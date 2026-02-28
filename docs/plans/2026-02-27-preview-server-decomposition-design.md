# Preview Server Decomposition

**Date:** 2026-02-27
**Status:** Design approved, ready for implementation

## Problem

`scripts/preview-server.js` is a 2396-line monolith managing HTTP routing, WebSocket dispatch, Claude subprocess lifecycle, prompt construction, theme switching, app generation, deployment, and server bootstrap in a single file. This makes changes risky (everything shares scope), handlers hard to find, and individual concerns impossible to test in isolation.

## Design Decisions

- **Goal:** Developer experience — make code easy to find, modify, and test.
- **No new dependencies.** Route table is a plain object, not a framework.
- **Separate files, shared utilities.** Each handler is its own module. No pipeline abstraction, no event bus.
- **Callback-based Claude bridge.** `runClaude` accepts an `onEvent` callback instead of a WebSocket reference, making it testable without mocks.

## File Structure

```
scripts/
  preview-server.js              ← ~120 lines: load config, wire modules, start server
  server/
    config.js                    ← loadConfig(): CLI args, .env, theme/animation catalogs
    lifecycle.js                 ← killProcessOnPort, waitForPort
    routes.js                    ← route table + static file serving
    ws-dispatch.js               ← WebSocket message parsing + dispatch table
    claude-bridge.js             ← runClaude (callback-based), cancelClaude, wsAdapter
    handlers/
      chat.js                    ← handleChat
      theme.js                   ← handleThemeSwitch, multi-pass, legacy, palette
      generate.js                ← handleGenerate, autoSelectTheme
      deploy.js                  ← handleDeploy, handleDeployStudio
      create-theme.js            ← handleCreateTheme, handlePickThemeImage
      editor-api.js              ← credentials, apps CRUD, screenshots, status
```

## Context Object

All module-level globals consolidate into a single `ctx` object built by `loadConfig()`:

```js
ctx = {
  projectRoot,       // __dirname parent
  port,              // --port flag or 3333
  mode,              // 'editor' | 'preview'
  initialPrompt,     // --prompt flag
  themes,            // parsed theme catalog array
  animations,        // parsed animation catalog array
  themeColors,       // pre-parsed per-theme color objects
  openRouterKey,     // from .env (nullable)
  appsDir,           // ~/.vibes/apps/
}
```

Every module receives `ctx` as its first argument instead of reading globals.

## Route Table (`routes.js`)

Replaces the 320-line if/else chain in `handleRequest`:

```js
const routeTable = {
  'GET /':                          serveHtml,
  'GET /index.html':                serveHtml,
  'GET /app.jsx':                   serveAppJsx,
  'GET /themes':                    serveThemes,
  'GET /themes/has-key':            serveHasKey,
  'GET /animations':                serveAnimations,
  'GET /app-frame':                 serveAppFrame,
  'GET /editor/status':             editorApi.status,
  'GET /editor/initial-prompt':     editorApi.initialPrompt,
  'GET /editor/app-exists':         editorApi.appExists,
  'GET /editor/apps':               editorApi.listApps,
  'GET /editor/apps/screenshot':    editorApi.getScreenshot,
  'POST /editor/credentials':       editorApi.saveCredentials,
  'POST /editor/credentials/check-studio': editorApi.checkStudio,
  'POST /editor/apps/load':         editorApi.loadApp,
  'POST /editor/apps/save':         editorApi.saveApp,
  'POST /editor/apps/screenshot':   editorApi.saveScreenshot,
  'POST /editor/apps/write':        editorApi.writeApp,
};

export function handleRequest(ctx, req, res) {
  const url = new URL(req.url, `http://localhost:${ctx.port}`);
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const key = `${req.method} ${url.pathname}`;
  const handler = routeTable[key];
  if (handler) return handler(ctx, req, res, url);

  return serveStaticFile(ctx, url.pathname, res);
}
```

Handler signature: `(ctx, req, res, url)`. Static file fallback handles bundles, assets, and 404.

## Claude Bridge (`claude-bridge.js`)

Decoupled from WebSocket. Accepts an `onEvent` callback:

```js
export async function runClaude(prompt, opts = {}, onEvent) { ... }
export function cancelClaude() { ... }
```

Event contract:

| Event | Fields | When |
|-------|--------|------|
| `progress` | progress, stage, elapsed | Every second + tool events |
| `tool_detail` | name, input_summary, elapsed | Each tool call |
| `error` | message | Spawn failure, bad exit, rate limit |
| `complete` | text, toolsUsed, elapsed | Clean exit |
| `cancelled` | — | After cancel |

The `wsAdapter` translates these events to WebSocket messages:

```js
export function wsAdapter(ws) {
  return (event) => {
    if (event.type === 'progress') {
      ws.send(JSON.stringify({ type: 'status', status: 'thinking', ...event }));
    } else if (event.type === 'complete') {
      ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress: 100, stage: 'Done!', elapsed: event.elapsed }));
    } else {
      ws.send(JSON.stringify(event));
    }
  };
}
```

Testing: pass `(event) => events.push(event)` instead of a real WebSocket.

## WebSocket Dispatch (`ws-dispatch.js`)

Thin message router with a dispatch table:

```js
export function setupWebSocket(wss, ctx, wsAdapter) {
  wss.on('connection', (ws) => {
    const onEvent = wsAdapter(ws);

    const dispatch = {
      chat:            (msg) => handleChat(ctx, onEvent, msg.message, msg.effects, msg.animationId, msg.model),
      theme:           (msg) => handleThemeSwitch(ctx, onEvent, msg.themeId, msg.model),
      cancel:          ()    => { if (!cancelClaude()) onEvent({ type: 'error', message: 'No request in progress.' }); },
      generate:        (msg) => handleGenerate(ctx, onEvent, msg.prompt, msg.themeId, msg.model),
      deploy:          (msg) => handleDeploy(ctx, onEvent, msg.target, msg.name),
      create_theme:    (msg) => handleCreateTheme(ctx, onEvent, msg.prompt, msg.model),
      pick_theme_image:(msg) => handlePickThemeImage(ctx, onEvent, msg.index, msg.prompt, msg.model),
      palette_theme:   (msg) => handlePaletteTheme(ctx, onEvent, msg.colors),
      'deploy-studio': (msg) => handleDeployStudio(ctx, onEvent, msg.studioName, msg.clerkPublishableKey, msg.clerkSecretKey),
      save_app:        (msg) => saveApp(ctx, ws, msg.name),
    };

    ws.on('message', async (raw) => {
      const msg = safeParseJSON(raw);
      if (!msg) { onEvent({ type: 'error', message: 'Invalid JSON' }); return; }
      const handler = dispatch[msg.type];
      if (!handler) return;
      try { await handler(msg); }
      catch (err) { onEvent({ type: 'error', message: `Internal error: ${err.message}` }); }
    });

    ws.on('close', () => cancelClaude());
  });
}
```

Adding a new message type: one line in the table + a handler file.

## Handler Pattern

Every handler follows the same shape:

```js
// handlers/chat.js
import { runClaude } from '../claude-bridge.js';
import { sanitizeAppJsx } from '../post-process.js';

export async function handleChat(ctx, onEvent, message, effects, animationId, model) {
  const effectBlock = buildEffectBlock(ctx, effects, animationId);
  const prompt = `...${message}...${effectBlock}...`;
  const maxTurns = (animationId || effects.length > 0) ? 12 : 8;

  await runClaude(prompt, { maxTurns, model, cwd: ctx.projectRoot }, onEvent);
  sanitizeAppJsx(ctx.projectRoot);
}
```

- **Input:** `ctx` (config), `onEvent` (status callback), then handler-specific args.
- **No `ws` reference** — handlers don't know about WebSocket.
- **Post-processing is a one-liner** — `sanitizeAppJsx()` replaces four copy-pasted blocks.

## Shared Post-Processing

```js
// server/post-process.js
import { sanitizeCssEscapes } from '../lib/theme-sections.js';

export function sanitizeAppJsx(projectRoot) {
  const appPath = join(projectRoot, 'app.jsx');
  if (!existsSync(appPath)) return;
  const code = readFileSync(appPath, 'utf-8');
  const clean = sanitizeCssEscapes(code);
  if (clean !== code) writeFileSync(appPath, clean, 'utf-8');
}
```

## Entry Point (`preview-server.js`)

~120 lines. Load config, wire modules, start server:

```js
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { handleRequest } from './server/routes.js';
import { setupWebSocket } from './server/ws-dispatch.js';
import { wsAdapter } from './server/claude-bridge.js';
import { loadConfig } from './server/config.js';
import { killProcessOnPort, waitForPort } from './server/lifecycle.js';

const ctx = loadConfig();
const server = createServer((req, res) => handleRequest(ctx, req, res));
const wss = new WebSocketServer({ server });
setupWebSocket(wss, ctx, wsAdapter);

async function start() {
  if (killProcessOnPort(ctx.port)) await waitForPort(ctx.port);
  server.listen(ctx.port, () => {
    console.log(`Vibes ${ctx.mode} Server → http://localhost:${ctx.port}`);
  });
}

start();
```

## Migration Strategy

Extract one module at a time, test after each extraction. Suggested order:

1. **`config.js` + `lifecycle.js`** — pure extractions, no behavior change.
2. **`claude-bridge.js`** — refactor `runClaude` to callback-based. Update all callers to pass `wsAdapter(ws)`.
3. **`server/post-process.js`** — extract `sanitizeAppJsx`, replace four inline blocks.
4. **`handlers/editor-api.js`** — the editor REST endpoints are self-contained, no Claude dependency.
5. **`routes.js`** — replace if/else chain with route table, import editor-api handlers.
6. **`handlers/chat.js`** — smallest Claude-using handler, good first extraction.
7. **`handlers/theme.js`** — largest handler, most internal complexity.
8. **`handlers/generate.js`** — depends on theme catalog, autoSelectTheme.
9. **`handlers/deploy.js`** — depends on assemble + deploy scripts.
10. **`handlers/create-theme.js`** — depends on OpenRouter key.
11. **`ws-dispatch.js`** — final wiring, replace inline WebSocket handler.

Each step is independently committable and testable. Run `node scripts/preview-server.js` after each extraction to verify the server still works.

## What This Does NOT Change

- **WebSocket transport stays.** No SSE migration.
- **Single active Claude process.** The `activeClaude` singleton stays in `claude-bridge.js`.
- **No new npm dependencies.**
- **Client-facing message format unchanged.** The `wsAdapter` produces the same JSON the frontend expects.
- **All prompt text stays identical.** Prompts move to handler files but their content doesn't change.
