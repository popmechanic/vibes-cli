# Editor Module Extraction

**Date**: 2026-03-19
**Approach**: Extract independent modules from editor.html into standalone JS files

## Problem Statement

`editor.html` is 6,263 lines — a single file containing CSS (2,500 lines), HTML (579 lines), and JavaScript (3,150 lines). The JS section mixes core orchestration (WebSocket, phase navigation, chat) with self-contained feature modules (animations, skills, themes, color utilities, image generation, reference file handling). This makes the file difficult to maintain: changing the theme picker requires reading past the deploy menu, color palette, and animation modal.

The JS can be decomposed into two categories:
1. **Core orchestration** (~1,865 lines) — WebSocket, phase system, chat, deploy, version history, auth, app management. These are tightly coupled and belong together.
2. **Independent modules** (~1,285 lines) — Self-contained feature areas. These have their own state, their own DOM elements, and communicate with the core through a small callback interface.

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

### Shared Utilities

`escapeHtml(str)` (defined at line 3111) is used by skills, animations, and theme grid rendering. Rather than duplicating it, include it in `editor-color-utils.js` (renamed to `editor-utils.js`) or keep it in the main editor and register it as `window.escapeHtml` before module scripts load. The simplest approach: add a tiny `<script>` block before the module loads that registers it on `window`.

### Modules to Extract

#### 1. `editor-color-utils.js` (~117 lines)

Pure math utilities. No state, no DOM, no callbacks.

**Exports:** `hexToRgb`, `rgbToHex`, `linearize`, `delinearize`, `rgbToOklab`, `oklabToRgb`, `hexToOklch`, `oklchToHex`, `oklchClamp`, `relativeLuminance`, `contrastRatio`, `generateHarmony`

**Source lines:** editor.html ~5892-6008 (includes `generateHarmony` through its end)

**Interface:** `window.EditorColorUtils = { hexToRgb, rgbToHex, ... }`

#### 2. `editor-animations.js` (~124 lines)

Animation catalog modal: load, filter by category, render grid, select/clear.

**State:** animation catalog array, active animation ID, active category filter

**Init receives:** modal container element, `escapeHtml` reference

**Callbacks:** `onSelect(id)` — main editor sets `activeAnimationId` and updates chat input placeholder

**Source lines:** editor.html ~4613-4736

**Interface:** `window.EditorAnimations = { init, load, open, close, select, clear, getActiveId }`

Note: `selectAnimation` currently writes to `chatInput.placeholder` directly. After extraction, this DOM mutation moves into the `onSelect` callback.

#### 3. `editor-skills.js` (~108 lines)

Skills catalog modal. Identical pattern to animations.

**State:** skills catalog array, active skill ID, active plugin filter

**Init receives:** modal container element, `escapeHtml` reference

**Callbacks:** `onSelect(id)` — main editor sets `activeSkillId`

**Source lines:** editor.html ~4737-4844

**Interface:** `window.EditorSkills = { init, load, open, close, select, clear, getActiveId }`

#### 4. `editor-reference.js` (~168 lines, deduplicates phase 2/3)

Reference file upload handling. Currently duplicated as `pickReference`/`genPickReference`, `handleRefFile`/`genHandleRefFile`, etc. Single module that accepts a `context` parameter ('edit' or 'generate') to target the right DOM elements.

**Behavioral differences between phases:**
- Generate-phase `attachRefFromFile` detects HTML files and calls an `onHtmlRef` callback (for `setThemeCarouselOverridden`)
- Generate-phase `showRefIntentPicker` omits the "Context" intent button (only "Mood" and "Match Layout")
- Generate-phase `pickRefIntent` calls `onHtmlRef` callback
- Clear button text color differs slightly between phases

These differences are parameterized in the context config passed to `init()`.

**State:** reference file per context

**Init receives:** container elements for each context, popover positioning function, context config

**Callbacks:** `onHtmlRef()` — generate phase calls `setThemeCarouselOverridden(true)`

**Source lines:** editor.html ~4872-4975 + ~5144-5207

**Interface:** `window.EditorReference = { init, pick, handleFile, clear, showIntentPicker, getFile }`

#### 5. `editor-imggen.js` (~228 lines, deduplicates phase 2/3)

Image generation UI. Currently duplicated as `generateImage`/`genGenerateImage`, etc. Single module with context parameter. Includes draggable popover helpers (~43 lines at 4976-5018) used exclusively by imggen popovers.

**State:** generated images array per context, carousel index, API key status

**Init receives:** container elements for each context

**Callbacks:**
- `onSendWs(msg)` — main editor sends WS message
- `getModel()` — gets current AI model selection
- `onAcceptImage(file, context)` — main editor handles accepted image (writes to reference state). This resolves the cross-module dependency with `editor-reference.js` — the main editor wires `onAcceptImage` to call `EditorReference.showIntentPicker()`.

**Source lines:** editor.html ~4976-5018 (popover helpers) + ~5019-5143 + ~5250-5352

**Interface:** `window.EditorImgGen = { init, toggle, close, generate, accept, getImages }`

#### 6. `editor-themes.js` (~540 lines, largest extraction)

Theme list rendering, filtering, modal, select, delete, save-current-theme flow, palette editor, theme preview capture. Consumes `EditorColorUtils`.

**State:** theme catalog, current/pending theme IDs, save mode, palette state

**Init receives:** modal container, palette container, preview iframe ref, `escapeHtml` reference

**Callbacks (complete list):**
- `onSendWs(msg)` — send WebSocket message (used by selectTheme, deleteTheme, saveCurrentTheme, savePalette)
- `onReloadPreview()` — reload the preview iframe
- `onAddMessage(role, text)` — add chat message (used by selectTheme, savePalette)
- `getModel()` — get current AI model selection (used by selectTheme, saveCurrentTheme, savePalette)
- `getCurrentAppName()` — get current app name (used by selectTheme, reloadThemes, saveCurrentTheme, savePalette)
- `isThinking()` — check if generation is in progress (guard in selectTheme)
- `setThinking(enabled, progress, stage)` — set thinking state (used by selectTheme)
- `buildThemeCarousel()` — rebuild the generate-phase carousel (called by reloadThemes, onThemeCreated)
- `selectThemeCarousel(id)` — select a theme in the carousel (called by onThemeCreated)
- `confetti()` — canvas-confetti library reference (called by onThemeCreated)

**Source lines:** editor.html ~5512-5891 (theme management, 380 lines) + ~6009-6168 (palette UI, 160 lines, after color utils extraction)

**Interface:** `window.EditorThemes = { init, load, reload, open, close, select, delete, openPalette, closePalette, savePalette, getThemes, getCurrentId, setPendingId, onThemeCreated, onThemeDeleted }`

Note: `themeThumbHtml` (line 3942) and `buildThemeCarousel` (line 3948) stay in editor.html because they operate on the generate-phase carousel DOM. The theme module calls `buildThemeCarousel` via callback.

Note: The Escape key handler at line 5880-5882 calls both `closeThemeModal()` and `closeAnimationModal()`. After extraction, this handler stays in editor.html and dispatches to `EditorThemes.close()` and `EditorAnimations.close()`.

### Orphaned Lines

Lines ~5220-5249 contain `customThemeMode`, `genAIEnabled`, `toggleGenAI`, `setThemeMode`, `toggleThemeMode`, `setThemeCarouselOverridden`. These are generate-phase UI state that doesn't belong to any extracted module. They stay in editor.html as part of the generate-phase orchestration.

### What Stays in editor.html

The JS section reduces from ~3,150 to ~1,865 lines. Remaining:

- `escapeHtml` utility (registered on `window` before module loads)
- WebSocket connection + message dispatcher
- Phase system (`setPhase`, `goHome`, unsaved guard)
- Auth/account panel
- Chat (`sendMessage`, `addMessage`, `setThinking`)
- Deploy (`startDeploy`, `toggleDeployMenu`, deploy history)
- Version history (undo/redo)
- App management (`saveApp`, `doSave`, `captureScreenshot`, `checkExistingApps`, `loadSavedApp`, `promptRenameApp`)
- Preview loading (`loadPreview`, `reloadPreview`)
- Theme carousel (`buildThemeCarousel`, `selectThemeCarousel`, `themeThumbHtml`)
- Generate-phase UI state (`customThemeMode`, `toggleGenAI`, etc.)
- Model picker (`toggleModelPicker`, `pickModel`, `getModel`)
- Audio toggle (~65 lines)
- Initialization (wires modules together via `init()` calls)

Total file size: ~4,980 lines (CSS 2,500 + HTML 579 + JS 1,865 + module `<script src>` tags).

### File Serving

New wildcard route in `router.ts` with path containment validation:

```typescript
if (url.pathname.startsWith('/editor/modules/')) {
  const modName = url.pathname.slice('/editor/modules/'.length);
  // Validate filename: only allow expected module names
  if (!/^[a-z0-9-]+\.js$/.test(modName)) {
    return new Response('Forbidden', { status: 403, headers: corsHeaders() });
  }
  const modDir = resolve(ctx.projectRoot, 'skills', 'vibes', 'modules');
  const modPath = resolve(modDir, modName);
  // Path containment check — prevent directory traversal
  if (!modPath.startsWith(modDir + '/')) {
    return new Response('Forbidden', { status: 403, headers: corsHeaders() });
  }
  const file = Bun.file(modPath);
  if (await file.exists()) {
    return new Response(file, { headers: { 'Content-Type': 'text/javascript', ...corsHeaders() } });
  }
}
```

### Load Order

In `editor.html`, before the main `<script>` block:

```html
<!-- Shared utilities -->
<script>window.escapeHtml = function(s) { /* ... */ };</script>

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
    editor.html  (reduced from 6263 to ~4980 lines)
```

No build step required. The modules are plain JS files served directly. The existing `merge-templates.js` system doesn't touch `editor.html` or these modules.

## Testing

| Change | Test Method |
|--------|-------------|
| Module loading | Start server, open editor, verify no console errors on page load |
| Color utilities | Unit tests (pure functions, easy to test with vitest) |
| Animations modal | Open animation modal, filter categories, select animation, verify it appears in chat context |
| Skills modal | Open skills modal, filter by plugin, select skill, verify it appears in chat context |
| Reference file | Upload reference in both generate and edit phases, verify intent picker works, verify HTML ref triggers theme carousel override |
| Image generation | Generate image in both phases, navigate carousel, accept image, verify reference intent picker opens |
| Theme management | Browse themes, select, delete, save current theme, palette editor, verify confetti on theme creation |
| Escape key | Press Escape with theme or animation modal open, verify both close correctly |
| Integration | Full generate → edit → save → deploy flow works end-to-end |

## Constraints

- No ES module imports in the main `<script>` block (plain HTML, not bundled)
- Modules use `window.*` registration pattern (consistent with existing `build/vibes-menu.js`)
- No build step — files served directly
- Modules must not call back into the main editor directly; use callbacks from `init()`

## Files Changed

- `scripts/server/router.ts` — add `/editor/modules/*` wildcard route with path containment
- `skills/vibes/modules/editor-color-utils.js` (new)
- `skills/vibes/modules/editor-animations.js` (new)
- `skills/vibes/modules/editor-skills.js` (new)
- `skills/vibes/modules/editor-reference.js` (new)
- `skills/vibes/modules/editor-imggen.js` (new)
- `skills/vibes/modules/editor-themes.js` (new)
- `skills/vibes/templates/editor.html` — remove extracted code, add `<script src>` tags, register `escapeHtml` on window, add `init()` wiring in initialization
