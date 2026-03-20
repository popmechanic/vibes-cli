/**
 * editor-animations.js — Animation catalog modal.
 * State: allAnimations[], activeAnimationId, activeCategory
 * Init receives: { animModal, animGrid, animCategoryTabs, animBadge, animBadgeName, animationIcons }
 * Callbacks: { onSelect(id, name), onClear() }
 * Interface: window.EditorAnimations = { init, load, open, close, select, clear, getActiveId, getAll, renderGrid }
 */
(function() {
  // Private state
  let allAnimations = [];
  let activeAnimationId = null;
  let activeCategory = 'All';
  let elements = {};
  let callbacks = {};
  let escapeHtml = function(s) { return s; };

  // Map animation IDs to CSS preview HTML
  const ANIM_PREVIEWS = {
    '3d-layers':          '<div class="ap-3d-layers"><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    '3d-flip-cards':      '<div class="ap-3d-flip" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%"><div class="ap"></div><div class="ap"></div></div>',
    '3d-perspective-grid':'<div class="ap-3d-grid"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    '3d-carousel':        '<div class="ap-3d-carousel"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    '3d-parallax':        '<div class="ap-3d-parallax" style="width:100%;height:100%"><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    '3d-ampersand':       '<div class="ap-ampersand"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    '3d-cuboid-gallery':  '<div class="ap-cuboid-gallery"><div class="ap-cuboid"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div><div class="ap-cuboid"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div><div class="ap-cuboid"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div><div class="ap-cuboid"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div></div>',
    'anim-scroll-reveal': '<div class="ap-scroll-reveal" style="width:100%;height:100%"><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    'anim-staggered':     '<div class="ap-staggered" style="width:100%;height:100%"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    'anim-gradient-morph':'<div class="ap-gradient"></div>',
    'anim-clip-path':     '<div class="ap-clip-path"></div>',
    'anim-typewriter':    '<div class="ap-typewriter">vibes_</div>',
    'int-mouse-glow':     '<div class="ap-glow" style="position:absolute"></div>',
    'int-tilt-cards':     '<div class="ap-tilt"></div>',
    'int-magnetic-buttons':'<div class="ap-magnetic">CLICK</div>',
    'int-drag-sort':      '<div class="ap-drag" style="width:100%;height:100%"><div class="ap"></div><div class="ap"></div></div>',
    'int-cursor-trail':   '<div class="ap-trail" style="width:100%;height:100%"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    'part-floating-dots': '<div class="ap-dots" style="width:100%;height:100%"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    'part-confetti':      '<div class="ap-confetti" style="width:100%;height:100%"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    'part-snow':          '<div class="ap-snow" style="width:100%;height:100%"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    'part-bubbles':       '<div class="ap-bubble" style="width:100%;height:100%"><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    'part-fireflies':     '<div class="ap-firefly" style="width:100%;height:100%"><div class="ap"></div><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    'shd-aurora':         '<div class="ap-aurora"></div>',
    'shd-plasma':         '<div class="ap-plasma"></div>',
    'shd-noise-gradient': '<div class="ap-noise"></div>',
    'shd-water-ripple':   '<div class="ap-ripple" style="width:100%;height:100%"><div class="ap"></div><div class="ap"></div><div class="ap"></div></div>',
    'shd-voronoi':        '<div class="ap-voronoi"></div>',
  };

  function init(els, cbs, escFn) {
    elements = els;
    callbacks = cbs || {};
    if (escFn) escapeHtml = escFn;

    // Icon strip click → open modal filtered to that category
    if (elements.animationIcons) {
      elements.animationIcons.addEventListener('click', (e) => {
        const btn = e.target.closest('.animation-icon-btn');
        if (!btn) return;
        open(btn.dataset.category);
      });
    }

    // Click-outside to close modal
    if (elements.animModal) {
      elements.animModal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) close();
      });
    }
  }

  async function load() {
    try {
      const res = await fetch('/animations');
      allAnimations = await res.json();
      console.log(`Loaded ${allAnimations.length} animations`);
    } catch (err) {
      console.error('Failed to load animations:', err);
    }
  }

  function open(category) {
    activeCategory = category || 'All';
    if (elements.animModal) elements.animModal.classList.add('open');
    renderCategoryTabs();
    renderGrid();
  }

  function close() {
    if (elements.animModal) elements.animModal.classList.remove('open');
  }

  function renderCategoryTabs() {
    const tabs = elements.animCategoryTabs;
    if (!tabs) return;
    const categories = ['All', ...new Set(allAnimations.map(a => a.category))];
    tabs.innerHTML = categories.map(c =>
      `<button class="anim-category-tab${c === activeCategory ? ' active' : ''}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`
    ).join('');
    tabs.addEventListener('click', handleCategoryTabClick);
  }

  function handleCategoryTabClick(e) {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    activeCategory = btn.dataset.category;
    renderCategoryTabs();
    renderGrid();
  }

  function renderGrid() {
    const grid = elements.animGrid;
    if (!grid) return;
    const filtered = activeCategory === 'All'
      ? allAnimations
      : allAnimations.filter(a => a.category === activeCategory);

    if (filtered.length === 0) {
      grid.innerHTML = '<div style="text-align:center;color:#555;padding:2rem;grid-column:1/-1;">No animations in this category</div>';
      return;
    }

    grid.innerHTML = filtered.map(a => {
      const preview = ANIM_PREVIEWS[a.id] || '';
      return `<div class="anim-card" data-anim-id="${escapeHtml(a.id)}">
        <div class="anim-card-preview">${preview}</div>
        <div class="anim-card-info">
          <div class="anim-card-name">${escapeHtml(a.name)}</div>
          <div class="anim-card-desc">${escapeHtml(a.description)}</div>
        </div>
      </div>`;
    }).join('');

    grid.querySelectorAll('[data-anim-id]').forEach(card => {
      card.addEventListener('click', () => select(card.dataset.animId));
    });
  }

  function select(id) {
    activeAnimationId = id;
    const anim = allAnimations.find(a => a.id === id);
    if (anim) {
      if (elements.animBadgeName) elements.animBadgeName.textContent = anim.name;
      if (elements.animBadge) elements.animBadge.classList.add('visible');
      if (callbacks.onSelect) callbacks.onSelect(id, anim.name);
    }
    close();
  }

  function clear() {
    activeAnimationId = null;
    if (elements.animBadge) elements.animBadge.classList.remove('visible');
    if (callbacks.onClear) callbacks.onClear();
  }

  function getActiveId() {
    return activeAnimationId;
  }

  function getAll() {
    return allAnimations;
  }

  window.EditorAnimations = { init, load, open, close, select, clear, getActiveId, getAll, renderGrid };
})();
