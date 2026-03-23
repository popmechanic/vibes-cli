# Skill Injection Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragile heading-based SKILL.md extraction with deterministic skill file injection via `--append-system-prompt`, ensuring all framework guidance reaches the editor agent.

**Architecture:** Decompose monolithic SKILL.md into three focused reference files (`generation-rules.md`, `data-api.md`, `style-guide.md`). Read these at bridge spawn time and inject via `--append-system-prompt`. Clean hardcoded duplicates from prompt-builders.ts. Add skill deduplication to the chat bridge.

**Tech Stack:** Bun, Claude CLI (`--append-system-prompt`), Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-skill-injection-architecture-design.md`

**Rollback:** Phases 1–2 (decompose + wire) can coexist with the old prompt-builders code. Phase 3 (cleanup) is the point of no return — only apply after verification. To roll back Phase 3: `git revert` the cleanup commit.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `skills/vibes/references/generation-rules.md` | What generated code must/must not contain, template constraints, sync UI prohibition |
| Create | `skills/vibes/references/style-guide.md` | OKLCH colors, gradients, neobrute, glass morphism |
| Create | `skills/vibes/references/data-api.md` | TinyBase hook reference, data patterns, bug prevention, reference app |
| Modify | `skills/vibes/SKILL.md` | Slim to terminal-mode orchestrator with `Read` directives |
| Modify | `scripts/lib/claude-subprocess.js` | Add `buildSkillAppendix()`, plumb `pluginRoot` into args builders |
| Modify | `scripts/server/claude-bridge.ts` | Pass `pluginRoot` to spawn, add skill dedup state |
| Modify | `scripts/server/config.ts` | Delete `vibesSkillContent` extraction, filter `inject: system-prompt` from skill selector |
| Modify | `scripts/server/prompt-builders.ts` | Delete hardcoded blocks, add RECENCY_REMINDER, refactor buildSkillBlock |
| Create | `scripts/__tests__/unit/skill-appendix.test.ts` | Tests for buildSkillAppendix, skill dedup, frontmatter filtering |

---

### Task 1: Create `references/generation-rules.md`

Extract SKILL.md lines 134–376 into a self-contained reference file with `inject: system-prompt` frontmatter. Also absorb the `TINYBASE_INVARIANT_RULES` and `NON-NEGOTIABLE DATA RULES` content from `prompt-builders.ts` so there is one authoritative source.

**Note on lines 117–133 (Pre-Flight Check):** Lines 117–124 are auth-related ("Auth is automatic — on first deploy...") and stay in SKILL.md as terminal-mode content. Lines 125–133 (platform name disambiguation, import map note) are relevant to the editor agent and go into `generation-rules.md`.

**Files:**
- Create: `skills/vibes/references/generation-rules.md`
- Read: `skills/vibes/SKILL.md:125-376`
- Read: `scripts/server/prompt-builders.ts:19-26` (TINYBASE_INVARIANT_RULES)

- [ ] **Step 1: Read source content**

Read `skills/vibes/SKILL.md` lines 125–376 and `scripts/server/prompt-builders.ts` lines 19–26 (TINYBASE_INVARIANT_RULES constant). Understand what content needs to be extracted.

- [ ] **Step 2: Create the file**

Write `skills/vibes/references/generation-rules.md` with:
- Frontmatter: `name`, `description`, `inject: system-prompt`
- Content from SKILL.md lines 125–376 (platform disambiguation through Assembly Workflow)
- The TINYBASE_INVARIANT_RULES content merged into the "What Generated Code Must Never Contain" list (no duplication)
- The NON-NEGOTIABLE DATA RULES about string literal table names merged in

```yaml
---
name: Generation Rules
description: >
  What generated Vibes app code must and must not contain — imports, store creation,
  sync UI, table name rules, template constraints, theme section markers, assembly workflow.
inject: system-prompt
---
```

- [ ] **Step 3: Verify content completeness**

Grep the new file for key terms that must be present: `SyncStatusDot`, `createStore`, `import`, `useApp`, `string literal`, `assembly`. All must appear.

- [ ] **Step 4: Commit**

```bash
git add skills/vibes/references/generation-rules.md
git commit -m "feat: extract generation-rules.md from SKILL.md"
```

---

### Task 2: Create `references/style-guide.md`

Extract SKILL.md lines 377–451 (UI Style & Theming section).

**Files:**
- Create: `skills/vibes/references/style-guide.md`
- Read: `skills/vibes/SKILL.md:377-451`

- [ ] **Step 1: Read source content**

Read `skills/vibes/SKILL.md` lines 377–451.

- [ ] **Step 2: Create the file**

Write `skills/vibes/references/style-guide.md` with frontmatter:

```yaml
---
name: Style Guide
description: >
  OKLCH color system, design token overrides, gradients, neobrute patterns,
  glass morphism, color modifications, Tailwind integration for Vibes apps.
inject: system-prompt
---
```

- [ ] **Step 3: Commit**

```bash
git add skills/vibes/references/style-guide.md
git commit -m "feat: extract style-guide.md from SKILL.md"
```

---

### Task 3: Create `references/data-api.md`

Extract SKILL.md lines 452–776 (TinyBase Data API through Patterns That Prevent Bugs, including the reference grocery list app).

**Files:**
- Create: `skills/vibes/references/data-api.md`
- Read: `skills/vibes/SKILL.md:452-776`

- [ ] **Step 1: Read source content**

Read `skills/vibes/SKILL.md` lines 452–776. This includes: TinyBase Data API, hook reference, data access patterns, user identity, game/timer patterns, AI features, sharing, reference app, and bug prevention checklist.

- [ ] **Step 2: Create the file**

Write `skills/vibes/references/data-api.md` with frontmatter:

```yaml
---
name: TinyBase Data API
description: >
  TinyBase hook API reference, data access patterns, user identity via useUser(),
  game/timer patterns, AI integration hooks, sharing, reference app, bug prevention checklist.
inject: system-prompt
---
```

- [ ] **Step 3: Verify the reference app is included**

Grep the new file for `Grocery` or `grocerylist` — the reference app must be present.

- [ ] **Step 4: Commit**

```bash
git add skills/vibes/references/data-api.md
git commit -m "feat: extract data-api.md from SKILL.md"
```

---

### Task 4: Slim SKILL.md to terminal-mode orchestrator

Remove the extracted content from SKILL.md and replace with `Read` directives pointing to the new reference files. Keep terminal-mode-only content (auth, step sequence, deployment).

**Files:**
- Modify: `skills/vibes/SKILL.md`

- [ ] **Step 1: Read current SKILL.md**

Read the full file to understand the boundary points.

- [ ] **Step 2: Replace extracted sections with Read directives**

Lines 125–376 become:
```markdown
Read `${CLAUDE_SKILL_DIR}/references/generation-rules.md` for what generated code must/must not contain.
```

Lines 377–451 become:
```markdown
Read `${CLAUDE_SKILL_DIR}/references/style-guide.md` for OKLCH colors, theming, and design token usage.
```

Lines 452–776 become:
```markdown
Read `${CLAUDE_SKILL_DIR}/references/data-api.md` for the complete TinyBase hook API, data patterns, and bug prevention.
```

Keep lines 1–124 (auth, terminal routing), 776–795 (extended docs table — still useful for terminal agents), and 796–841 (deployment, what's next) intact.

- [ ] **Step 3: Verify line count**

The combined line count of `generation-rules.md` + `style-guide.md` + `data-api.md` + slimmed `SKILL.md` should approximately equal the original 841 lines (allowing for frontmatter additions and Read directives).

- [ ] **Step 4: Commit**

```bash
git add skills/vibes/SKILL.md
git commit -m "refactor: slim SKILL.md to terminal-mode orchestrator with Read directives"
```

---

### Task 5: Write tests for `buildSkillAppendix`

Test the new skill file reading and concatenation logic before implementing it.

**Files:**
- Create: `scripts/__tests__/unit/skill-appendix.test.ts`

**Note:** Do NOT use the existing `skill-injection.test.js` — that file tests unrelated skill injection logic (extract-import-map, sell SKILL.md). Use a new file with `.ts` extension to match project conventions.

- [ ] **Step 1: Write the tests**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { join } from 'path';
import { buildSkillAppendix } from '../../lib/claude-subprocess.js';

describe('buildSkillAppendix', () => {
  it('reads all three core reference files and concatenates them', () => {
    const pluginRoot = join(__dirname, '..', '..', '..');
    const result = buildSkillAppendix(pluginRoot);

    expect(result).toContain('EDITOR ENVIRONMENT CONSTRAINTS');
    expect(result).toContain('Generation Rules');  // from generation-rules.md frontmatter
    expect(result).toContain('useRowIds');          // from data-api.md
    expect(result).toMatch(/oklch/i);              // from style-guide.md
  });

  it('warns when a core reference file is missing', () => {
    const spy = vi.spyOn(console, 'warn');
    buildSkillAppendix('/nonexistent/path');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('WARNING: Core reference missing'));
    spy.mockRestore();
  });

  it('logs FATAL when no core files found', () => {
    const spy = vi.spyOn(console, 'error');
    buildSkillAppendix('/nonexistent/path');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('FATAL'));
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/skill-appendix.test.ts`
Expected: FAIL — `buildSkillAppendix` does not exist yet.

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/unit/skill-appendix.test.ts
git commit -m "test: add failing tests for buildSkillAppendix"
```

---

### Task 6: Implement `buildSkillAppendix` and wire `--append-system-prompt`

Add the skill file reading function to `claude-subprocess.js` and pass `--append-system-prompt` in both persistent and one-shot arg builders.

**Files:**
- Modify: `scripts/lib/claude-subprocess.js`

**Note on imports:** `existsSync` is already imported at line 111 (`import { existsSync } from 'fs';`). Add `readFileSync` to this import. `join` is already imported at line 113.

- [ ] **Step 1: Add `readFileSync` to existing import and add `buildSkillAppendix`**

At line 111, change `import { existsSync } from 'fs';` to `import { existsSync, readFileSync } from 'fs';`.

Then add the function before `buildClaudeArgs` (before line 36):

```javascript
const CORE_REFS = ['generation-rules.md', 'data-api.md', 'style-guide.md'];

const EDITOR_ENVIRONMENT = `
EDITOR ENVIRONMENT CONSTRAINTS:
You are running inside the Vibes web editor.
Available tools: Read, Edit, Write, Glob, Grep. No Bash, no terminal, no Agent spawning.
Working directory is the app project root. You are editing app.jsx.
Prioritize Edit calls over analysis — turns are limited.`;

export function buildSkillAppendix(pluginRoot) {
  const loaded = [];
  for (const f of CORE_REFS) {
    const path = join(pluginRoot, 'skills/vibes/references', f);
    if (existsSync(path)) {
      loaded.push(readFileSync(path, 'utf-8'));
    } else {
      console.warn(`[skill-inject] WARNING: Core reference missing: ${path}`);
    }
  }
  if (loaded.length === 0) {
    console.error('[skill-inject] FATAL: No core reference files found. Agent will lack framework guidance.');
  }
  return [EDITOR_ENVIRONMENT, ...loaded].join('\n\n---\n\n');
}
```

- [ ] **Step 2: Add `--append-system-prompt` to `buildPersistentArgs`**

Modify `buildPersistentArgs` (line 98) to accept and use `config.pluginRoot`:

```javascript
export function buildPersistentArgs(config = {}) {
  const args = ['-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--verbose',
  ];

  if (config.pluginRoot) {
    const appendix = buildSkillAppendix(config.pluginRoot);
    if (appendix) {
      args.push('--append-system-prompt', appendix);
    }
  }

  if (config.model) args.push('--model', config.model);
  return args;
}
```

- [ ] **Step 3: Add `--append-system-prompt` to `buildClaudeArgs`**

Inside `buildClaudeArgs` (line 36), after the model check (around line 59), add:

```javascript
if (config.pluginRoot) {
  const appendix = buildSkillAppendix(config.pluginRoot);
  if (appendix) {
    args.push('--append-system-prompt', appendix);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd scripts && npx vitest run __tests__/unit/skill-appendix.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/claude-subprocess.js
git commit -m "feat: add buildSkillAppendix and --append-system-prompt injection"
```

---

### Task 7: Plumb `pluginRoot` through the bridge

Pass `projectRoot` from the server context through to the subprocess builders.

**Files:**
- Modify: `scripts/server/claude-bridge.ts:120` (createBridge signature)
- Modify: `scripts/server/claude-bridge.ts:147-148` (spawn function)
- Modify: `scripts/server/claude-bridge.ts:396-424` (runOneShot — already has `projectRoot` as 4th param)
- Modify: `scripts/server/ws.ts:135` (createBridge call site)

- [ ] **Step 1: Update createBridge to accept pluginRoot**

At `claude-bridge.ts:120`, change the factory signature:

```typescript
export function createBridge(appDir: string, onEvent: EventCallback, pluginRoot?: string): PersistentBridge {
```

- [ ] **Step 2: Pass pluginRoot to buildPersistentArgs**

At `claude-bridge.ts:148`, change:

```typescript
// Before:
const args = buildPersistentArgs({});
// After:
const args = buildPersistentArgs({ pluginRoot });
```

- [ ] **Step 3: Pass pluginRoot in runOneShot**

`runOneShot` already receives `projectRoot` as its 4th parameter (line ~396). Find the `buildClaudeArgs` call (around line 404) and add `pluginRoot`:

```typescript
// Before:
const args = buildClaudeArgs({ outputFormat: 'stream-json', maxTurns: opts.maxTurns, model: opts.model, tools: opts.tools });
// After — add pluginRoot from existing parameter:
const args = buildClaudeArgs({ outputFormat: 'stream-json', maxTurns: opts.maxTurns, model: opts.model, tools: opts.tools, pluginRoot: projectRoot });
```

- [ ] **Step 4: Update createBridge caller**

The primary call site is `scripts/server/ws.ts:135`. Update it to pass `ctx.projectRoot`:

```typescript
// Before:
const bridge = createBridge(appDir, onEvent);
// After:
const bridge = createBridge(appDir, onEvent, ctx.projectRoot);
```

`runOneShot` callers in `scripts/server/handlers/generate.ts` (lines ~57, ~60) and `scripts/server/handlers/theme.ts` (lines ~125, ~171) already pass `ctx.projectRoot` as the 4th argument — no changes needed.

- [ ] **Step 5: Run existing bridge tests**

Run: `cd scripts && npx vitest run __tests__/unit/bridge-state.test.ts`
Expected: PASS (state machine tests test pure functions, not spawning)

- [ ] **Step 6: Commit**

```bash
git add scripts/server/claude-bridge.ts scripts/server/ws.ts
git commit -m "feat: plumb pluginRoot through bridge to subprocess builders"
```

---

### Task 8: Clean config.ts and prompt-builders.ts (atomic)

Delete `vibesSkillContent` extraction from config.ts AND its consumers in prompt-builders.ts in a single atomic commit. These must change together — deleting the config field while prompt-builders still references it would break compilation.

Also: filter `inject: system-prompt` from skill selector, add RECENCY_REMINDER, refactor buildSkillBlock.

**Files:**
- Modify: `scripts/server/config.ts:32` (ServerContext interface), `:95-111` (skill registration), `:115-129` (vibesSkillContent extraction), `:558-572` (parseSkillFrontmatter)
- Modify: `scripts/server/prompt-builders.ts:19-26` (TINYBASE_INVARIANT_RULES), `:113-121` (vibesBaseline), `:170-185` (TinyBase fallback), `:287-292` (NON-NEGOTIABLE block), `:759-789` (buildSkillBlock)

- [ ] **Step 1: Extend parseSkillFrontmatter to extract `inject` field**

At `config.ts:565`, add `'inject'` to the extracted fields:

```javascript
for (const field of ['name', 'description', 'inject']) {
```

- [ ] **Step 2: Filter injected skills from the selector**

At `config.ts:98-110`, add a filter after reading frontmatter:

```javascript
// Skip core references that are injected via --append-system-prompt
if (frontmatter.inject === 'system-prompt') continue;
```

- [ ] **Step 3: Delete vibesSkillContent extraction from config.ts**

Delete lines 115–129 (the heading-based extraction of `## TinyBase Data API` to `## Deployment Options`). Remove `vibesSkillContent` from:
- The returned context object (around line 146: delete `vibesSkillContent,`)
- The `ServerContext` interface (line 32: delete `vibesSkillContent: string;`)

- [ ] **Step 4: Delete TINYBASE_INVARIANT_RULES from prompt-builders.ts**

Remove lines 19–26. Search for all references to `TINYBASE_INVARIANT_RULES` in the file and remove those too (appears at end of buildChatPrompt and buildGeneratePrompt).

- [ ] **Step 5: Add RECENCY_REMINDER constant**

Replace the deleted constant with:

```typescript
const RECENCY_REMINDER = `
CRITICAL REMINDERS (see system prompt for full reference):
- NO imports. NO createStore. Hooks are pre-existing globals.
- useApp() is mandatory in root App. Cells are scalars only (string/number/boolean).
- No sync/connection status UI — the template provides SyncStatusDot automatically.
- Table names must be string literals: useRowIds('todos'), never useRowIds(tableName).`;
```

- [ ] **Step 6: Delete vibesBaseline in buildChatPrompt**

Remove lines 111–121 (the `ctx.vibesSkillContent` conditional block that constructs `vibesBaseline`). Remove `${vibesBaseline}` from the prompt template string.

- [ ] **Step 7: Delete TinyBase API fallback in buildGeneratePrompt**

Remove lines 170–185 (the `ctx.vibesSkillContent || \`DATABASE...\`` block). Remove `${tinybaseRef}` from the prompt template strings in both the reference and normal generation paths.

- [ ] **Step 8: Replace NON-NEGOTIABLE DATA RULES with RECENCY_REMINDER**

In `buildGeneratePrompt`, the `=== NON-NEGOTIABLE DATA RULES ===` block (lines 287–292) becomes:

```
=== NON-NEGOTIABLE DATA RULES ===
${RECENCY_REMINDER}
```

In `buildChatPrompt`, append `${RECENCY_REMINDER}` at the end of the RULES section.

- [ ] **Step 9: Refactor buildSkillBlock for deduplication**

Replace `buildSkillBlock` (lines 759–789). Delete:
- The hardcoded "ENVIRONMENT CONSTRAINTS" preamble (lines 772–779) — now in `--append-system-prompt`
- The "ACTION REQUIREMENT" paragraph (lines 781–784) — also moved to system prompt
- The 30KB truncation (lines 764–766)

New implementation uses parameter-based dedup state (kept in prompt-builders.ts rather than moving to bridge module — simpler, avoids module dependency):

```typescript
export function buildSkillBlock(
  ctx: any,
  skillId: string,
  dedupState: { lastSkillId: string | null; messageCount: number },
): { block: string; newState: { lastSkillId: string | null; messageCount: number } } {
  const skill = (ctx.pluginSkills || []).find((s: any) => s.id === skillId);
  if (!skill || !existsSync(skill.skillMdPath)) {
    return { block: '', newState: dedupState };
  }

  const count = dedupState.messageCount + 1;
  const needsFull = skillId !== dedupState.lastSkillId || count >= 5;

  if (needsFull) {
    const content = readFileSync(skill.skillMdPath, 'utf-8');
    return {
      block: `\nSKILL CONTEXT: "${skill.name}"\n\n${content}\n`,
      newState: { lastSkillId: skillId, messageCount: 0 },
    };
  }

  return {
    block: `\n(Using skill: "${skill.name}" — full guidance was provided earlier)\n`,
    newState: { lastSkillId: skillId, messageCount: count },
  };
}
```

- [ ] **Step 10: Update buildChatPrompt to use new buildSkillBlock signature**

The caller must maintain dedup state. The WebSocket handler (or chat handler) should hold `let skillDedupState = { lastSkillId: null, messageCount: 0 };` and pass/update it on each call.

- [ ] **Step 11: Verify compilation**

Run: `cd scripts && npx tsc --noEmit` (or just start the server) to confirm no TypeScript errors from the `vibesSkillContent` removal.

- [ ] **Step 12: Commit**

```bash
git add scripts/server/config.ts scripts/server/prompt-builders.ts
git commit -m "refactor: delete hardcoded blocks, add RECENCY_REMINDER, deduplicate skill injection"
```

---

### Task 9: Fix tests and add new assertions

Update tests that reference deleted constants/functions. Add skill injection and dedup tests.

**Files:**
- Modify: `scripts/__tests__/unit/prompt-builders.test.ts`
- Modify: `scripts/__tests__/unit/skill-appendix.test.ts`

- [ ] **Step 1: Fix prompt-builders tests**

Read `scripts/__tests__/unit/prompt-builders.test.ts`. Find and update any assertions that reference `TINYBASE_INVARIANT_RULES`, `vibesSkillContent`, or the old `buildSkillBlock` signature. Theme-related tests should be untouched — theme resolution code is unchanged.

- [ ] **Step 2: Add skill dedup tests**

Add to `scripts/__tests__/unit/skill-appendix.test.ts`:

```typescript
import { buildSkillBlock } from '../../server/prompt-builders.ts';
import { join } from 'path';

// Mock context with real skill file paths
const pluginRoot = join(__dirname, '..', '..', '..');
const mockCtx = {
  pluginSkills: [
    {
      id: 'vibes/multiplayer-guide',
      name: 'Multiplayer Guide',
      skillMdPath: join(pluginRoot, 'skills/vibes/references/multiplayer-guide.md'),
    },
    {
      id: 'vibes/game-patterns',
      name: 'Game Patterns',
      skillMdPath: join(pluginRoot, 'skills/vibes/references/game-patterns.md'),
    },
  ],
};

describe('buildSkillBlock deduplication', () => {
  it('injects full content on first call', () => {
    const state = { lastSkillId: null, messageCount: 0 };
    const result = buildSkillBlock(mockCtx, 'vibes/multiplayer-guide', state);
    expect(result.block).toContain('SKILL CONTEXT');
    expect(result.block).toContain('Multiplayer');
    expect(result.newState.lastSkillId).toBe('vibes/multiplayer-guide');
    expect(result.newState.messageCount).toBe(0);
  });

  it('returns pointer on subsequent calls with same skill', () => {
    const state = { lastSkillId: 'vibes/multiplayer-guide', messageCount: 1 };
    const result = buildSkillBlock(mockCtx, 'vibes/multiplayer-guide', state);
    expect(result.block).toContain('provided earlier');
    expect(result.block).not.toContain('Multiplayer Guide\n\n');
    expect(result.newState.messageCount).toBe(2);
  });

  it('re-injects full content on 5th message', () => {
    const state = { lastSkillId: 'vibes/multiplayer-guide', messageCount: 4 };
    const result = buildSkillBlock(mockCtx, 'vibes/multiplayer-guide', state);
    expect(result.block).toContain('SKILL CONTEXT');
    expect(result.newState.messageCount).toBe(0);
  });

  it('injects full content when skill changes', () => {
    const state = { lastSkillId: 'vibes/multiplayer-guide', messageCount: 1 };
    const result = buildSkillBlock(mockCtx, 'vibes/game-patterns', state);
    expect(result.block).toContain('SKILL CONTEXT');
    expect(result.newState.lastSkillId).toBe('vibes/game-patterns');
  });

  it('returns empty for unknown skill', () => {
    const state = { lastSkillId: null, messageCount: 0 };
    const result = buildSkillBlock(mockCtx, 'unknown/skill', state);
    expect(result.block).toBe('');
  });
});
```

- [ ] **Step 3: Add inject:system-prompt filtering test**

Add to `scripts/__tests__/unit/skill-appendix.test.ts`:

```typescript
import { parseSkillFrontmatter } from '../../server/config.ts';

describe('parseSkillFrontmatter inject field', () => {
  it('extracts inject field from frontmatter', () => {
    const content = '---\nname: Test\ninject: system-prompt\n---\nBody';
    const result = parseSkillFrontmatter(content);
    expect(result.inject).toBe('system-prompt');
  });

  it('returns undefined inject when not present', () => {
    const content = '---\nname: Test\n---\nBody';
    const result = parseSkillFrontmatter(content);
    expect(result.inject).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run all tests**

Run: `cd scripts && npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/__tests__/
git commit -m "test: update tests for skill injection, add dedup and frontmatter filter tests"
```

---

### Task 10: Add automated fixture assertions

The spec requires automated assertions that scan generated app code for common violations. Add these to the fixture test suite.

**Files:**
- Modify: `scripts/__tests__/unit/tinybase-template.test.js` (or create `scripts/__tests__/unit/generation-compliance.test.ts`)

- [ ] **Step 1: Write compliance assertions**

These scan existing fixture files (and any future generated `app.jsx`) for violations:

```typescript
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const fixturesDir = join(__dirname, '..', 'fixtures');
const fixtures = readdirSync(fixturesDir)
  .filter(f => f.endsWith('.jsx'))
  .map(f => ({ name: f, content: readFileSync(join(fixturesDir, f), 'utf-8') }));

describe('generation compliance', () => {
  for (const { name, content } of fixtures) {
    describe(name, () => {
      it('has no import statements', () => {
        const imports = content.match(/^import\s+/gm);
        expect(imports).toBeNull();
      });

      it('calls useApp()', () => {
        expect(content).toContain('useApp()');
      });

      it('has no createStore or createMergeableStore', () => {
        expect(content).not.toMatch(/createStore|createMergeableStore/);
      });

      it('uses string literal table names in hook calls', () => {
        // Match useRowIds(varName) or useCell(varName, ...) where varName is not a string literal
        const badCalls = content.match(/use(?:RowIds|Cell|AddRowCallback|SetCellCallback|SortedRowIds|DelRowCallback|RowCount)\(\s*[a-zA-Z_$]/g);
        expect(badCalls).toBeNull();
      });
    });
  }
});
```

- [ ] **Step 2: Run to verify fixtures pass**

Run: `cd scripts && npx vitest run __tests__/unit/generation-compliance.test.ts`
Expected: PASS (existing fixtures should already comply)

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/unit/generation-compliance.test.ts
git commit -m "test: add automated generation compliance assertions for fixtures"
```

---

### Task 11: Rebuild templates and verify end-to-end

Rebuild templates, restart the server, and verify the full pipeline works.

- [ ] **Step 1: Rebuild templates**

```bash
bun scripts/merge-templates.js --force
```

- [ ] **Step 2: Restart server and check logs**

```bash
VIBES_ROOT="$(pwd)" bun scripts/server.ts --mode=editor
```

Verify in the console output:
- Skill count is reduced by 3 (core refs filtered from selector)
- No `vibesSkillContent` log line (extraction is gone)
- No errors from skill loading

- [ ] **Step 3: Manual verification — generate an app**

Generate a new app in the editor. After generation, check `app.jsx`:
- No `import` statements
- `useApp()` present
- No `createStore` / `createMergeableStore`
- No sync status UI (`"Connected"`, `"LIVE"`, `"Syncing"`)
- Table names are string literals

- [ ] **Step 4: Manual verification — chat edit**

Open an existing app and ask the chat to "add a sync status indicator." The agent should explain the template already provides `SyncStatusDot` and decline to add a duplicate.

- [ ] **Step 5: Manual verification — skill selector**

Open the skill selector dropdown in the editor. Verify `generation-rules`, `data-api`, and `style-guide` do NOT appear. Other skills (`multiplayer-guide`, `game-patterns`, etc.) still appear.

- [ ] **Step 6: Run full test suite**

```bash
cd scripts && npx vitest run
```
Expected: ALL PASS

- [ ] **Step 7: Final commit**

```bash
git add skills/vibes/references/ scripts/server/ scripts/lib/ scripts/__tests__/
git commit -m "feat: complete skill injection architecture — deterministic guidance pipeline"
```
