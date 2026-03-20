/**
 * editor-themes.js — Theme modal, palette editor, save/delete flows.
 * Depends on: window.EditorColorUtils (editor-color-utils.js)
 * State: themes[], currentThemeId, pendingThemeId, saveMode, paletteState, savedPaletteState
 * Init receives: elements{themeModal, themeGrid, themeSearch, currentThemeBadge,
 *   saveThemeSection, saveThemeToggle, saveThemeBtn, saveThemeName, saveThemeStatus,
 *   themeSelect, paletteSidebar, paletteSlots, paletteContrast, harmonyMode, previewFrame}
 * Callbacks: { onSendWs(msg), isWsOpen(), onReloadPreview(), onAddMessage(role, text),
 *   getModel(), getCurrentAppName(), isThinking(), setThinking(enabled, progress, stage),
 *   buildThemeCarousel(), selectThemeCarousel(id), confetti, themeThumbHtml(id, ctx) }
 * Interface: window.EditorThemes = { init, setThemes, getThemes, getCurrentId, setCurrentId,
 *   setPendingId, load: reload, reload, open, close, select, confirmDelete,
 *   delete: deleteTheme, onDeleted, toggleSaveMode, saveCurrent, updateSaveProgress,
 *   onCreated, filterThemes, openPalette, closePalette, cancelPalette, savePalette, applyHarmony }
 */
(function() {
  // Private state
  let themes = [];
  let currentThemeId = null;
  let pendingThemeId = null;
  let saveMode = false;

  let paletteState = {
    bg: '#1a1a2e', text: '#eaeaea', border: '#334455', accent: '#e94560',
    accentText: '#ffffff', muted: '#555555', colorBg: '#111122', gridColor: '#33445522'
  };
  let savedPaletteState = null;

  const PALETTE_SLOTS = [
    { key: 'bg',         label: 'Background',  cssVar: '--comp-bg' },
    { key: 'text',       label: 'Text',        cssVar: '--comp-text' },
    { key: 'border',     label: 'Border',      cssVar: '--comp-border' },
    { key: 'accent',     label: 'Accent',      cssVar: '--comp-accent' },
    { key: 'accentText', label: 'Accent Text', cssVar: '--comp-accent-text' },
    { key: 'muted',      label: 'Muted',       cssVar: '--comp-muted' },
    { key: 'colorBg',   label: 'Page BG',     cssVar: '--color-background' },
    { key: 'gridColor',  label: 'Grid',        cssVar: '--grid-color' },
  ];

  let elements = {};
  let callbacks = {};

  // ===========================
  // Init
  // ===========================

  function init(els, cbs) {
    elements = els || {};
    callbacks = cbs || {};

    // Theme modal click-outside handler
    if (elements.themeModal) {
      elements.themeModal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) close();
      });
    }

    // Theme grid event delegation: card click → select, delete button click → confirmDelete
    if (elements.themeGrid) {
      elements.themeGrid.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('[data-delete-id]');
        if (deleteBtn) {
          e.stopPropagation();
          const id = deleteBtn.dataset.deleteId;
          const name = deleteBtn.dataset.deleteName;
          confirmDelete(id, name, e);
          return;
        }
        const card = e.target.closest('[data-theme-id]');
        if (card) {
          select(card.dataset.themeId);
        }
      });
    }

    // Palette slots event delegation
    if (elements.paletteSlots) {
      elements.paletteSlots.addEventListener('change', (e) => {
        const colorInput = e.target.closest('input[type=color][data-slot-color]');
        if (colorInput) {
          onSlotColorChange(colorInput.dataset.slotColor, colorInput.value);
          return;
        }
        const textInput = e.target.closest('input[type=text][data-slot]');
        if (textInput) {
          onSlotHexInput(textInput.dataset.slot, textInput.value);
        }
      });
      elements.paletteSlots.addEventListener('input', (e) => {
        const colorInput = e.target.closest('input[type=color][data-slot-color]');
        if (colorInput) {
          onSlotColorChange(colorInput.dataset.slotColor, colorInput.value);
        }
      });
    }
  }

  // ===========================
  // State accessors
  // ===========================

  function setThemes(list) { themes = list || []; }
  function getThemes() { return themes; }
  function getCurrentId() { return currentThemeId; }
  function setCurrentId(id) { currentThemeId = id; }
  function setPendingId(id) { pendingThemeId = id; }

  // ===========================
  // Theme Grid
  // ===========================

  function renderThemeGrid(filter) {
    const grid = elements.themeGrid;
    if (!grid) return;
    const q = (filter || '').toLowerCase().trim();

    const filtered = q
      ? themes.filter(t => `${t.name} ${t.mood} ${t.bestFor}`.toLowerCase().includes(q))
      : themes;

    const recommended = filtered.filter(t => t.recommended);
    const rest = filtered.filter(t => !t.recommended);

    function swatchHtml(colors) {
      if (!colors) return '';
      const bg = colors.bg || '#333';
      const text = colors.text || '#fff';
      const accent = colors.accent || '#888';
      const muted = colors.muted || '#666';
      return `<div class="theme-swatches">
        <div class="theme-swatch-bar">
          <div class="theme-swatch-segment" style="background:${bg};flex:3"></div>
          <div class="theme-swatch-segment" style="background:${text};flex:1"></div>
          <div class="theme-swatch-segment" style="background:${accent};flex:2"></div>
          <div class="theme-swatch-segment" style="background:${muted};flex:1"></div>
        </div>
      </div>`;
    }

    function cardHtml(t) {
      const escapedName = t.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return `<div class="theme-card${t.recommended ? ' recommended' : ''}" data-theme-id="${t.id}">
        <button class="theme-card-delete" data-delete-id="${t.id}" data-delete-name="${escapedName}" title="Delete theme">&times;</button>
        ${callbacks.themeThumbHtml ? callbacks.themeThumbHtml(t.id, 'card') : ''}
        <div class="theme-card-body">
          ${swatchHtml(t.colors)}
          <div class="theme-card-name">${t.name}${t.recommended ? '<span class="theme-card-badge">recommended</span>' : ''}</div>
          <div class="theme-card-mood">${t.mood}</div>
          <div class="theme-card-for">${t.bestFor}</div>
        </div>
      </div>`;
    }

    let html = '';
    if (recommended.length > 0) {
      html += `<div class="theme-section-label">Recommended for your app</div>`;
      html += `<div class="theme-grid">${recommended.map(cardHtml).join('')}</div>`;
    }
    if (rest.length > 0) {
      html += `<div class="theme-section-label all">${recommended.length > 0 ? 'All themes' : 'Themes'}</div>`;
      html += `<div class="theme-grid">${rest.map(cardHtml).join('')}</div>`;
    }
    if (filtered.length === 0) {
      html = `<div style="text-align:center;color:#555;padding:2rem;">No themes match "${filter}"</div>`;
    }
    grid.innerHTML = html;
  }

  function filterThemes(value) {
    renderThemeGrid(value);
  }

  // ===========================
  // Theme Selection & Deletion
  // ===========================

  function select(themeId) {
    if (callbacks.isThinking && callbacks.isThinking()) return;
    if (!callbacks.isWsOpen || !callbacks.isWsOpen()) return;
    const theme = themes.find(t => t.id === themeId);
    if (callbacks.onAddMessage) callbacks.onAddMessage('user', `Switch to theme: ${theme ? theme.name : themeId}`);
    pendingThemeId = themeId;
    currentThemeId = themeId;
    if (callbacks.setThinking) callbacks.setThinking(true, 0, 'Switching theme...');
    if (callbacks.onSendWs) {
      callbacks.onSendWs({
        type: 'theme',
        themeId,
        model: callbacks.getModel ? callbacks.getModel() : undefined,
        app: callbacks.getCurrentAppName ? callbacks.getCurrentAppName() : undefined
      });
    }
    close();
  }

  function confirmDelete(themeId, themeName, event) {
    const card = elements.themeGrid
      ? elements.themeGrid.querySelector(`[data-theme-id="${themeId}"]`)
      : (event && event.target ? event.target.closest('.theme-card') : null);
    if (!card) return;
    if (card.querySelector('.delete-confirm')) return; // already showing

    const confirm = document.createElement('div');
    confirm.className = 'delete-confirm';
    confirm.style.cssText = 'position:absolute;inset:0;background:rgba(26,26,26,0.92);border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem;z-index:2;';

    const label = document.createElement('div');
    label.style.cssText = 'color:var(--vibes-cream);font-size:0.75rem;font-weight:700;text-align:center;padding:0 0.5rem;';
    label.textContent = `Delete "${themeName}"?`;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:0.4rem;';

    const deleteBtn = document.createElement('button');
    deleteBtn.style.cssText = 'background:var(--vibes-red);color:white;border:1.5px solid var(--vibes-red);border-radius:6px;padding:0.25rem 0.6rem;font-size:0.65rem;font-weight:700;cursor:pointer;font-family:inherit;text-transform:uppercase;';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTheme(themeId); });

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = 'background:var(--vibes-cream);color:var(--vibes-near-black);border:1.5px solid var(--vibes-near-black);border-radius:6px;padding:0.25rem 0.6rem;font-size:0.65rem;font-weight:700;cursor:pointer;font-family:inherit;text-transform:uppercase;';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); confirm.remove(); });

    btnRow.appendChild(deleteBtn);
    btnRow.appendChild(cancelBtn);
    confirm.appendChild(label);
    confirm.appendChild(btnRow);
    confirm.addEventListener('click', (e) => e.stopPropagation());
    card.appendChild(confirm);
  }

  function deleteTheme(themeId) {
    if (!callbacks.isWsOpen || !callbacks.isWsOpen()) return;
    if (callbacks.onSendWs) {
      callbacks.onSendWs({ type: 'delete_theme', themeId });
    }
  }

  function onDeleted(themeId) {
    themes = themes.filter(t => t.id !== themeId);
    renderThemeGrid(elements.themeSearch ? elements.themeSearch.value : '');
  }

  // ===========================
  // Modal Open / Close
  // ===========================

  function open() {
    if (elements.themeModal) elements.themeModal.classList.add('open');
    if (elements.themeSearch) elements.themeSearch.value = '';
    renderThemeGrid();
    // Show current theme badge
    if (elements.currentThemeBadge) {
      if (currentThemeId) {
        const t = themes.find(th => th.id === currentThemeId);
        elements.currentThemeBadge.textContent = 'Current: ' + (t ? t.name : currentThemeId);
        elements.currentThemeBadge.style.display = '';
      } else {
        elements.currentThemeBadge.style.display = 'none';
      }
    }
    if (elements.themeSearch) {
      setTimeout(() => { elements.themeSearch.focus(); }, 100);
    }
  }

  function close() {
    if (elements.themeModal) elements.themeModal.classList.remove('open');
  }

  // ===========================
  // Save Current Theme
  // ===========================

  function toggleSaveMode() {
    saveMode = !saveMode;
    if (elements.saveThemeSection) elements.saveThemeSection.style.display = saveMode ? '' : 'none';
    if (elements.themeSearch) elements.themeSearch.style.display = saveMode ? 'none' : '';
    if (elements.themeGrid) elements.themeGrid.style.display = saveMode ? 'none' : '';
    if (elements.saveThemeToggle) elements.saveThemeToggle.textContent = saveMode ? 'Browse' : 'Save Theme';
    if (saveMode) {
      if (elements.saveThemeBtn) elements.saveThemeBtn.disabled = false;
      if (elements.saveThemeName) {
        elements.saveThemeName.disabled = false;
        elements.saveThemeName.focus();
      }
      if (elements.saveThemeStatus) elements.saveThemeStatus.innerHTML = '';
    } else {
      renderThemeGrid();
    }
  }

  function saveCurrent() {
    const input = elements.saveThemeName;
    const name = input ? input.value.trim() : '';
    if (!name) return;
    if (!callbacks.isWsOpen || !callbacks.isWsOpen()) return;

    if (elements.saveThemeBtn) elements.saveThemeBtn.disabled = true;
    if (elements.saveThemeStatus) {
      elements.saveThemeStatus.innerHTML = `
        <div class="create-status">
          <div class="spinner" style="display:inline-block;width:16px;height:16px;vertical-align:middle;margin-right:0.5rem;"></div>
          <span id="saveThemeStage">Analyzing app styles...</span>
          <div class="thinking-progress-bar" style="margin-top:0.5rem;">
            <div class="thinking-progress-fill" id="saveThemeFill" style="width: 0%"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.7rem;opacity:0.7;margin-top:0.25rem;">
            <span id="saveThemePct">0%</span>
            <span id="saveThemeTime">0s</span>
          </div>
        </div>`;
    }

    if (callbacks.onSendWs) {
      callbacks.onSendWs({
        type: 'save_theme',
        name,
        model: callbacks.getModel ? callbacks.getModel() : undefined,
        app: callbacks.getCurrentAppName ? callbacks.getCurrentAppName() : undefined
      });
    }
  }

  function updateSaveProgress(progress, stage, elapsed) {
    // These elements are created dynamically by saveCurrent(); use document.getElementById
    const fill = document.getElementById('saveThemeFill');
    const pct = document.getElementById('saveThemePct');
    const time = document.getElementById('saveThemeTime');
    const stageEl = document.getElementById('saveThemeStage');
    if (fill) fill.style.width = (progress || 0) + '%';
    if (pct) pct.textContent = (progress || 0) + '%';
    if (time) time.textContent = (elapsed || 0) + 's';
    if (stageEl && stage) stageEl.textContent = stage;
  }

  async function onCreated(themeId, themeName) {
    if (elements.saveThemeBtn) elements.saveThemeBtn.disabled = false;

    // Set the new theme as the current active theme
    currentThemeId = themeId;

    // Floating toast in center of screen
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10001;background:var(--vibes-near-black);color:var(--vibes-cream);padding:1.25rem 2.5rem;border-radius:12px;font-size:1.2rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;border:2px solid var(--vibes-cream);box-shadow:0 8px 32px rgba(0,0,0,0.5);pointer-events:none;opacity:0;transition:opacity 0.3s;';
    toast.textContent = '"' + themeName + '" saved!';
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.style.opacity = '1');

    // Rainbow confetti burst
    const confetti = callbacks.confetti;
    if (confetti) {
      const rainbowColors = ['#ff0000', '#ffa500', '#fedd00', '#008000', '#009ace', '#4b0082', '#ee82ee'];
      const duration = 2000;
      const end = Date.now() + duration;
      (function frame() {
        confetti({ particleCount: 7, angle: 60, spread: 55, origin: { x: 0 }, colors: rainbowColors, zIndex: 10000 });
        confetti({ particleCount: 7, angle: 120, spread: 55, origin: { x: 1 }, colors: rainbowColors, zIndex: 10000 });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
    }

    // Capture preview in background (don't block UI)
    captureThemePreview(themeId);

    // Reset save mode UI back to browse
    saveMode = false;
    if (elements.saveThemeSection) elements.saveThemeSection.style.display = 'none';
    if (elements.themeSearch) elements.themeSearch.style.display = '';
    if (elements.themeGrid) elements.themeGrid.style.display = '';
    if (elements.saveThemeToggle) elements.saveThemeToggle.textContent = 'Save Theme';
    if (elements.saveThemeName) elements.saveThemeName.value = '';
    if (elements.saveThemeStatus) elements.saveThemeStatus.innerHTML = '';

    // Close modal, reload themes, carousel will update
    close();

    await reload();
    if (callbacks.selectThemeCarousel) callbacks.selectThemeCarousel(themeId);

    // Fade toast
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 1500);
  }

  // ===========================
  // captureThemePreview (~110 lines verbatim)
  // ===========================

  async function captureThemePreview(themeId) {
    try {
      // Read current theme colors from the preview iframe
      const pf = elements.previewFrame || document.getElementById('previewFrame');
      const pdoc = pf?.contentDocument;
      if (!pdoc) return;
      const cs = getComputedStyle(pdoc.documentElement);
      const v = (name) => cs.getPropertyValue(name)?.trim() || '';
      const bg = v('--comp-bg') || '#1a1a2e';
      const text = v('--comp-text') || '#eee';
      const border = v('--comp-border') || '#333';
      const accent = v('--comp-accent') || '#e94560';
      const accentText = v('--comp-accent-text') || '#fff';
      const muted = v('--comp-muted') || '#888';
      const pageBg = v('--color-background') || '#0f0f23';

      // Draw showcase directly to canvas — no iframes or external libs needed
      const W = 800, H = 500;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Helper functions
      const roundRect = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
      const fillRect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

      // Page background
      fillRect(0, 0, W, H, pageBg);

      // Header
      ctx.fillStyle = text; ctx.font = 'bold 22px system-ui'; ctx.fillText('Theme Preview', 24, 40);
      ctx.fillStyle = muted; ctx.font = '10px system-ui'; ctx.fillText('SHOWCASE', 680, 38);
      ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(24, 52); ctx.lineTo(W - 24, 52); ctx.stroke();

      // Card — table
      const cardY = 66, cardH = 180;
      roundRect(24, cardY, W - 48, cardH, 8); ctx.fillStyle = bg; ctx.fill();
      roundRect(24, cardY, W - 48, cardH, 8); ctx.strokeStyle = border; ctx.stroke();

      // Table header
      ctx.fillStyle = muted; ctx.font = '9px system-ui';
      const cols = ['ITEM', 'CATEGORY', 'VALUE', 'STATUS'];
      const colX = [40, 250, 440, 580];
      cols.forEach((c, i) => ctx.fillText(c, colX[i], cardY + 28));
      ctx.strokeStyle = border; ctx.beginPath(); ctx.moveTo(40, cardY + 35); ctx.lineTo(W - 40, cardY + 35); ctx.stroke();

      // Table rows
      const rows = [
        ['Alpha Module', 'Core', '92', 'Active'],
        ['Beta System', 'Util', '85', 'Stable'],
        ['Gamma Process', 'Data', '78', 'Pending'],
      ];
      rows.forEach((row, ri) => {
        const ry = cardY + 56 + ri * 42;
        ctx.fillStyle = text; ctx.font = '14px system-ui';
        ctx.fillText(row[0], colX[0], ry); ctx.fillText(row[1], colX[1], ry);
        ctx.font = 'bold 20px system-ui'; ctx.fillText(row[2], colX[2], ry + 2);
        if (row[3] === 'Active') {
          roundRect(colX[3], ry - 12, 60, 20, 3); ctx.fillStyle = accent; ctx.fill();
          ctx.fillStyle = accentText; ctx.font = 'bold 11px system-ui'; ctx.fillText(row[3], colX[3] + 8, ry + 2);
        } else {
          ctx.fillStyle = text; ctx.font = '14px system-ui'; ctx.fillText(row[3], colX[3], ry);
        }
        if (ri < rows.length - 1) {
          ctx.strokeStyle = border + '33'; ctx.beginPath(); ctx.moveTo(40, ry + 16); ctx.lineTo(W - 40, ry + 16); ctx.stroke();
        }
      });

      // Bottom row — two cards side by side
      const row2Y = cardY + cardH + 16, row2H = 190, gap = 16, cw = (W - 48 - gap) / 2;

      // Left card — form
      roundRect(24, row2Y, cw, row2H, 8); ctx.fillStyle = bg; ctx.fill();
      roundRect(24, row2Y, cw, row2H, 8); ctx.strokeStyle = border; ctx.stroke();
      ctx.fillStyle = muted; ctx.font = '9px system-ui'; ctx.fillText('SEARCH', 40, row2Y + 28);
      roundRect(40, row2Y + 34, cw - 32, 28, 4); ctx.fillStyle = pageBg; ctx.fill();
      roundRect(40, row2Y + 34, cw - 32, 28, 4); ctx.strokeStyle = border; ctx.stroke();
      ctx.fillStyle = muted; ctx.font = '13px system-ui'; ctx.fillText('Filter items...', 50, row2Y + 53);
      ctx.fillStyle = muted; ctx.font = '9px system-ui'; ctx.fillText('CATEGORY', 40, row2Y + 82);
      roundRect(40, row2Y + 88, cw - 32, 28, 4); ctx.fillStyle = pageBg; ctx.fill();
      roundRect(40, row2Y + 88, cw - 32, 28, 4); ctx.strokeStyle = border; ctx.stroke();
      ctx.fillStyle = text; ctx.font = '13px system-ui'; ctx.fillText('All', 50, row2Y + 107);
      // Buttons
      roundRect(40, row2Y + 132, 80, 32, 4); ctx.fillStyle = accent; ctx.fill();
      ctx.fillStyle = accentText; ctx.font = 'bold 11px system-ui'; ctx.fillText('APPLY', 56, row2Y + 152);
      roundRect(130, row2Y + 132, 80, 32, 4); ctx.strokeStyle = border; ctx.stroke();
      ctx.fillStyle = text; ctx.font = 'bold 11px system-ui'; ctx.fillText('RESET', 146, row2Y + 152);

      // Right card — controls
      const rcX = 24 + cw + gap;
      roundRect(rcX, row2Y, cw, row2H, 8); ctx.fillStyle = bg; ctx.fill();
      roundRect(rcX, row2Y, cw, row2H, 8); ctx.strokeStyle = border; ctx.stroke();
      const ctrlItems = [
        { label: 'Show details', checked: true },
        { label: 'Include archived', checked: false },
      ];
      ctrlItems.forEach((item, i) => {
        const cy = row2Y + 28 + i * 32;
        roundRect(rcX + 16, cy, 16, 16, 3);
        if (item.checked) { ctx.fillStyle = accent; ctx.fill(); ctx.fillStyle = accentText; ctx.font = 'bold 12px system-ui'; ctx.fillText('✓', rcX + 19, cy + 13); }
        else { ctx.strokeStyle = border; ctx.stroke(); }
        ctx.fillStyle = text; ctx.font = '13px system-ui'; ctx.fillText(item.label, rcX + 40, cy + 13);
      });
      // Toggles
      const toggleItems = [{ label: 'Live updates', on: true }, { label: 'Compact view', on: false }];
      toggleItems.forEach((item, i) => {
        const ty = row2Y + 100 + i * 32;
        roundRect(rcX + 16, ty, 36, 18, 9);
        ctx.fillStyle = item.on ? accent : border; ctx.fill();
        ctx.beginPath(); ctx.arc(item.on ? rcX + 40 : rcX + 28, ty + 9, 6, 0, Math.PI * 2);
        ctx.fillStyle = item.on ? accentText : text; ctx.fill();
        ctx.fillStyle = text; ctx.font = '13px system-ui'; ctx.fillText(item.label, rcX + 60, ty + 14);
      });

      // Convert to blob and upload
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (!blob || blob.size < 100) return;
      await fetch('/themes/preview?id=' + encodeURIComponent(themeId), { method: 'POST', body: blob });
      console.log('[ThemePreview] Saved preview for', themeId);
    } catch (err) {
      console.warn('[ThemePreview] Failed:', err);
    }
  }

  // ===========================
  // Reload Themes
  // ===========================

  async function reload() {
    try {
      const appName = callbacks.getCurrentAppName ? callbacks.getCurrentAppName() : '';
      const appParam = appName ? '?app=' + encodeURIComponent(appName) : '';
      const res = await fetch('/themes' + appParam);
      themes = await res.json();
      // Refresh the generate-phase select dropdown
      if (elements.themeSelect) {
        const prev = elements.themeSelect.value;
        elements.themeSelect.innerHTML = '<option value="">Auto (let AI choose)</option>';
        for (const t of themes) {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.name + (t.mood ? ` — ${t.mood}` : '');
          elements.themeSelect.appendChild(opt);
        }
        if (prev) elements.themeSelect.value = prev;
      }
      // Rebuild carousel with updated theme list
      if (callbacks.buildThemeCarousel) callbacks.buildThemeCarousel();
    } catch (err) {
      console.error('Failed to reload themes:', err);
    }
  }

  // ===========================
  // Palette — delegating to EditorColorUtils
  // ===========================

  function renderPaletteSlots() {
    const container = elements.paletteSlots;
    if (!container) return;
    container.innerHTML = PALETTE_SLOTS.map(s => {
      const val = paletteState[s.key];
      return `<div class="palette-slot">
        <div class="palette-slot-label">${s.label}</div>
        <div class="palette-slot-preview" style="background:${val}">
          <input type="color" value="${val}" data-slot-color="${s.key}" />
        </div>
        <input class="palette-slot-value" type="text" value="${val}" data-slot="${s.key}" />
      </div>`;
    }).join('');
    updateContrastDisplay();
  }

  function onSlotColorChange(key, hex) {
    paletteState[key] = hex;
    // Update text input
    const textInput = elements.paletteSlots
      ? elements.paletteSlots.querySelector(`.palette-slot-value[data-slot="${key}"]`)
      : null;
    if (textInput) textInput.value = hex;
    // Update preview swatch
    const slot = textInput?.closest('.palette-slot');
    if (slot) slot.querySelector('.palette-slot-preview').style.background = hex;
    // Reset harmony to custom since user manually edited
    if (elements.harmonyMode) elements.harmonyMode.value = 'custom';
    applyPaletteLive();
  }

  function onSlotHexInput(key, value) {
    const hex = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      paletteState[key] = hex;
      const slotEl = elements.paletteSlots
        ? elements.paletteSlots.querySelector(`.palette-slot-value[data-slot="${key}"]`)?.closest('.palette-slot')
        : null;
      if (slotEl) {
        slotEl.querySelector('.palette-slot-preview').style.background = hex;
        slotEl.querySelector('input[type=color]').value = hex;
      }
      applyPaletteLive();
    }
  }

  function applyHarmony() {
    const modeEl = elements.harmonyMode;
    const mode = modeEl ? modeEl.value : 'custom';
    if (mode === 'custom') return;
    const colorUtils = window.EditorColorUtils;
    if (!colorUtils) return;
    const result = colorUtils.generateHarmony(paletteState.bg, mode);
    if (!result) return;
    paletteState = { ...paletteState, ...result };
    renderPaletteSlots();
    applyPaletteLive();
  }

  function updateContrastDisplay() {
    const el = elements.paletteContrast;
    if (!el) return;
    const colorUtils = window.EditorColorUtils;
    if (!colorUtils) return;
    const textBg = colorUtils.contrastRatio(paletteState.text, paletteState.bg);
    const accentAt = colorUtils.contrastRatio(paletteState.accentText, paletteState.accent);
    function badge(ratio) {
      const pass = ratio >= 4.5;
      return `<span class="palette-contrast-badge ${pass ? 'pass' : 'fail'}">${ratio.toFixed(1)}:1 ${pass ? 'AA' : 'Fail'}</span>`;
    }
    el.innerHTML = `
      <div class="palette-contrast-item">Text / Bg: ${badge(textBg)}</div>
      <div class="palette-contrast-item">Accent Text / Accent: ${badge(accentAt)}</div>
    `;
  }

  function applyPaletteLive() {
    const frame = elements.previewFrame;
    const doc = frame?.contentDocument;
    if (!doc) return;
    const root = doc.documentElement;
    PALETTE_SLOTS.forEach(s => {
      root.style.setProperty(s.cssVar, paletteState[s.key]);
    });
    updateContrastDisplay();
  }

  function cssColorToHex(val) {
    const colorUtils = window.EditorColorUtils;
    // Already 6-digit hex
    if (/^#[0-9a-fA-F]{6}$/.test(val)) return val;
    if (/^#[0-9a-fA-F]{3}$/.test(val)) {
      return '#' + val[1]+val[1]+val[2]+val[2]+val[3]+val[3];
    }
    // Use browser to resolve oklch/rgb/hsl etc to rgb
    const temp = document.createElement('div');
    temp.style.color = val;
    document.body.appendChild(temp);
    const computed = getComputedStyle(temp).color;
    document.body.removeChild(temp);
    const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      return colorUtils ? colorUtils.rgbToHex(+m[1], +m[2], +m[3]) : null;
    }
    return null;
  }

  function initPaletteFromPreview() {
    const frame = elements.previewFrame;
    const doc = frame?.contentDocument;
    if (!doc) return;
    const cs = getComputedStyle(doc.documentElement);
    PALETTE_SLOTS.forEach(s => {
      const val = cs.getPropertyValue(s.cssVar)?.trim();
      if (val) {
        const hex = cssColorToHex(val);
        if (hex) paletteState[s.key] = hex;
      }
    });
  }

  function openPalette() {
    // Read current app colors from iframe FIRST, then snapshot
    initPaletteFromPreview();
    savedPaletteState = { ...paletteState };
    renderPaletteSlots();
    if (elements.paletteSidebar) elements.paletteSidebar.style.display = 'flex';
  }

  function closePalette() {
    if (elements.paletteSidebar) elements.paletteSidebar.style.display = 'none';
  }

  function cancelPalette() {
    // Remove all inline style overrides so iframe reverts to its original CSS
    const frame = elements.previewFrame;
    const root = frame?.contentDocument?.documentElement;
    if (root) {
      PALETTE_SLOTS.forEach(s => root.style.removeProperty(s.cssVar));
    }
    // Restore palette state to what we read on open
    if (savedPaletteState) paletteState = { ...savedPaletteState };
    closePalette();
  }

  function savePalette() {
    if (!callbacks.isWsOpen || !callbacks.isWsOpen()) return;
    // Send all palette slots dynamically
    const colors = {};
    PALETTE_SLOTS.forEach(s => { colors[s.cssVar] = paletteState[s.key]; });
    if (callbacks.onSendWs) {
      callbacks.onSendWs({
        type: 'palette_theme',
        colors,
        model: callbacks.getModel ? callbacks.getModel() : undefined,
        app: callbacks.getCurrentAppName ? callbacks.getCurrentAppName() : undefined
      });
    }
    if (callbacks.onAddMessage) callbacks.onAddMessage('user', 'Apply custom color palette');
    closePalette();
  }

  // ===========================
  // Public interface
  // ===========================

  window.EditorThemes = {
    init,
    setThemes,
    getThemes,
    getCurrentId,
    setCurrentId,
    setPendingId,
    load: reload,
    reload,
    open,
    close,
    select,
    confirmDelete,
    delete: deleteTheme,
    onDeleted,
    toggleSaveMode,
    saveCurrent,
    updateSaveProgress,
    onCreated,
    filterThemes,
    openPalette,
    closePalette,
    cancelPalette,
    savePalette,
    applyHarmony,
  };
})();
