# Vibes DIY Plugin - Development Guide

## Agent Quick Reference

### When to Read What

| Task | Read First |
|------|------------|
| Working on skills | The specific `skills/*/SKILL.md` file |
| Generating app code | SKILL.md has patterns; for advanced features, read `docs/fireproof.txt` |
| Working on scripts | `scripts/package.json` for deps |
| Debugging React errors | `.claude/rules/react-singleton.md` loads automatically; also `skills/vibes/SKILL.md` Common Mistakes |
| Deploying to Cloudflare | `skills/cloudflare/SKILL.md` |
| Testing plugin changes | `cd scripts && npm run test:fixtures` for structural tests; `/vibes:test` for full E2E |
| Editing SessionStart hook context | `hooks/session-context.md` for content; `hooks/session-start.sh` for logic |
| Editing auth components | `.claude/rules/auth-components.md` loads automatically |
| Editing templates or build system | `.claude/rules/template-build.md` loads automatically |
| Working on sharing/invites | `.claude/rules/sharing-architecture.md` loads automatically |

### Fireproof API Reference

SKILL.md provides common patterns (useDocument, useLiveQuery, database.put/del) and critical gotchas.

**Read `docs/fireproof.txt` when the user's app needs:**

| Feature | Signal in prompt |
|---------|------------------|
| User authentication | "login", "auth", "accounts", "Pocket ID" |
| Sync status indicators | "connection status", "online/offline" |
| User context/identity | "user name", "profile", "who is logged in" |
| Complete example | "full example", "show me how" |

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

## Package Versions

The import map in `source-templates/base/template.html` is the authoritative source for current package versions (`esm.sh/stable/` URLs, `oauth4webapi`, React 19.2.4). The OIDC bridge (`bundles/fireproof-oidc-bridge.js`) is loaded as a local bundle, not from esm.sh.

## Deploy Workflow

Apps deploy to Cloudflare Workers via the shared Deploy API Worker. No wrangler installation or user Cloudflare tokens required.

```bash
bun scripts/deploy-cloudflare.js --name <app> --file index.html
```

Auth happens automatically: the CLI opens a browser for Pocket ID login and caches credentials at `~/.vibes/auth.json`. The Deploy API accepts the assembled HTML plus an OIDC token and handles Cloudflare API calls server-side.

## Desktop App

The desktop app lives in `vibes-desktop/` — a thin ElectroBun shell (VibesOS, `com.vibes.os`) that embeds the web editor in a native window. One command builds everything including a polished DMG:

```bash
bash scripts/build-desktop.sh
```

Build steps: (1) sync version from `plugin.json`, (2) compile native dylib, (3) `bunx electrobun build`, (4) create DMG with `create-dmg` + post-process to replace Applications symlink with Finder alias + system icon. Output: `vibes-desktop/artifacts/stable-macos-arm64-VibesOS.dmg`.

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

- `vibes-desktop/src/bun/index.ts` — window creation, menu, tray, external link handling
- `vibes-desktop/native/macos/window-controls.mm` — native dylib for hiding standard window buttons
- `vibes-desktop/electrobun.config.ts` — app metadata (name: VibesOS, identifier: com.vibes.os, version)
- `vibes-desktop/icon.iconset/` — app icon PNGs at all required macOS sizes
- `vibes-desktop/dmg-background.png` — branded DMG background (1024×576, blue grid)
- `scripts/build-desktop.sh` — one-command build + DMG creation script
- `scripts/install-vibes.command` — CLI installer included in DMG

### Desktop-Specific Behavior

Enabled when server runs with `managed: true`:
- Custom traffic light buttons (red/yellow/green) in the editor header via `window.__VIBES_DESKTOP__`
- External links open in system browser via `Utils.openExternal()`
- Auth popup opens in system browser instead of `window.open()`
- Window controls routed through WebSocket → `ctx.onWindowControl` / `ctx.onOpenExternal`

## Architecture: JSX + Babel

The plugin uses JSX with Babel runtime transpilation. See `source-templates/base/template.html` for the `<script type="text/babel">` pattern.

## Local Development

```bash
claude --plugin .                        # From the plugin directory
claude --plugin /path/to/vibes-skill     # Or with absolute path
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

## Hooks (SessionStart)

The `SessionStart` hook injects framework awareness context into every conversation.

1. `hooks.json` triggers `run-hook.cmd session-start.sh`
2. `session-start.sh` reads `session-context.md` (static) + detects project state in `$PWD`
3. Outputs JSON with `additionalContext` → appears in system reminders

**Editing:** Static content in `hooks/session-context.md` (keep under 100 lines). Dynamic detection in `hooks/session-start.sh` (pure bash only). Test with `echo '{}' | bash hooks/session-start.sh`.

## Non-Obvious Files

| File | Why it matters |
|------|---------------|
| `bundles/fireproof-oidc-bridge.js` | ES module bridge wrapping OIDC auth -- sync status, ledger routing, invite redemption |
| `deploy-api/` | Deploy API Worker — accepts HTML + OIDC token, deploys to CF Workers server-side |
| `scripts/lib/cli-auth.js` | CLI OIDC authentication with localhost callback, token caching |
| `scripts/lib/auth-constants.js` | Hardcoded OIDC authority and client ID (shared Pocket ID instance) |
| `scripts/lib/env-utils.js` | Shared .env loading, Connect config |
| `scripts/lib/paths.js` | Centralized path resolution for all plugin paths |
| `skills/launch/LAUNCH-REFERENCE.md` | Launch dependency graph, timing, skip modes |
| `skills/launch/prompts/builder.md` | Builder agent prompt template with {placeholder} markers |

## Cloudflare Deployment

All apps deploy to Cloudflare Workers via the shared Deploy API Worker — no wrangler or user CF tokens needed. Connect deploys automatically on first app deploy. App-Connect pairings tracked in `~/.vibes/deployments.json`.

## Adding or Removing Skills

Update `README.md` (Skills section).

## Plugin Versioning

Update version in **both** files — they must match:
1. `.claude-plugin/plugin.json` — `"name": "vibes"`
2. `.claude-plugin/marketplace.json` — top-level `"name": "vibes-cli"`, plugin entry `"name": "vibes"`

## Commit Messages

Do not credit Claude Code when making commit messages.
