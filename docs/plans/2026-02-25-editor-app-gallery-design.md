# Editor App Gallery Design

## Problem

The editor landing page (Phase 2: Generate) shows a single centered column with a prompt textarea and a flat list of saved apps. Users can't visually distinguish apps before clicking into them.

## Design

### Two-Panel Layout

Split the generate phase into two side-by-side panels:

- **Left panel (40%)** — "What do you want to build?" prompt, theme selector, generate button. Same content as current, just narrower.
- **Right panel (60%)** — "Your Apps" gallery. Two sections:
  1. **Top 8 most recent** — 2-column grid of cards with screenshot thumbnails, app name, time ago, theme name. Click to load and edit.
  2. **Older apps** — compact list rows (no screenshots) with name, time, arrow. Same style as current app-item buttons.

When there are no saved apps, hide the right panel and center the left panel (current behavior).

### Screenshot Capture

**When:** After a successful deploy (not on auto-save). The app is fully rendered in the preview iframe at deploy time.

**How:** Use `html2canvas` on the preview iframe's `contentDocument.body`. Convert to PNG data URL, send to server via new endpoint.

**Storage:** `~/.vibes/apps/{name}/screenshot.png` alongside `app.jsx`.

**Fallback:** Apps without screenshots show a styled placeholder card with theme colors or a generic gradient.

### Server Changes (preview-server.js)

1. **`GET /editor/apps`** — Add `hasScreenshot: boolean` to each app in the response.
2. **`GET /editor/apps/:name/screenshot`** — Serve `screenshot.png` for a given app. 404 if not found.
3. **`POST /editor/apps/:name/screenshot`** — Accept PNG body (or base64 JSON), write to `~/.vibes/apps/{name}/screenshot.png`.

### Editor HTML Changes (editor.html)

1. **Phase 2 layout** — Replace single `.generate-card` with two-panel flex layout.
2. **App gallery component** — New `renderAppGallery()` function that builds the card grid + list.
3. **Screenshot capture** — New `captureScreenshot()` function called after deploy succeeds. Uses html2canvas on the preview iframe.
4. **Responsive** — On narrow screens (< 768px), stack panels vertically (prompt on top, gallery below).

### Dependencies

- `html2canvas` — loaded from CDN (`https://html2canvas.hertzen.com/dist/html2canvas.min.js`). ~40KB gzipped. Only loaded when needed (lazy script tag injection on first deploy).

## Scope

- Editor landing page only (Phase 2: Generate)
- No changes to Phase 3 (Edit) or deploy scripts
- No changes to saved app data format (just adds optional screenshot.png)
