# Loom Best Practices Audit — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply Loom skill best practices to the editor's `claude -p` subprocess bridge — stream text tokens live, surface tool results, fix safety/correctness gaps.

**Architecture:** Extract a shared stream parser utility (Loom pattern), enrich the event contract in `claude-bridge.js` with `token` and `tool_result` events, fix `cleanEnv()` for cmux, switch permission default to `dontAsk`, and DRY up `create-theme.js`.

**Tech Stack:** Node.js, Vitest, WebSocket (ws)

---

### Task 1: Create `stream-parser.js` with tests

**Files:**
- Create: `scripts/lib/stream-parser.js`
- Create: `scripts/__tests__/unit/stream-parser.test.js`

**Step 1: Write the failing tests**

```javascript
// scripts/__tests__/unit/stream-parser.test.js
import { describe, it, expect, vi } from 'vitest';
import { createStreamParser } from '../../lib/stream-parser.js';

describe('createStreamParser', () => {
  it('parses a complete JSON line', () => {
    const events = [];
    const parse = createStreamParser((e) => events.push(e));
    parse(Buffer.from('{"type":"result"}\n'));
    expect(events).toEqual([{ type: 'result' }]);
  });

  it('buffers incomplete lines across chunks', () => {
    const events = [];
    const parse = createStreamParser((e) => events.push(e));
    parse(Buffer.from('{"type":'));
    expect(events).toHaveLength(0);
    parse(Buffer.from('"assistant"}\n'));
    expect(events).toEqual([{ type: 'assistant' }]);
  });

  it('handles multiple lines in one chunk', () => {
    const events = [];
    const parse = createStreamParser((e) => events.push(e));
    parse(Buffer.from('{"a":1}\n{"b":2}\n'));
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ a: 1 });
    expect(events[1]).toEqual({ b: 2 });
  });

  it('skips empty lines', () => {
    const events = [];
    const parse = createStreamParser((e) => events.push(e));
    parse(Buffer.from('\n\n{"type":"ok"}\n\n'));
    expect(events).toEqual([{ type: 'ok' }]);
  });

  it('warns on malformed JSON without throwing', () => {
    const events = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parse = createStreamParser((e) => events.push(e));
    parse(Buffer.from('not-json\n{"type":"ok"}\n'));
    expect(events).toEqual([{ type: 'ok' }]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('handles multi-byte UTF-8 split across chunks', () => {
    const events = [];
    const parse = createStreamParser((e) => events.push(e));
    const full = Buffer.from('{"text":"hello 🌍"}\n');
    // Split in the middle of the emoji (4-byte sequence)
    parse(full.subarray(0, 18));
    parse(full.subarray(18));
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('hello 🌍');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/stream-parser.test.js`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// scripts/lib/stream-parser.js
/**
 * Shared stream-json parser for claude -p subprocess output.
 *
 * Buffers stdout chunks into complete JSON lines, handling:
 * - Lines split across TCP chunks
 * - Multi-byte UTF-8 characters split at chunk boundaries
 * - Malformed JSON (warns, does not throw)
 */

/**
 * @param {function} onEvent - Called with each parsed JSON object
 * @returns {function} Parser function — call with each stdout Buffer/Uint8Array chunk
 */
export function createStreamParser(onEvent) {
  const decoder = new TextDecoder();
  let buffer = '';

  return (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line));
      } catch (err) {
        console.warn('[stream-parser] JSON parse error:', err.message, line.slice(0, 200));
      }
    }
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/stream-parser.test.js`
Expected: 6 tests PASS

**Step 5: Commit**

```bash
git add scripts/lib/stream-parser.js scripts/__tests__/unit/stream-parser.test.js
git commit -m "Add shared stream parser utility (Loom pattern)"
```

---

### Task 2: Fix `cleanEnv()` — add cmux nesting detection

**Files:**
- Modify: `scripts/lib/claude-subprocess.js:85-90`
- Modify: `scripts/__tests__/unit/claude-subprocess.test.js:203-244`

**Step 1: Write the failing tests**

Add these tests to the existing `describe('cleanEnv')` block in `scripts/__tests__/unit/claude-subprocess.test.js`:

```javascript
  it('removes CMUX nesting vars when CMUX_SURFACE_ID is present', () => {
    process.env.CMUX_SURFACE_ID = 'surface-1';
    process.env.CMUX_PANEL_ID = 'panel-1';
    process.env.CMUX_TAB_ID = 'tab-1';
    process.env.CMUX_WORKSPACE_ID = 'ws-1';
    process.env.CMUX_SOCKET_PATH = '/tmp/cmux.sock';
    const env = cleanEnv();
    expect(env).not.toHaveProperty('CMUX_SURFACE_ID');
    expect(env).not.toHaveProperty('CMUX_PANEL_ID');
    expect(env).not.toHaveProperty('CMUX_TAB_ID');
    expect(env).not.toHaveProperty('CMUX_WORKSPACE_ID');
    expect(env).not.toHaveProperty('CMUX_SOCKET_PATH');
    // Cleanup
    delete process.env.CMUX_SURFACE_ID;
    delete process.env.CMUX_PANEL_ID;
    delete process.env.CMUX_TAB_ID;
    delete process.env.CMUX_WORKSPACE_ID;
    delete process.env.CMUX_SOCKET_PATH;
  });

  it('does not touch CMUX vars when CMUX_SURFACE_ID is absent', () => {
    delete process.env.CMUX_SURFACE_ID;
    process.env.CMUX_PANEL_ID = 'panel-stale';
    const env = cleanEnv();
    expect(env).toHaveProperty('CMUX_PANEL_ID', 'panel-stale');
    delete process.env.CMUX_PANEL_ID;
  });
```

**Step 2: Run tests to verify the first new test fails**

Run: `cd scripts && npx vitest run __tests__/unit/claude-subprocess.test.js`
Expected: FAIL — `CMUX_SURFACE_ID` still present in env

**Step 3: Update `cleanEnv()` implementation**

In `scripts/lib/claude-subprocess.js`, replace the `cleanEnv` function body:

```javascript
export function cleanEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // cmux terminal sets CMUX_* vars that trigger nesting detection.
  // These are terminal-state identifiers, not auth tokens — safe to remove.
  if (env.CMUX_SURFACE_ID) {
    delete env.CMUX_SURFACE_ID;
    delete env.CMUX_PANEL_ID;
    delete env.CMUX_TAB_ID;
    delete env.CMUX_WORKSPACE_ID;
    delete env.CMUX_SOCKET_PATH;
  }
  return env;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/claude-subprocess.test.js`
Expected: ALL tests PASS (including 2 new + all existing)

**Step 5: Commit**

```bash
git add scripts/lib/claude-subprocess.js scripts/__tests__/unit/claude-subprocess.test.js
git commit -m "Add cmux nesting detection to cleanEnv"
```

---

### Task 3: Switch permission default to `dontAsk`

**Files:**
- Modify: `scripts/lib/claude-subprocess.js:41-79`
- Modify: `scripts/__tests__/unit/claude-subprocess.test.js` (update assertions)

**Step 1: Update tests to expect new default**

In `scripts/__tests__/unit/claude-subprocess.test.js`, update these tests:

1. The test at line 36-41 (`'includes --permission-mode bypassPermissions'`) — change to expect `dontAsk`
2. The test at line 155-158 (`bypassPermissions: true`) — change expected value to `dontAsk` when `bypassPermissions` is not set
3. The test at line 162-166 (`bypassPermissions is omitted`) — change to expect `dontAsk`

The `bypassPermissions` config key is being **replaced** with a `permissionMode` key that accepts a string. The old boolean `bypassPermissions: false` becomes the equivalent of omitting `permissionMode` (no flag emitted). The old `bypassPermissions: true` becomes `permissionMode: 'bypassPermissions'`.

Updated test block:

```javascript
  describe('permission mode', () => {
    it('defaults to dontAsk when permissionMode is omitted', () => {
      const args = buildClaudeArgs({});
      const idx = args.indexOf('--permission-mode');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('dontAsk');
    });

    it('uses specified permissionMode', () => {
      const args = buildClaudeArgs({ permissionMode: 'bypassPermissions' });
      const idx = args.indexOf('--permission-mode');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('bypassPermissions');
    });

    it('omits --permission-mode when permissionMode is false', () => {
      const args = buildClaudeArgs({ permissionMode: false });
      expect(args).not.toContain('--permission-mode');
    });
  });
```

Also update the default config test (`'includes --permission-mode bypassPermissions'` at line 36) to expect `dontAsk`.

**Step 2: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/claude-subprocess.test.js`
Expected: FAIL — still outputs `bypassPermissions`

**Step 3: Update `buildClaudeArgs` implementation**

Replace the permission mode block in `scripts/lib/claude-subprocess.js`:

```javascript
  // Permission mode: default to dontAsk (auto-deny unallowed tools).
  // Pass permissionMode: 'bypassPermissions' to skip all checks.
  // Pass permissionMode: false to omit the flag entirely.
  if (config.permissionMode !== false) {
    args.push('--permission-mode', config.permissionMode || 'dontAsk');
  }
```

Also keep backward compat: if old code passes `bypassPermissions: true`, map it:

```javascript
  const mode = config.permissionMode !== undefined
    ? config.permissionMode
    : (config.bypassPermissions === true ? 'bypassPermissions'
       : config.bypassPermissions === false ? false
       : 'dontAsk');
  if (mode) {
    args.push('--permission-mode', mode);
  }
```

**Step 4: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/claude-subprocess.test.js`
Expected: ALL tests PASS

**Step 5: Commit**

```bash
git add scripts/lib/claude-subprocess.js scripts/__tests__/unit/claude-subprocess.test.js
git commit -m "Switch default permission mode from bypassPermissions to dontAsk"
```

---

### Task 4: Add `allowedTools` to each handler's `runClaude` call

**Files:**
- Modify: `scripts/server/handlers/chat.js:170`
- Modify: `scripts/server/handlers/generate.js:239`
- Modify: `scripts/server/handlers/theme.js:171,256`
- Modify: `scripts/server/claude-bridge.js:38-42` (pass `tools` through)

**Step 1: Update `runClaude` to forward `opts.tools` to `buildClaudeArgs`**

In `scripts/server/claude-bridge.js`, the `buildClaudeArgs` call at line 38-42:

```javascript
    const args = buildClaudeArgs({
      outputFormat: 'stream-json',
      maxTurns: opts.maxTurns,
      model: opts.model,
      tools: opts.tools,
    });
```

**Step 2: Add `tools` to each handler call**

- `chat.js:170`: `{ maxTurns, model, cwd: ctx.projectRoot, tools: 'Read,Edit,Write,Glob,Grep' }`
- `generate.js:239`: `{ skipChat: true, maxTurns, model, cwd: ctx.projectRoot, tools: 'Write' }`
- `theme.js:171` (multi-pass Pass 2): `{ skipChat: true, maxTurns: 5, model, cwd: ctx.projectRoot, tools: 'Read,Edit' }`
- `theme.js:256` (legacy): `{ skipChat: true, maxTurns: 8, model, cwd: ctx.projectRoot, tools: 'Read,Edit' }`

**Step 3: Run full test suite**

Run: `cd scripts && npm test`
Expected: ALL tests PASS (no unit tests cover handler calls directly — this is integration-level)

**Step 4: Commit**

```bash
git add scripts/server/claude-bridge.js scripts/server/handlers/chat.js scripts/server/handlers/generate.js scripts/server/handlers/theme.js
git commit -m "Add explicit allowedTools to each handler for dontAsk mode"
```

---

### Task 5: Enrich `claude-bridge.js` — streaming text, tool results, is_error, SIGTERM

**Files:**
- Modify: `scripts/server/claude-bridge.js`

This is the core change. Refactor `runClaude` to use the shared parser and add new event types.

**Step 1: Replace manual parser with `createStreamParser`**

At the top of `claude-bridge.js`, add:
```javascript
import { createStreamParser } from '../lib/stream-parser.js';
```

Replace lines 90-143 (the `child.stdout.on('data')` handler and its inline parsing) with:

```javascript
    const parse = createStreamParser((event) => {
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_use') {
            toolsUsed++;
            const toolName = block.name || '';
            if (toolName === 'Edit' || toolName === 'Write') hasEdited = true;

            const input = block.input || {};
            const inputSummary =
              (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') ? (input.file_path || '') :
              (toolName === 'Glob') ? (input.pattern || '') :
              (toolName === 'Grep') ? (input.pattern || '') :
              (toolName === 'Bash') ? (input.command || '').slice(0, 80) :
              '';

            const toolLabel = toolName === 'Read' ? 'Reading files...' :
                              toolName === 'Glob' ? 'Searching files...' :
                              toolName === 'Grep' ? 'Searching code...' :
                              toolName === 'Edit' ? 'Editing app.jsx...' :
                              toolName === 'Write' ? 'Writing app.jsx...' : null;

            const elapsed = getElapsed();
            sendProgress(toolLabel ? { stage: toolLabel } : {});
            console.log(`[Claude] Tool: ${toolName}${inputSummary ? ` → ${inputSummary}` : ''} (${elapsed}s)`);

            onEvent({ type: 'tool_detail', name: toolName, input_summary: inputSummary, elapsed });
          }
          if (block.type === 'text' && block.text) {
            resultText = block.text;
            // Stream text blocks to client (extended thinking models deliver text here)
            onEvent({ type: 'token', text: block.text });
          }
        }
      } else if (event.type === 'stream_event' && event.event?.delta?.text) {
        // Incremental token streaming (most models)
        onEvent({ type: 'token', text: event.event.delta.text });
      } else if (event.type === 'tool_result') {
        // Tool completion — forward name, truncated content, error flag
        const content = typeof event.content === 'string'
          ? event.content.slice(0, 500)
          : JSON.stringify(event.content || '').slice(0, 500);
        onEvent({
          type: 'tool_result',
          name: event.tool_name || '',
          content,
          is_error: !!event.is_error,
          elapsed: getElapsed(),
        });
      } else if (event.type === 'result') {
        // Check is_error flag before treating as success
        if (event.is_error) {
          const errMsg = event.result || 'Claude flagged the run as failed';
          console.error(`[Claude] Result is_error: ${errMsg}`);
          onEvent({ type: 'error', message: errMsg });
        } else {
          resultText = event.result || resultText || 'Done.';
        }
      } else {
        if (event.type === 'rate_limit_event') {
          hitRateLimit = true;
          sendProgress({ stage: 'Rate limited, waiting...' });
        }
        console.log(`[Claude] Event: ${event.type} (${getElapsed()}s)`);
      }
    });

    child.stdout.on('data', parse);
```

**Step 2: Update the `close` handler to account for `is_error` result**

The existing close handler at lines 153-190 already works — but now `is_error` results emit an `error` event during parsing, so the `close` handler should check whether an error was already sent. Add a `let errorSent = false;` flag, set it in the `is_error` branch, and skip the `complete` event if `errorSent`.

**Step 3: Change cancel signal from SIGKILL to SIGTERM**

In `cancelClaude()` (line 209), change:
```javascript
  activeClaude.kill('SIGKILL');
```
to:
```javascript
  activeClaude.kill('SIGTERM');
```

**Step 4: Add new event types to wsAdapter**

In the `wsAdapter` function, add handlers for `token` and `tool_result`:

```javascript
      } else if (event.type === 'token') {
        ws.send(JSON.stringify({ type: 'token', text: event.text }));
      } else if (event.type === 'tool_result') {
        ws.send(JSON.stringify({ type: 'tool_result', name: event.name, content: event.content, is_error: event.is_error }));
```

**Step 5: Remove the now-unused `buffer` variable**

The old `let buffer = '';` at line 55 and the manual parsing block are replaced by the shared parser. Remove the `buffer` declaration.

**Step 6: Run full test suite**

Run: `cd scripts && npm test`
Expected: ALL tests PASS

**Step 7: Commit**

```bash
git add scripts/server/claude-bridge.js
git commit -m "Enrich claude-bridge with streaming text, tool results, is_error checks, SIGTERM"
```

---

### Task 6: Refactor `create-theme.js` to use shared parser

**Files:**
- Modify: `scripts/server/handlers/create-theme.js:74-139`

**Step 1: Replace manual parser with `createStreamParser`**

Add import at top:
```javascript
import { createStreamParser } from '../../lib/stream-parser.js';
```

In `extractThemeFromAppJsx`, replace lines 87-115 (the manual buffer/parse block) with:

```javascript
    const parse = createStreamParser((event) => {
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) resultText = block.text;
          if (block.type === 'tool_use') {
            console.log(`[SaveTheme] Tool: ${block.name || ''}`);
          }
        }
      } else if (event.type === 'result') {
        if (event.is_error) {
          console.error(`[SaveTheme] Result is_error: ${event.result}`);
        } else {
          resultText = event.result || resultText || 'Done.';
        }
      }
    });

    child.stdout.on('data', parse);
```

Also remove the now-unused `let buffer = '';` declaration and the old `let lineBuf = '';` if present.

**Step 2: Add `tools` and `permissionMode` to the `buildClaudeArgs` call**

Update line 75:
```javascript
    const args = buildClaudeArgs({ outputFormat: 'stream-json', maxTurns: 10, timeoutMs: 240_000, tools: 'Edit,Read,Write', model, permissionMode: 'bypassPermissions' });
```

Note: `create-theme.js` keeps `bypassPermissions` because it runs a creative extraction task that may need broader tool access — this is an intentional override of the `dontAsk` default.

**Step 3: Run full test suite**

Run: `cd scripts && npm test`
Expected: ALL tests PASS

**Step 4: Commit**

```bash
git add scripts/server/handlers/create-theme.js
git commit -m "Refactor create-theme.js to use shared stream parser"
```

---

### Task 7: Run full test suite + manual verification

**Step 1: Run all tests**

Run: `cd scripts && npm test`
Expected: ALL tests PASS

**Step 2: Manual verification checklist**

Start editor: `node scripts/preview-server.js --mode=editor`

Open browser devtools → Network → WS tab, and verify:

1. **Generate an app** — WS messages should include `token` events with streaming text (not just `status` progress)
2. **Chat with the app** — same: `token` events stream live, `tool_detail` shows Read/Edit, `tool_result` shows completion
3. **Switch theme** — `token` events during Pass 2 creative restyle
4. **Save a theme** — verify no regression (create-theme still works)
5. **Cancel a request** — verify process terminates (SIGTERM not SIGKILL)

**Step 3: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "Loom best practices: streaming text, tool results, safety fixes"
```
