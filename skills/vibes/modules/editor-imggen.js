/**
 * editor-imggen.js — Image generation UI with draggable popovers.
 * Deduplicates edit-phase and generate-phase image generation.
 * State: images[] and carouselIndex per context, hasOpenRouterKey
 * Interface: window.EditorImgGen = {
 *   init, initContext, setHasKey, saveKey, toggle, close,
 *   generate, onResult, accept, prev, next
 * }
 */
(function() {
  let hasOpenRouterKey = false;
  let sharedCallbacks = {};
  // ctxs: { edit: { images, index, elements }, generate: { ... } }
  const ctxs = {};

  /**
   * Position a popover relative to a toggle button.
   * Centers the popover above the button, clamped to viewport.
   */
  function positionPopover(pop, btn) {
    const r = btn.getBoundingClientRect();
    let left = r.left + r.width / 2 - 160; // 320/2
    let top = r.top - 8;
    // Clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - 328));
    top = Math.max(8, top);
    // If not enough room above, place below
    if (top < 100) top = r.bottom + 8;
    else top = top - pop.offsetHeight || top - 200;
    pop.style.left = left + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  /** Initialize draggable popover handles. */
  function initDrag() {
    let dragging = null, startX, startY, origX, origY;
    document.addEventListener('mousedown', (e) => {
      const handle = e.target.closest('.imggen-drag-handle');
      if (!handle || e.target.closest('.imggen-drag-close')) return;
      const popId = handle.dataset.drag;
      if (!popId) return;
      dragging = document.getElementById(popId);
      if (!dragging) return;
      const rect = dragging.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      origX = rect.left; origY = rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      dragging.style.left = Math.max(0, Math.min(origX + dx, window.innerWidth - dragging.offsetWidth)) + 'px';
      dragging.style.top = Math.max(0, Math.min(origY + dy, window.innerHeight - dragging.offsetHeight)) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = null; });
  }

  /** Close popovers when clicking outside them. */
  function initOutsideClickClose() {
    document.addEventListener('mousedown', (e) => {
      for (const [ctxName, ctx] of Object.entries(ctxs)) {
        const pop = ctx.elements.popover;
        const toggleBtn = ctx.elements.toggleBtn;
        if (pop && pop.classList.contains('open') &&
            !pop.contains(e.target) &&
            !(toggleBtn && toggleBtn.contains(e.target))) {
          close(ctxName);
        }
      }
    });
  }

  /**
   * Initialize the module.
   * @param {object} cbs - {
   *   onSendWs(msg),
   *   getModel(),
   *   isWsOpen(),
   *   onAcceptImage(file, contextName)
   * }
   */
  function init(cbs) {
    sharedCallbacks = cbs || {};
    initDrag();
    initOutsideClickClose();
  }

  /**
   * Register a context.
   * @param {string} name - 'edit' or 'generate'
   * @param {object} els - {
   *   popover, toggleBtn, keyForm, promptRow, promptInput,
   *   goBtn, preview, actions, counter, keyInput, keyHint
   * }
   */
  function initContext(name, els) {
    ctxs[name] = { images: [], index: 0, elements: els || {} };
  }

  /** Update key UI for all registered contexts. */
  function _updateKeyUI() {
    for (const ctx of Object.values(ctxs)) {
      const els = ctx.elements;
      if (els.keyForm) els.keyForm.style.display = hasOpenRouterKey ? 'none' : 'flex';
      if (els.promptRow) els.promptRow.style.display = hasOpenRouterKey ? 'flex' : 'none';
    }
  }

  /**
   * Set the OpenRouter key availability flag.
   * Updates key/prompt row visibility across all contexts.
   */
  function setHasKey(hasKey) {
    hasOpenRouterKey = hasKey;
    _updateKeyUI();
  }

  /**
   * Save the OpenRouter API key entered in a context's key input.
   * Posts to /editor/credentials.
   */
  function saveKey(contextName) {
    const ctx = ctxs[contextName];
    if (!ctx) return;
    const els = ctx.elements;
    const key = els.keyInput ? els.keyInput.value.trim() : '';
    if (!key.startsWith('sk-or-') || key.length < 10) {
      if (els.keyHint) {
        els.keyHint.textContent = 'Key must start with sk-or- and be at least 10 characters';
        els.keyHint.style.display = 'block';
      }
      return;
    }
    if (els.keyHint) els.keyHint.style.display = 'none';
    fetch('/editor/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ OPENROUTER_API_KEY: key })
    }).then(r => r.json()).then(data => {
      if (data.error) {
        if (els.keyHint) {
          els.keyHint.textContent = data.error;
          els.keyHint.style.display = 'block';
        }
      } else {
        hasOpenRouterKey = true;
        _updateKeyUI();
      }
    }).catch(() => {
      if (els.keyHint) {
        els.keyHint.textContent = 'Failed to save key';
        els.keyHint.style.display = 'block';
      }
    });
  }

  /** Toggle the popover open/closed for a context. */
  function toggle(contextName) {
    const ctx = ctxs[contextName];
    if (!ctx) return;
    const pop = ctx.elements.popover;
    if (!pop) return;
    if (pop.classList.contains('open')) {
      close(contextName);
      return;
    }
    _updateKeyUI();
    positionPopover(pop, ctx.elements.toggleBtn);
    pop.classList.add('open');
    if (hasOpenRouterKey) {
      if (ctx.elements.promptInput) ctx.elements.promptInput.focus();
    } else {
      if (ctx.elements.keyInput) ctx.elements.keyInput.focus();
    }
  }

  /** Close the popover for a context. */
  function close(contextName) {
    const ctx = ctxs[contextName];
    if (!ctx) return;
    const pop = ctx.elements.popover;
    if (pop) {
      pop.classList.remove('open');
      pop.style.left = '';
      pop.style.top = '';
    }
    if (ctx.elements.toggleBtn) {
      ctx.elements.toggleBtn.classList.remove('active');
    }
  }

  /** Send an image generation request via WebSocket. */
  function generate(contextName) {
    const ctx = ctxs[contextName];
    if (!ctx) return;
    const els = ctx.elements;
    const prompt = els.promptInput ? els.promptInput.value.trim() : '';
    if (!prompt || !sharedCallbacks.isWsOpen || !sharedCallbacks.isWsOpen()) return;

    if (els.goBtn) els.goBtn.disabled = true;
    if (els.preview) {
      els.preview.style.display = 'flex';
      els.preview.innerHTML = '<div class="spinner"></div>';
    }
    if (els.actions) els.actions.style.display = 'none';
    if (els.counter) els.counter.style.display = 'none';

    // Tag context so WS result handler routes correctly
    window._imggenContext = contextName === 'generate' ? 'gen' : 'chat';

    const model = sharedCallbacks.getModel ? sharedCallbacks.getModel() : undefined;
    sharedCallbacks.onSendWs({ type: 'generate_image', prompt, model });
  }

  /**
   * Handle an image generation result.
   * Adds image to carousel and re-renders.
   */
  function onResult(contextName, imageUrl, prompt) {
    const ctx = ctxs[contextName];
    if (!ctx) return;
    ctx.images.push({ url: imageUrl, prompt });
    ctx.index = ctx.images.length - 1;
    _renderPreview(contextName);
    if (ctx.elements.goBtn) ctx.elements.goBtn.disabled = false;
  }

  /** Internal: render carousel preview for a context. */
  function _renderPreview(contextName) {
    const ctx = ctxs[contextName];
    if (!ctx || ctx.images.length === 0) return;
    const img = ctx.images[ctx.index];
    const preview = ctx.elements.preview;
    if (!preview) return;

    preview.style.display = 'flex';
    preview.innerHTML = `<img src="${img.url}" alt="Generated image" />`;

    if (ctx.images.length > 1) {
      const prevBtn = document.createElement('button');
      prevBtn.className = 'imggen-nav prev';
      prevBtn.innerHTML = '&#8249;';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        prev(contextName);
      });

      const nextBtn = document.createElement('button');
      nextBtn.className = 'imggen-nav next';
      nextBtn.innerHTML = '&#8250;';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        next(contextName);
      });

      preview.appendChild(prevBtn);
      preview.appendChild(nextBtn);
    }

    if (ctx.elements.counter) {
      ctx.elements.counter.style.display = '';
      ctx.elements.counter.textContent = (ctx.index + 1) + ' / ' + ctx.images.length;
    }
    if (ctx.elements.actions) {
      ctx.elements.actions.style.display = 'flex';
    }
  }

  /**
   * Accept the current generated image — converts to a reference file
   * and calls onAcceptImage so the main editor can wire it to EditorReference.
   */
  function accept(contextName) {
    const ctx = ctxs[contextName];
    if (!ctx || ctx.images.length === 0) return;
    const img = ctx.images[ctx.index];

    const file = {
      name: 'generated-' + Date.now() + '.png',
      type: 'image/png',
      dataUrl: img.url,
      intent: 'match'
    };

    if (sharedCallbacks.onAcceptImage) {
      sharedCallbacks.onAcceptImage(file, contextName);
    }

    close(contextName);

    // Reset carousel state
    ctx.images = [];
    ctx.index = 0;
    const els = ctx.elements;
    if (els.preview) els.preview.style.display = 'none';
    if (els.actions) els.actions.style.display = 'none';
    if (els.counter) els.counter.style.display = 'none';
  }

  /** Navigate to previous image in carousel. */
  function prev(contextName) {
    const ctx = ctxs[contextName];
    if (!ctx || ctx.images.length === 0) return;
    ctx.index = (ctx.index - 1 + ctx.images.length) % ctx.images.length;
    _renderPreview(contextName);
  }

  /** Navigate to next image in carousel. */
  function next(contextName) {
    const ctx = ctxs[contextName];
    if (!ctx || ctx.images.length === 0) return;
    ctx.index = (ctx.index + 1) % ctx.images.length;
    _renderPreview(contextName);
  }

  window.EditorImgGen = {
    init,
    initContext,
    setHasKey,
    saveKey,
    toggle,
    close,
    generate,
    onResult,
    accept,
    prev,
    next
  };
})();
