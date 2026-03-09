# Desktop Link Handling via Preload Event Bridge

## Problem

External links and auth popups don't work in the VibesOS desktop app. Two prior approaches failed:

1. **WebSocket bridge** — editor.html intercepted clicks, sent `open_external` over WebSocket to server, server called `Utils.openExternal`. Fragile: required WebSocket connection, added latency, `preventDefault()` killed native events.

2. **Native navigation events** — `will-navigate` and `new-window-open` handlers on BrowserView. Links are completely dead: events don't fire for blocked navigations or `window.open()` calls.

### Root Cause

ElectroBun's preload (`events.ts`) only emits `new-window-open` for Cmd+Click, not regular link clicks or `window.open()`. The `will-navigate` event may fire at the native WKWebView level but doesn't propagate to the Bun process for blocked URLs. Navigation rules silently block without notification.

## Solution

Add an inline preload script that intercepts external links and `window.open()` calls, then emits `new-window-open` events through ElectroBun's own event bridge (`__electrobunEventBridge`). The existing Bun-side `new-window-open` handler routes URLs appropriately.

## Architecture

```
User clicks external link / calls window.open()
  → Custom preload intercepts (capture-phase listener + window.open override)
  → Emits "new-window-open" via __electrobunEventBridge.postMessage()
  → Bun process receives event on webview.on("new-window-open")
  → vibesos.com URLs → mainWindow.webview.loadURL() (inline auth)
  → All other URLs → Utils.openExternal() (system browser)
```

## Files Changed

### `vibes-desktop/src/bun/index.ts`

Add `preload` option to BrowserWindow constructor with inline JS (~30 lines):

```javascript
// Inline preload — runs after ElectroBun's built-in preload, has access to event bridge
const LINK_PRELOAD = `
(function() {
  function emitNewWindow(url) {
    var bridge = window.__electrobunEventBridge || window.__electrobunInternalBridge;
    if (!bridge) return;
    bridge.postMessage(JSON.stringify({
      id: "webviewEvent",
      type: "message",
      payload: {
        id: window.__electrobunWebviewId,
        eventName: "new-window-open",
        detail: JSON.stringify({ url: url, isCmdClick: false })
      }
    }));
  }

  // Intercept external link clicks
  document.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.href;
    if (!href || href.startsWith('javascript:')) return;
    try {
      if (new URL(href, location.origin).origin === location.origin) return;
    } catch(e) { return; }
    e.preventDefault();
    e.stopPropagation();
    emitNewWindow(href);
  }, true);

  // Override window.open to emit events
  var originalOpen = window.open;
  window.open = function(url) {
    if (url) { emitNewWindow(String(url)); }
    return null;
  };
})();
`;
```

Pass to BrowserWindow:
```typescript
const mainWindow = new BrowserWindow({
  // ...existing options...
  preload: LINK_PRELOAD,
});
```

### No other files change

- Navigation rules stay (defense-in-depth)
- `will-navigate` handler stays (safety net)
- `new-window-open` handler stays (receives preload events)
- editor.html already cleaned up (WebSocket interceptors removed)
- No React/server changes

## Auth Flow

1. Editor calls `window.open(authorizeUrl, 'vibes_auth', ...)`
2. Preload override emits `new-window-open` with vibesos.com URL
3. Bun handler detects vibesos.com → `mainWindow.webview.loadURL(url)`
4. Pocket ID login renders inline in the main window
5. Auth completes → callback redirects to `http://localhost:3333/callback?...`
6. Navigation rules allow localhost → editor resumes

## Event Bridge Format

ElectroBun's internal event bridge expects:
```json
{
  "id": "webviewEvent",
  "type": "message",
  "payload": {
    "id": "<webviewId>",
    "eventName": "new-window-open",
    "detail": "{\"url\": \"...\", \"isCmdClick\": false}"
  }
}
```

This matches the format used by ElectroBun's own Cmd+Click handler in `events.ts`.

## Edge Cases

- **Preview iframe links**: Preload only runs on the top-level webview, not inside iframes. Links inside the preview iframe are blocked by navigation rules but won't open externally. Acceptable for now.
- **JavaScript navigation** (`location.href = ...`): Not intercepted by the preload. Blocked by navigation rules. `will-navigate` may or may not fire.
- **Auth return**: The callback URL (`localhost:3333/callback`) is allowed by navigation rules, so the redirect works naturally.
