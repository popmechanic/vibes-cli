# Vibes DIY Plugin - Development Guide

## Agent Quick Reference

### When to Read What

| Task | Read First |
|------|------------|
| Working on skills | The specific `skills/*/SKILL.md` file |
| Generating app code | SKILL.md has TinyBase patterns and common hooks |
| Working on scripts | `scripts/package.json` for deps |
| Debugging React errors | `.claude/rules/react-singleton.md` loads automatically; also `skills/vibes/SKILL.md` Common Mistakes |
| Deploying to Cloudflare | `skills/cloudflare/SKILL.md` |
| Testing plugin changes | `cd scripts && npm run test:fixtures` for structural tests; `/vibes:test` for full E2E |
| Editing auth components | `.claude/rules/auth-components.md` loads automatically |
| Editing templates or build system | `.claude/rules/template-build.md` loads automatically |
| Working on sharing/invites | `.claude/rules/sharing-architecture.md` loads automatically |
| Running autoresearch | `docs/superpowers/specs/2026-03-25-parallel-autoresearch-engine-design.md` for spec; `.claude/agents/autoresearch-*.md` for agent defs |
| Autoresearch scoring/reports | `scripts/eval-scoring.ts`, `scripts/eval-report.ts` |
| Autoresearch test harness | `scripts/eval-ssr-check.ts` (Tier 1.5), `scripts/eval-harness.ts` (Tier 2) |

### TinyBase API Reference

SKILL.md provides common patterns (useTable, useRow, useAddRowCallback, store.setRow/delRow) and critical gotchas.

TinyBase hooks are exposed as `window.*` globals in the template (useTable, useRow, useCell, useRowIds, useSortedRowIds, useAddRowCallback, etc.). The `useApp()` hook provides `{ isReady, isSyncing, user }` context.

### Environment Variables in SKILL.md

`CLAUDE_PLUGIN_ROOT` is set by plugin runtime but may be missing in dev mode (`claude --plugin .`). `CLAUDE_SKILL_DIR` is text-substituted before the agent sees the markdown — always reliable.

All SKILL.md bash blocks use the fallback pattern:
```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
```

`CLAUDE_SKILL_DIR` is `<plugin-root>/skills/<name>/`, so `dirname dirname` gives the plugin root.

## Critical Rules

### `?external=` for React Singleton

Any esm.sh package that depends on React MUST use `?external=react,react-dom`. Details in `.claude/rules/react-singleton.md` (loads automatically when editing templates).

### Import Map Lives in Base Template

The authoritative import map is in `source-templates/base/template.html`. After editing, run `bun scripts/merge-templates.js --force`.

### Skills Are Atomic

Each skill is ONE plan step — never decompose into sub-steps. Always invoke the skill before running its commands, even for reassembly/redeploy.

## Autoresearch (Parallel Autoresearch Engine)

Massively parallel SKILL.md optimization. Run with `/vibes:autoresearch` or directly:

```bash
bun scripts/eval-parallel.ts --mode=continuous
```

**Key scripts:**
- `scripts/eval-ssr-check.ts` — Tier 1.5 SSR smoke test
- `scripts/eval-harness.ts` — Tier 2 render-and-record data model harness
- `scripts/eval-scoring.ts` — Triple-run scoring with consistency penalty
- `scripts/eval-parallel.ts` — Orchestrator with generation loop
- `scripts/eval-report.ts` — Final report generator

**Agent definitions:** `.claude/agents/autoresearch-*.md` (orchestrator, mutator, generator, red-teamer, cross-pollinator)

## Package Versions

The import map in `source-templates/base/template.html` is the authoritative source for current package versions (TinyBase from esm.sh, `oauth4webapi`, React 19.2.4). The OIDC bridge (`bundles/oidc-bridge.js`) is loaded as a local bundle for private app auth.

## Deploy Workflow

Apps deploy to Cloudflare Workers via the shared Deploy API Worker. No wrangler installation or user Cloudflare tokens required.

```bash
bun scripts/deploy-cloudflare.js --name <app> --file index.html
```

Auth happens automatically: the CLI opens a browser for Pocket ID login and caches credentials at `~/.vibes/auth.json`. The Deploy API accepts the assembled HTML plus an OIDC token and handles all Cloudflare API calls server-side, including:

- **Worker deployment**: Deploys the app as a Worker in a Workers for Platforms namespace.
- **WebSocket URL injection**: The Deploy API injects the `wsUrl` for TinyBase sync into the app HTML before deploying.
- **Sync**: Handled by TinyBase Durable Objects via the dispatch worker (`dispatch-worker/`). The DO auto-creates on first WebSocket connection — no provisioning step needed.

## Desktop App

The desktop app lives in `vibes-desktop/` — a thin ElectroBun shell (VibesOS, `com.vibes.os`) that embeds the web editor in a native window. One command builds everything including a polished DMG:

```bash
bash scripts/build-desktop.sh
```

Build steps: (1) sync version from `plugin.json`, (2) compile native dylib, (3) clean `build/` dir then `bunx electrobun build` (ElectroBun caches compiled TS — always clean to avoid stale code), (4) bundle plugin files into `.app/Contents/Resources/vibes-plugin/` via rsync, (5) create DMG with `create-dmg` (2-icon layout: app + Applications). Output: `vibes-desktop/artifacts/stable-macos-arm64-VibesOS.dmg`.

### First-Launch Setup

On first launch (or version upgrade), the app shows a setup UI instead of the editor:
1. **Claude check/install**: Finds existing Claude binary or installs via `claude.ai/install.sh`
2. **Plugin install**: Copies bundled plugin from `.app/Contents/Resources/vibes-plugin/` to `~/.claude/plugins/cache/vibes-bundled/vibes/{version}/`, registers in `installed_plugins.json` and `known_marketplaces.json`
3. **Auth**: Placeholder — pending Loom skill integration

Setup completion is tracked by `~/.vibes/setup-complete-{version}` marker files. Subsequent launches skip setup entirely.

### Code Signing & Notarization

ElectroBun handles signing and notarization automatically when `codesign: true, notarize: true` in `electrobun.config.ts`. Required env vars (set in `~/.zshrc`):

- `ELECTROBUN_DEVELOPER_ID` — `Developer ID Application: Chroma Corporation (33S8ZN3JF7)`
- `ELECTROBUN_TEAMID` — `33S8ZN3JF7`
- `ELECTROBUN_APPLEID` — Apple ID email
- `ELECTROBUN_APPLEIDPASS` — app-specific password (generate at account.apple.com → Sign-In and Security → App-Specific Passwords)

### DMG Gotchas

- **Background images must be 1x resolution** matching the window size (1024×576), not 2× retina. Retina images silently fail to display.
- **Symlinks cannot hold custom icons** — macOS extended attributes don't work on symlinks. The build script replaces the Applications symlink with a Finder alias (bookmark file) created via Swift, then sets the system Applications folder icon on it.
- **`create-dmg` (Homebrew)** is the reliable DMG creation tool. AppleScript-based approaches have flaky `.DS_Store` behavior.

### Key Files

- `vibes-desktop/src/bun/index.ts` — window creation, setup flow, menu, tray, external link handling
- `vibes-desktop/src/bun/setup.ts` — first-launch setup orchestrator (Claude install, plugin copy, auth placeholder)
- `vibes-desktop/src/bun/setup-html.ts` — inline HTML for setup screen UI
- `vibes-desktop/src/bun/plugin-installer.ts` — copy plugin files to `~/.claude/plugins/`, merge JSON registrations
- `vibes-desktop/src/bun/plugin-discovery.ts` — plugin path resolution (dev override → bundled cache → installed_plugins.json)
- `vibes-desktop/native/macos/window-controls.mm` — native dylib for hiding standard window buttons
- `vibes-desktop/electrobun.config.ts` — app metadata (name: VibesOS, identifier: com.vibes.os, version)
- `vibes-desktop/icon.iconset/` — app icon PNGs at all required macOS sizes
- `vibes-desktop/dmg-background.png` — branded DMG background (1024×576, blue grid)
- `scripts/build-desktop.sh` — one-command build + plugin bundling + DMG creation script

### Desktop-Specific Behavior

Enabled when server runs with `managed: true`:
- Custom traffic light buttons (red/yellow/green) in the editor header via `window.__VIBES_DESKTOP__`
- External links open in system browser via `Utils.openExternal()`
- Auth popup opens in system browser instead of `window.open()`
- Window controls routed through WebSocket → `ctx.onWindowControl`

### External Link Handling (Preload → Host Message)

External links and `window.open()` are intercepted by an inline preload script injected via `executeJavascript()` on `dom-ready`. The preload uses `window.__electrobunSendToHost()` to send `{type: "open-external", url}` messages to the Bun process, which listens on `host-message` events and calls `Utils.openExternal(url)`.

**Do NOT use raw `__electrobunEventBridge.postMessage()` for custom events.** ElectroBun's `emitWebviewEvent` wraps sends in `setTimeout` to avoid an FFI race condition. Sending synchronously via the bridge causes data loss (event fires but payload is empty). Always use `__electrobunSendToHost()` (which calls `emitWebviewEvent` internally) or the `host-message` channel.

**ElectroBun's `preload` BrowserWindow option does NOT work** for custom scripts. Use `mainWindow.webview.executeJavascript(script)` on the `dom-ready` event instead.

## Architecture: JSX + Babel

The plugin uses JSX with Babel runtime transpilation. See `source-templates/base/template.html` for the `<script type="text/babel">` pattern.

## Local Development

```bash
claude --plugin .                        # From the plugin directory
claude --plugin /path/to/VibesOS     # Or with absolute path
```

## Restarting the Preview Server

After editing server code, handlers, or templates (e.g. `scripts/server/`, `skills/vibes/templates/editor.html`), the running server must be restarted to pick up changes. The server auto-kills any existing process on the same port — just re-run the start command:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(pwd)}"
bun "$VIBES_ROOT/scripts/server.ts" --mode=editor
```

Run in background if you need to continue working:
```bash
bun "$VIBES_ROOT/scripts/server.ts" --mode=editor &
```

**Do NOT use `pkill -f server.ts`** — the server handles takeover automatically via `killProcessOnPort()`. Re-running the command is the only correct restart method.

The `--mode=editor` flag is required for the editor UI. Omit it for preview-only mode. Optional flags: `--port 3333` (default), `--prompt "..."`.

## Testing

```bash
cd scripts
npm install          # First time
npm test             # All tests
npm run test:unit    # Unit only (<1 second)
npm run test:integration  # Mocked external services
npm run test:e2e:server   # E2E local server for manual testing
```

### Integration Testing

| What Changed | How to Test |
|-------------|-------------|
| Template structure | `cd scripts && npm run test:fixtures` (vitest, ~200ms) |
| Full E2E (assembly + deploy + browser) | `/vibes:test` |

### E2E with /etc/hosts

For subdomain routing tests, add to `/etc/hosts`:
```
127.0.0.1  test-app.local  tenant1.test-app.local  admin.test-app.local
```
Then `npm run test:e2e:server` and open `http://test-app.local:3000`.

## Non-Obvious Files

| File | Why it matters |
|------|---------------|
| `bundles/oidc-bridge.js` | ES module bridge wrapping OIDC auth for private app sign-in |
| `deploy-api/` | Deploy API Worker — accepts HTML + OIDC token, deploys to CF Workers server-side |
| `dispatch-worker/` | TinyBase sync dispatch worker with Durable Object for WebSocket-based sync |
| `scripts/lib/cli-auth.js` | CLI OIDC authentication with localhost callback, token caching |
| `scripts/lib/auth-constants.js` | Hardcoded OIDC authority and client ID (shared Pocket ID instance) |
| `scripts/lib/env-utils.js` | Shared .env loading, Connect config |
| `scripts/lib/paths.js` | Centralized path resolution for all plugin paths |
| `skills/launch/LAUNCH-REFERENCE.md` | Launch dependency graph, timing, skip modes |
| `skills/launch/prompts/builder.md` | Builder agent prompt template with {placeholder} markers |
| `scripts/deploy-cloudflare.js` (asset discovery) | Auto-discovers app-level `assets/` directory and includes files in deploy payload |

## Cloudflare Deployment

All apps deploy to Cloudflare Workers via the shared Deploy API Worker — no wrangler or user CF tokens needed. App metadata is stored in the Deploy API's KV (`subdomain:{name}` records). Local registry at `~/.vibes/deployments.json` caches deploy info from the Deploy API response. Sync is handled by TinyBase Durable Objects (auto-created on first WebSocket connection).

### App-Level Static Assets

Apps can include static assets (images, fonts, etc.) by placing them in an `assets/` directory next to the app file:

```
~/.vibes/apps/my-app/
├── app.jsx
├── assets/
│   ├── logo.png
│   └── icons/
│       └── favicon.svg
└── index.html
```

The deploy script auto-discovers files in `assets/` and includes them in the deployed worker. Binary files (PNG, JPG, GIF, WebP, ICO, WOFF/WOFF2, TTF, OTF, AVIF) are base64-encoded; text files are included as-is. Assets are served at their path relative to domain root (e.g., `/assets/logo.png`).

Reference assets in app code with absolute paths:

```jsx
<img src="/assets/logo.png" alt="Logo" />
```

**Size limit:** All assets are embedded in the worker script. Cloudflare Workers have a 10 MB script size limit, and base64 encoding adds ~33% overhead, so keep total asset size reasonable.

### Resetting App Sync State

TinyBase sync state lives in a Durable Object (one per app). To reset sync state:

1. **Try incognito/private window first.** If errors disappear, the issue is local — clear site data (localStorage).
2. **If errors persist in incognito**, the Durable Object state needs resetting. Delete and re-create the DO by redeploying the dispatch worker, or use the Cloudflare dashboard to delete the DO's storage.

**After resetting:**
1. Redeploy the app
2. Users should clear site data for the app URL (DevTools > Application > Clear site data) to remove stale local TinyBase state

## Adding or Removing Skills

Update `README.md` (Skills section).

## Plugin Versioning

Update version in **both** files — they must match:
1. `.claude-plugin/plugin.json` — `"name": "vibes"`
2. `.claude-plugin/marketplace.json` — top-level `"name": "VibesOS"`, plugin entry `"name": "vibes"`

## Terminal Workflow: Always Reassemble Before Deploy

When editing `app.jsx` outside the editor (e.g., fixing bugs via terminal), **always reassemble before telling the user to deploy**:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(pwd)}"
bun "$VIBES_ROOT/scripts/assemble.js" app.jsx index.html
```

The editor's deploy button auto-reassembles, but if the user deploys immediately after you edit `app.jsx` (before the editor picks it up), they'll deploy stale HTML. The rule: **never edit `app.jsx` and say "redeploy" without running assembly in between.**

## Commit Messages

Do not credit Claude Code when making commit messages.
