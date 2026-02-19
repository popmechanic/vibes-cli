# Live Preview Wrapper — Design Document

**Date:** 2026-02-18
**Status:** Approved

## Summary

A live development wrapper that lets users preview their app, chat with Claude Code to iterate on the design, and switch between all 41 themes via a modal — all from a single browser tab.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LLM backend | Claude Code bridge via `claude -p` | No extra API key needed, uses existing session |
| Theme switch behavior | Preserve edits + retheme | User work is preserved when switching themes |
| Layout | Side-by-side split (60/40) | IDE-like experience, best for desktop |
| Architecture | WebSocket bridge server | Clean separation, supports streaming, real-time |

## Architecture

```
preview-server.js (Node.js/Bun)
├── HTTP Server (:3333)
│   ├── GET /           → preview.html
│   ├── GET /app.jsx    → current app.jsx
│   ├── GET /themes     → JSON array of 41 themes
│   └── GET /bundles/*  → mocked Fireproof bundles
│
└── WebSocket Server (:3333/ws)
    ├── Receives: chat messages, theme switch requests
    ├── Spawns: claude -p (CLI subprocess)
    └── Returns: updated app.jsx, status, chat responses
```

### Data Flow

1. User runs `node scripts/preview-server.js`
2. Opens `http://localhost:3333` in browser
3. Side-by-side: app preview (iframe, left 60%) + chat panel (right 40%)
4. Chat message → WebSocket → server → `claude -p` with app.jsx context → Claude edits app.jsx on disk → server signals client → iframe reloads
5. Theme click → same pipeline with retheme prompt + theme file content

## UI Design

### Main Layout

- **Header bar:** Dark bg, app title, theme button (left), reload button (right)
- **Left panel (60%):** App preview in iframe, React 18 UMD + Babel + mocked Fireproof
- **Right panel (40%):** Chat with message bubbles, input box at bottom
- **Resizable splitter:** Drag to resize panels

### Theme Modal

- Overlay grid of 41 theme cards
- Each card: theme name, mood description, accent color swatch, "best for" snippet
- Click a theme → sends retheme request → closes modal
- Scrollable grid, 3 columns

### States

- **Thinking:** Spinner in chat, dimmed preview iframe
- **Updated:** Flash green border on preview iframe, new message in chat
- **Error:** Red error message in chat panel

## Technical Details

### Files

| File | Purpose |
|------|---------|
| `scripts/preview-server.js` | HTTP + WebSocket server |
| `skills/vibes/templates/preview.html` | Side-by-side preview wrapper |

### WebSocket Protocol

**Client → Server:**
```json
{ "type": "chat", "message": "make the cards bigger" }
{ "type": "theme", "themeId": "vault" }
```

**Server → Client:**
```json
{ "type": "status", "status": "thinking" }
{ "type": "chat", "role": "assistant", "content": "Done! I've..." }
{ "type": "app_updated" }
{ "type": "error", "message": "..." }
```

### Claude Code Invocation

For chat messages:
```bash
claude -p "The user says: [message]. Edit app.jsx to implement the changes.
Keep the same component structure (useTenant, useFireproofClerk mocks, useVibesTheme)." \
  --allowedTools Edit,Read,Write,Glob,Grep
```

For theme switches:
```bash
claude -p "Restyle app.jsx using the [theme-name] theme.
Theme design principles: [theme file content].
Preserve all functionality — only change visual styling and layout.
Keep useVibesTheme() and the theme switching mechanism." \
  --allowedTools Edit,Read,Write,Glob,Grep
```

### Preview Iframe

- Same mocked Fireproof approach as existing preview.html
- React 18 UMD + Babel standalone
- Loads app.jsx via `fetch('/app.jsx')`, injects into Babel script block
- On `app_updated` WebSocket message: re-fetch + re-render
- Global mocks: `useTenant()`, `useFireproofClerk()`, `useVibesTheme()`, React hooks

### Theme Catalog

- Server parses `skills/vibes/themes/catalog.txt` at startup
- Extracts table rows: theme ID, name, mood, best-for
- Serves as JSON array via `GET /themes`
- Client renders as scrollable grid modal

## Out of Scope

- Streaming Claude output character-by-character (future enhancement)
- Mobile-optimized layout
- Saving chat history between sessions
- Deploying the preview wrapper (it's a local dev tool)
