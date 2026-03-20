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

  /**
   * Register a context.
   * @param {string} name - 'edit' or 'generate'
   * @param {object} els - { refFileInput, refBadgeRow, refBtn? }
   * @param {object} cbs - { onHtmlRef?(dataUrl), onClear?(), onFocusInput?() }
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
    if (ctx.callbacks.onClear) {
      ctx.callbacks.onClear();
    }
  }

  /** Read a File and show intent picker or badge. */
  function attachFromFile(contextName, file) {
    const ctx = contexts[contextName];
    if (!ctx) return;
    const isHtml = /\.html?$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      ctx.file = { name: file.name, type: file.type, dataUrl: reader.result, intent: 'match' };
      if (isHtml) {
        // HTML files always use 'match' intent, skip intent picker
        _showBadge(contextName, file.name, ' (HTML Design)');
        if (ctx.callbacks.onHtmlRef) {
          ctx.callbacks.onHtmlRef(reader.result);
        }
      } else if (file.type.startsWith('image/')) {
        showIntentPicker(contextName, file);
      } else {
        _showBadge(contextName, file.name, null);
      }
    };
    reader.readAsDataURL(file);
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
      <button class="clear-btn ref-clear-trigger" title="Remove reference" style="background:none;border:none;cursor:pointer;font-size:0.875rem;font-weight:800;opacity:0.6;padding:0 0 0 0.2rem;color:${clearColor}">&times;</button>
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
    const intentLabels = { none: '', mood: ' (Mood)', match: ' (Match)' };
    _showBadge(contextName, ctx.file.name, intentLabels[intent] || '');

    if (ctx.callbacks.onHtmlRef) {
      ctx.callbacks.onHtmlRef(ctx.file.dataUrl);
    }
    if (ctx.callbacks.onFocusInput) {
      ctx.callbacks.onFocusInput();
    }
  }

  /** Internal: render the reference badge. */
  function _showBadge(contextName, name, intentSuffix) {
    const ctx = contexts[contextName];
    if (!ctx) return;
    const display = name.length > 20
      ? name.slice(0, 8) + '...' + name.slice(-8)
      : name;
    const label = escapeHtml(display) + (intentSuffix || '');
    const row = ctx.elements.refBadgeRow;
    if (!row) return;

    row.innerHTML = `<span class="ref-badge">
      <span class="ref-badge-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span>
      <span class="ref-badge-label">${label}</span>
      <button class="clear-btn ref-clear-trigger" title="Remove reference">&times;</button>
    </span>`;
    row.classList.add('visible');

    if (ctx.elements.refBtn) {
      ctx.elements.refBtn.classList.add('active');
    }

    // Delegation for clear button in badge
    row.querySelector('.ref-clear-trigger').addEventListener('click', () => {
      clear(contextName);
    });
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
      if (file && (file.type.startsWith('image/') || /\.html?$/i.test(file.name))) {
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
    getFile,
    setFile,
    initPasteHandler,
    initDragDrop
  };
})();
