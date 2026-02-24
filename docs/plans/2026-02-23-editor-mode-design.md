# Editor Mode Design

**Date:** 2026-02-23
**Status:** Approved

## Summary

Add an "Editor" UI mode to the Vibes plugin. When users invoke app-building skills (`/vibes`, `/sell`, `/launch`, `/riff`), the system checks dependencies first, then asks: Terminal or UI? If UI, launches a browser-based editor that handles the entire workflow — setup, app generation, preview, iteration, and deployment — all in one page.

## Architecture

Two modes, one server:

```
preview-server.js
├── --mode=preview  (default, unchanged)
│   └── GET / → preview.html (existing behavior, untouched)
│
└── --mode=editor
    └── GET / → editor.html (new full experience)
```

## Editor Phases

### Phase 1: Setup Wizard
- Checks `.env` for Clerk keys, Connect URLs
- Probes wrangler auth, SSH access
- Shows checklist with pass/fail status
- Clerk + Connect required to proceed; wrangler/SSH optional (affects deploy targets)
- Auto-advances to Phase 2 if all required deps pass

### Phase 2: App Generation
- Centered prompt UI: textarea + theme dropdown + "Generate" button
- Shows "Use existing app.jsx" if one exists
- Sends `{ type: 'generate', prompt, themeId }` over WebSocket
- Server reads design tokens + theme file, builds generation prompt, runs Claude
- Shows progress indicator during generation
- Auto-transitions to Phase 3 on completion

### Phase 3: Edit + Deploy
- Same layout as preview.html: preview iframe (left) + chat panel (right)
- Adds Deploy button in header (alongside Themes, Reload)
- Deploy button opens dropdown: Cloudflare / exe.dev (greyed out if not configured)
- Sends `{ type: 'deploy', target: 'cloudflare'|'exe' }` over WebSocket
- Server runs assemble.js then deploy script, streams progress
- Shows deployed URL in chat when done

## New Server Endpoints

- `GET /editor/status` → JSON with dependency check results
- `GET /editor/app-exists` → `{ exists: boolean }`

## New WebSocket Messages

- `{ type: 'generate', prompt, themeId }` → generate app.jsx from scratch
- `{ type: 'deploy', target }` → assemble + deploy
- `{ type: 'phase', phase: 'setup'|'generate'|'edit' }` → server→client phase transition

## Skill Changes

Skills `/vibes`, `/sell`, `/launch`, `/riff` get a pre-flight dependency check, then ask "Terminal or UI?" If UI, launch `node scripts/preview-server.js --mode=editor` and tell user to open the browser. If Terminal, continue as before.

## Files

| File | Action |
|------|--------|
| `skills/vibes/templates/editor.html` | Create — full editor UI |
| `scripts/preview-server.js` | Modify — add `--mode=editor`, new endpoints + handlers |
| `skills/vibes/SKILL.md` | Modify — add Terminal/UI choice |
| `skills/sell/SKILL.md` | Modify — add Terminal/UI choice |
| `skills/launch/SKILL.md` | Modify — add Terminal/UI choice |
| `skills/riff/SKILL.md` | Modify — add Terminal/UI choice |
