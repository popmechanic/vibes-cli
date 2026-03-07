# Skills Button for Web Editor Chat Interface

## Summary

Add a Skills button to the editor chat composer that lets users browse and select installed Claude Code plugin skills. Selecting a skill attaches it as context (like animations), and when the user sends their next message, the server prepends that skill's SKILL.md content to Claude's prompt.

## Architecture Overview

The feature follows the same pattern as the existing animation system:

```
Server: discover skills on startup → serve catalog via HTTP endpoint
Client: Skills button → modal with cards → select → badge appears
Client: sendMessage() includes skillId in payload
Server: chat handler reads SKILL.md content, prepends to Claude prompt
```

### Key Design Decisions

1. **Show ALL installed plugin skills system-wide**, EXCLUDING vibes plugin skills (those are orchestrated via other UI affordances)
2. Selecting a skill adds a badge (like animations), and sending a message prepends the SKILL.md content
3. The Skills button goes in the left button group alongside `refBtn`, `modelBtn`, `imggenBtn`
4. Skills are discovered at server startup by scanning `~/.claude/plugins/installed_plugins.json` and reading SKILL.md frontmatter from each plugin's install path
5. The vibes plugin is excluded by matching on plugin name `"vibes"` from the installed_plugins.json key format `pluginName@marketplace`

## Files to Modify

| File | Change |
|------|--------|
| `scripts/server/config.js` | Add `discoverPluginSkills()` function; call from `loadConfig()` to populate `ctx.pluginSkills` |
| `scripts/server/routes.js` | Add `GET /skills` route serving `ctx.pluginSkills` as JSON |
| `scripts/server/handlers/chat.js` | Accept `skillId` param; read SKILL.md content; prepend as context block |
| `scripts/server/ws-dispatch.js` | Pass `msg.skillId` through to `handleChat()` |
| `skills/vibes/templates/editor.html` | Add Skills button, modal, badge, and JS logic (directly — not template-merged) |

No new files are created. All changes are additions to existing files.

## Implementation Plan

### Step 1: Server — Skill Discovery (`scripts/server/config.js`)

Add a `discoverPluginSkills()` function that:

1. Reads `~/.claude/plugins/installed_plugins.json`
2. Iterates each plugin entry; skips any where the key starts with `vibes@` (our own plugin)
3. For each plugin's `installPath`, scans `skills/*/SKILL.md` using `readdirSync` + `existsSync`
4. Parses YAML frontmatter from each SKILL.md (everything between `---` delimiters) to extract `name`, `description`, and optionally `argument-hint`
5. Returns an array of skill objects:

```js
{
  id: 'systematic-debugging',           // skill directory name
  name: 'systematic-debugging',         // from frontmatter
  description: 'Use when encountering any bug...', // from frontmatter
  pluginName: 'superpowers',           // from installed_plugins key
  marketplace: 'claude-plugins-official', // from installed_plugins key
  skillMdPath: '/Users/.../skills/systematic-debugging/SKILL.md'  // absolute path for reading content later
}
```

Call `discoverPluginSkills()` from `loadConfig()` and store result as `ctx.pluginSkills`. Log count: `console.log(\`Skills: ${ctx.pluginSkills.length} discovered\`)`.

**YAML frontmatter parsing:** Simple regex extraction — no dependency needed. Pattern:
```js
const fm = content.match(/^---\n([\s\S]*?)\n---/);
// Then extract name/description with line-level regex
```

### Step 2: Server — HTTP Endpoint (`scripts/server/routes.js`)

Add route to the route table:

```js
'GET /skills': serveSkills,
```

Handler function:
```js
function serveSkills(ctx, req, res) {
  // Return catalog without skillMdPath (don't expose server paths to client)
  const catalog = (ctx.pluginSkills || []).map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    pluginName: s.pluginName,
    marketplace: s.marketplace,
  }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(catalog));
}
```

### Step 3: Server — Chat Handler Integration (`scripts/server/handlers/chat.js`)

Modify the `handleChat` function signature to accept a `skillId` parameter:

```js
export async function handleChat(ctx, onEvent, message, effects, animationId, model, reference, skillId) {
```

When `skillId` is provided:
1. Find the skill in `ctx.pluginSkills` by id
2. Read the SKILL.md file from `skill.skillMdPath`
3. Prepend the content as a context block before the main prompt, similar to how animation instructions are prepended:

```js
let skillBlock = '';
if (skillId) {
  const skill = (ctx.pluginSkills || []).find(s => s.id === skillId);
  if (skill && existsSync(skill.skillMdPath)) {
    const skillContent = readFileSync(skill.skillMdPath, 'utf-8');
    skillBlock = `\n\nSKILL CONTEXT: "${skill.name}" (from ${skill.pluginName} plugin)
The user selected this skill to guide your approach. Follow its instructions carefully.

${skillContent}

`;
  }
}
```

Insert `${skillBlock}` into the prompt string before the existing `${referenceBlock}`.

### Step 4: Server — WebSocket Dispatch (`scripts/server/ws-dispatch.js`)

Update the chat dispatch entry to pass `msg.skillId`:

```js
chat: (msg) => handleChat(ctx, onEvent, msg.message, msg.effects || [], msg.animationId || null, msg.model, msg.reference || null, msg.skillId || null),
```

### Step 5: Client — Editor HTML (`skills/vibes/templates/editor.html`)

This is the largest change. All modifications are to the standalone `editor.html` file.

#### 5a: CSS — Add skill-specific styles

Add after the existing `.animation-active-badge .clear-btn:hover` rule (around line 1570):

- `.skill-active-badge` — styled like `.animation-active-badge` but with `background: var(--vibes-blue)` and `color: white` to visually differentiate from animation badges
- Reuse `.anim-modal-overlay`, `.anim-modal`, `.anim-modal-header`, `.anim-modal-body`, `.anim-grid`, `.anim-card` styles for the skills modal (same visual language, no duplication needed — the modal HTML uses the same CSS classes)
- `.skill-card-plugin` — small muted text showing which plugin the skill comes from

#### 5b: HTML — Add Skills button to composer

In the `.chat-composer-inner` div (around line 2780), add a Skills button AFTER the `imggenBtn` wrapper and BEFORE the `textarea`:

```html
<button class="composer-btn" id="skillsBtn" onclick="toggleSkillsModal()" title="Add skill context">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg>
</button>
```

The star icon conveys "special capability" — distinct from the existing plus, clock, and image icons.

#### 5c: HTML — Add skill badge

Add after the `animBadge` span, inside `.animation-icons` (around line 2769):

```html
<span class="skill-active-badge animation-active-badge" id="skillBadge">
  <span id="skillBadgeName"></span>
  <button class="clear-btn" onclick="clearSkill()" title="Clear skill">&times;</button>
</span>
```

Reuse `.animation-active-badge` class for base styling, override color with `.skill-active-badge`.

#### 5d: HTML — Add skills modal

Add after the `animModal` div (around line 2905):

```html
<div class="anim-modal-overlay" id="skillsModal">
  <div class="anim-modal">
    <div class="anim-modal-header">
      <h2>Choose a Skill</h2>
      <button class="modal-close" onclick="closeSkillsModal()">&times;</button>
    </div>
    <div class="anim-category-tabs" id="skillPluginTabs"></div>
    <div class="anim-modal-body">
      <div class="anim-grid" id="skillGrid"></div>
    </div>
  </div>
</div>
```

Reuses animation modal CSS classes for visual consistency.

#### 5e: JavaScript — Skills logic

Add in the `<script>` block, after the animation section (around line 4512):

```js
// === Skills ===
let allSkills = [];
let activeSkillId = null;
let activeSkillPlugin = 'All';

async function loadSkills() {
  try {
    const res = await fetch('/skills');
    allSkills = await res.json();
    console.log(`Loaded ${allSkills.length} skills`);
    // Show/hide skills button based on availability
    document.getElementById('skillsBtn').style.display = allSkills.length > 0 ? '' : 'none';
  } catch (err) {
    console.error('Failed to load skills:', err);
    document.getElementById('skillsBtn').style.display = 'none';
  }
}

loadSkills();

function toggleSkillsModal() {
  const modal = document.getElementById('skillsModal');
  if (modal.classList.contains('open')) {
    closeSkillsModal();
  } else {
    openSkillsModal();
  }
}

function openSkillsModal() {
  activeSkillPlugin = 'All';
  document.getElementById('skillsModal').classList.add('open');
  renderSkillPluginTabs();
  renderSkillGrid();
}

function closeSkillsModal() {
  document.getElementById('skillsModal').classList.remove('open');
}

function renderSkillPluginTabs() {
  const tabs = document.getElementById('skillPluginTabs');
  const plugins = ['All', ...new Set(allSkills.map(s => s.pluginName))];
  tabs.innerHTML = plugins.map(p =>
    `<button class="anim-category-tab${p === activeSkillPlugin ? ' active' : ''}" onclick="filterSkillsByPlugin('${p}')">${p}</button>`
  ).join('');
}

function filterSkillsByPlugin(plugin) {
  activeSkillPlugin = plugin;
  renderSkillPluginTabs();
  renderSkillGrid();
}

function renderSkillGrid() {
  const grid = document.getElementById('skillGrid');
  const filtered = activeSkillPlugin === 'All'
    ? allSkills
    : allSkills.filter(s => s.pluginName === activeSkillPlugin);

  if (filtered.length === 0) {
    grid.innerHTML = '<div style="text-align:center;color:#555;padding:2rem;grid-column:1/-1;">No skills available</div>';
    return;
  }

  grid.innerHTML = filtered.map(s => {
    const isActive = activeSkillId === s.id;
    const activeStyle = isActive ? 'border-color:var(--vibes-blue);box-shadow:4px 4px 0px 0px var(--vibes-blue), 4px 4px 0px 2px var(--vibes-near-black);' : '';
    return `<div class="anim-card" style="${activeStyle}" onclick="selectSkill('${s.id}')">
      <div class="anim-card-info" style="padding:0.75rem;">
        <div class="anim-card-name">${escapeHtml(s.name)}</div>
        <div class="anim-card-desc">${escapeHtml(s.description || '')}</div>
        <div class="skill-card-plugin" style="font-size:0.6rem;color:#888;margin-top:0.25rem;">${escapeHtml(s.pluginName)}</div>
      </div>
    </div>`;
  }).join('');
}

function selectSkill(id) {
  activeSkillId = id;
  const skill = allSkills.find(s => s.id === id);
  const badge = document.getElementById('skillBadge');
  const badgeName = document.getElementById('skillBadgeName');
  if (skill) {
    badgeName.textContent = skill.name;
    badge.classList.add('visible');
    document.getElementById('skillsBtn').classList.add('active');
  }
  closeSkillsModal();
}

function clearSkill() {
  activeSkillId = null;
  document.getElementById('skillBadge').classList.remove('visible');
  document.getElementById('skillsBtn').classList.remove('active');
}

// Close skills modal on overlay click
document.getElementById('skillsModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('skillsModal')) closeSkillsModal();
});
```

#### 5f: JavaScript — Modify `sendMessage()`

Update the `sendMessage()` function to include `skillId` in the payload and show it in the display:

```js
// In the display text section, add skill label:
const skillLabel = activeSkillId ? allSkills.find(s => s.id === activeSkillId)?.name : null;
if (skillLabel) displayText += '  [skill: ' + skillLabel + ']';

// In the payload construction:
if (activeSkillId) payload.skillId = activeSkillId;

// After sending, clear the skill:
if (activeSkillId) clearSkill();
```

## Testing Strategy

### Manual Testing

1. Start editor server: `node scripts/preview-server.js --mode=editor`
2. Verify `/skills` endpoint returns JSON array of skills (excluding vibes plugin skills)
3. Verify Skills button appears in composer (or is hidden if no skills installed)
4. Click Skills button → modal opens with cards grouped by plugin
5. Select a skill → badge appears, modal closes
6. Send a message → check server console for SKILL CONTEXT block in the prompt
7. After send, badge auto-clears
8. Clear button on badge works

### Unit Test Considerations

- `discoverPluginSkills()` can be tested in isolation by mocking the filesystem
- YAML frontmatter parsing can be tested with sample SKILL.md content
- The `/skills` endpoint handler can be tested with a mock `ctx`

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| `installed_plugins.json` format changes | Parse defensively; return empty array on error |
| SKILL.md files very large (>50KB) | Truncate content to first 30KB in chat handler |
| Plugin install paths stale/missing | `existsSync` check before reading; skip missing |
| No plugins installed | Hide Skills button entirely when catalog is empty |
| SKILL.md has no frontmatter | Use directory name as fallback `name`; empty `description` |

## Visual Design

The Skills button uses a star icon (distinct from existing icons). The modal reuses the animation modal's visual language (brutalist cards with shadows, category tabs). The badge uses blue background (vs yellow for animations) to visually differentiate the two.

Skills cards omit the preview section that animation cards have (no visual preview for skills) and show: skill name, description, and plugin source in a compact card layout.
