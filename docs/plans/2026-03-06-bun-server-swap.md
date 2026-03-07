# Bun Server Swap — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Node.js preview server with a Bun-native server. Adopt the Julian project's patterns for `Bun.serve`, `Bun.spawn`, and native WebSocket. Rethink the `claude -p` bridge to use Julian's long-lived process + stdin/stdout model instead of the current one-shot-per-message pattern. Implement a "time-lapse preview" HMR system that pushes renderable app.jsx snapshots to the browser during generation.

**Architecture:**

The current server is a Node.js `http.createServer` + `ws` WebSocket library with 7 handler modules, a subprocess bridge that spawns one `claude -p` per message, and file-watching via `fs.readFileSync` polls. The new server will be a single `Bun.serve()` with native WebSocket upgrade, `Bun.spawn` for the claude subprocess, `Bun.file()` for static serving, and a persistent claude session model inspired by Julian.

**Tech Stack:** Bun (native), TypeScript, Vitest (kept for tests)

**Reference codebases studied:**
- Julian server: `/Users/marcusestes/Websites/Julian/server/server.ts` — Bun.serve, Bun.spawn, ReadableStream stdout parsing, SSE event log, native WebSocket
- Current server: `/Users/marcusestes/Websites/VibesCLI/vibes-skill/scripts/preview-server.js` + `scripts/server/` — Node http, ws, child_process
- Loom best practices audit: `/Users/marcusestes/Websites/VibesCLI/vibes-skill/docs/plans/2026-03-05-loom-best-practices-audit-design.md` — stream parser extraction, event contract enrichment, cleanEnv cmux fix, permission mode defaults, tool allowlisting

---

## Loom Skill Lineage

The Loom skill audit (`2026-03-05-loom-best-practices-audit-design.md`) already delivered several patterns that were implemented into the current codebase. This plan carries them forward into the Bun rewrite, and documents which ones get rethought vs. preserved:

| Loom Contribution | Current State | Bun Plan |
|-------------------|---------------|----------|
| `stream-parser.js` — shared JSON-lines parser with UTF-8 chunk buffering | Implemented, used by `claude-bridge.js` and `create-theme.js` | **Preserved.** The parser is runtime-agnostic (`TextDecoder`). No changes needed — import it directly into the new `.ts` files. |
| Enriched event contract (`token`, `tool_detail`, `tool_result`, `error`, `complete`) | Implemented in `claude-bridge.js` + `wsAdapter` | **Preserved.** The same event types flow through the new bridge. The persistent session emits them identically. |
| `cleanEnv()` — CMUX nesting var stripping | Implemented in `claude-subprocess.js` | **Ported.** New `cleanEnv()` in `claude-bridge.ts` carries the same CLAUDECODE + CMUX stripping. Julian's server does the same (`CLAUDECODE: '', CLAUDE_CODE_ENTRYPOINT: ''`). |
| `dontAsk` permission default + per-handler `allowedTools` | Implemented. Chat: `Read,Edit,Write,Glob,Grep`. Generate: `Write`. Theme: `Read,Edit`. | **Preserved for one-shot spawns.** The persistent bridge uses `acceptEdits` (like Julian) since it needs to allow edits interactively. One-shot spawns keep `dontAsk` + explicit tool lists. |
| `is_error` result checking | Implemented in bridge's stream parser callback | **Preserved.** Same check in both persistent and one-shot stdout readers. |
| SIGTERM for cancel (not SIGKILL) | Implemented | **Preserved.** Both `bridge.cancel()` and one-shot timeout use SIGTERM. |
| `createStreamParser` DRYing `create-theme.js` | Implemented — create-theme uses shared parser | **Preserved.** The one-shot helper reuses the same parser. |

**What gets rethought (not just ported):**

1. **The bridge itself.** Loom enriched a one-shot-per-message bridge. We replace it entirely with a persistent session (Julian pattern) for chat, while keeping one-shot for generate/theme. This is a deeper architectural change than Loom attempted.

2. **`wsAdapter` as an indirection layer.** Loom kept the `onEvent → wsAdapter → ws.send` chain. The new design simplifies: the WebSocket handler holds a direct reference to a `broadcast` function. No adapter translation — events go straight to the client with the same shape.

3. **`buildClaudeArgs` / `claude-subprocess.js`.** Loom added tool/permission support to this shared module. The new bridge builds args inline (persistent session has fixed args). The `runOneShot` helper reuses `buildClaudeArgs` for one-shot spawns, preserving Loom's tool allowlisting.

---

## Concurrency Model

The hybrid architecture (persistent session + one-shot spawns) introduces two subprocess pathways that must not collide.

**Rules:**

1. **Global operation lock.** A single `operationLock: { type: string, abortController: AbortController } | null` guards all claude operations. Only one operation (chat message, generate, theme switch, theme save) can run at a time. This matches the current `activeClaude` mutex — the UI already serializes operations via the "Another request is in progress" error.

2. **Persistent bridge lifecycle.** The persistent bridge spawns lazily on first chat message. It stays alive across chat messages (context preservation). Generate/theme operations do NOT use the bridge — they spawn one-shot processes. The bridge is killed on:
   - 15-minute inactivity timeout
   - User disconnects (all WebSockets close)
   - Server shutdown

3. **One-shot operations pause the bridge.** When a one-shot operation starts (generate, theme, create-theme), the operation lock is acquired. If the persistent bridge is processing a chat response, the one-shot waits (the lock serializes them). The bridge's stdin remains open but idle during one-shot operations — it doesn't interfere because nothing is writing to it.

4. **app.jsx write contention.** Only one writer at a time (enforced by the operation lock). The HMR watcher is read-only — it never writes. Chat edits go through the persistent bridge (Claude uses Edit/Write tools). Generate/theme go through one-shot spawns. The lock prevents overlapping writes.

5. **Cancel semantics.** Cancel kills whichever operation is active:
   - If persistent bridge is processing: send a cancel signal (or SIGTERM + respawn)
   - If one-shot is running: SIGTERM the one-shot process
   - The operation lock is released on cancel

```typescript
interface OperationLock {
  type: 'chat' | 'generate' | 'theme' | 'create-theme';
  cancel: () => void;
}

let currentOp: OperationLock | null = null;

function acquireLock(type: string, cancelFn: () => void): boolean {
  if (currentOp) return false; // "Another request in progress"
  currentOp = { type, cancel: cancelFn };
  return true;
}

function releaseLock() {
  currentOp = null;
}

function cancelCurrent(): boolean {
  if (!currentOp) return false;
  currentOp.cancel();
  currentOp = null;
  return true;
}
```

---

## Phase 1: Foundation — Bun.serve + Static Routes

### Task 1: Create `scripts/server.ts` entry point with Bun.serve

**Files:**
- Create: `scripts/server.ts`
- Delete (later): `scripts/preview-server.js`

**Design decisions:**

The entrypoint uses `Bun.serve()` with the `fetch` + `websocket` handler pattern from Julian. No npm dependencies for the server itself — no `ws`, no `http.createServer`. The server is a single TypeScript file that imports handler modules.

```typescript
// scripts/server.ts — entry point
import { loadConfig } from './server/config';
import { createRouter } from './server/router';
import { createWsHandler } from './server/ws';

const ctx = loadConfig();
const router = createRouter(ctx);

const server = Bun.serve({
  port: ctx.port,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req, { data: { ctx } });
      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    return router(req, url);
  },
  websocket: createWsHandler(ctx),
});

console.log(`Vibes Server — http://localhost:${ctx.port}`);
```

**Step 1:** Create `scripts/server.ts` with the Bun.serve skeleton above. The `createRouter` and `createWsHandler` are stubs that return 404 / no-ops initially.

**Step 2:** Add `"start": "bun run scripts/server.ts"` to `scripts/package.json`.

**Step 3:** Verify it starts: `cd scripts && bun run start`

**Step 4:** Commit: `"Add Bun server entry point skeleton"`

---

### Task 2: Port `config.ts` — drop Node-specific imports

**Files:**
- Create: `scripts/server/config.ts` (rewrite of `config.js`)

**Key changes:**
- No `fileURLToPath` / `import.meta.url` gymnastics — Bun supports `import.meta.dir` directly
- `Bun.file().text()` for sync reads where appropriate (or keep `readFileSync` — Bun supports both)
- Same `loadConfig()` contract — returns mutable `ctx` object
- Drop the `parseThemeCatalog` / `parseAnimationCatalog` imports — they're pure functions, no Node deps
- `projectRoot` resolution: `join(import.meta.dir, '../..')` (same as current `dirname(dirname(__dirname))`)

**Step 1:** Copy `config.js` to `config.ts`, add types to the ctx object, replace `fileURLToPath` with `import.meta.dir`.

**Step 2:** Verify: `bun run scripts/server.ts` loads themes/animations.

**Step 3:** Commit: `"Port config to TypeScript with Bun-native imports"`

---

### Task 3: Port `router.ts` — Bun-native HTTP routing

**Files:**
- Create: `scripts/server/router.ts` (rewrite of `routes.js`)

**Key changes:**
- Handlers return `Response` objects (Web API) instead of writing to `res` streams
- `Bun.file()` for static serving (no `readFileSync` + manual content-type)
- CORS via a helper that wraps `Response` headers
- Route table stays the same shape: `'GET /themes'` => handler

**Body size limiting for POST routes:**

The current `parseJsonBody` enforces a 1MB limit via streaming `req.on('data')` with a byte counter. Bun's `await req.json()` reads the full body with no size cap. To preserve the safety limit:

```typescript
const MAX_BODY_SIZE = 1024 * 1024; // 1MB

async function parseJsonBody(req: Request): Promise<any> {
  const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_BODY_SIZE) {
    throw Object.assign(new Error('Request body too large'), { status: 413 });
  }
  // Content-Length can be spoofed or missing — also limit the actual read
  const body = await req.text();
  if (body.length > MAX_BODY_SIZE) {
    throw Object.assign(new Error('Request body too large'), { status: 413 });
  }
  return JSON.parse(body);
}
```

This two-phase check (header first for fast rejection, then actual body size) prevents both honest oversized requests and spoofed Content-Length headers. Use this instead of bare `await req.json()` for all POST endpoints that accept user input. The screenshot endpoint (`saveScreenshot`) uses a separate 5MB limit and should use the same pattern with `MAX_SCREENSHOT_SIZE`.

**Pattern from Julian:**
```typescript
// Static file serving
const file = Bun.file(safePath);
if (await file.exists()) {
  return new Response(file);
}
```

**Step 1:** Create `router.ts` with the route table. Port each static route handler to return `Response`. Use `parseJsonBody` (with size limit) for POST routes.

**Step 2:** Port `editor-api.ts` handlers to return `Response` objects. This is the largest handler file — 633 lines — but the changes are mechanical: `res.writeHead(200, {...}); res.end(JSON.stringify(x))` becomes `return Response.json(x, { headers })`. Replace the old streaming `parseJsonBody` with the new Bun-native version that checks both Content-Length header and actual body size.

**Step 3:** Port all remaining HTTP handlers (deploy, image-gen) to return `Response`.

**Step 4:** Verify all routes work via browser.

**Step 5:** Commit: `"Port HTTP router to Bun.serve Response API"`

---

## Phase 2: Claude Bridge — Persistent Session Model

### Task 4: Rewrite `claude-bridge.ts` — long-lived process + stdin/stdout

**Files:**
- Create: `scripts/server/claude-bridge.ts` (rewrite of `claude-bridge.js`)

**This is the core architectural change.** The current bridge spawns a new `claude -p` subprocess per user message. Julian's pattern is better: spawn one long-lived `claude` process with `--input-format stream-json --output-format stream-json`, keep its stdin/stdout open, and pipe messages via JSON-lines on stdin.

**Current (one-shot per message):**
```
User sends chat → spawn claude -p with prompt on stdin → pipe stdout → close
User sends chat → spawn claude -p again → ...
```

**New (persistent session, Julian pattern):**
```
Server starts → spawn claude with stream-json I/O → keep stdin/stdout open
User sends chat → write JSON-line to stdin → read responses from stdout
User sends chat → write JSON-line to stdin → read responses from stdout
15min idle → SIGTERM → respawn on next message
```

**Benefits:**
- Context preserved across messages (Claude CLI manages session)
- No 20-40s cold start per message
- Simpler cancellation (write cancel marker vs. SIGTERM)
- Matches Julian's proven pattern

**Implementation:**

```typescript
// scripts/server/claude-bridge.ts
import { createStreamParser } from '../lib/stream-parser';

interface ClaudeBridge {
  send(message: string): boolean;
  cancel(): boolean;
  isAlive(): boolean;
  onEvent: (event: BridgeEvent) => void;
  spawn(opts?: SpawnOpts): void;
  kill(): void;
}

export function createClaudeBridge(ctx: ServerContext): ClaudeBridge {
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let alive = false;
  let lastActivity = 0;
  let onEvent: (event: BridgeEvent) => void = () => {};

  function spawn(opts: SpawnOpts = {}) {
    if (alive) return;

    proc = Bun.spawn({
      cmd: [
        'claude', '--print',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Read,Edit,Write,Glob,Grep',
      ],
      cwd: ctx.projectRoot,
      env: cleanEnv(),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    alive = true;
    lastActivity = Date.now();

    // Read stdout via ReadableStream (Julian pattern)
    readStdout(proc);
    drainStderr(proc);

    proc.exited.then((code) => {
      alive = false;
      proc = null;
      onEvent({ type: 'session_end', exitCode: code });
    });
  }

  async function readStdout(proc) {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            lastActivity = Date.now();
            dispatchEvent(event);
          } catch {}
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  function send(message: string): boolean {
    if (!alive || !proc) return false;
    const jsonl = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: message }] },
    }) + '\n';
    try {
      proc.stdin.write(jsonl);
      proc.stdin.flush();
      lastActivity = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  // ... cancel, kill, idle timeout
}
```

**Note on `--no-session-persistence`:** This flag is deliberately **omitted** from the persistent bridge spawn. The whole point of the persistent session is that Claude preserves context across messages — `--no-session-persistence` would defeat that. Julian's server omits it for the same reason. The flag IS used in `runOneShot` (Task 5) where each operation is self-contained and we don't want leftover session files.

**Note on `--permission-mode`:** The persistent bridge uses `acceptEdits` (same as Julian) rather than `dontAsk`. Since chat is interactive and the user may ask Claude to do things that require tool approval, `acceptEdits` auto-approves edit operations while still gating destructive ones. One-shot spawns use `dontAsk` with explicit `--allowedTools` (Loom pattern) since they have well-defined tool sets.

**Key differences from current bridge:**
1. `Bun.spawn` instead of `child_process.spawn`
2. `ReadableStream.getReader()` instead of `child.stdout.on('data')` events
3. Persistent process — `send()` writes to stdin instead of spawning new process
4. `proc.exited` promise instead of `child.on('close')` callback
5. `proc.stdin.flush()` — Bun-specific, ensures data is written immediately

**Step 1:** Create `claude-bridge.ts` with the persistent session model and the operation lock (see Concurrency Model section). Keep the existing Loom event contract (`progress`, `token`, `tool_detail`, `tool_result`, `error`, `complete`).

**Step 2:** Create a `cleanEnv()` that strips CLAUDECODE / CMUX vars (port from current, carrying forward the Loom cmux fix).

**Step 3:** Wire the bridge into the WebSocket dispatch.

**Step 4:** Test manually: start server, send a chat message, verify streaming tokens arrive.

**Step 5:** Commit: `"Rewrite claude-bridge as persistent session with Bun.spawn"`

---

### Task 5: Port handler logic into the bridge event model

**Files:**
- Create: `scripts/server/handlers/chat.ts`
- Create: `scripts/server/handlers/generate.ts`
- Create: `scripts/server/handlers/theme.ts`
- Create: `scripts/server/handlers/create-theme.ts`
- Create: `scripts/server/handlers/deploy.ts`

**The key insight:** With a persistent session, handlers no longer spawn subprocesses. Instead, they build a prompt and call `bridge.send(prompt)`. The bridge's stdout reader dispatches events to all WebSocket clients.

However, some handlers need **different tool sets** and **different maxTurns** per operation. The persistent session model needs to accommodate this. Two approaches:

**Option A (recommended): Hybrid model.** Keep the persistent session for chat (preserves context across edits), but use one-shot `Bun.spawn` for generate/theme/create-theme (which are self-contained operations with specific tool restrictions). This matches the actual usage pattern: chat is conversational, generate is a one-shot creative task.

**Option B: Single session with tool switching.** Use `--input-format stream-json` config messages to switch tool sets mid-session. This is more elegant but depends on a Claude CLI feature that may not exist yet.

**Go with Option A.** The handlers become:

- `chat.ts` — Uses the persistent bridge (`bridge.send(prompt)`). Acquires operation lock as `'chat'`.
- `generate.ts` — Spawns a one-shot `Bun.spawn` (self-contained, needs only Write tool). Acquires lock as `'generate'`.
- `theme.ts` — Spawns a one-shot `Bun.spawn` (self-contained, needs Read+Edit). Acquires lock as `'theme'`.
- `create-theme.ts` — Spawns a one-shot `Bun.spawn` (self-contained, needs Read+Write+Edit). Acquires lock as `'create-theme'`.
- `deploy.ts` — Spawns subprocesses for assembly + deploy. See deploy section below.

The one-shot spawn pattern is a helper function:

```typescript
export async function runOneShot(prompt: string, opts: OneShotOpts, onEvent: EventCallback): Promise<string | null> {
  const proc = Bun.spawn({
    cmd: buildClaudeArgs({
      ...opts,
      // One-shot spawns: no session persistence, dontAsk with explicit tools (Loom pattern)
    }),
    cwd: opts.cwd,
    env: cleanEnv(),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  proc.stdin.write(prompt);
  proc.stdin.end();

  // Read stdout with ReadableStream (same as persistent bridge)
  const reader = proc.stdout.getReader();
  // ... same pattern as bridge.readStdout, using Loom's stream-parser
}
```

**Deploy handler — Bun subprocess migration:**

The current `deploy.js` spawns two Node subprocesses:
1. `spawn('node', ['scripts/assemble.js', ...])` — assembly
2. `spawn('node', ['scripts/deploy-cloudflare.js', ...])` — deploy

Both `assemble.js` and `deploy-cloudflare.js` are standard ESM scripts using `fs`, `path`, `child_process`, and `crypto` — all of which Bun supports natively. The `deploy-cloudflare.js` script also calls `npx wrangler` via `execSync`, which works identically under Bun.

**Migration:** Replace `spawn('node', [...])` with `Bun.spawn({ cmd: ['bun', 'run', ...] })`. Both scripts work under Bun without modification because:
- They use Node-compatible APIs that Bun implements (`fs`, `path`, `crypto`, `child_process`)
- Their shebangs (`#!/usr/bin/env node`) are irrelevant when spawned explicitly
- `execSync('npx wrangler ...')` works the same under Bun's shell

```typescript
// deploy.ts — Bun subprocess spawning
const assembleResult = await runBunScript(
  join(ctx.projectRoot, 'scripts/assemble.js'),
  [appJsxPath, indexHtmlPath],
  { cwd: ctx.projectRoot }
);

const deployResult = await runBunScript(
  join(ctx.projectRoot, 'scripts/deploy-cloudflare.js'),
  deployArgs,
  { cwd: ctx.projectRoot, env: getRegistryEnv() }
);

// Helper: spawn a JS script under Bun
async function runBunScript(script: string, args: string[], opts: SpawnOpts): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', script, ...args],
    cwd: opts.cwd,
    env: opts.env || { ...process.env },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout, stderr };
}
```

**Verification step:** Before merging, run `bun run scripts/assemble.js app.jsx index.html` and `bun run scripts/deploy-cloudflare.js --name test --file index.html` standalone to confirm Bun compatibility. If any script uses a Node API that Bun doesn't support, fix the script (not the spawn call).

**Step 1:** Create the shared `runOneShot` helper (for claude subprocess) and `runBunScript` helper (for JS script spawning).

**Step 2:** Port each handler to TypeScript, replacing `child_process.spawn` with `Bun.spawn` and the appropriate helper.

**Step 3:** Port `post-process.ts` (trivial — pure string transforms, no Node deps).

**Step 4:** Verify each handler works end-to-end.

**Step 5:** Commit: `"Port all handlers to Bun.spawn + TypeScript"`

---

## Phase 3: Native WebSocket + Time-Lapse HMR

### Task 6: Port WebSocket dispatch to Bun native

**Files:**
- Create: `scripts/server/ws.ts` (rewrite of `ws-dispatch.js`)

**Bun's native WebSocket API** (from Julian):

```typescript
websocket: {
  open(ws) {
    // ws is a ServerWebSocket<TData>
    console.log('[WS] Client connected');
    ws.data.onEvent = createEventAdapter(ws);
  },
  message(ws, message) {
    const msg = JSON.parse(message as string);
    const handler = dispatch[msg.type];
    if (handler) handler(msg, ws.data.onEvent);
  },
  close(ws) {
    bridge.cancel();
  },
},
```

**Key differences from `ws` library:**
- No `new WebSocketServer({ server })` — WebSocket is built into `Bun.serve`
- `ws.send(data)` is the same API
- `ws.data` is typed per-connection state (set during `server.upgrade(req, { data })`)
- `maxPayload` set via `Bun.serve({ websocket: { maxPayloadLength } })`
- No `ws.on('message')` — use the `message(ws, data)` handler

**Step 1:** Create `ws.ts` exporting `createWsHandler(ctx)` that returns Bun's websocket handler object.

**Step 2:** Port the dispatch table from `ws-dispatch.js`.

**Step 3:** Verify WebSocket connects and handlers fire.

**Step 4:** Commit: `"Port WebSocket to Bun native handler"`

---

### Task 7: Implement time-lapse HMR — parseable-chunk hot reload

**Files:**
- Create: `scripts/server/hmr.ts`
- Modify: `scripts/server/handlers/generate.ts`

**This is the creative, production-ready HMR system the user wants.** The challenge: during generation, Claude writes app.jsx token by token. Naive HMR would push every partial file to the browser, breaking the page mid-syntax.

**Design: Babel-Validated Snapshot HMR**

The HMR system watches `app.jsx` during generation and pushes updates to the browser only when the file is in a renderable state. Rather than hand-rolling a bracket balancer that would miss JSX, comments, regex, and template literal expressions, we use Babel's parser as the renderability oracle — the same parser the browser uses to transpile the app.

**Why Babel:** The template system already depends on `@babel/standalone` (loaded from unpkg CDN in the browser). For the server-side parse check, we add `@babel/parser` as a dev dependency (~400KB). If it can parse the code, the browser can render it. This is the only reliable check for JSX code that may contain comments with unmatched braces, regex with brackets, template literals with nested expressions, and HTML-like syntax inside return statements.

**Algorithm:**

1. When generation starts, begin watching `app.jsx` with `fs.watch`.

2. On each file change, read the current content and attempt a Babel parse:
   ```typescript
   import { parse } from '@babel/parser';

   function isRenderable(code: string): boolean {
     // Must have export default (quick pre-check avoids parse cost on tiny fragments)
     if (!code.includes('export default')) return false;

     try {
       parse(code, {
         sourceType: 'module',
         plugins: ['jsx'],
         errorRecovery: false,
       });
       return true;
     } catch {
       return false;
     }
   }
   ```

3. When `isRenderable` returns true, snapshot the code and push it to all connected WebSocket clients:
   ```typescript
   ws.send(JSON.stringify({
     type: 'hmr_update',
     html: assembledHtml,
     timestamp: Date.now(),
     codeLength: code.length,
   }));
   ```

4. The browser receives `hmr_update`, and hot-swaps the iframe `srcdoc` with the assembled HTML.

5. **Debounce:** Don't check more than once per 500ms. Claude writes in bursts — the file changes rapidly during tool execution, then pauses. The debounce naturally aligns with meaningful edit boundaries.

6. **Parse cost:** `@babel/parser` parses a 30KB JSX file in ~5ms on modern hardware. With 500ms debounce, the CPU cost is negligible.

**The "time-lapse" effect:** Since we only push when the code parses cleanly, the browser sees discrete "frames" of the app evolving — first the basic structure, then styles appear, then components flesh out, then animations activate. It's a time-lapse of the app coming together.

**Implementation:**

```typescript
// scripts/server/hmr.ts
import { parse } from '@babel/parser';
import { watch, readFileSync } from 'fs';
import { join } from 'path';
import { assembleAppFrame } from './handlers/generate';

export function createHmrWatcher(ctx: ServerContext, broadcast: (msg: object) => void) {
  let watcher: ReturnType<typeof watch> | null = null;
  let lastSnapshot = '';
  let debounceTimer: Timer | null = null;
  let active = false;

  function start() {
    if (active) return;
    active = true;
    const appPath = join(ctx.projectRoot, 'app.jsx');

    watcher = watch(appPath, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => checkAndPush(appPath), 500);
    });
  }

  function checkAndPush(appPath: string) {
    try {
      const code = readFileSync(appPath, 'utf-8');
      if (code === lastSnapshot) return;
      if (!isRenderable(code)) return;

      lastSnapshot = code;
      const assembled = assembleAppFrame(ctx, code);
      broadcast({
        type: 'hmr_update',
        html: assembled,
        timestamp: Date.now(),
        codeLength: code.length,
      });
    } catch {}
  }

  function stop() {
    active = false;
    if (watcher) { watcher.close(); watcher = null; }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    lastSnapshot = '';
  }

  return { start, stop };
}

function isRenderable(code: string): boolean {
  if (!code.includes('export default')) return false;
  try {
    parse(code, {
      sourceType: 'module',
      plugins: ['jsx'],
      errorRecovery: false,
    });
    return true;
  } catch {
    return false;
  }
}
```

**Browser-side integration:**

The editor's WebSocket message handler already processes `type: 'app_updated'`. Add handling for `type: 'hmr_update'`:

```javascript
// In the browser's WS handler
case 'hmr_update':
  // Update the preview iframe with the new assembled HTML
  const iframe = document.getElementById('app-preview');
  if (iframe) {
    iframe.srcdoc = msg.html;
  }
  break;
```

**Step 1:** Add `@babel/parser` to `scripts/package.json` devDependencies.

**Step 2:** Create `hmr.ts` with the watcher, `isRenderable` (Babel-based), and broadcast logic.

**Step 3:** Integrate with `generate.ts` — call `hmr.start()` before generation, `hmr.stop()` after.

**Step 4:** Add `hmr_update` handling to the browser-side WebSocket handler.

**Step 5:** Test: generate an app, watch the preview update in real-time as Claude writes.

**Step 6:** Commit: `"Implement time-lapse HMR with Babel-validated snapshot detection"`

---

## Phase 4: Cleanup + Migration

### Task 8: Drop Node dependencies

**Files:**
- Modify: `scripts/package.json`
- Delete: `scripts/lib/ensure-deps.js`
- Delete: `scripts/preview-server.js`
- Modify: `scripts/server/lifecycle.js` → `lifecycle.ts`

**Step 1:** Remove `ws` from `scripts/package.json` dependencies. Add `@babel/parser` to devDependencies (for HMR).

**Step 2:** Delete `ensure-deps.js` — Bun doesn't need npm auto-install; it reads dependencies at startup. The `ensurePreviewDeps` function (which checked for `ws`) is obsolete. The `ensureDeps` function (which checked for `jsonwebtoken` for deploy) is also obsolete since Bun resolves deps at import time and errors clearly.

**Step 3:** Delete `preview-server.js` — replaced by `server.ts`.

**Step 4:** Port `lifecycle.ts` — replace `execSync('lsof')` with a cleaner Bun approach:
```typescript
// Bun-native port check
async function isPortFree(port: number): Promise<boolean> {
  try {
    const server = Bun.serve({ port, fetch() { return new Response(); } });
    server.stop();
    return true;
  } catch {
    return false;
  }
}
```

**Step 5:** Update SKILL.md references from `node scripts/preview-server.js` to `bun scripts/server.ts`.

**Step 6:** Commit: `"Drop Node dependencies, delete preview-server.js"`

---

### Task 9: Port tests

**Files:**
- Modify: `scripts/__tests__/unit/stream-parser.test.js` → `.ts`
- Modify: `scripts/__tests__/unit/claude-subprocess.test.js` → `.ts`
- Add: `scripts/__tests__/unit/hmr.test.ts`
- Add: `scripts/__tests__/unit/claude-bridge.test.ts`

**Keep Vitest** — it runs fine under Bun and the 520-test suite is too valuable to rewrite.

**New tests for HMR:**
```typescript
describe('isRenderable', () => {
  it('accepts a complete React component', () => {
    const code = `function App() { return <div>Hello</div>; }\nexport default App;`;
    expect(isRenderable(code)).toBe(true);
  });

  it('rejects mid-function code', () => {
    const code = `function App() { return <div>He`;
    expect(isRenderable(code)).toBe(false);
  });

  it('rejects code without export', () => {
    const code = `function App() { return <div>Hello</div>; }`;
    expect(isRenderable(code)).toBe(false);
  });

  it('handles comments with unmatched braces', () => {
    const code = `// this has a { without closing\nfunction App() { return <div>Hi</div>; }\nexport default App;`;
    expect(isRenderable(code)).toBe(true);
  });

  it('handles JSX with embedded expressions', () => {
    const code = `function App() { const x = [1,2,3]; return <div>{x.map(i => <span key={i}>{i}</span>)}</div>; }\nexport default App;`;
    expect(isRenderable(code)).toBe(true);
  });

  it('handles template literals with nested braces', () => {
    const code = 'function App() { const s = `${JSON.stringify({a:1})}`; return <div>{s}</div>; }\nexport default App;';
    expect(isRenderable(code)).toBe(true);
  });

  it('rejects unterminated template literal', () => {
    const code = 'function App() { const s = `hello ${world'; // unterminated
    expect(isRenderable(code)).toBe(false);
  });
});
```

**New tests for concurrency model:**
```typescript
describe('operation lock', () => {
  it('rejects concurrent operations', () => {
    expect(acquireLock('chat', () => {})).toBe(true);
    expect(acquireLock('generate', () => {})).toBe(false);
    releaseLock();
    expect(acquireLock('generate', () => {})).toBe(true);
  });

  it('cancel releases the lock', () => {
    const cancel = vi.fn();
    acquireLock('chat', cancel);
    expect(cancelCurrent()).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(acquireLock('generate', () => {})).toBe(true);
  });
});
```

**Step 1:** Add HMR unit tests (isRenderable with edge cases: comments, JSX, template literals).

**Step 2:** Add claude-bridge tests (event dispatching, send/cancel, operation lock).

**Step 3:** Run full suite: `cd scripts && bun test` (or `npm test` — vitest works under both).

**Step 4:** Commit: `"Add tests for HMR and claude-bridge"`

---

### Task 10: Update CLAUDE.md + SKILL.md references

**Files:**
- Modify: `CLAUDE.md` — update dev commands, architecture references
- Modify: `skills/vibes/SKILL.md` — update preview server invocation
- Modify: `scripts/package.json` — update `"preview"` script

**Step 1:** In `CLAUDE.md`, update:
- `node scripts/preview-server.js` → `bun scripts/server.ts`
- Architecture notes: add Bun.serve, native WebSocket, persistent session model
- Remove references to `ws` npm package

**Step 2:** In `scripts/package.json`, change:
```json
"preview": "bun run scripts/server.ts"
```

**Step 3:** Commit: `"Update documentation for Bun server"`

---

## File Inventory

### New files (11)
| File | Purpose |
|------|---------|
| `scripts/server.ts` | Bun.serve entry point |
| `scripts/server/config.ts` | Config loader (port from .js) |
| `scripts/server/router.ts` | HTTP route table returning Response objects |
| `scripts/server/ws.ts` | Native WebSocket handler |
| `scripts/server/claude-bridge.ts` | Persistent claude session + one-shot helper + operation lock |
| `scripts/server/handlers/chat.ts` | Chat handler (persistent session) |
| `scripts/server/handlers/generate.ts` | Generate handler (one-shot + HMR) |
| `scripts/server/handlers/theme.ts` | Theme switch handler (one-shot) |
| `scripts/server/handlers/create-theme.ts` | Theme save handler (one-shot) |
| `scripts/server/handlers/deploy.ts` | Deploy handler (Bun subprocess spawning) |
| `scripts/server/hmr.ts` | Babel-validated snapshot HMR watcher |

### Deleted files (3)
| File | Reason |
|------|--------|
| `scripts/preview-server.js` | Replaced by `server.ts` |
| `scripts/lib/ensure-deps.js` | Bun doesn't need npm auto-install |
| `scripts/server/ws-dispatch.js` | Replaced by `ws.ts` |

### Modified files (8)
| File | Change |
|------|--------|
| `scripts/package.json` | Remove `ws` dep, add `@babel/parser`, update scripts |
| `scripts/server/config.js` → `.ts` | TypeScript, Bun-native imports |
| `scripts/server/lifecycle.js` → `.ts` | Bun-native port management |
| `scripts/server/routes.js` | Deleted (replaced by `router.ts`) |
| `scripts/server/claude-bridge.js` | Deleted (replaced by `.ts`) |
| `scripts/server/post-process.js` → `.ts` | TypeScript (logic unchanged) |
| `CLAUDE.md` | Update dev commands |
| `scripts/server/handlers/editor-api.js` → `.ts` | Response API, size-limited body parsing |

### Preserved files (unchanged)
| File | Why |
|------|-----|
| `scripts/lib/stream-parser.js` | Loom pattern — pure utility, runtime-agnostic, used by both persistent bridge and one-shot helper |
| `scripts/lib/claude-subprocess.js` | Still used by `runOneShot` helper for `buildClaudeArgs`. Also used by other standalone scripts. |
| `scripts/lib/*.js` | Pure utilities, runtime-agnostic |
| `scripts/__tests__/` | Vitest tests — add new, keep existing |
| `scripts/server/handlers/image-gen.js` | Pure fetch, no Node deps |
| `scripts/assemble.js` | Standalone script — runs under both Node and Bun. Spawned by deploy handler via `bun run`. |
| `scripts/deploy-cloudflare.js` | Standalone script — runs under both Node and Bun. Spawned by deploy handler via `bun run`. |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Bun.spawn stdin flushing behaves differently from Node child_process | Julian project proves this works; test early in Task 4 |
| `--input-format stream-json` may not support tool set switching | Hybrid model (Task 5) — persistent session for chat, one-shot for others |
| Babel parse too slow for HMR debounce cycle | @babel/parser parses 30KB JSX in ~5ms; 500ms debounce makes this negligible. Measure in Task 7 and increase debounce if needed. |
| Vitest under Bun may have edge cases | Vitest officially supports Bun; 520 tests will surface issues quickly |
| `Bun.file().watch()` not yet stable | Use `fs.watch` (Bun supports Node fs module) |
| `assemble.js` or `deploy-cloudflare.js` uses a Node API Bun doesn't support | Verify each script with `bun run <script>` before merging (Task 5 verification step). `deploy-cloudflare.js` uses `createPublicKey` from crypto — verify this specifically. |
| Body size limits lost on POST endpoints | `parseJsonBody` helper enforces Content-Length + actual body size checks (Task 3) |
| Persistent bridge + one-shot spawn race on app.jsx | Operation lock (see Concurrency Model) serializes all claude operations. HMR watcher is read-only. |

---

## Execution Order

Tasks 1-3 can be done in sequence (foundation).
Task 4 is the critical path (bridge rewrite).
Task 5 depends on Task 4 (handler ports).
Tasks 6-7 can be parallelized (WebSocket + HMR).
Tasks 8-10 are cleanup after everything works.

**Estimated effort:** Tasks 1-3 are mechanical ports (~2 hours). Task 4 is the most complex (~3 hours). Task 7 (HMR) is the most creative (~2 hours). Total: ~10-12 hours of focused implementation.
