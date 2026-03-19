# App Management: Bug Fixes + State Architecture Simplification

**Date**: 2026-03-18
**Approach**: Targeted fixes (Approach A) combined with client-authoritative state (Approach B)

## Problem Statement

Three related bugs in the desktop app's editor, all rooted in the same architectural gap: the "current app" is tracked independently on the frontend (`currentAppName`) and backend (`ctx.currentApp`) with no reliable sync protocol.

### Bug 1: Wrong Document on Navigation

After generating an app and saving/renaming it, navigating home and back to the app sometimes loads a different document (e.g., a Claude subprocess design plan) in the preview iframe. Loading the app a second time shows the correct content.

**Root cause**: `useExistingApp()` (line 4350) calls `loadPreview()` without telling the server which app to serve. The preview iframe loads `/app-frame`, which uses `ctx.currentApp` — but that may have drifted from what the client thinks is current.

### Bug 2: Rename Not Persisting

Renaming an app via the app name text input in the editor header, then navigating home and back, shows the old name in both the gallery card and the URL bar header.

**Root cause**: `promptRenameApp()` (line 4192) calls `doSave(newName)` which copies `app.jsx` to `~/.vibes/apps/newName/` but never deletes `~/.vibes/apps/oldName/`. Both directories coexist. Additionally, `checkExistingApps()` is only called once at page load (line 6208), so the gallery never refreshes to reflect the rename.

### Bug 3: Screenshot Not Captured on Save

The Save feature via the top menu does not capture a screenshot for the app thumbnail.

**Root cause**: `captureScreenshot()` (line 4205) injects `dom-to-image-more` from `cdn.jsdelivr.net` into the preview iframe. In ElectroBun's WKWebView, this cross-origin script injection fails silently. The error is caught at line 4259 and only logged to `console.warn`, so the user gets no feedback.

## Architecture Change: Client-Authoritative State

### Motivation

The root cause of Bug 1 (and an entire class of potential future bugs) is that two independent state holders track "current app" and can get out of sync. Rather than patching each desync case, eliminate the concept of persistent server-side app state.

### Principle

**The client always tells the server which app it's talking about.** The server never remembers "current app" between requests.

| | Current | After |
|---|---|---|
| State holders for "current app" | 2 (frontend `currentAppName` + server `ctx.currentApp`) | 1 (frontend `currentAppName`) |
| Sync protocol | Ad hoc WebSocket + HTTP calls | None needed |
| New feature asks "which app?" | Must check: is `ctx.currentApp` correct? | Read the request parameter |
| Server restart | Loses state silently | No state to lose |

### Server Changes

**`app-context.js`** — Change `currentAppDir()` and `resolveAppJsxPath()` to accept an explicit `appName` parameter:

```javascript
export function currentAppDir(ctx, appName) {
    if (!appName) return null;
    return join(ctx.appsDir, appName);
}

export function resolveAppJsxPath(ctx, appName) {
    const dir = currentAppDir(ctx, appName);
    return join(dir || ctx.projectRoot, 'app.jsx');
}
```

**`router.ts`** — HTTP handlers read app name from `?app=` query parameter:

- `GET /app.jsx?app=name` — serve the named app's JSX
- `GET /app-frame?app=name` — assemble and serve the named app's preview
- `GET /editor/app-exists?app=name` — check if named app exists
- `POST /editor/apps/save?name=X` — save (unchanged, already uses `?name=`)
- `POST /editor/apps/write?app=name` — write app code

Remove `ctx.currentApp = name` from `editorLoadApp()` and `editorSaveApp()`. The `editorLoadApp` endpoint simplifies to a file-existence check + copy-on-write for examples (no longer needs to set server state).

**`ws.ts`** — `save_app` handler already receives `name` in the message. Stop setting `ctx.currentApp`. Pass `name` through to `resolveAppJsxPath(ctx, name)`.

**Subprocess handlers** (`generate.ts`, `chat.ts`, `theme.ts`, `deploy.ts`, `create-theme.ts`) — Receive `appName` as a parameter from the WebSocket dispatch. Replace `currentAppDir(ctx)` calls with `currentAppDir(ctx, appName)`.

**Special case — `handleGenerate()`**: The server creates the app name from the prompt slug. It already uses a local `appDir` variable (line 43). Replace the remaining `currentAppDir(ctx)` calls with the local variable. The client learns the name via the `app_created` event, which already exists.

**Remove `ctx.currentApp`** from `ServerContext` in `config.ts`.

### Frontend Changes

**`editor.html`** — Every fetch/iframe load includes `currentAppName`:

- `loadPreview()` / `reloadPreview()` — `frame.src = '/app-frame?app=' + encodeURIComponent(currentAppName) + '&t=' + Date.now()`
- `versionPush()` — `fetch('/app.jsx?app=' + encodeURIComponent(currentAppName))`
- WebSocket messages (`chat`, `theme_switch`) — add `app: currentAppName` field
- `useExistingApp()` simplifies — just calls `setPhase('edit')` and `loadPreview()`. Since the client sends the app name with the iframe request, no server sync needed. The two-path divergence between `useExistingApp` and `loadSavedApp` collapses.
- `loadSavedApp()` simplifies — the `POST /editor/apps/load` call is only needed for copy-on-write (bundled examples). After that, just set `currentAppName` and load.

### Call Sites (complete inventory)

**Writers of `ctx.currentApp` to remove** (5):
- `router.ts:546` — `editorLoadApp()`
- `router.ts:560` — `editorSaveApp()`
- `ws.ts:200` — `save_app` handler
- `generate.ts:45` — `handleGenerate()` (replace with local variable)
- `generate.ts:28` — auto-save guard (use parameter)

**Readers to update** (~25, via `currentAppDir(ctx)` / `resolveAppJsxPath(ctx)`):
- `router.ts` — 5 call sites
- `handlers/generate.ts` — 6 call sites (already has local `appDir`)
- `handlers/chat.ts` — 3 call sites
- `handlers/theme.ts` — 7 call sites
- `handlers/deploy.ts` — 1 call site
- `handlers/create-theme.ts` — 1 call site
- `ws.ts` — 1 call site
- `config.ts` — 1 call site

### WebSocket Dispatch Changes

The WS message handler in `ws.ts` dispatches to subprocess handlers. Each dispatch call adds the app name from the message or from a new `app` field:

```
case 'chat':     handleChat(ctx, onEvent, ..., msg.app)
case 'generate': handleGenerate(ctx, onEvent, ...)  // generates its own name
case 'theme':    handleThemeSwitch(ctx, onEvent, ..., msg.app)
case 'deploy':   handleDeploy(ctx, onEvent, ..., msg.app)
```

`generate` is the exception — it creates the app name server-side and communicates it back via `app_created`.

## Bug Fixes (on top of architecture change)

### Fix 1: Server-Side Rename Endpoint

Add `POST /editor/apps/rename?from=old-name&to=new-name` to `router.ts`:

- Validate both names via `sanitizeAppName()`
- Check source directory exists, destination does not (409 Conflict if it does)
- Use `fs.renameSync()` to atomically move the directory
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

### Fix 3: Screenshot Capture

**3a: Serve dom-to-image-more locally.**

Download `dom-to-image-more.min.js` to `assets/vendor/`. Add an explicit route at `GET /vendor/dom-to-image-more.min.js` in `router.ts`. Update the injection in `captureScreenshot()`:

```javascript
script.src = '/vendor/dom-to-image-more.min.js';
```

Eliminates cross-origin issues since both the iframe and the script are served from localhost.

**3b: Add visible failure feedback.**

Replace `console.warn` with a system message:

```javascript
} catch (err) {
    console.warn('[Screenshot] Capture failed:', err);
    if (!silent) addMessage('system', 'Screenshot capture failed — thumbnail may not update.');
}
```

Add an optional `silent` parameter to `captureScreenshot(silent)`. The `deploy_complete` handler calls it with `silent=true` to avoid confusing users with a screenshot error right after a successful deploy.

**Files**: `scripts/server/router.ts` (route), `assets/vendor/dom-to-image-more.min.js` (new), `skills/vibes/templates/editor.html` (injection URL + conditional error message)

## Testing

| Change | Test Method |
|--------|-------------|
| Client-authoritative state | Generate app, restart server (`bun scripts/server.ts --mode=editor`), verify preview still loads correctly when client resends app name |
| Rename | Generate app, rename via header input, go home, verify old name gone + new name shown in gallery, click card, verify header shows new name |
| Gallery refresh | Generate app, go home, verify new app appears in gallery without page reload |
| useExistingApp | Generate app, save, go home, click "Continue current app" card, verify correct app loads in preview |
| Screenshot | Save an app, verify screenshot.png is created in `~/.vibes/apps/{name}/`, verify thumbnail appears in gallery |
| Generate flow | Generate new app, verify `app_created` event sets `currentAppName`, verify preview loads the new app |
| Chat/theme while editing | Open app, send chat message or switch theme, verify changes apply to the correct app |

## Edge Cases

- **Rename destination already exists**: The rename endpoint checks that the destination directory doesn't exist before renaming. Return 409 Conflict if it does.
- **Save & Go race condition**: The "Save & Go" dialog calls `saveApp()` then `navigateHome()` synchronously. The save is async (WebSocket), so the gallery may refresh before the save completes. The newly saved app will appear on the next home visit. Acceptable tradeoff — no additional complexity needed.
- **Name sanitization asymmetry**: The server's `sanitizeAppName()` strips non-`[a-z0-9-]` chars, while the client dialog replaces them with hyphens. Pre-existing issue, not introduced here. The rename endpoint receives already-sanitized names from the client dialog.
- **`currentAppName` is null**: When no app is active (fresh page load, after starting a new generation), requests that need an app name simply omit the parameter. Server handlers return the "Waiting for app" placeholder or fall back to the project root, same as current behavior when `ctx.currentApp` is null.
- **Version history reset**: `loadSavedApp()` resets `versionHistory` and `versionIndex`. This is desirable — it gives a clean undo/redo slate when resuming an app from the gallery.

## Files Changed

- `scripts/server/config.ts` — remove `currentApp` from `ServerContext`
- `scripts/server/app-context.js` — add `appName` parameter to `currentAppDir()`, `resolveAppJsxPath()`
- `scripts/server/router.ts` — read `?app=` param in handlers, add rename endpoint, add vendor route
- `scripts/server/ws.ts` — pass app name through to handlers, stop setting `ctx.currentApp`
- `scripts/server/handlers/generate.ts` — use local `appDir` variable throughout
- `scripts/server/handlers/chat.ts` — receive `appName` parameter
- `scripts/server/handlers/theme.ts` — receive `appName` parameter
- `scripts/server/handlers/deploy.ts` — receive `appName` parameter
- `scripts/server/handlers/create-theme.ts` — receive `appName` parameter
- `scripts/lib/registry.js` — rename updates deployment registry entries
- `skills/vibes/templates/editor.html` — send `currentAppName` with all requests, simplify `useExistingApp()`, update `navigateHome()`, `promptRenameApp()`, `captureScreenshot()`
- `assets/vendor/dom-to-image-more.min.js` (new) — vendored library
