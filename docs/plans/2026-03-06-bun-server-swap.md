# Bun Server Swap — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Node.js preview server with a Bun-native server. Adopt the Julian project's patterns for `Bun.serve`, `Bun.spawn`, and native WebSocket. Rethink the `claude -p` bridge to use Julian's long-lived process + stdin/stdout model instead of the current one-shot-per-message pattern. Implement a "time-lapse preview" HMR system that pushes renderable app.jsx snapshots to the browser during generation.

**Architecture:**

The current server is a Node.js `http.createServer` + `ws` WebSocket library with 7 handler modules, a subprocess bridge that spawns one `claude -p` per message, and file-watching via `fs.readFileSync` polls. The new server will be a single `Bun.serve()` with native WebSocket upgrade, `Bun.spawn` for the claude subprocess, `Bun.file()` for static serving, and a persistent claude session model inspired by Julian.

**Tech Stack:** Bun (native), TypeScript, Vitest (kept for tests)

**Reference codebases studied:**
- Julian server: `/Users/marcusestes/Websites/Julian/server/server.ts` — Bun.serve, Bun.spawn, ReadableStream stdout parsing, SSE event log, native WebSocket
- Current server: `/Users/marcusestes/Websites/VibesCLI/vibes-skill/scripts/preview-server.js` + `scripts/server/` — Node http, ws, child_process

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
- `parseJsonBody` replaced by `await req.json()` (Bun natively parses request bodies)

**Pattern from Julian:**
```typescript
// Static file serving
const file = Bun.file(safePath);
if (await file.exists()) {
  return new Response(file);
}
```

**Step 1:** Create `router.ts` with the route table. Port each static route handler to return `Response`. For POST routes that currently use `parseJsonBody`, use `await req.json()`.

**Step 2:** Port `editor-api.js` handlers to return `Response` objects. This is the largest handler file — 633 lines — but the changes are mechanical: `res.writeHead(200, {...}); res.end(JSON.stringify(x))` becomes `return Response.json(x, { headers })`.

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
        '--permission-mode', 'dontAsk',
        '--allowedTools', 'Read,Edit,Write,Glob,Grep',
        '--no-session-persistence',
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

**Key differences from current bridge:**
1. `Bun.spawn` instead of `child_process.spawn`
2. `ReadableStream.getReader()` instead of `child.stdout.on('data')` events
3. Persistent process — `send()` writes to stdin instead of spawning new process
4. `proc.exited` promise instead of `child.on('close')` callback
5. `proc.stdin.flush()` — Bun-specific, ensures data is written immediately

**Step 1:** Create `claude-bridge.ts` with the persistent session model. Keep the existing event contract (`progress`, `token`, `tool_detail`, `tool_result`, `error`, `complete`).

**Step 2:** Create a `cleanEnv()` that strips CLAUDECODE / CMUX vars (port from current).

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

**The key insight:** With a persistent session, handlers no longer spawn subprocesses. Instead, they build a prompt and call `bridge.send(prompt)`. The bridge's stdout reader dispatches events to all WebSocket clients.

However, some handlers need **different tool sets** and **different maxTurns** per operation. The persistent session model needs to accommodate this. Two approaches:

**Option A (recommended): Hybrid model.** Keep the persistent session for chat (preserves context across edits), but use one-shot `Bun.spawn` for generate/theme/create-theme (which are self-contained operations with specific tool restrictions). This matches the actual usage pattern: chat is conversational, generate is a one-shot creative task.

**Option B: Single session with tool switching.** Use `--input-format stream-json` config messages to switch tool sets mid-session. This is more elegant but depends on a Claude CLI feature that may not exist yet.

**Go with Option A.** The handlers become:

- `chat.ts` — Uses the persistent bridge (`bridge.send(prompt)`)
- `generate.ts` — Spawns a one-shot `Bun.spawn` (self-contained, needs only Write tool)
- `theme.ts` — Spawns a one-shot `Bun.spawn` (self-contained, needs Read+Edit)
- `create-theme.ts` — Spawns a one-shot `Bun.spawn` (self-contained, needs Read+Write+Edit)

The one-shot spawn pattern is a helper function:

```typescript
export async function runOneShot(prompt: string, opts: OneShotOpts, onEvent: EventCallback): Promise<string | null> {
  const proc = Bun.spawn({
    cmd: buildClaudeArgs(opts),
    cwd: opts.cwd,
    env: cleanEnv(),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  proc.stdin.write(prompt);
  proc.stdin.end();

  // Read stdout with ReadableStream
  const reader = proc.stdout.getReader();
  // ... same pattern as bridge.readStdout
}
```

**Step 1:** Create the shared `runOneShot` helper.

**Step 2:** Port each handler to TypeScript, replacing `child_process.spawn` with `Bun.spawn` and `runOneShot`.

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

**Design: Parseable-Snapshot HMR**

The HMR system watches `app.jsx` during generation and pushes updates to the browser only when the file is in a renderable state. The key insight: we don't need to parse JSX — we need to detect when the file has **balanced braces and a valid export**.

**Algorithm:**

1. When generation starts, begin watching `app.jsx` with `fs.watch` (or `Bun.file().watch()` when stable).

2. On each file change, read the current content and run a fast syntactic check:
   ```typescript
   function isRenderable(code: string): boolean {
     // Must have export default
     if (!code.includes('export default')) return false;
     // Balanced braces/parens/brackets (fast O(n) scan)
     if (!hasBracketBalance(code)) return false;
     // Must have at least one complete component (function returning JSX)
     if (!hasCompleteComponent(code)) return false;
     // No unterminated string literals
     if (hasUnterminatedStrings(code)) return false;
     return true;
   }
   ```

3. When `isRenderable` returns true, snapshot the code and push it to all connected WebSocket clients:
   ```typescript
   ws.send(JSON.stringify({
     type: 'hmr_update',
     code: snapshotCode,
     timestamp: Date.now(),
   }));
   ```

4. The browser receives `hmr_update`, assembles it into the template frame (like `/app-frame` does server-side), and hot-swaps the iframe `srcdoc`.

5. **Debounce:** Don't check more than once per 500ms. Claude writes in bursts — the file changes rapidly during tool execution, then pauses. The debounce naturally aligns with meaningful edit boundaries.

6. **Diffing optimization (optional, Phase 2):** Instead of sending the full code each time, send a diff. But for v1, full code is fine — app.jsx is typically 5-30KB, well within WebSocket frame limits.

**The "time-lapse" effect:** Since we only push when the code is parseable, the browser sees discrete "frames" of the app evolving — first the basic structure, then styles appear, then components flesh out, then animations activate. It's a time-lapse of the app coming together.

**Implementation:**

```typescript
// scripts/server/hmr.ts

export function createHmrWatcher(ctx: ServerContext, broadcast: (msg: object) => void) {
  let watcher: ReturnType<typeof import('fs').watch> | null = null;
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

// Fast bracket balance checker
function hasBracketBalance(code: string): boolean {
  let depth = { '{': 0, '(': 0, '[': 0, '`': 0 };
  let inString: string | null = null;
  let escape = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }

    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth['{']++;
    else if (ch === '}') depth['{']--;
    else if (ch === '(') depth['(']++;
    else if (ch === ')') depth['(']--;
    else if (ch === '[') depth['[']++;
    else if (ch === ']') depth['[']--;

    if (depth['{'] < 0 || depth['('] < 0 || depth['['] < 0) return false;
  }

  return depth['{'] === 0 && depth['('] === 0 && depth['['] === 0;
}

function hasCompleteComponent(code: string): boolean {
  return /function\s+\w+\s*\([^)]*\)\s*\{/.test(code) &&
         code.includes('return') &&
         /export\s+default\s+\w+/.test(code);
}

function hasUnterminatedStrings(code: string): boolean {
  // Quick heuristic: odd number of unescaped quotes
  const singles = (code.match(/(?<!\\)'/g) || []).length;
  const doubles = (code.match(/(?<!\\)"/g) || []).length;
  const backticks = (code.match(/(?<!\\)`/g) || []).length;
  return (singles % 2 !== 0) || (doubles % 2 !== 0) || (backticks % 2 !== 0);
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

**Step 1:** Create `hmr.ts` with the watcher, balance checker, and broadcast logic.

**Step 2:** Integrate with `generate.ts` — call `hmr.start()` before generation, `hmr.stop()` after.

**Step 3:** Add `hmr_update` handling to the browser-side WebSocket handler.

**Step 4:** Test: generate an app, watch the preview update in real-time as Claude writes.

**Step 5:** Commit: `"Implement time-lapse HMR with parseable-snapshot detection"`

---

## Phase 4: Cleanup + Migration

### Task 8: Drop Node dependencies

**Files:**
- Modify: `scripts/package.json`
- Delete: `scripts/lib/ensure-deps.js`
- Delete: `scripts/preview-server.js`
- Modify: `scripts/server/lifecycle.js` → `lifecycle.ts`

**Step 1:** Remove `ws` from `scripts/package.json` dependencies.

**Step 2:** Delete `ensure-deps.js` — Bun doesn't need npm auto-install; it reads dependencies at startup.

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

  it('rejects unbalanced braces', () => {
    const code = `function App() { return <div>Hello</div>;\nexport default App;`;
    expect(isRenderable(code)).toBe(false);
  });

  it('rejects code without export', () => {
    const code = `function App() { return <div>Hello</div>; }`;
    expect(isRenderable(code)).toBe(false);
  });
});
```

**Step 1:** Add HMR unit tests (isRenderable, hasBracketBalance, hasUnterminatedStrings).

**Step 2:** Add claude-bridge tests (event dispatching, send/cancel).

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

### New files (10)
| File | Purpose |
|------|---------|
| `scripts/server.ts` | Bun.serve entry point |
| `scripts/server/config.ts` | Config loader (port from .js) |
| `scripts/server/router.ts` | HTTP route table returning Response objects |
| `scripts/server/ws.ts` | Native WebSocket handler |
| `scripts/server/claude-bridge.ts` | Persistent claude session + one-shot helper |
| `scripts/server/handlers/chat.ts` | Chat handler (persistent session) |
| `scripts/server/handlers/generate.ts` | Generate handler (one-shot + HMR) |
| `scripts/server/handlers/theme.ts` | Theme switch handler (one-shot) |
| `scripts/server/handlers/create-theme.ts` | Theme save handler (one-shot) |
| `scripts/server/hmr.ts` | Parseable-snapshot HMR watcher |

### Deleted files (3)
| File | Reason |
|------|--------|
| `scripts/preview-server.js` | Replaced by `server.ts` |
| `scripts/lib/ensure-deps.js` | Bun doesn't need npm auto-install |
| `scripts/server/ws-dispatch.js` | Replaced by `ws.ts` |

### Modified files (8)
| File | Change |
|------|--------|
| `scripts/package.json` | Remove `ws` dep, update scripts |
| `scripts/server/config.js` → `.ts` | TypeScript, Bun-native imports |
| `scripts/server/lifecycle.js` → `.ts` | Bun-native port management |
| `scripts/server/routes.js` | Deleted (replaced by `router.ts`) |
| `scripts/server/claude-bridge.js` | Deleted (replaced by `.ts`) |
| `scripts/server/post-process.js` → `.ts` | TypeScript (logic unchanged) |
| `CLAUDE.md` | Update dev commands |
| `scripts/server/handlers/editor-api.js` → `.ts` | Response API, `req.json()` |

### Preserved files (unchanged)
| File | Why |
|------|-----|
| `scripts/lib/stream-parser.js` | Pure utility, no Node deps |
| `scripts/lib/claude-subprocess.js` | Still used by other scripts (deploy, etc.) |
| `scripts/lib/*.js` | Pure utilities, runtime-agnostic |
| `scripts/__tests__/` | Vitest tests — add new, keep existing |
| `scripts/server/handlers/deploy.js` | Spawns `node` subprocess for deploy scripts — separate concern |
| `scripts/server/handlers/image-gen.js` | Pure fetch, no Node deps |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Bun.spawn stdin flushing behaves differently from Node child_process | Julian project proves this works; test early in Task 4 |
| `--input-format stream-json` may not support tool set switching | Hybrid model (Task 5) — persistent session for chat, one-shot for others |
| HMR bracket balance checker produces false positives/negatives | Conservative: only push when ALL checks pass. False negatives (missing valid states) are fine — user just sees fewer intermediate frames |
| Vitest under Bun may have edge cases | Vitest officially supports Bun; 520 tests will surface issues quickly |
| `Bun.file().watch()` not yet stable | Use `fs.watch` (Bun supports Node fs module) |
| Deploy handler spawns `node` subprocesses | Keep as-is — deploy scripts are separate from the server runtime |

---

## Execution Order

Tasks 1-3 can be done in sequence (foundation).
Task 4 is the critical path (bridge rewrite).
Task 5 depends on Task 4 (handler ports).
Tasks 6-7 can be parallelized (WebSocket + HMR).
Tasks 8-10 are cleanup after everything works.

**Estimated effort:** Tasks 1-3 are mechanical ports (~2 hours). Task 4 is the most complex (~3 hours). Task 7 (HMR) is the most creative (~2 hours). Total: ~10-12 hours of focused implementation.
