# Editor Module Extraction

**Date**: 2026-03-19
**Approach**: Extract independent modules from editor.html into standalone JS files

## Problem Statement

`editor.html` is 6,263 lines — a single file containing CSS (2,500 lines), HTML (579 lines), and JavaScript (3,150 lines). The JS section mixes core orchestration (WebSocket, phase navigation, chat) with self-contained feature modules (animations, skills, themes, color utilities, image generation, reference file handling). This makes the file difficult to maintain: changing the theme picker requires reading past the deploy menu, color palette, and animation modal.

The JS can be decomposed into two categories:
1. **Core orchestration** (~2,050 lines) — WebSocket, phase system, chat, deploy, version history, auth, app management. These are tightly coupled and belong together.
2. **Independent modules** (~1,100 lines) — Self-contained feature areas with 75-100% isolation scores. These have their own state, their own DOM elements, and communicate with the core through a small interface.

## Design

### Module Pattern

Each extracted module follows the same pattern:

- **IIFE registering on `window`** — no global scope pollution beyond the namespace
- **Dependencies injected via `init()` call** — module doesn't reach into DOM or WS directly
- **Callbacks for outbound actions** — if a module needs to trigger an editor action (send WS message, reload preview), it calls a callback passed during `init()`
- **No direct calls back into main editor** — modules are leaf nodes in the dependency graph

Example shape:
```javascript
(function() {
  const state = { all: [], activeId: null };

  window.EditorAnimations = {
    init(container, callbacks) { /* bind DOM refs, store callbacks */ },
    load() { /* fetch from server */ },
    open(category) { /* show modal */ },
    close() { /* hide modal */ },
    getActiveId() { return state.activeId; },
    clear() { state.activeId = null; }
  };
})();
```

### Modules to Extract

#### 1. `editor-color-utils.js` (~75 lines)

Pure math utilities. No state, no DOM, no callbacks.

**Exports:** `hexToRgb`, `rgbToHex`, `linearize`, `delinearize`, `rgbToOklab`, `oklabToRgb`, `hexToOklch`, `oklchToHex`, `oklchClamp`, `relativeLuminance`, `contrastRatio`, `generateHarmony`

**Source lines:** editor.html ~5892-5970

**Interface:** `window.EditorColorUtils = { hexToRgb, rgbToHex, ... }`

#### 2. `editor-animations.js` (~124 lines)

Animation catalog modal: load, filter by category, render grid, select/clear.

**State:** animation catalog array, active animation ID, active category filter

**Init receives:** modal container element

**Callbacks:** `onSelect(id)` — main editor sets `activeAnimationId`

**Source lines:** editor.html ~4613-4736

**Interface:** `window.EditorAnimations = { init, load, open, close, select, clear, getActiveId }`

#### 3. `editor-skills.js` (~108 lines)

Skills catalog modal. Identical pattern to animations.

**State:** skills catalog array, active skill ID, active plugin filter

**Init receives:** modal container element

**Callbacks:** `onSelect(id)` — main editor sets `activeSkillId`

**Source lines:** editor.html ~4737-4844

**Interface:** `window.EditorSkills = { init, load, open, close, select, clear, getActiveId }`

#### 4. `editor-reference.js` (~180 lines, deduplicates phase 2/3)

Reference file upload handling. Currently duplicated as `pickReference`/`genPickReference`, `handleRefFile`/`genHandleRefFile`, etc. Single module that accepts a `context` parameter ('edit' or 'generate') to target the right DOM elements.

**State:** reference file per context

**Init receives:** container elements for each context, popover positioning function

**Source lines:** editor.html ~4872-4975 + ~5144-5207

**Interface:** `window.EditorReference = { init, pick, handleFile, clear, showIntentPicker, getFile }`

#### 5. `editor-imggen.js` (~180 lines, deduplicates phase 2/3)

Image generation UI. Currently duplicated as `generateImage`/`genGenerateImage`, etc. Single module with context parameter.

**State:** generated images array per context, carousel index, API key status

**Init receives:** container elements for each context

**Callbacks:** `onSendWs(msg)` — main editor sends WS message

**Source lines:** editor.html ~5019-5143 + ~5250-5352

**Interface:** `window.EditorImgGen = { init, toggle, close, generate, accept, getImages }`

#### 6. `editor-themes.js` (~380 lines, largest extraction)

Theme list rendering, filtering, modal, select, delete, save-current-theme flow, palette editor, theme preview capture. Consumes `EditorColorUtils`.

**State:** theme catalog, current/pending theme IDs, save mode, palette state

**Init receives:** modal container, palette container, preview iframe ref

**Callbacks:** `onSendWs(msg)`, `onReloadPreview()`, `onAddMessage(role, text)`

**Source lines:** editor.html ~5512-5891 (theme management) + palette at ~5892-6168 (minus color utils)

**Interface:** `window.EditorThemes = { init, load, reload, open, close, select, delete, openPalette, closePalette, savePalette, getThemes, getCurrentId }`

### What Stays in editor.html

The JS section reduces from ~3,150 to ~2,050 lines. Remaining:

- WebSocket connection + message dispatcher
- Phase system (`setPhase`, `goHome`, unsaved guard)
- Auth/account panel
- Chat (`sendMessage`, `addMessage`, `setThinking`)
- Deploy (`startDeploy`, `toggleDeployMenu`, deploy history)
- Version history (undo/redo)
- App management (`saveApp`, `doSave`, `captureScreenshot`, `checkExistingApps`, `loadSavedApp`, `promptRenameApp`)
- Preview loading (`loadPreview`, `reloadPreview`)
- Audio toggle (~65 lines, small enough to stay inline)
- Initialization (wires modules together via `init()` calls)

### File Serving

New wildcard route in `router.ts`:

```typescript
if (url.pathname.startsWith('/editor/modules/')) {
  const modName = url.pathname.slice('/editor/modules/'.length);
  const modPath = join(ctx.projectRoot, 'skills', 'vibes', 'modules', modName);
  const file = Bun.file(modPath);
  if (await file.exists()) {
    return new Response(file, { headers: { 'Content-Type': 'text/javascript', ...corsHeaders() } });
  }
}
```

### Load Order

In `editor.html`, before the main `<script>` block:

```html
<!-- Utility modules (no dependencies) -->
<script src="/editor/modules/editor-color-utils.js"></script>

<!-- Feature modules (may depend on utilities) -->
<script src="/editor/modules/editor-animations.js"></script>
<script src="/editor/modules/editor-skills.js"></script>
<script src="/editor/modules/editor-reference.js"></script>
<script src="/editor/modules/editor-imggen.js"></script>
<script src="/editor/modules/editor-themes.js"></script>

<!-- Main editor script (orchestrator) -->
<script>
  // Initialization wires modules together
</script>
```

### Directory Structure

```
skills/vibes/
  modules/
    editor-color-utils.js
    editor-animations.js
    editor-skills.js
    editor-reference.js
    editor-imggen.js
    editor-themes.js
  templates/
    editor.html  (reduced from 6263 to ~5100 lines)
```

No build step required. The modules are plain JS files served directly. The existing `merge-templates.js` system doesn't touch `editor.html` or these modules.

## Testing

| Change | Test Method |
|--------|-------------|
| Module loading | Start server, open editor, verify no console errors on page load |
| Color utilities | Unit tests (pure functions, easy to test with vitest) |
| Animations modal | Open animation modal, filter categories, select animation, verify it appears in chat context |
| Skills modal | Open skills modal, filter by plugin, select skill, verify it appears in chat context |
| Reference file | Upload reference in both generate and edit phases, verify intent picker works |
| Image generation | Generate image in both phases, navigate carousel, accept image |
| Theme management | Browse themes, select, delete, save current theme, palette editor |
| Integration | Full generate → edit → save → deploy flow works end-to-end |

## Constraints

- No ES module imports in the main `<script>` block (plain HTML, not bundled)
- Modules use `window.*` registration pattern (consistent with existing `build/vibes-menu.js`)
- No build step — files served directly
- Modules must not call back into the main editor directly; use callbacks from `init()`

## Files Changed

- `scripts/server/router.ts` — add `/editor/modules/*` wildcard route
- `skills/vibes/modules/editor-color-utils.js` (new)
- `skills/vibes/modules/editor-animations.js` (new)
- `skills/vibes/modules/editor-skills.js` (new)
- `skills/vibes/modules/editor-reference.js` (new)
- `skills/vibes/modules/editor-imggen.js` (new)
- `skills/vibes/modules/editor-themes.js` (new)
- `skills/vibes/templates/editor.html` — remove extracted code, add `<script src>` tags, add `init()` wiring in initialization
