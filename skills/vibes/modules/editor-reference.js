/**
 * editor-reference.js — Reference file upload handling for both phases.
 * Deduplicates edit-phase and generate-phase reference logic.
 * State: referenceFile per context
 * Interface: window.EditorReference = {
 *   init, setEscapeHtml, pick, handleFile, attachFromFile, clear,
 *   showIntentPicker, getFile, setFile, initPasteHandler, initDragDrop
 * }
 */
(function() {
  // contexts: { edit: { file, elements, callbacks, opts }, generate: { ... } }
  const contexts = {};
  const intentAbortControllers = {};
  let escapeHtml = function(s) { return s; };

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
  const TEXT_EXTS = /\.(txt|md|csv|tsv|json|xml|rtf)$/i;
  const INTENT_PLACEHOLDERS = {
    seed: 'Build an app using this data, or describe what to do with it...',
    content: 'Describe how to display this content, or just hit send...',
    context: 'Describe what to build \u2014 the file will inform the design...',
    mood: 'Describe the app \u2014 the image sets the visual mood...',
    match: 'Describe the app \u2014 the image sets the layout and style...',
    none: 'Describe changes to your app...',
  };
  const DEFAULT_PLACEHOLDER = 'Describe changes to your app...';

  /**
   * Register a context.
   * @param {string} name - 'edit' or 'generate'
   * @param {object} els - { refFileInput, refBadgeRow, refBtn? }
   * @param {object} cbs - { onRefAttached?(dataUrl), onClear?(), onFocusInput?() }
   * @param {object} opts - { showContextIntent: boolean, clearBtnColor: string }
   */
  function init(name, els, cbs, opts) {
    contexts[name] = {
      file: null,
      elements: els || {},
      callbacks: cbs || {},
      opts: opts || {}
    };
  }

  function setEscapeHtml(fn) {
    escapeHtml = fn;
  }

  /** Click the hidden file input for this context. */
  function pick(contextName) {
    const ctx = contexts[contextName];
    if (!ctx) return;
    ctx.elements.refFileInput.click();
  }

  /** Handle file input change event. */
  function handleFile(contextName, event) {
    const file = event.target.files[0];
    if (!file) return;
    attachFromFile(contextName, file);
    event.target.value = '';
  }

  /** Clear the reference for this context. */
  function clear(contextName) {
    const ctx = contexts[contextName];
    if (!ctx) return;
    ctx.file = null;
    if (ctx.elements.refBadgeRow) {
      ctx.elements.refBadgeRow.classList.remove('visible');
    }
    if (ctx.elements.refBtn) {
      ctx.elements.refBtn.classList.remove('active');
    }
    _setPlaceholder(contextName, null);
    if (ctx.callbacks.onClear) {
      ctx.callbacks.onClear();
    }
  }

  /** Internal: update the textarea placeholder based on intent. */
  function _setPlaceholder(contextName, intent) {
    const ctx = contexts[contextName];
    if (!ctx || !ctx.elements.inputEl) return;
    ctx.elements.inputEl.placeholder = intent ? (INTENT_PLACEHOLDERS[intent] || DEFAULT_PLACEHOLDER) : DEFAULT_PLACEHOLDER;
  }

  /** Read a File and show intent picker or badge. */
  function attachFromFile(contextName, file) {
    const ctx = contexts[contextName];
    if (!ctx) return;

    // Size limit
    if (file.size > MAX_FILE_SIZE) {
      const row = ctx.elements.refBadgeRow;
      if (row) {
        row.innerHTML = '<span class="ref-badge" style="background:var(--vibes-red);color:white;">File too large (max 50 MB)</span>';
        row.classList.add('visible');
        setTimeout(() => clear(contextName), 3000);
      }
      return;
    }

    const isHtml = /\.html?$/i.test(file.name);
    const isText = TEXT_EXTS.test(file.name);
    const reader = new FileReader();

    reader.onload = () => {
      if (isText) {
        ctx.file = { name: file.name, type: file.type, dataUrl: null, textContent: reader.result, intent: 'content' };
        showTextIntentPicker(contextName, file);
      } else {
        ctx.file = { name: file.name, type: file.type, dataUrl: reader.result, textContent: null, intent: 'match' };
        if (isHtml) {
          _showBadge(contextName, file.name, ' (HTML Design)');
          if (ctx.callbacks.onRefAttached) {
            ctx.callbacks.onRefAttached(reader.result);
          }
        } else if (file.type.startsWith('image/')) {
          showIntentPicker(contextName, file);
        } else {
          // Binary files (PDF, DOCX, etc.) — show badge directly
          _showBadge(contextName, file.name, '');
        }
      }
    };

    if (isText) {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  }

  /** Show intent picker for an image file. */
  function showIntentPicker(contextName, file) {
    const ctx = contexts[contextName];
    if (!ctx) return;
    const display = file.name.length > 20
      ? file.name.slice(0, 8) + '...' + file.name.slice(-8)
      : file.name;
    const row = ctx.elements.refBadgeRow;
    if (!row) return;

    const clearColor = ctx.opts.clearBtnColor || 'var(--vibes-near-black)';

    // Build intent buttons — edit phase includes 'Context', generate phase omits it
    let intentBtns = '';
    if (ctx.opts.showContextIntent) {
      intentBtns += `<button class="ref-intent-btn" data-intent="none">Context</button>`;
    }
    intentBtns += `<button class="ref-intent-btn" data-intent="mood">Mood</button>`;
    intentBtns += `<button class="ref-intent-btn" data-intent="match">Match Layout</button>`;

    row.innerHTML = `<div class="ref-intent-picker">
      <span class="ref-intent-label">${escapeHtml(display)}</span>
      ${intentBtns}
      <button class="ref-intent-btn ref-clear-trigger" title="Remove reference" style="color:var(--vibes-red);border-color:var(--vibes-red);">&times; Remove</button>
    </div>`;
    row.classList.add('visible');

    if (ctx.elements.refBtn) {
      ctx.elements.refBtn.classList.add('active');
    }

    // Event delegation for intent buttons and clear button.
    // Abort previous listener to prevent accumulation across multiple showIntentPicker calls.
    if (intentAbortControllers[contextName]) intentAbortControllers[contextName].abort();
    intentAbortControllers[contextName] = new AbortController();
    row.addEventListener('click', _intentPickerClickHandler.bind(null, contextName),
      { signal: intentAbortControllers[contextName].signal });
  }

  /** Show intent picker for a text/data file. */
  function showTextIntentPicker(contextName, file) {
    const ctx = contexts[contextName];
    if (!ctx) return;
    const display = file.name.length > 20
      ? file.name.slice(0, 8) + '...' + file.name.slice(-8)
      : file.name;
    const row = ctx.elements.refBadgeRow;
    if (!row) return;

    row.innerHTML = `<div class="ref-intent-picker">
      <span class="ref-intent-label">${escapeHtml(display)}</span>
      <button class="ref-intent-btn" data-intent="seed" data-tooltip="Parse this file and populate the app's database">Seed Data</button>
      <button class="ref-intent-btn" data-intent="content" data-tooltip="The app should display or reference this text">Content</button>
      <button class="ref-intent-btn" data-intent="context" data-tooltip="Background info for the AI — won't be included in the app">Context</button>
      <button class="ref-intent-btn ref-clear-trigger" data-tooltip="Remove file" style="color:var(--vibes-red);border-color:var(--vibes-red);">&times; Remove</button>
    </div>`;
    row.classList.add('visible');

    if (ctx.elements.refBtn) {
      ctx.elements.refBtn.classList.add('active');
    }

    if (intentAbortControllers[contextName]) intentAbortControllers[contextName].abort();
    intentAbortControllers[contextName] = new AbortController();
    row.addEventListener('click', _intentPickerClickHandler.bind(null, contextName),
      { signal: intentAbortControllers[contextName].signal });
  }

  /** Internal: handle clicks within the intent picker via delegation. */
  function _intentPickerClickHandler(contextName, e) {
    const intentBtn = e.target.closest('.ref-intent-btn');
    const clearBtn = e.target.closest('.ref-clear-trigger');

    if (clearBtn) {
      clear(contextName);
      return;
    }

    if (intentBtn) {
      const intent = intentBtn.dataset.intent;
      _pickIntent(contextName, intent);
    }
  }

  /** Internal: commit intent selection and show badge. */
  function _pickIntent(contextName, intent) {
    const ctx = contexts[contextName];
    if (!ctx || !ctx.file) return;
    ctx.file.intent = intent;
    const intentLabels = { none: '', mood: ' (Mood)', match: ' (Match)', seed: ' (Seed Data)', content: ' (Content)', context: ' (Context)' };
    _showBadge(contextName, ctx.file.name, intentLabels[intent] || '');
    _setPlaceholder(contextName, intent);

    if (ctx.callbacks.onRefAttached) {
      ctx.callbacks.onRefAttached(ctx.file.dataUrl || ctx.file.textContent);
    }
    if (ctx.callbacks.onFocusInput) {
      ctx.callbacks.onFocusInput();
    }
  }

  /** Internal: render the reference badge. Clicking the label reopens the picker. */
  function _showBadge(contextName, name, intentSuffix) {
    const ctx = contexts[contextName];
    if (!ctx) return;
    const display = name.length > 20
      ? name.slice(0, 8) + '...' + name.slice(-8)
      : name;
    const label = escapeHtml(display) + (intentSuffix || '');
    const row = ctx.elements.refBadgeRow;
    if (!row) return;

    row.innerHTML = `<span class="ref-badge ref-badge-clickable" data-tooltip="Click to change intent">
      <span class="ref-badge-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span>
      <span class="ref-badge-label">${label}</span>
      <button class="clear-btn ref-clear-trigger" title="Remove reference">&times;</button>
    </span>`;
    row.classList.add('visible');

    if (ctx.elements.refBtn) {
      ctx.elements.refBtn.classList.add('active');
    }

    // Click badge label to reopen intent picker
    const badge = row.querySelector('.ref-badge');
    badge.addEventListener('click', (e) => {
      // Don't reopen if user clicked the X button
      if (e.target.closest('.ref-clear-trigger')) return;
      _reopenPicker(contextName);
    });

    // X button removes the file
    row.querySelector('.ref-clear-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      clear(contextName);
    });
  }

  /** Internal: reopen the appropriate intent picker for the current file. */
  function _reopenPicker(contextName) {
    const ctx = contexts[contextName];
    if (!ctx || !ctx.file) return;
    const isText = TEXT_EXTS.test(ctx.file.name);
    const isImage = ctx.file.type && ctx.file.type.startsWith('image/');
    // Create a minimal file-like object for the picker functions
    const fakeFile = { name: ctx.file.name, type: ctx.file.type };
    if (isText) {
      showTextIntentPicker(contextName, fakeFile);
    } else if (isImage) {
      showIntentPicker(contextName, fakeFile);
    }
    // HTML and binary files don't have intent pickers
  }

  /** Get the current reference file for a context. */
  function getFile(contextName) {
    return contexts[contextName] ? contexts[contextName].file : null;
  }

  /**
   * Set the reference file directly (used by imggen accept flow).
   * Does NOT update badge UI — caller should call showIntentPicker after.
   */
  function setFile(contextName, file) {
    const ctx = contexts[contextName];
    if (!ctx) return;
    ctx.file = file;
  }

  /** Attach paste-image handler to a textarea element. */
  function initPasteHandler(contextName, textareaEl) {
    if (!textareaEl) return;
    textareaEl.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const named = new File([file], file.name || 'pasted-image.png', { type: file.type });
            attachFromFile(contextName, named);
          }
          return;
        }
      }
    });
  }

  /** Attach drag-and-drop handler to a drop target element. */
  function initDragDrop(contextName, dropTarget) {
    if (!dropTarget) return;
    dropTarget.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropTarget.style.outline = '2px solid var(--vibes-blue)';
    });
    dropTarget.addEventListener('dragleave', () => {
      dropTarget.style.outline = '';
    });
    dropTarget.addEventListener('drop', (e) => {
      e.preventDefault();
      dropTarget.style.outline = '';
      const file = e.dataTransfer.files[0];
      if (file) {
        attachFromFile(contextName, file);
      }
    });
  }

  window.EditorReference = {
    init,
    setEscapeHtml,
    pick,
    handleFile,
    attachFromFile,
    clear,
    showIntentPicker,
    showTextIntentPicker,
    getFile,
    setFile,
    initPasteHandler,
    initDragDrop
  };
})();
