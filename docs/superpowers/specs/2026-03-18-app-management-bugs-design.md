# App Management Bug Fixes: Rename, Navigation, Screenshots

**Date**: 2026-03-18
**Approach**: Targeted fixes (Approach A) — fix each bug at its narrowest point

## Problem Statement

Three related bugs in the desktop app's editor, all rooted in the same architectural gap: rename is copy-not-move, the gallery is never refreshed after page load, and `useExistingApp()` doesn't sync state with the server.

### Bug 1: Wrong Document on Navigation

After generating an app and saving/renaming it, navigating home and back to the app sometimes loads a different document (e.g., a Claude subprocess design plan) in the preview iframe. Loading the app a second time shows the correct content.

**Root cause**: `useExistingApp()` (line 4350) calls `loadPreview()` without syncing `ctx.currentApp` on the server via `POST /editor/apps/load`. If the server's `ctx.currentApp` drifted (e.g., auto-save set it to the original slug during generation), the preview loads whatever the server thinks is current.

### Bug 2: Rename Not Persisting

Renaming an app via the Chrome URL bar, then navigating home and back, shows the old name in both the gallery card and the URL bar header.

**Root cause**: `promptRenameApp()` (line 4192) calls `doSave(newName)` which copies `app.jsx` to `~/.vibes/apps/newName/` but never deletes `~/.vibes/apps/oldName/`. Both directories coexist. Additionally, `checkExistingApps()` is only called once at page load (line 6208), so the gallery never refreshes to reflect the rename.

### Bug 3: Screenshot Not Captured on Save

The Save feature via the top menu does not capture a screenshot for the app thumbnail.

**Root cause**: `captureScreenshot()` (line 4205) injects `dom-to-image-more` from `cdn.jsdelivr.net` into the preview iframe. In ElectroBun's WKWebView, this cross-origin script injection fails silently. The error is caught at line 4259 and only logged to `console.warn`, so the user gets no feedback.

## Design

### Fix 1: Server-Side Rename Endpoint

Add `POST /editor/apps/rename?from=old-name&to=new-name` to `router.ts`:

- Validate both names via `sanitizeAppName()`
- Check source directory exists, destination does not
- Use `fs.renameSync()` to atomically move the directory
- Update `ctx.currentApp = newName`
- Update deployment registry: if `registry.apps[oldName]` exists, move it to `registry.apps[newName]` and delete the old key. This preserves Connect infrastructure association so the next deploy doesn't re-provision.
- Return `{ ok: true, name: newName }`

Update `promptRenameApp()` in `editor.html` to call the new endpoint instead of `doSave(newName)`:

- `fetch('/editor/apps/rename?from=oldName&to=newName', { method: 'POST' })`
- On success: update `currentAppName`, call `updateAppNameDisplay()`
- On failure: revert `currentAppName` to `oldName`, show error

**Files**: `scripts/server/router.ts`, `scripts/lib/registry.js`, `skills/vibes/templates/editor.html`

### Fix 2: Gallery Refresh on Navigation Home

Call `checkExistingApps()` inside `navigateHome()`:

```javascript
function navigateHome() {
    closeEditSettings();
    setPhase('generate');
    checkExistingApps();
}
```

Every time the user clicks the logo (or discards/saves from the unsaved dialog), the gallery re-fetches `GET /editor/apps` and rebuilds the grid HTML. The "Continue current app" card matching uses the current `currentAppName`, so it reflects any renames.

**Files**: `skills/vibes/templates/editor.html`

### Fix 3: Fix `useExistingApp()` State Desync

Make `useExistingApp()` sync with the server before loading the preview:

```javascript
function useExistingApp() {
    if (currentAppName) {
        loadSavedApp(currentAppName);
    } else {
        document.getElementById('chatMessages').innerHTML = '';
        setPhase('edit');
        loadPreview();
        versionPush();
    }
}
```

When `currentAppName` is set, delegate to `loadSavedApp()` which awaits `POST /editor/apps/load` before calling `loadPreview()` — guaranteeing `ctx.currentApp` is correct. The fallback preserves existing behavior for anonymous/unsaved apps.

**Behavioral change**: Delegating to `loadSavedApp()` also resets `versionHistory` and `versionIndex`, which the current `useExistingApp()` does not do. This is desirable — it gives a clean undo/redo slate when resuming an app from the gallery.

**Files**: `skills/vibes/templates/editor.html`

### Fix 4: Screenshot Capture

**4a: Serve dom-to-image-more locally.**

Download `dom-to-image-more.min.js` to the server assets directory. Add a route to serve it at `GET /vendor/dom-to-image-more.min.js`. Update the injection in `captureScreenshot()`:

```javascript
script.src = '/vendor/dom-to-image-more.min.js';
```

Eliminates cross-origin issues since both the iframe and the script are served from localhost.

**4b: Add visible failure feedback.**

Replace `console.warn` with a system message:

```javascript
} catch (err) {
    console.warn('[Screenshot] Capture failed:', err);
    addMessage('system', 'Screenshot capture failed — thumbnail may not update.');
}
```

**Note**: `captureScreenshot()` is also called after `deploy_complete` (line 3814). A screenshot failure message right after "Deployed!" could be confusing. Only show the failure message when `captureScreenshot()` is called from `doSave()`, not from deploy. The simplest way: add an optional `silent` parameter to `captureScreenshot(silent)` — deploy calls it with `silent=true`.

**Files**: `scripts/server/router.ts` (explicit route at `GET /vendor/dom-to-image-more.min.js`), `assets/vendor/dom-to-image-more.min.js` (new, vendored library under project root so the route can serve it), `skills/vibes/templates/editor.html` (injection URL + conditional error message)

## Testing

| Fix | Test Method |
|-----|-------------|
| Rename | Generate app, rename via URL bar, go home, verify old name gone + new name shown in gallery, click card, verify URL bar shows new name |
| Gallery refresh | Generate app, go home, verify new app appears in gallery without page reload |
| useExistingApp desync | Generate app, save, go home, click "Continue current app" card, verify correct app loads in preview |
| Screenshot | Save an app, verify screenshot.png is created in `~/.vibes/apps/{name}/`, verify thumbnail appears in gallery |

## Edge Cases

- **Rename destination already exists**: The rename endpoint checks that the destination directory doesn't exist before renaming. Return 409 Conflict if it does.
- **Save & Go race condition**: The "Save & Go" dialog calls `saveApp()` then `navigateHome()` synchronously. The save is async (WebSocket), so the gallery may refresh before the save completes. The newly saved app will appear on the next home visit. Acceptable tradeoff — no additional complexity needed.
- **Name sanitization asymmetry**: The server's `sanitizeAppName()` strips non-`[a-z0-9-]` chars, while the client dialog replaces them with hyphens. Pre-existing issue, not introduced here. The rename endpoint receives already-sanitized names from the client dialog.

## Files Changed

- `scripts/server/router.ts` — rename endpoint, vendor route
- `scripts/lib/registry.js` — rename updates deployment registry entries
- `skills/vibes/templates/editor.html` — `navigateHome()`, `useExistingApp()`, `promptRenameApp()`, `captureScreenshot()`
- `assets/vendor/dom-to-image-more.min.js` (new) — vendored library
