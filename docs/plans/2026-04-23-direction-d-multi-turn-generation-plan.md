# Direction D Multi-Turn Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Vibes OS app generation into two tool calls (Write skeleton → Edit rest) using Claude Code's native tool loop, with a live staged preview UX that shows the reference asset, then the skeleton, then the complete app.

**Architecture:** Prompt-driven multi-turn — no harness orchestration, no Agent SDK. Changes are prompt edits, server-side event emissions, a new `/reference-frame` route, a JSX syntax validator, and editor-UI plumbing in `editor.html`.

**Tech Stack:** Bun, TypeScript/JavaScript, vitest, Claude Code CLI subprocess, stream-json parsing, WebSocket → editor UI.

**Spec:** [docs/plans/2026-04-23-direction-d-multi-turn-generation-design.md](2026-04-23-direction-d-multi-turn-generation-design.md)

---

> ## Status update — post-PR [#73](https://github.com/popmechanic/VibesOS/pull/73) / [#75](https://github.com/popmechanic/VibesOS/pull/75)
>
> This plan targets `scripts/server/handlers/generate.ts::handleGenerate` as
> the site where staged-preview events are emitted and where `runOneShot`
> is tuned. **That surface is gone in production.**
>
> After [#73](https://github.com/popmechanic/VibesOS/pull/73), the editor
> generate flow runs through the **persistent bridge**
> (`scripts/server/claude-bridge.ts::createBridge`), dispatched from
> `scripts/server/ws.ts` at `case 'generate':`. Staged-preview events are
> emitted by `translateStreamEvent` (in `event-translator.ts`), gated by
> `turnMode === 'generate'`. `handleGenerate` and the one-shot-specific
> `generation-events.test.ts` references to the editor path have been
> cleaned up in [#75](https://github.com/popmechanic/VibesOS/pull/75);
> only `assembleAppFrame` remains in `handlers/generate.ts` for the
> `/app-frame` route.
>
> When reading task-by-task file references below, substitute:
> - `scripts/server/handlers/generate.ts` (for emit sites) → `scripts/server/claude-bridge.ts` + `scripts/server/ws.ts`
> - `dispatchStreamEvent` → `translateStreamEvent` (bridge path) — `dispatchStreamEvent` still exists and still powers `runOneShot` (theme / factory / riff), just not the editor
> - `handleGenerate` → `case 'generate':` in `ws.ts`
>
> The prompt structure, event names and payloads, validator logic, and
> editor-side UI plumbing are all still accurate. The routing landmine
> is documented in `CLAUDE.md` "Generate Flow Routing."

---

## File Structure

### Modified files

- `scripts/server/prompt-builders.ts` — add shared constants (`USE_VIBES_THEME_TEMPLATE`, `TWO_STEP_INSTRUCTIONS`, `GLOBAL_STEP_RULES`, `DESIGN_REASONING_SECTION`); rewrite `buildGeneratePrompt` for 2-step structure.
- `scripts/server/handlers/generate.ts` — emit `reference_preview` + initial `generation_stage` before `runOneShot`; update `runOneShot` call sites (tools allowlist, maxTurns).
- `scripts/server/claude-bridge.ts` — emit `preview_reload` (gated by JSX validator), `preview_reload_failed`, `generation_stage` from `runOneShot`; track `toolUseSeen` counter; add `appJsxValid` field on the `complete` event.
- `scripts/server/router.ts` — register `GET /reference-frame` route.
- `scripts/__tests__/unit/prompt-builders.test.ts` — add assertions for shared constants and 2-step structure.
- `scripts/__tests__/unit/claude-subprocess.test.js` — update any tools/maxTurns expectations that now differ.
- `skills/vibes/templates/editor.html` — add overlay component over preview iframe; wire WebSocket `onmessage` to handle new events; implement iframe-src swap and cache-bust logic.
- `.claude-plugin/plugin.json` — bump version to `0.3.0`.
- `.claude-plugin/marketplace.json` — bump version to `0.3.0`.

### New files

- `scripts/lib/validate-app-jsx.ts` — JSX syntax check helper using `Bun.Transpiler`.
- `scripts/__tests__/unit/validate-app-jsx.test.ts` — tests for validator.
- `scripts/server/handlers/reference-frame.ts` — `GET /reference-frame` handler for image and HTML references.
- `scripts/__tests__/unit/reference-frame.test.ts` — tests for the new route handler.

### File-by-file responsibilities

| File | Responsibility |
|---|---|
| `prompt-builders.ts` | Build the 2-step generate prompt with DRY'd shared constants |
| `generate.ts` | Orchestrate generation; emit pre-run UI events; pass the right tools/maxTurns |
| `claude-bridge.ts` | Stream-json subprocess wrapper; emits UI events from assistant/tool events |
| `validate-app-jsx.ts` | Pure function: parse-check `app.jsx` via Bun.Transpiler, return ok/error |
| `reference-frame.ts` | Serve the reference asset (HTML passthrough; image full-bleed wrapper) |
| `editor.html` | Render overlay state + swap/cache-bust iframe in response to events |

---

## Phase 1 — Prompt refactor + DRY extraction

**Commit boundary at end of phase.** At this point app generation still works single-Write — we haven't changed behavior yet, just reorganized prompt code so subsequent tasks can edit one place.

### Task 1.1: Add a regression test for shared prompt constants

**Files:**
- Modify: `scripts/__tests__/unit/prompt-builders.test.ts`

- [ ] **Step 1: Add a failing test asserting both generate paths contain the shared constants**

Append this `describe` block to `prompt-builders.test.ts` (at the end of the file, before the final closing bracket if there is one; otherwise at top level):

```typescript
describe('buildGeneratePrompt shared constants (DRY refactor)', () => {
  it('non-reference path contains TWO_STEP_INSTRUCTIONS and GLOBAL_STEP_RULES', () => {
    writeFileSync(join(TMP, 'themes', 'abstract.txt'), ':root { --color-background: oklch(20% 0 0); }');
    const ctx = makeCtx({
      themes: [{ id: 'abstract', name: 'Abstract' }],
      themeColors: { abstract: { bg: '#000', rootBlock: ':root { --color-background: oklch(20% 0 0); }' } },
    });
    const result = buildGeneratePrompt(ctx as any, 'a todo list', { themeId: 'abstract' });
    expect(result.prompt).toContain('=== BUILD app.jsx IN TWO TOOL CALLS ===');
    expect(result.prompt).toContain('STEP 1 — Write app.jsx');
    expect(result.prompt).toContain('STEP 2 — Edit app.jsx');
    expect(result.prompt).toContain('=== RULES THAT APPLY TO ALL STEPS ===');
  });

  it('reference path (HTML) contains the same TWO_STEP_INSTRUCTIONS and GLOBAL_STEP_RULES', () => {
    const refPath = join(TMP, 'ref.html');
    writeFileSync(refPath, '<html><body style="background:#f00">Hi</body></html>');
    const ctx = makeCtx();
    const result = buildGeneratePrompt(ctx as any, 'match this', {
      reference: { name: 'ref.html', serverPath: refPath, intent: 'match' },
    });
    expect(result.prompt).toContain('=== BUILD app.jsx IN TWO TOOL CALLS ===');
    expect(result.prompt).toContain('STEP 1 — Write app.jsx');
    expect(result.prompt).toContain('STEP 2 — Edit app.jsx');
    expect(result.prompt).toContain('=== RULES THAT APPLY TO ALL STEPS ===');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd scripts && npm run test:unit -- prompt-builders`
Expected: FAIL — both assertions fail because the current prompt uses `=== WRITE app.jsx ===`, not the new two-step framing.

### Task 1.2: Extract `USE_VIBES_THEME_TEMPLATE` helper

**Files:**
- Modify: `scripts/server/prompt-builders.ts`

- [ ] **Step 1: Add the helper near the top of the file, under existing imports**

Insert after the `EFFECT_INSTRUCTIONS` constant (around line 34):

```typescript
/**
 * The boilerplate JSX block every generated app.jsx must start with.
 * Shared between the reference and non-reference paths.
 */
function USE_VIBES_THEME_TEMPLATE(themeId: string, themeName: string): string {
  return `\`\`\`jsx
window.__VIBES_THEMES__ = [{ id: "${themeId}", name: "${themeName}" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "${themeId}");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}
\`\`\``;
}
```

- [ ] **Step 2: Replace the inline useVibesTheme blocks in `buildGeneratePrompt`**

In the reference-path prompt (inside `if (hasRef) { ... }`), find the string literal containing the `useVibesTheme` function and replace that entire fenced code block with `${USE_VIBES_THEME_TEMPLATE('custom-ref', 'Custom Reference')}`.

In the non-reference-path prompt (`const prompt = \`... \``), find the same block and replace with `${USE_VIBES_THEME_TEMPLATE(themeId!, themeName)}`.

- [ ] **Step 3: Run existing tests to make sure nothing broke**

Run: `cd scripts && npm run test:unit -- prompt-builders`
Expected: existing tests still pass. The new test from Task 1.1 still fails (different reason now — or same).

### Task 1.3: Extract `GLOBAL_STEP_RULES` constant

**Files:**
- Modify: `scripts/server/prompt-builders.ts`

- [ ] **Step 1: Add the constant**

Insert after `USE_VIBES_THEME_TEMPLATE`:

```typescript
/**
 * Cross-cutting rules that apply to every step of the 2-step generation.
 * Kept in one place so the reference and non-reference prompts share identical text.
 */
const GLOBAL_STEP_RULES = `=== RULES THAT APPLY TO ALL STEPS ===

- NO import statements — the app runs in a Babel script block with globals
- NO TypeScript. End the file with: export default App
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters: → ● « etc. CSS escapes break Babel.
- Responsive (mobile-first with Tailwind). Use className="btn" for buttons, className="grid-background" on the root element.
- TinyBase hooks (useRowIds, useCell, useAddRowCallback, useSetCellCallback, useDelRowCallback, useValue, useSortedRowIds, useTable) are PRE-EXISTING GLOBALS. NEVER import, redeclare, or alias them.
- Table names must be string literals: useRowIds('todos'), never useRowIds(tableName).
- Cells are scalars only (string/number/boolean) — no nested objects or arrays.
- No sync/connection status UI, not even decorative ("Online", "LIVE", "Connected") — SyncStatusDot is built-in.
- useApp() is mandatory in root App. It returns { isReady, isSyncing, user }.`;
```

- [ ] **Step 2: Leave existing prompt strings alone for now** — we'll fold this in after `TWO_STEP_INSTRUCTIONS` is added in Task 1.4.

### Task 1.4: Extract `TWO_STEP_INSTRUCTIONS` constant

**Files:**
- Modify: `scripts/server/prompt-builders.ts`

- [ ] **Step 1: Add the constant**

Insert after `GLOBAL_STEP_RULES`:

```typescript
/**
 * The core new behavior: tell Claude to produce the app via two tool calls.
 * Claude Code's native tool loop turns each tool_result into a new assistant turn
 * with its own fresh max_tokens budget — so we don't need server-side orchestration.
 */
const TWO_STEP_INSTRUCTIONS = `=== BUILD app.jsx IN TWO TOOL CALLS ===

Build this app in two separate tool calls, in order. Each step has a specific purpose; do not try to do everything in one call.

STEP 1 — Write app.jsx: the visible skeleton.
Produce a file that compiles and renders the app's basic shape — even without data or interactions. Include:
- The exact __VIBES_THEMES__ + useVibesTheme code from above (unchanged)
- A <style> tag with :root tokens and the four marker sections (/* @theme:tokens */, /* @theme:surfaces */, /* @theme:motion */, {/* @theme:decoration */}) present even when their contents are empty, plus base layout CSS
- A functioning component tree with visible elements: header with the app title, main content area, whatever structural regions fit this app (sidebar/nav/footer as needed). Components render placeholder/empty states but the layout is real.
- Basic React hooks for local UI state (useState). NO TinyBase hooks yet. NO event handlers yet.
- export default App

After STEP 1 the preview should look like the final app in colors, typography, and layout — just without data or polish.

STEP 2 — Edit app.jsx: data, interactions, and polish.
Read app.jsx (the skeleton you just wrote), then Edit it to add everything else:
- TinyBase hooks (useRowIds, useCell, useAddRowCallback, useSetCellCallback, useDelRowCallback, useValue)
- React event handlers, effects, refs
- useApp() integration; useAI wiring if the app needs it
- Inside the @theme:surfaces marker: shadows, borders, gradients, glass effects
- Inside the @theme:motion marker: @keyframes, CSS @property animations, hover effects
- Inside the @theme:decoration marker: SVG illustrations, Canvas 2D or WebGL backgrounds, decorative patterns

After STEP 2 the app is complete.

IMPORTANT: Do NOT produce a <design> narrative before STEP 1. Any design notes belong inside CSS comments in the <style> tag. Narrative prose counts against the same output budget as your code.`;
```

### Task 1.5: Swap the new blocks into both prompt paths

**Files:**
- Modify: `scripts/server/prompt-builders.ts` (function `buildGeneratePrompt`)

- [ ] **Step 1: Update the reference-path final prompt**

Find the reference-path `refPrompt` template string assignment (inside `if (hasRef)`). Its tail currently looks like:

```typescript
  ${THEME_SECTION_MARKERS}
${useAI ? AI_INSTRUCTIONS_GENERATE : ''}`;
```

Replace the section that begins with `=== WRITE app.jsx ===` through the `- Responsive ...` rule (the whole old Write-instructions + rules block) with:

```typescript
${TWO_STEP_INSTRUCTIONS}

${GLOBAL_STEP_RULES}

${THEME_SECTION_MARKERS}
${useAI ? AI_INSTRUCTIONS_GENERATE : ''}`;
```

The `=== DESIGN REASONING ===` section stays as-is (already trimmed in PR #68).

- [ ] **Step 2: Update the non-reference-path final prompt**

Find the non-reference `prompt` template string (after the `if (hasRef) { return ... }` block). Do the same swap: replace the `=== WRITE app.jsx ===` through rules block with the same two constants.

- [ ] **Step 3: Run the test suite**

Run: `cd scripts && npm run test:unit`
Expected: all 694 existing tests pass; the two new tests from Task 1.1 now PASS.

### Task 1.6: Commit Phase 1

- [ ] **Step 1: Commit**

```bash
git add scripts/server/prompt-builders.ts scripts/__tests__/unit/prompt-builders.test.ts
git commit -m "$(cat <<'EOF'
refactor(generate): extract shared prompt constants; switch to 2-step instructions

Pulls the useVibesTheme boilerplate, global step rules, and the new
two-tool-call framing into named constants so the reference and
non-reference prompt paths share identical text. Regression test guards
against re-duplication.

This is the core behavioral change for Direction D: Claude is now told
to split app generation into Write (skeleton) + Edit (rest), taking
advantage of Claude Code's native tool loop so each step gets its own
fresh max_tokens budget.
EOF
)"
```

---

## Phase 2 — Config changes (tools + maxTurns)

**Commit boundary at end of phase.** This is where the generate handler opts in to the new multi-tool-call flow.

### Task 2.1: Update generate handler tools + maxTurns

**Files:**
- Modify: `scripts/server/handlers/generate.ts:59-65`

- [ ] **Step 1: Update the reference-path runOneShot call**

Find the current code:

```typescript
if (result.isReference) {
  const maxTurns = result.isHtmlRef ? 5 : 8;
  console.log(`[Generate] Starting (reference path) — ref: ${reference.name} (${result.referenceIntent}), prompt: ${(result.prompt.length / 1024).toFixed(1)}KB`);
  await runOneShot(result.prompt, { lockType: 'generate', skipChat: true, maxTurns, model, cwd: appDir, tools: result.isHtmlRef ? 'Write' : 'Write,Read' }, onEvent, ctx.projectRoot);
} else {
  console.log(`[Generate] Starting — theme: ${result.themeId} (${result.themeName}), prompt: ${(result.prompt.length / 1024).toFixed(1)}KB`);
  await runOneShot(result.prompt, { lockType: 'generate', skipChat: true, maxTurns: 5, model, cwd: appDir, tools: 'Write' }, onEvent, ctx.projectRoot);
}
```

Replace with:

```typescript
if (result.isReference) {
  const maxTurns = result.isHtmlRef ? 10 : 12;
  console.log(`[Generate] Starting (reference path) — ref: ${reference.name} (${result.referenceIntent}), prompt: ${(result.prompt.length / 1024).toFixed(1)}KB`);
  await runOneShot(result.prompt, { lockType: 'generate', skipChat: true, maxTurns, model, cwd: appDir, tools: 'Write,Edit,Read' }, onEvent, ctx.projectRoot);
} else {
  console.log(`[Generate] Starting — theme: ${result.themeId} (${result.themeName}), prompt: ${(result.prompt.length / 1024).toFixed(1)}KB`);
  await runOneShot(result.prompt, { lockType: 'generate', skipChat: true, maxTurns: 10, model, cwd: appDir, tools: 'Write,Edit,Read' }, onEvent, ctx.projectRoot);
}
```

- [ ] **Step 2: Run the full test suite**

Run: `cd scripts && npm run test:unit`
Expected: all tests pass. If any test in `claude-subprocess.test.js` hard-coded `tools: 'Write'` or `maxTurns: 5` for generate, update those assertions to match the new values.

### Task 2.2: Commit Phase 2

- [ ] **Step 1: Commit**

```bash
git add scripts/server/handlers/generate.ts scripts/__tests__/
git commit -m "$(cat <<'EOF'
feat(generate): allow Edit + Read tools, raise max-turns for 2-step flow

All three generate paths (non-reference, HTML ref, image ref) now share
the Write,Edit,Read allowlist required for Step 2 to edit the skeleton
Step 1 wrote. Max-turns raised from 5/5/8 to 10/10/12 to absorb Claude's
natural tendency to split Step 2 into multiple Edit calls.
EOF
)"
```

---

## Phase 3 — JSX validator utility

**Commit boundary at end of phase.** Independent module; does nothing on its own until Phase 4 wires it in.

### Task 3.1: Write validator tests

**Files:**
- Create: `scripts/__tests__/unit/validate-app-jsx.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
/**
 * Tests for validateAppJsx — parse-check app.jsx using Bun.Transpiler.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { validateAppJsx } from '../../lib/validate-app-jsx.ts';

const TMP = join(import.meta.dirname, '.tmp-validate-test');

beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('validateAppJsx', () => {
  it('returns ok for a minimal valid component', () => {
    const p = join(TMP, 'app.jsx');
    writeFileSync(p, 'function App() { return <div>Hi</div>; }\nexport default App;');
    expect(validateAppJsx(p)).toEqual({ ok: true });
  });

  it('returns ok for JSX that uses TinyBase-style globals (no imports)', () => {
    const p = join(TMP, 'app.jsx');
    writeFileSync(p, `
      function App() {
        const ids = useRowIds('todos');
        return <ul>{ids.map(id => <li key={id} />)}</ul>;
      }
      export default App;
    `);
    expect(validateAppJsx(p)).toEqual({ ok: true });
  });

  it('returns not-ok with error for unclosed JSX tag', () => {
    const p = join(TMP, 'app.jsx');
    writeFileSync(p, 'function App() { return <div>Hi; }\nexport default App;');
    const r = validateAppJsx(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it('returns not-ok for unterminated template literal', () => {
    const p = join(TMP, 'app.jsx');
    writeFileSync(p, 'const s = `hello world');
    const r = validateAppJsx(p);
    expect(r.ok).toBe(false);
  });

  it('truncates long error messages to 500 chars', () => {
    const p = join(TMP, 'app.jsx');
    writeFileSync(p, '(' .repeat(2000));
    const r = validateAppJsx(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd scripts && npm run test:unit -- validate-app-jsx`
Expected: FAIL — `validateAppJsx` module not found.

### Task 3.2: Implement the validator

**Files:**
- Create: `scripts/lib/validate-app-jsx.ts`

- [ ] **Step 1: Create the module**

```typescript
/**
 * Parse-check app.jsx using Bun.Transpiler in JSX mode.
 *
 * Called from the generate flow after each successful Write/Edit tool_result
 * to decide whether to emit preview_reload (file is parseable, iframe can
 * safely refresh) or preview_reload_failed (last-known-good render should
 * stay on screen).
 *
 * Note: this is a syntax-only check. It does not catch React runtime errors,
 * missing globals, or broken prop shapes — the in-browser Babel load in the
 * preview iframe is the final arbiter for those.
 */

import { readFileSync } from 'fs';

export type ValidateResult = { ok: true } | { ok: false; error: string };

export function validateAppJsx(path: string): ValidateResult {
  try {
    const code = readFileSync(path, 'utf-8');
    new Bun.Transpiler({ loader: 'jsx' }).transformSync(code);
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { ok: false, error: msg.slice(0, 500) };
  }
}
```

- [ ] **Step 2: Run the tests**

Run: `cd scripts && npm run test:unit -- validate-app-jsx`
Expected: all 5 tests PASS.

### Task 3.3: Commit Phase 3

- [ ] **Step 1: Commit**

```bash
git add scripts/lib/validate-app-jsx.ts scripts/__tests__/unit/validate-app-jsx.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): add validateAppJsx parse-check helper

Uses Bun.Transpiler in JSX mode as a fast, parse-only sanity check.
Consumed by the bridge in Phase 4 to decide whether to fire
preview_reload or preview_reload_failed after each Write/Edit tool_result.
EOF
)"
```

---

## Phase 4 — Bridge event emission

**Commit boundary at end of phase.** Telemetry and UI events are emitted; no UI consumer yet (Phase 6 adds that). This phase is safe to ship alone — unknown events are ignored by the current editor.

### Task 4.1: Add import + state for the new events in runOneShot

**Files:**
- Modify: `scripts/server/claude-bridge.ts`

- [ ] **Step 1: Add the import at the top of the file, near other lib imports**

Find the existing imports (around lines 11-13):

```typescript
import { createStreamParser } from '../lib/stream-parser.js';
import { buildPersistentArgs, resolveClaudeBin, cleanEnv } from '../lib/claude-subprocess.js';
import { translateStreamEvent } from './event-translator.ts';
```

Add after them:

```typescript
import { validateAppJsx } from '../lib/validate-app-jsx.ts';
```

- [ ] **Step 2: Add a `toolUseSeen` counter and a `currentStage` tracker to runOneShot**

In `runOneShot`, find the existing counters block (around line 445):

```typescript
  let stderrBuffer = '';
  let resultText = '';
  let toolsUsed = 0;
  let hasEdited = false;
  let errorSent = false;
  let hitMaxTokens = false;
  const startTime = Date.now();
```

Add two lines:

```typescript
  let stderrBuffer = '';
  let resultText = '';
  let toolsUsed = 0;
  let hasEdited = false;
  let errorSent = false;
  let hitMaxTokens = false;
  let toolUseSeen = 0; // counts Write/Edit tool_use events; drives generation_stage transitions
  let currentStage: 'reading_reference' | 'foundation' | 'interactions' | null = null;
  const startTime = Date.now();
```

### Task 4.2: Emit `generation_stage: interactions` on the second Write/Edit tool_use

**Files:**
- Modify: `scripts/server/claude-bridge.ts` (inside `runOneShot`'s stream parser)

- [ ] **Step 1: Update the tool_use block-processing branch**

Find the existing `block.type === 'tool_use'` handling (around line 517):

```typescript
      for (const block of event.message.content) {
        if (block.type === 'tool_use') {
          toolsUsed++;
          const toolName = block.name || '';
          if (toolName === 'Edit' || toolName === 'Write') hasEdited = true;
          const inputSummary = summarizeInput(block);

          if (block.id) {
            pendingTools.set(block.id, { name: toolName, filePath: inputSummary });
          }

          onEvent({ type: 'tool_detail', name: toolName, input_summary: inputSummary, elapsed });
          onEvent({ type: 'progress', ...calcProgressLocal(), elapsed });
        }
```

Replace with:

```typescript
      for (const block of event.message.content) {
        if (block.type === 'tool_use') {
          toolsUsed++;
          const toolName = block.name || '';
          if (toolName === 'Edit' || toolName === 'Write') hasEdited = true;
          const inputSummary = summarizeInput(block);

          if (block.id) {
            pendingTools.set(block.id, { name: toolName, filePath: inputSummary });
          }

          // Advance the generation stage on Write/Edit boundaries. Read tool
          // uses don't count — they're setup, not a step boundary.
          if (toolName === 'Write' || toolName === 'Edit') {
            toolUseSeen++;
            if (toolUseSeen === 1 && currentStage === 'reading_reference') {
              currentStage = 'foundation';
              onEvent({ type: 'generation_stage', stage: 'foundation' });
            } else if (toolUseSeen === 2) {
              currentStage = 'interactions';
              onEvent({ type: 'generation_stage', stage: 'interactions' });
            }
          }

          onEvent({ type: 'tool_detail', name: toolName, input_summary: inputSummary, elapsed });
          onEvent({ type: 'progress', ...calcProgressLocal(), elapsed });
        }
```

### Task 4.3: Emit `preview_reload` / `preview_reload_failed` on tool_result

**Files:**
- Modify: `scripts/server/claude-bridge.ts` (inside the tool_result branch)

- [ ] **Step 1: Add validator-gated emission**

Find the existing `event.type === 'tool_result'` branch (around line 530):

```typescript
    } else if (event.type === 'tool_result') {
      const toolDetail = event.tool_use_id ? pendingTools.get(event.tool_use_id) : undefined;
      if (event.tool_use_id) pendingTools.delete(event.tool_use_id);

      onEvent({
        type: 'tool_result',
        name: event.tool_name || '',
        content: (typeof event.content === 'string' ? event.content : JSON.stringify(event.content || '')).slice(0, 500),
        is_error: !!event.is_error,
        elapsed,
        _filePath: toolDetail?.filePath || '',
        _toolName: toolDetail?.name || event.tool_name || '',
      });
    }
```

Replace with:

```typescript
    } else if (event.type === 'tool_result') {
      const toolDetail = event.tool_use_id ? pendingTools.get(event.tool_use_id) : undefined;
      if (event.tool_use_id) pendingTools.delete(event.tool_use_id);

      onEvent({
        type: 'tool_result',
        name: event.tool_name || '',
        content: (typeof event.content === 'string' ? event.content : JSON.stringify(event.content || '')).slice(0, 500),
        is_error: !!event.is_error,
        elapsed,
        _filePath: toolDetail?.filePath || '',
        _toolName: toolDetail?.name || event.tool_name || '',
      });

      // After a successful Write/Edit, parse-check app.jsx. If it parses,
      // signal the UI to refresh the preview iframe. If it fails, surface
      // the error without reloading — the last-known-good render stays.
      const wasWriteOrEdit = toolDetail?.name === 'Write' || toolDetail?.name === 'Edit';
      const targetedAppJsx = typeof toolDetail?.filePath === 'string' && toolDetail.filePath.endsWith('app.jsx');
      if (wasWriteOrEdit && targetedAppJsx && !event.is_error) {
        const v = validateAppJsx(toolDetail!.filePath);
        if (v.ok) {
          onEvent({ type: 'preview_reload' });
        } else {
          onEvent({
            type: 'preview_reload_failed',
            stage: currentStage === 'interactions' ? 'interactions' : 'foundation',
            error: v.error,
          });
        }
      }
    }
```

### Task 4.4: Add `appJsxValid` to the complete event

**Files:**
- Modify: `scripts/server/claude-bridge.ts` (near the end of runOneShot)

- [ ] **Step 1: Add a final validation + field on complete**

Find the block near the end of `runOneShot` (around line 625):

```typescript
  if (!errorSent) {
    onEvent({
      type: 'complete',
      text: resultText || 'Done.',
      toolsUsed,
      elapsed: getElapsed(),
      hasEdited,
      skipChat: opts.skipChat,
      maxTokensHit: hitMaxTokens,
    });
  }
```

Replace with:

```typescript
  let appJsxValid: boolean | undefined = undefined;
  if (hasEdited && opts.cwd) {
    const appPath = `${opts.cwd}/app.jsx`;
    try {
      appJsxValid = validateAppJsx(appPath).ok;
    } catch {
      appJsxValid = false;
    }
  }

  if (!errorSent) {
    onEvent({
      type: 'complete',
      text: resultText || 'Done.',
      toolsUsed,
      elapsed: getElapsed(),
      hasEdited,
      skipChat: opts.skipChat,
      maxTokensHit: hitMaxTokens,
      appJsxValid,
    });
  }
```

### Task 4.5: Emit initial `generation_stage` from generate handler

**Files:**
- Modify: `scripts/server/handlers/generate.ts`

- [ ] **Step 1: Emit the pre-run stage event**

Find the `runOneShot` call sites (lines 60-64 after Task 2.1's edits). Insert a `generation_stage` emission right before them:

```typescript
if (result.isReference) {
  const maxTurns = result.isHtmlRef ? 10 : 12;
  console.log(`[Generate] Starting (reference path) — ref: ${reference.name} (${result.referenceIntent}), prompt: ${(result.prompt.length / 1024).toFixed(1)}KB`);
  onEvent({ type: 'generation_stage', stage: 'reading_reference' });
  await runOneShot(result.prompt, { lockType: 'generate', skipChat: true, maxTurns, model, cwd: appDir, tools: 'Write,Edit,Read' }, onEvent, ctx.projectRoot);
} else {
  console.log(`[Generate] Starting — theme: ${result.themeId} (${result.themeName}), prompt: ${(result.prompt.length / 1024).toFixed(1)}KB`);
  onEvent({ type: 'generation_stage', stage: 'foundation' });
  await runOneShot(result.prompt, { lockType: 'generate', skipChat: true, maxTurns: 10, model, cwd: appDir, tools: 'Write,Edit,Read' }, onEvent, ctx.projectRoot);
}
```

### Task 4.6: Thread `currentStage` into runOneShot via opts

**Files:**
- Modify: `scripts/server/claude-bridge.ts`

The generate handler emitted the initial stage, but runOneShot needs to know the starting stage so its first-tool-use logic knows whether to advance to `foundation` or not.

- [ ] **Step 1: Add an `initialStage` field to `OneShotOpts`**

Find `OneShotOpts`:

```typescript
export interface OneShotOpts {
  maxTurns?: number;
  model?: string;
  tools?: string;
  cwd?: string;
  skipChat?: boolean;
  permissionMode?: string;
  /** Operation type for the lock (default: 'chat'). Set to false to skip auto-locking. */
  lockType?: string | false;
}
```

Add one field:

```typescript
export interface OneShotOpts {
  maxTurns?: number;
  model?: string;
  tools?: string;
  cwd?: string;
  skipChat?: boolean;
  permissionMode?: string;
  /** Operation type for the lock (default: 'chat'). Set to false to skip auto-locking. */
  lockType?: string | false;
  /** Initial generation_stage, used by the tool_use counter to decide when
   * to emit the foundation → interactions transition. Only passed by the
   * generate handler; chat/theme paths leave it undefined. */
  initialStage?: 'reading_reference' | 'foundation';
}
```

- [ ] **Step 2: Initialize `currentStage` from opts**

Change the declaration to seed from opts:

```typescript
  let currentStage: 'reading_reference' | 'foundation' | 'interactions' | null = opts.initialStage ?? null;
```

- [ ] **Step 3: Pass `initialStage` from generate.ts**

Update the two `runOneShot` calls in `handleGenerate`:

```typescript
if (result.isReference) {
  const maxTurns = result.isHtmlRef ? 10 : 12;
  console.log(`[Generate] Starting (reference path) — ref: ${reference.name} (${result.referenceIntent}), prompt: ${(result.prompt.length / 1024).toFixed(1)}KB`);
  onEvent({ type: 'generation_stage', stage: 'reading_reference' });
  await runOneShot(result.prompt, { lockType: 'generate', skipChat: true, maxTurns, model, cwd: appDir, tools: 'Write,Edit,Read', initialStage: 'reading_reference' }, onEvent, ctx.projectRoot);
} else {
  console.log(`[Generate] Starting — theme: ${result.themeId} (${result.themeName}), prompt: ${(result.prompt.length / 1024).toFixed(1)}KB`);
  onEvent({ type: 'generation_stage', stage: 'foundation' });
  await runOneShot(result.prompt, { lockType: 'generate', skipChat: true, maxTurns: 10, model, cwd: appDir, tools: 'Write,Edit,Read', initialStage: 'foundation' }, onEvent, ctx.projectRoot);
}
```

### Task 4.7: Emit `reference_preview` from generate handler

**Files:**
- Modify: `scripts/server/handlers/generate.ts`

- [ ] **Step 1: Emit the reference preview event for HTML and image references**

Text-file references (.txt/.md/.csv/.tsv/.json/.xml/.rtf) are deliberately **not** shown in the preview — their textual content doesn't visualize usefully, and the user already saw the content when they uploaded it. The event is emitted only for HTML and image refs, and only if the file is findable under `.vibes-tmp/`.

Just before the `onEvent({ type: 'generation_stage', stage: 'reading_reference' })` line added in Task 4.5, add:

```typescript
  const refName = reference?.name as string | undefined;
  const isTextRef = !!refName && /\.(txt|md|csv|tsv|json|xml|rtf)$/i.test(refName);
  if (refName && !isTextRef) {
    const refKind = result.isHtmlRef ? 'html' : 'image';
    const vibesTmpPath = join(ctx.projectRoot, '.vibes-tmp', refName);
    if (existsSync(vibesTmpPath)) {
      onEvent({
        type: 'reference_preview',
        src: `/reference-frame?name=${encodeURIComponent(refName)}&kind=${refKind}`,
      });
    }
  }
  onEvent({ type: 'generation_stage', stage: 'reading_reference' });
```

Make sure `join` and `existsSync` are imported at the top of `generate.ts` — they already are for the existing `assembleAppFrame` function.

### Task 4.8: Run the full test suite

- [ ] **Step 1: Run tests**

Run: `cd scripts && npm run test:unit`
Expected: all tests pass. No new tests added yet for bridge emissions — those are covered by the integration-style fixture test in Task 4.9.

### Task 4.9: Add a bridge event-ordering unit test

**Files:**
- Create: `scripts/__tests__/unit/generation-events.test.ts`

- [ ] **Step 1: Create a test using a fake stream to verify event order**

```typescript
/**
 * Verify that runOneShot's stream parser emits the right sequence of
 * generation_stage and preview_reload events given synthetic stream-json
 * input for a 2-step generation.
 */
import { describe, it, expect } from 'vitest';
import { createStreamParser } from '../../lib/stream-parser.js';
// Note: this test exercises the stream parser + translator contract used
// by runOneShot. The full runOneShot has subprocess side effects, so we
// test the event-emission logic by feeding synthetic events through a
// helper that mirrors runOneShot's parse dispatch. Keep this test in lock-step
// with the dispatch in claude-bridge.ts#runOneShot.

// If runOneShot's parse callback is refactored into a pure helper later,
// import that helper directly. For now, we assert the sequence by
// hand-rolling the same dispatch logic — this is a known duplication
// acceptable for testing until the helper is extracted.

describe('2-step generation event sequence', () => {
  it.skip('pending extraction of parse dispatch into a pure helper', () => {
    // Placeholder: extraction of the parse-dispatch logic from runOneShot
    // into a testable pure function is a follow-up. For now, the bridge
    // code is exercised by the existing stream-parser tests plus manual
    // verification from the implementation plan's Phase 7 manual checklist.
    expect(true).toBe(true);
  });
});
```

Note: a thorough unit test of runOneShot's emission sequence would require extracting the `parse` callback body into a pure function. That's a worthwhile refactor but deferred to avoid scope creep. The manual test checklist in Phase 7 covers this end-to-end.

### Task 4.10: Commit Phase 4

- [ ] **Step 1: Commit**

```bash
git add scripts/server/claude-bridge.ts scripts/server/handlers/generate.ts scripts/__tests__/unit/generation-events.test.ts
git commit -m "$(cat <<'EOF'
feat(bridge): emit generation_stage, preview_reload, reference_preview

The generate handler now emits a reference_preview event (for reference
paths) and an initial generation_stage before runOneShot starts. Inside
runOneShot, a tool_use counter drives generation_stage transitions
(reading_reference → foundation → interactions), and each successful
Write/Edit tool_result fires either preview_reload (if app.jsx parses)
or preview_reload_failed (if it doesn't). The complete event gains an
appJsxValid field for final validity.

No UI consumer yet — unknown events are ignored by the current editor
and the server-side signal is immediately useful for logs/telemetry.
Phase 6 wires the editor UI.
EOF
)"
```

---

## Phase 5 — `/reference-frame` route

**Commit boundary at end of phase.** Serves the reference asset; consumed by UI in Phase 6.

### Task 5.1: Write tests for the reference-frame handler

**Files:**
- Create: `scripts/__tests__/unit/reference-frame.test.ts`

- [ ] **Step 1: Create the test**

```typescript
/**
 * Tests for the /reference-frame route handler.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { serveReferenceFrame } from '../../server/handlers/reference-frame.ts';

const TMP = join(import.meta.dirname, '.tmp-refframe-test');

function makeCtx() {
  return { projectRoot: TMP } as any;
}

beforeEach(() => {
  mkdirSync(join(TMP, '.vibes-tmp'), { recursive: true });
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('serveReferenceFrame', () => {
  it('serves an HTML reference as-is with text/html content-type', async () => {
    writeFileSync(join(TMP, '.vibes-tmp', 'ref.html'), '<p>hi</p>');
    const url = new URL('http://localhost/reference-frame?name=ref.html&kind=html');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<p>hi</p>');
  });

  it('wraps an image reference in a full-bleed HTML shell', async () => {
    writeFileSync(join(TMP, '.vibes-tmp', 'ref.png'), 'fake-png-bytes');
    const url = new URL('http://localhost/reference-frame?name=ref.png&kind=image');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<img');
    expect(body).toContain('src="/reference-frame?name=ref.png&kind=raw"');
    expect(body).toContain('object-fit:contain');
  });

  it('returns the raw image bytes when kind=raw', async () => {
    const bytes = Buffer.from([137, 80, 78, 71]); // PNG magic
    writeFileSync(join(TMP, '.vibes-tmp', 'ref.png'), bytes);
    const url = new URL('http://localhost/reference-frame?name=ref.png&kind=raw');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/');
  });

  it('rejects path traversal attempts', () => {
    const url = new URL('http://localhost/reference-frame?name=..%2Fetc%2Fpasswd&kind=html');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(400);
  });

  it('rejects missing name', () => {
    const url = new URL('http://localhost/reference-frame?kind=html');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(400);
  });

  it('returns 404 for a name that does not exist on disk', () => {
    const url = new URL('http://localhost/reference-frame?name=nonexistent.html&kind=html');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd scripts && npm run test:unit -- reference-frame`
Expected: FAIL — handler not found.

### Task 5.2: Implement the reference-frame handler

**Files:**
- Create: `scripts/server/handlers/reference-frame.ts`

- [ ] **Step 1: Create the handler**

```typescript
/**
 * GET /reference-frame — serve the user-uploaded reference asset inside
 * an iframe-friendly wrapper so the preview iframe can show it while
 * Claude is analyzing it in Step 1 of generation.
 *
 * Supported kinds:
 *   - html: serve the file as-is with text/html (for HTML references)
 *   - image: wrap the image in a minimal full-bleed HTML shell
 *   - raw: return the raw file bytes (used by the image shell's <img src>)
 *
 * Security: the `name` query parameter is validated to be a plain filename
 * (no slashes, no ..). The file is looked up only under the known reference
 * directory (.vibes-tmp/) relative to projectRoot.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { ServerContext } from '../config.ts';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': `http://localhost:3333`,
    'Vary': 'Origin',
  };
}

function isSafeName(name: string): boolean {
  return !!name && !name.includes('/') && !name.includes('\\') && !name.includes('..') && name.length <= 200;
}

function contentTypeFor(name: string): string {
  const ext = extname(name).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    case '.avif': return 'image/avif';
    default: return 'application/octet-stream';
  }
}

export function serveReferenceFrame(ctx: ServerContext, url: URL): Response {
  const name = url.searchParams.get('name') || '';
  const kind = url.searchParams.get('kind') || '';

  if (!isSafeName(name)) {
    return new Response('Bad Request', { status: 400, headers: corsHeaders() });
  }

  const refDir = join(ctx.projectRoot, '.vibes-tmp');
  const filePath = join(refDir, name);
  if (!filePath.startsWith(refDir + '/')) {
    return new Response('Bad Request', { status: 400, headers: corsHeaders() });
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return new Response('Not Found', { status: 404, headers: corsHeaders() });
  }

  if (kind === 'html') {
    const body = readFileSync(filePath, 'utf-8');
    return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() } });
  }

  if (kind === 'raw') {
    const bytes = readFileSync(filePath);
    return new Response(bytes, { headers: { 'Content-Type': contentTypeFor(name), ...corsHeaders() } });
  }

  // kind === 'image' (or default): wrap in a minimal full-bleed shell
  const rawSrc = `/reference-frame?name=${encodeURIComponent(name)}&kind=raw`;
  const shell = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <style>
    html,body { margin:0; padding:0; height:100%; background:#000; }
    img { display:block; width:100%; height:100%; object-fit:contain; }
  </style>
</head>
<body><img src="${rawSrc}" alt="reference"></body></html>`;
  return new Response(shell, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() } });
}
```

- [ ] **Step 2: Run the tests**

Run: `cd scripts && npm run test:unit -- reference-frame`
Expected: all 6 tests PASS.

### Task 5.3: Register the route in router.ts

**Files:**
- Modify: `scripts/server/router.ts`

- [ ] **Step 1: Add the import**

Find the existing handler imports near the top (around line 15):

```typescript
import { assembleAppFrame } from './handlers/generate.ts';
```

Add after it:

```typescript
import { serveReferenceFrame } from './handlers/reference-frame.ts';
```

- [ ] **Step 2: Register the route**

Find the route switch (around line 868):

```typescript
      case 'GET /app-frame':                return serveAppFrame(ctx, url);
```

Add a line right after it:

```typescript
      case 'GET /app-frame':                return serveAppFrame(ctx, url);
      case 'GET /reference-frame':          return serveReferenceFrame(ctx, url);
```

### Task 5.4: Commit Phase 5

- [ ] **Step 1: Commit**

```bash
git add scripts/server/handlers/reference-frame.ts scripts/server/router.ts scripts/__tests__/unit/reference-frame.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add /reference-frame route for live reference preview

New GET /reference-frame route serves the user-uploaded reference asset
(image or HTML) inside an iframe-friendly wrapper. Consumed by the editor
UI (next phase) to show the reference while Claude is analyzing it in
Step 1 of generation.

Security: name param must be a plain filename; lookup is scoped to the
.vibes-tmp/ directory under projectRoot.
EOF
)"
```

---

## Phase 6 — Editor UI

**Commit boundary at end of phase.** UI consumes the events; full UX lands.

Implementation note: the editor is a single-file template at `skills/vibes/templates/editor.html`. The WebSocket `onmessage` handler is around line 4205. The preview iframe has `id="previewFrame"` at line 3175. All edits in this phase are to that file.

### Task 6.1: Add the overlay DOM

**Files:**
- Modify: `skills/vibes/templates/editor.html`

- [ ] **Step 1: Find the preview iframe markup**

Search for `id="previewFrame"` (line 3175-ish). The surrounding markup looks roughly like:

```html
<iframe class="preview-iframe" id="previewFrame" src="about:blank"></iframe>
```

- [ ] **Step 2: Wrap it in a positioned container and add the overlay**

Replace the iframe line with:

```html
<div class="preview-container" id="previewContainer" style="position:relative; width:100%; height:100%;">
  <iframe class="preview-iframe" id="previewFrame" src="about:blank"></iframe>
  <div class="preview-overlay" id="previewOverlay" hidden>
    <div class="preview-overlay-card" id="previewOverlayCard">
      <div class="preview-overlay-spinner"></div>
      <div class="preview-overlay-text" id="previewOverlayText">Starting...</div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add overlay CSS in the existing `<style>` block**

Find the CSS block (the file has one large `<style>` near the top — search for `.preview-iframe {`). Add after it:

```css
.preview-overlay {
  position: absolute;
  inset: 0;
  background: rgba(10, 10, 10, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto; /* absorb clicks on the skeleton */
  z-index: 10;
  transition: opacity 120ms ease;
}
.preview-overlay[hidden] { display: none; }
.preview-overlay-card {
  background: rgba(24, 24, 28, 0.9);
  color: #eaeaea;
  padding: 14px 20px;
  border-radius: 10px;
  font: 500 13px/1.4 system-ui, sans-serif;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.preview-overlay-card.error { background: rgba(80, 30, 30, 0.92); }
.preview-overlay-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.25);
  border-top-color: #fff;
  border-radius: 50%;
  animation: preview-overlay-spin 0.8s linear infinite;
}
.preview-overlay-card.error .preview-overlay-spinner { display: none; }
@keyframes preview-overlay-spin { to { transform: rotate(360deg); } }
```

### Task 6.2: Add overlay state + helpers in the editor JS

**Files:**
- Modify: `skills/vibes/templates/editor.html`

- [ ] **Step 1: Find a sensible place to add the helper functions**

Search for `ws.onmessage = (event) =>` (around line 4205). Add the following helper block immediately before it:

```javascript
// --- Generation overlay state ---
const OVERLAY_COPY = {
  reading_reference: 'Analyzing reference — extracting design...',
  foundation: 'Step 1 of 2 — Foundation',
  interactions: 'Step 2 of 2 — Building interactions and polish',
  preview_reload_failed_foundation: 'Step 1 produced a syntax error — waiting for retry...',
  preview_reload_failed_interactions: 'Step 2 produced a syntax error — continuing...',
};

let overlayCurrentStage = null;
let overlayInError = false;

function setOverlayVisible(visible) {
  const o = document.getElementById('previewOverlay');
  if (!o) return;
  if (visible) { o.hidden = false; } else { o.hidden = true; }
}

function setOverlayText(text, isError) {
  const t = document.getElementById('previewOverlayText');
  const card = document.getElementById('previewOverlayCard');
  if (t) t.textContent = text;
  if (card) card.classList.toggle('error', !!isError);
}

function handleGenerationStage(stage) {
  overlayCurrentStage = stage;
  if (overlayInError && stage === 'interactions') {
    // Recovery: a new stage event clears the error state
    overlayInError = false;
  }
  if (!overlayInError) {
    setOverlayText(OVERLAY_COPY[stage] || stage, false);
    setOverlayVisible(true);
  }
}

function handlePreviewReload() {
  // Cache-bust the preview iframe. If we were showing the reference asset,
  // this is also the cue to swap back to /app-frame. Reuse the exact
  // appParam derivation pattern used elsewhere in this file (see the existing
  // reload call site around line 5066) — currentProjectDir is a full path,
  // not an app name, so we derive `name` from it.
  const frame = document.getElementById('previewFrame');
  if (!frame) return;
  if (overlayInError) overlayInError = false; // recovery: successful reload clears error
  const name = currentProjectDir ? currentProjectDir.split('/').pop() : currentAppName;
  const appParam = name ? 'app=' + encodeURIComponent(name) + '&' : '';
  frame.src = '/app-frame?' + appParam + 't=' + Date.now();
  // After a successful reload, restore the normal overlay copy for the current stage
  if (overlayCurrentStage) setOverlayText(OVERLAY_COPY[overlayCurrentStage] || overlayCurrentStage, false);
}

function handlePreviewReloadFailed(stage) {
  overlayInError = true;
  const key = 'preview_reload_failed_' + stage;
  setOverlayText(OVERLAY_COPY[key] || 'Syntax error — continuing...', true);
}

function handleReferencePreview(src) {
  const frame = document.getElementById('previewFrame');
  if (!frame) return;
  frame.src = src;
}

function handleGenerationComplete(appJsxValid) {
  setOverlayVisible(false);
  overlayCurrentStage = null;
  overlayInError = false;
  if (appJsxValid === false) {
    // Surface a persistent error chip / toast — project-specific UI hook.
    // For now, just log; a later polish pass can attach to the existing toast system.
    console.warn('[generate] app.jsx did not pass final validation');
  }
}
```

Note: references to `currentProjectDir` match the existing editor — it's the module-level variable used elsewhere (e.g., the existing `frame.src = '/app-frame?' + appParam + 't=' + Date.now()` pattern at lines 5068/5092). If naming differs slightly in this file, use the same variable that those existing reload sites use.

### Task 6.3: Wire the new events into the WebSocket handler

**Files:**
- Modify: `skills/vibes/templates/editor.html`

- [ ] **Step 1: Find the `ws.onmessage` handler**

Search for `ws.onmessage = (event) =>` (~line 4205). Immediately inside its body, after the JSON parse and logging, add the new event dispatches. The existing handler starts like:

```javascript
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type !== 'token') console.log('[WS-IN]', msg.type, ...);
  // ... existing branches for 'complete', 'token', 'tool_result', etc.
```

Add a new early dispatch block right after the console.log and before the first existing `if`/`else if`:

```javascript
  // --- Direction D multi-turn generation events ---
  if (msg.type === 'generation_stage') {
    handleGenerationStage(msg.stage);
    return;
  }
  if (msg.type === 'preview_reload') {
    handlePreviewReload();
    return;
  }
  if (msg.type === 'preview_reload_failed') {
    handlePreviewReloadFailed(msg.stage);
    return;
  }
  if (msg.type === 'reference_preview') {
    handleReferencePreview(msg.src);
    return;
  }
```

- [ ] **Step 2: Hook the existing `complete` branch to dismiss the overlay**

Find the existing `if (msg.type === 'complete')` branch in the same handler (around line 4212 or 4269). At the top of that branch, add:

```javascript
  if (msg.type === 'complete') {
    handleGenerationComplete(msg.appJsxValid);
    // ... existing complete logic continues below
```

Do not remove any existing logic in the complete branch.

### Task 6.4: Manual smoke test

- [ ] **Step 1: Start the server**

```bash
cd /Users/marcusestes/Websites/VibesCLI/VibesOS
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(pwd)}"
bun "$VIBES_ROOT/scripts/server.ts" --mode=editor &
```

Expected: server listens on localhost:3333.

- [ ] **Step 2: Generate a non-reference app**

Open the editor in a browser. Submit a prompt like "a simple todo list".

Expected:
- Overlay appears immediately with "Step 1 of 2 — Foundation"
- After ~10-15s the iframe updates to show a skeleton (header, empty content area, theme colors visible)
- Overlay changes to "Step 2 of 2 — Building interactions and polish"
- Eventually the iframe updates to the complete app
- Overlay dismisses

- [ ] **Step 3: Generate an image-reference app**

Upload an image and submit a prompt like "an app with this vibe".

Expected:
- Overlay: "Analyzing reference — extracting design..."
- Iframe shows the uploaded image (full-bleed, black background)
- Overlay: "Step 1 of 2 — Foundation"
- Iframe swaps to the skeleton
- Overlay: "Step 2 of 2 — Building interactions and polish"
- Iframe updates to complete app
- Overlay dismisses

- [ ] **Step 4: Verify the overlay absorbs clicks on the skeleton**

Between Step 1 and Step 2 completion, click on the preview iframe. The overlay should absorb the clicks — nothing inside the iframe responds.

- [ ] **Step 5: Stop the server**

Bring the backgrounded `server.ts` to the foreground and Ctrl-C, or find the process and terminate it.

### Task 6.5: Commit Phase 6

- [ ] **Step 1: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "$(cat <<'EOF'
feat(editor): wire multi-turn generation UI — staged preview + overlay

Adds an overlay to the preview iframe that communicates generation
progress (Analyzing reference / Step 1 / Step 2) and absorbs clicks so
users can't interact with a partially-wired skeleton. Handles four new
bridge events: generation_stage (overlay copy), preview_reload (iframe
cache-bust), preview_reload_failed (non-fatal error state), and
reference_preview (swap iframe src to reference asset).

On complete, the overlay dismisses; if appJsxValid is false, the final
state is a warning log (full toast integration is a future polish).
EOF
)"
```

---

## Phase 7 — Version bump + final verification

**Final commit boundary.**

### Task 7.1: Bump plugin version

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Read the current version from plugin.json**

```bash
grep '"version"' /Users/marcusestes/Websites/VibesCLI/VibesOS/.claude-plugin/plugin.json
```

Expected: shows `"version": "0.2.15"` or similar.

- [ ] **Step 2: Update plugin.json to 0.3.0**

Edit the file and change the `version` field to `"0.3.0"`. Keep the rest untouched.

- [ ] **Step 3: Update marketplace.json to 0.3.0**

In `.claude-plugin/marketplace.json`, update the top-level `"version"` field (or the plugin entry's version field — follow whatever the existing file structure is) to `"0.3.0"`.

- [ ] **Step 4: Verify with grep**

```bash
grep '"version"' /Users/marcusestes/Websites/VibesCLI/VibesOS/.claude-plugin/plugin.json /Users/marcusestes/Websites/VibesCLI/VibesOS/.claude-plugin/marketplace.json
```

Expected: both show `0.3.0`.

### Task 7.2: Run the full test suite

- [ ] **Step 1: Run all tests**

```bash
cd /Users/marcusestes/Websites/VibesCLI/VibesOS/scripts && npm test
```

Expected: all unit tests pass, including the new `prompt-builders` DRY assertions, `validate-app-jsx` suite, and `reference-frame` suite. No regressions in the existing 694 tests.

### Task 7.3: Run the E2E test

- [ ] **Step 1: Run the vibes E2E test**

This invokes the `/vibes:test` skill, which assembles a fixture and deploys to Cloudflare.

Expected: the test passes and presents a live URL.

### Task 7.4: Manual verification checklist

Per the spec, run through these manual checks:

- [ ] **Non-reference simple app** — prompt: "a todo list with categories". Watch preview update twice, verify overlay copy advances correctly.
- [ ] **Image-reference, intent=match** — upload a distinctive image. Verify reference shows first, then skeleton, then complete app. Verify the generated app's colors match the image.
- [ ] **HTML-reference** — upload a small HTML file with inline CSS. Same three-phase reveal.
- [ ] **Text-reference, intent=seed** — upload a small CSV. Verify seeding logic ends up in Step 2's Edit (check app.jsx after generation).
- [ ] **Force a syntax error** — temporarily modify the prompt to include `Deliberately emit a typo like "function App)" in step 1 to test error handling`. Re-run generation. Verify `preview_reload_failed` triggers the error overlay copy. Recovery not strictly testable without further contrivance; confirm the overlay state at least flashes correctly. Revert the contrived prompt after.
- [ ] **Compliance check** — in server logs, grep for `preview_reload` events. For each generation you ran, count how many preview_reload events fired. Target: ≥2 per generation. Record the count in your notes.

### Task 7.5: Commit Phase 7

- [ ] **Step 1: Commit**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "$(cat <<'EOF'
chore: bump to 0.3.0 for Direction D multi-turn generation

Generation now uses a two-step prompt (Write skeleton → Edit rest) with
live staged preview UX. See docs/plans/2026-04-23-direction-d-multi-turn-
generation-design.md for the design; PR #68 shipped the companion
max_tokens floor and instrumentation.
EOF
)"
```

### Task 7.6: Push and open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(generate): 2-step app generation with live staged preview" --body "$(cat <<'EOF'
## Summary

Implements Direction D from the [design spec](docs/plans/2026-04-23-direction-d-multi-turn-generation-design.md): Vibes OS app generation is now split into two Claude tool calls (Write skeleton → Edit rest) using Claude Code's native tool loop, which gives each step its own fresh max_tokens budget. Along the way, the preview iframe updates in stages — reference asset → skeleton → complete — with an overlay communicating progress.

- **Prompt rewrite** — new TWO_STEP_INSTRUCTIONS and GLOBAL_STEP_RULES constants shared between reference and non-reference paths; regression test guards DRY.
- **Config** — tools allowlist Write,Edit,Read on all generate paths; max-turns raised to 10/10/12.
- **JSX validator** — Bun.Transpiler parse-check gates preview_reload emission.
- **Bridge events** — new generation_stage, preview_reload, preview_reload_failed, reference_preview events; appJsxValid field on complete.
- **Server route** — new /reference-frame serves the reference asset for the iframe preview.
- **Editor UI** — overlay over the preview iframe, iframe src swap + cache-bust wired to new events.
- **Version** — bumped to 0.3.0.

## Test plan

- [x] All unit tests pass (`cd scripts && npm test`)
- [ ] E2E (`/vibes:test`) passes
- [ ] Manual: non-reference, HTML-ref, image-ref, text-ref seed — each shows the intended staged preview reveal
- [ ] Manual: overlay absorbs clicks on skeleton
- [ ] Manual: syntax error produces preview_reload_failed overlay state
- [ ] Log compliance check: ≥2 preview_reload events per generation in typical use
EOF
)"
```

---

## Self-review checklist (plan writer only, not part of execution)

Before handing off, the plan writer should verify:

1. **Spec coverage.** Every section of the design spec maps to a task:
   - Turn structure → Tasks 1.4, 1.5
   - Prompt rewrite + DRY → Tasks 1.1 through 1.6
   - Bridge + UI plumbing → Phases 4 and 6
   - Config changes → Phase 2
   - Reference-path compatibility → Tasks 4.7, 5.1–5.4, 6.4
   - Rollout + success metrics → Task 7.4 covers manual verification; compliance logging is in Task 7.4's final item
2. **Placeholder scan.** The plan uses code blocks in every code-step. Task 4.9 contains a deliberately-skipped test (pending an acceptable follow-up refactor); that's called out explicitly, not a hidden TODO.
3. **Type consistency.** Event names (`generation_stage`, `preview_reload`, `preview_reload_failed`, `reference_preview`) and the `appJsxValid` field are consistent across bridge emission, UI consumption, and the spec. Stage values (`reading_reference`, `foundation`, `interactions`) match in all three files.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-04-23-direction-d-multi-turn-generation-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
