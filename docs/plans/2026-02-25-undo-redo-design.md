# Undo/Redo Version Navigation Design

## Problem

When iterating on an app in the editor, there's no way to go back to a previous version if a change makes things worse.

## Design

### In-Memory Version History

- `versionHistory[]` array stores app.jsx content strings
- `versionIndex` points to the current version
- Max 20 entries (oldest dropped when full)
- Lost on page reload (no persistence needed)

### Flow

1. On `app_updated` WebSocket message, fetch `/app.jsx` content and push to `versionHistory[]`
2. If navigating back and a new update arrives, truncate future versions (standard undo behavior)
3. Undo: POST previous version content to new `/editor/apps/write` endpoint, reload preview
4. Redo: POST next version content, reload preview

### UI

Undo/Redo buttons in the edit phase header area, with a version counter:

```
[← Undo] [Redo →]  v3/5
```

- Buttons disabled at boundaries (no undo at v1, no redo at latest)
- Counter shows current position / total

### Server Endpoint

`POST /editor/apps/write` — accepts raw JSX body, writes to `PROJECT_ROOT/app.jsx`. No app name needed. Used only for undo/redo navigation (not for normal AI-driven updates).

### Edge Cases

- First app_updated: history has 1 entry, both buttons disabled
- Navigate back + new AI update: future versions discarded, new version appended
- History full (20): shift oldest entry off
