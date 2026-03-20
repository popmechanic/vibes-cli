/**
 * editor-skills.js — Skills catalog modal.
 * State: allSkills[], activeSkillId, activePlugin
 * Init receives: { skillsModal, skillGrid, skillPluginTabs, skillBadge, skillBadgeName, skillsBtn }
 * Callbacks: { onSelect(id, name) }
 * Interface: window.EditorSkills = { init, load, open, close, toggle, select, clear, getActiveId, getAll }
 */
(function() {
  // Private state
  let allSkills = [];
  let activeSkillId = null;
  let activePlugin = 'All';
  let elements = {};
  let callbacks = {};
  let escapeHtml = function(s) { return s; };

  function init(els, cbs, escFn) {
    elements = els;
    callbacks = cbs || {};
    if (escFn) escapeHtml = escFn;

    // Click-outside to close modal
    if (elements.skillsModal) {
      elements.skillsModal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) close();
      });
    }
  }

  async function load() {
    try {
      const res = await fetch('/skills');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      allSkills = await res.json();
      console.log(`Loaded ${allSkills.length} skills`);
      if (elements.skillsBtn) {
        elements.skillsBtn.style.display = allSkills.length > 0 ? '' : 'none';
      }
    } catch (err) {
      console.error('Failed to load skills:', err);
      if (elements.skillsBtn) elements.skillsBtn.style.display = 'none';
    }
  }

  function toggle() {
    const modal = elements.skillsModal;
    if (!modal) return;
    if (modal.classList.contains('open')) {
      close();
    } else {
      open();
    }
  }

  function open() {
    activePlugin = 'All';
    if (elements.skillsModal) elements.skillsModal.classList.add('open');
    renderPluginTabs();
    renderGrid();
  }

  function close() {
    if (elements.skillsModal) elements.skillsModal.classList.remove('open');
  }

  function renderPluginTabs() {
    const tabs = elements.skillPluginTabs;
    if (!tabs) return;
    const plugins = ['All', ...new Set(allSkills.map(s => s.pluginName))];
    tabs.innerHTML = plugins.map(p =>
      `<button class="anim-category-tab${p === activePlugin ? ' active' : ''}" data-plugin="${escapeHtml(p)}">${escapeHtml(p)}</button>`
    ).join('');
    tabs.addEventListener('click', handlePluginTabClick);
  }

  function handlePluginTabClick(e) {
    const btn = e.target.closest('[data-plugin]');
    if (!btn) return;
    activePlugin = btn.dataset.plugin;
    renderPluginTabs();
    renderGrid();
  }

  function renderGrid() {
    const grid = elements.skillGrid;
    if (!grid) return;
    const filtered = activePlugin === 'All'
      ? allSkills
      : allSkills.filter(s => s.pluginName === activePlugin);

    if (filtered.length === 0) {
      grid.innerHTML = '<div style="text-align:center;color:#555;padding:2rem;grid-column:1/-1;">No skills available</div>';
      return;
    }

    grid.innerHTML = filtered.map(s => {
      const isActive = activeSkillId === s.id;
      const activeStyle = isActive
        ? 'border-color:var(--vibes-blue);box-shadow:4px 4px 0px 0px var(--vibes-blue), 4px 4px 0px 2px var(--vibes-near-black);'
        : '';
      return `<div class="anim-card" style="${activeStyle}" data-skill-id="${escapeHtml(s.id)}">
        <div class="anim-card-info" style="padding:0.75rem;">
          <div class="anim-card-name">${escapeHtml(s.name)}</div>
          <div class="anim-card-desc">${escapeHtml(s.description || '')}</div>
          <div style="font-size:0.6rem;color:#888;margin-top:0.25rem;">${escapeHtml(s.pluginName)}</div>
        </div>
      </div>`;
    }).join('');

    grid.querySelectorAll('[data-skill-id]').forEach(card => {
      card.addEventListener('click', () => select(card.dataset.skillId));
    });
  }

  function select(id) {
    activeSkillId = id;
    const skill = allSkills.find(s => s.id === id);
    if (skill) {
      if (elements.skillBadgeName) elements.skillBadgeName.textContent = skill.name;
      if (elements.skillBadge) elements.skillBadge.classList.add('visible');
      if (elements.skillsBtn) elements.skillsBtn.classList.add('active');
      if (callbacks.onSelect) callbacks.onSelect(id, skill.name);
    }
    close();
  }

  function clear() {
    activeSkillId = null;
    if (elements.skillBadge) elements.skillBadge.classList.remove('visible');
    if (elements.skillsBtn) elements.skillsBtn.classList.remove('active');
  }

  function getActiveId() {
    return activeSkillId;
  }

  function getAll() {
    return allSkills;
  }

  window.EditorSkills = { init, load, open, close, toggle, select, clear, getActiveId, getAll };
})();
