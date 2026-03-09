# Desktop Build Pipeline Design

**Date:** 2026-03-09
**Status:** Approved

## Problem

The vibes-desktop ElectroBun app lives on a separate branch with changes to shared files (`scripts/server.ts`, `editor.html`). Maintaining a separate branch adds mental overhead for a solo developer. We need a way to build the desktop app from `main` with one command.

## Key Insight

The shared file changes are backward-compatible:
- `server.ts`: `startServer()` export + `import.meta.main` guard — CLI behavior unchanged
- `editor.html`: drag spacer div + `IS_DESKTOP` flag — invisible in browser

These aren't "desktop patches." They're additive enhancements. No reason to keep them separate.

## Design: "It's just a subdirectory"

Everything lives in the repo on `main`. `vibes-desktop/` is a self-contained ElectroBun project that imports the parent plugin's server at runtime.

### The one command

```bash
bun scripts/build-desktop.sh
```

Three steps:
1. Compile native dylib (if stale or missing)
2. Run `bunx electrobun build --env=stable` inside `vibes-desktop/`
3. Output `.app` bundle to `vibes-desktop/dist/`

### What lives where

| Location | Purpose | Affects plugin users? |
|----------|---------|----------------------|
| `vibes-desktop/src/bun/` | ElectroBun shell (4 files, ~360 lines) | No |
| `vibes-desktop/native/macos/` | ObjC++ dylib source + build script | No |
| `vibes-desktop/electrobun.config.ts` | App name, identifier, version | No |
| `scripts/server.ts` | `startServer()` export + `import.meta.main` guard | No |
| `skills/vibes/templates/editor.html` | Drag spacer div, `IS_DESKTOP` flag | No |

### Version sync

Build script reads version from `.claude-plugin/plugin.json` and writes it into `electrobun.config.ts`. One version number, one source of truth.

### Developer mental model

Develop the plugin normally. Run one command when you want a `.app` for distribution. Changes to `editor.html` or `server.ts` are picked up automatically at runtime — no rebuild needed during development, only for distribution.
