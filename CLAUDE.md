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
| Testing plugin changes | `cd scripts && npm test` for all tests; `/vibes:test` for full E2E |
| Editing auth components | `.claude/rules/auth-components.md` loads automatically |
| Editing templates or build system | `.claude/rules/template-build.md` loads automatically |
| Working on sharing/invites | `.claude/rules/sharing-architecture.md` loads automatically |
| Working on generate/chat/theme server flow | See "Generate Flow Routing" below before editing `handlers/` |

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
- **Sync**: Handled server-side by TinyBase Durable Objects. The DO auto-creates on first WebSocket connection — no provisioning step needed.

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
| Full E2E (assembly + deploy + browser) | `/vibes:test` |

### E2E with /etc/hosts

For subdomain routing tests, add to `/etc/hosts`:
```
127.0.0.1  test-app.local  tenant1.test-app.local  admin.test-app.local
```
Then `npm run test:e2e:server` and open `http://test-app.local:3000`.

## Generate Flow Routing

**Landmine warning.** The editor's "generate" action does NOT route through `scripts/server/handlers/generate.ts:handleGenerate`. That handler exists but has zero call sites — it's effectively dead code. Grep before editing.

The real flow: the editor sends a `{ type: 'generate', ... }` WebSocket message, which is handled in `scripts/server/ws.ts` at `case 'generate':` (around line 328). That branch wraps the user's prompt inside a brainstorm prompt (via `buildBrainstormPrompt`) and sends it through the **persistent bridge** (`createBridge` in `scripts/server/claude-bridge.ts`) via `b.sendMessage(...)`. The persistent bridge is used — not a one-shot subprocess — because the brainstorm Q&A is multi-turn: Claude asks clarifying questions, the user answers, and eventually Claude produces the brief and starts writing. All of that must happen in a single conversation.

Chat iteration (`case 'chat':`) uses the same bridge — so the bridge's per-turn state needs to be reset between generate and chat turns. That's what `bridge.setTurnMode('generate' | 'chat', initialStage?)` is for — call it before every `sendMessage`.

Stream-event translation has two parallel paths:

| Path | Used by | Translator | UI events emitted |
|---|---|---|---|
| Persistent bridge | generate, chat, theme | `translateStreamEvent` (event-translator.ts) | `tool_start`, `token`, `tool_result`, `init`, `complete`, `status` |
| One-shot (`runOneShot`) | theme switcher, factory-assemble, riff | `dispatchStreamEvent` | `tool_detail`, `generation_stage`, `preview_reload`, `preview_reload_failed` |

Direction D's staged-preview events (`generation_stage` / `preview_reload` / `reference_preview`) are emitted by the bridge's stream parser, gated by `turnMode === 'generate'`, so they fire on the real editor generate flow. If you add generate-UX events in the future, emit them from the bridge, not from `runOneShot`.

Before claiming a generate-flow feature works end-to-end: verify in the browser DevTools Console that the expected event types show up in `[WS-IN]` logs. Unit tests of `runOneShot` / `dispatchStreamEvent` do NOT exercise this path.

## Non-Obvious Files

| File | Why it matters |
|------|---------------|
| `bundles/oidc-bridge.js` | ES module bridge wrapping OIDC auth for private app sign-in |
| `scripts/lib/cli-auth.js` | CLI OIDC authentication with localhost callback, token caching |
| `scripts/lib/auth-constants.js` | Hardcoded OIDC authority and client ID (shared Pocket ID instance) |
| `scripts/lib/env-utils.js` | Shared env utilities and config |
| `scripts/lib/paths.js` | Centralized path resolution for all plugin paths |
| `scripts/server/ws.ts` | WebSocket router — `case 'generate':` / `case 'chat':` / `case 'theme':` dispatch. The actual generate flow lives here, not in `handlers/generate.ts`. |
| `scripts/server/claude-bridge.ts` | Persistent stream-json bridge (`createBridge`) — used for all multi-turn flows. Holds per-turn state via `setTurnMode`. Emits Direction D staged-preview events. |
| `scripts/server/event-translator.ts` | Translates raw stream-json into UI events for the persistent bridge (`tool_start`, etc.). Separate from `dispatchStreamEvent` which belongs to `runOneShot`. |
| `scripts/server/handlers/generate.ts` | **Unused in production.** `handleGenerate` exists but has no call sites; the real generate flow is in `ws.ts`. Don't edit this file expecting changes to affect generation. |
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
2. **If errors persist in incognito**, the Durable Object state needs resetting. Use the Cloudflare dashboard to delete the DO's storage.

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
