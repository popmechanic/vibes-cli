# Skill Injection Architecture — Design Spec

**Date:** 2026-03-23
**Status:** Approved
**Problem:** The editor's generation/chat agents receive incomplete framework guidance because SKILL.md content is extracted via fragile heading-based string slicing. Guidance written to help app generation silently fails to reach the agent.

## Problem Statement

SKILL.md is a single 840-line file serving two consumers with different ingestion mechanisms:

| Consumer | What it reads | How |
|----------|--------------|-----|
| Terminal agent (Claude Code CLI) | Full SKILL.md | Plugin runtime loads entire file |
| Editor generate/chat agent | Lines 452–796 only | `config.ts` extracts by heading match |

Lines 1–451 (Core Rules, Generation Process, Theming) and 796–840 (Deployment) are invisible to the editor. Meanwhile, `prompt-builders.ts` re-hardcodes guidance inline (NON-NEGOTIABLE DATA RULES, TINYBASE_INVARIANT_RULES, etc.) which drifts from SKILL.md over time.

**Concrete failure:** The "don't build sync/connection status UI" warning existed at line 338 in SKILL.md but fell outside the extracted range. Generated apps rendered duplicate sync indicators.

## Design

### Layer 1: Skill Decomposition

Break the monolithic SKILL.md into focused, self-contained reference files. Each file is a complete unit — no extraction, no slicing.

**New files** (from splitting current SKILL.md):

| Current SKILL.md Section | Becomes | Content |
|---|---|---|
| Lines 117–133 (Pre-Flight Check) + 134–376 (Core Rules, Generation Process, Output Code, Assembly) | `references/generation-rules.md` | Platform name disambiguation, import map note, what generated code must/must not contain, template constraints, sync UI prohibition, theme section markers, assembly rules |
| Lines 377–451 (UI Style & Theming) | `references/style-guide.md` | OKLCH colors, gradients, neobrute, glass morphism, color modifications |
| Lines 452–776 (TinyBase API, Patterns, Bug Prevention, Reference App) | `references/data-api.md` | Hook API reference, data access patterns, user identity, game patterns, bug prevention checklist, complete reference grocery list app |

**Intentionally excluded from injection** (terminal-mode only, stays in slimmed SKILL.md):
- Lines 1–116: Terminal-mode auth check, step sequence, editor detection
- Lines 776–795: "When to Read Extended Docs" routing table (redundant when core references are pre-injected)
- Lines 796–840: Deployment options, "What's Next" section

**Existing files** (unchanged):

- `references/multiplayer-guide.md`
- `references/game-patterns.md`
- `references/ai-integration.md`
- `references/bug-prevention.md`
- `references/tinybase-patterns.md`

**SKILL.md becomes thin** — the terminal-mode orchestrator containing only:
- Auth check flow
- Step-by-step generation sequence (for terminal mode)
- Assembly/deploy commands
- `Read ${CLAUDE_SKILL_DIR}/references/*.md` directives for on-demand loading

### Layer 2: Deterministic Injection via `--append-system-prompt`

Replace manual prompt construction with skill file reads at bridge spawn time.

**Mechanism:** At process spawn, the server reads the decomposed skill files from disk and passes them via `--append-system-prompt`. This appends to Claude Code's default system prompt (preserving built-in behavior) rather than replacing it.

**Persistent bridge spawn (chat/edit):**

```javascript
// claude-subprocess.js — buildSkillAppendix()
//
// Core reference files injected into every bridge session.
// These are the ONLY files injected at spawn time. Existing reference files
// (multiplayer-guide.md, game-patterns.md, etc.) remain on-demand only —
// the terminal agent reads them when prompted, and the editor skill selector
// loads them per-message via buildSkillBlock().
const CORE_REFS = ['generation-rules.md', 'data-api.md', 'style-guide.md'];

function buildSkillAppendix(pluginRoot) {
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
  return loaded.join('\n\n---\n\n');
}

function buildPersistentArgs(config) {
  const args = ['-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--verbose',
  ];

  const skillContent = buildSkillAppendix(config.pluginRoot);
  if (skillContent) {
    args.push('--append-system-prompt', skillContent);
  }

  if (config.model) args.push('--model', config.model);
  return args;
}
```

**One-shot spawn (riff generate):**

Same pattern — `buildClaudeArgs` reads skill files and passes via `--append-system-prompt`.

**Why `--append-system-prompt` over `--agent`:**

| Approach | Pros | Cons |
|----------|------|------|
| `--agent` with preloaded skills | Declarative, agent definitions in markdown | Replaces Claude Code system prompt entirely, loses built-in behavior, agent file discovery requirements |
| `--append-system-prompt` | Preserves Claude Code defaults, deterministic file reads, no resolution dependencies | Manual concatenation in code |
| `--system-prompt` | Full control | Loses all Claude Code defaults |

`--append-system-prompt` is the safest injection point: it preserves Claude Code's built-in tool descriptions, permission handling, and session management while adding our framework guidance.

### Double-Injection Prevention

The three core reference files (`generation-rules.md`, `data-api.md`, `style-guide.md`) are injected at spawn time via `--append-system-prompt`. They must NOT also appear in the editor's skill selector dropdown, which would double-inject them when selected during chat.

**Solution:** Add frontmatter to each core reference file marking it as system-prompt-injected:

```yaml
---
inject: system-prompt
---
```

The skill discovery code in `config.ts` filters out references with `inject: system-prompt` from the selectable skill list. Existing reference files without this frontmatter remain selectable as before.

### pluginRoot Plumbing

`buildPersistentArgs()` currently takes `config = {}` with only `config.model`. The bridge at `claude-bridge.ts:148` calls `buildPersistentArgs({})`. After this change:

1. `buildPersistentArgs(config)` accepts `config.pluginRoot`
2. `claude-bridge.ts` receives `pluginRoot` from the server context (`ctx.projectRoot`) and passes it through
3. Same change for `buildClaudeArgs()` in the one-shot path

### Layer 3: Prompt Builder Cleanup

**Delete from `prompt-builders.ts`:**
- `TINYBASE_INVARIANT_RULES` constant — absorbed into `generation-rules.md`
- `NON-NEGOTIABLE DATA RULES` inline block — absorbed into `generation-rules.md`
- The hardcoded TinyBase API fallback in `buildGeneratePrompt` (lines 172–185) — absorbed into `data-api.md`
- `ctx.vibesSkillContent` and its extraction logic in `config.ts` (lines 115–128)

**Retain in `prompt-builders.ts`:**
- Theme resolution (selecting theme, extracting `:root` CSS) — runtime data, not guidance
- Reference handling (`buildReferenceBlock` for base64 image/HTML injection) — runtime data
- Dynamic context (user prompt, app name, `useAI` flag)
- `AI_INSTRUCTIONS_*` blocks — editor-specific, belong in prompt builder
- `EFFECT_INSTRUCTIONS` and animation/effect blocks — per-message runtime data
- `buildSkillBlock()` — continues to exist unchanged for non-vibes skills selected in the editor chat dropdown. Only vibes core references move to `--append-system-prompt`; third-party skill injection is unaffected.
- **Per-message recency reminders** — short inline reinforcement of critical rules (see below)

**Recency reminders — addressing positional salience:**

The full guidance lives in `--append-system-prompt` (system prompt). But in long chat sessions the system prompt may be 100+ turns back, and for generation the data rules are most effective near the user's request. Each per-message prompt retains a 3–5 line reminder of the most-violated rules. These are not a second source of truth — they're pointers back to the system prompt, not full explanations.

```typescript
const RECENCY_REMINDER = `
CRITICAL REMINDERS (see system prompt for full reference):
- NO imports. NO createStore. Hooks are pre-existing globals.
- useApp() is mandatory in root App. Cells are scalars only (string/number/boolean).
- No sync/connection status UI — the template provides SyncStatusDot automatically.
- Table names must be string literals: useRowIds('todos'), never useRowIds(tableName).`;
```

**What `buildChatPrompt` becomes:**

```typescript
export function buildChatPrompt(ctx, message, opts) {
  // Skills are already in the system prompt via --append-system-prompt.
  // This function only constructs the dynamic, per-message context.

  let dynamicContext = '';

  // Reference file injection (if user provided an image/HTML)
  if (reference) {
    dynamicContext += buildReferenceBlock(ctx, reference);
  }

  // Skill-specific context (for non-vibes skills selected in editor)
  if (skillId) {
    dynamicContext += buildSkillBlock(ctx, skillId);
  }

  // AI feature instructions
  if (useAI) {
    dynamicContext += AI_INSTRUCTIONS_CHAT;
  }

  return `${dynamicContext}The user is iterating on a React app in app.jsx. Read app.jsx first, then Edit it.

User says: "${message}"

RULES:
- Read app.jsx, then Edit ONLY what the user asked for
- ADD to the existing app — never rewrite from scratch
- Preserve all components, hooks, state, data models
${RECENCY_REMINDER}`;
}
```

**What `buildGeneratePrompt` becomes:**

```typescript
export function buildGeneratePrompt(ctx, userPrompt, opts) {
  // Skills are already in system prompt. This builds the generation task
  // with runtime data: theme, style guide, design reference.

  const styleGuide = readFileSync(stylePath, 'utf-8');
  const themeContent = resolveTheme(ctx, themeId);

  return `You are an expert React app designer. Generate a beautiful, creative app.

=== NON-NEGOTIABLE DATA RULES ===
${RECENCY_REMINDER}

USER REQUEST: "${userPrompt}"

=== MANDATORY THEME: "${themeName}" ===
${themeBoilerplate}

=== THEME PERSONALITY ===
${themeEssentials}

=== DESIGN GUIDANCE ===
${styleGuide}

=== WRITE app.jsx ===
Write the complete app to app.jsx.${useAI ? AI_INSTRUCTIONS_GENERATE : ''}`;
}
```

### Process Architecture

No change to process count:

- **Single-app editing:** 1 persistent bridge + `--append-system-prompt` (same as today)
- **Riff/parallel gen:** N one-shot processes + same `--append-system-prompt` (same as today)
- **Future multi-project:** N persistent bridges, each with `--append-system-prompt` (deferred)

### Contract: What We Write = What the Agent Sees

After this change, the pipeline is deterministic:

```
Skill files on disk
  ↓ read at spawn time
--append-system-prompt
  ↓ injected by Claude CLI
Agent's system prompt context
```

There is no extraction, no heading matching, no manual re-hardcoding. If guidance exists in a skill file under `references/`, the agent sees it. If it doesn't exist there, the agent doesn't see it. One source of truth, one injection path.

### Compaction Behavior

`--append-system-prompt` content is part of the system prompt, which is re-injected after auto-compaction. Skills survive long sessions.

Context budget: Only the three core references are injected at spawn time (not the full `references/` directory). Estimated ~30KB from SKILL.md lines 117–776 ≈ 7.5K tokens ≈ 3.75% of a 200K context window. Existing reference files (multiplayer-guide, game-patterns, etc.) remain on-demand and do not contribute to the spawn-time budget.

## Migration Path

### Phase 1: Decompose SKILL.md
1. Create `references/generation-rules.md` from SKILL.md lines 134–358
2. Create `references/style-guide.md` from SKILL.md lines 377–451
3. Create `references/data-api.md` from SKILL.md lines 452–776
4. Slim SKILL.md to terminal-mode orchestration only
5. Verify no content is lost (diff total line count)

### Phase 2: Wire Injection
1. Add `buildSkillAppendix()` to `claude-subprocess.js`
2. Add `--append-system-prompt` to `buildPersistentArgs()` and `buildClaudeArgs()`
3. Pass `pluginRoot` through to subprocess builders

### Phase 3: Clean Prompt Builders
1. Delete `TINYBASE_INVARIANT_RULES` constant
2. Delete `NON-NEGOTIABLE DATA RULES` inline block
3. Delete TinyBase API fallback in `buildGeneratePrompt`
4. Delete `vibesSkillContent` extraction in `config.ts`
5. Simplify `buildChatPrompt` and `buildGeneratePrompt` to runtime-data-only

### Phase 4: Verify

**Automated assertions** (add to fixture test suite):
- Scan generated `app.jsx` for `import ` statements — zero matches expected
- Scan for `useApp()` — at least one match expected in root component
- Scan for `createStore` / `createMergeableStore` — zero matches expected
- Scan for sync status UI patterns (`isSyncing &&`, `"Syncing"`, `"Connected"`, `"LIVE"`, `"Online"/"Offline"`) — zero matches expected
- Scan for string literal table names in all hook calls — no variable/template-literal first args

**Manual verification:**
1. Run `cd scripts && npm test` — all unit tests pass
2. Generate a new app — verify it passes the automated assertions above
3. Chat-edit an app — verify guidance is applied (ask "add a sync indicator" — agent should refuse or explain it's built-in)
4. Log `--append-system-prompt` content at spawn time — verify it matches concatenated skill files
5. Check skill selector dropdown — core reference files (with `inject: system-prompt` frontmatter) must NOT appear

### Rollback Strategy

Phases are designed for incremental rollback:

- **Phase 1** (decompose) is safe standalone — SKILL.md references the new files, existing prompt-builders still work with extraction
- **Phase 2** (wire injection) can coexist with Phase 3 not yet applied — `--append-system-prompt` adds skill content AND prompt-builders still include inline guidance (temporarily redundant but not harmful)
- **Phase 3** (delete from prompt-builders) is the point of no return — only apply after Phase 4 verification passes
- To roll back Phase 3: `git revert` the cleanup commit, prompt-builders resume inline guidance alongside the system prompt injection

## Alternatives Considered

### `--agent` with preloaded skills
Replaces Claude Code's default system prompt entirely. Loses built-in tool descriptions, permission handling, and session management. Higher risk for uncertain benefit.

### `--agents` JSON inline definitions
Programmatic agent definitions at spawn time. Interesting for future subagent dispatch but adds complexity without solving the core injection problem.

### Marker-based extraction (`<!-- editor:begin -->`)
Keeps the monolithic SKILL.md with extraction markers. Doesn't solve the two-sources-of-truth problem — prompt-builders.ts still re-hardcodes guidance.

### Subagent dispatch for primary work
Master session dispatches generation/editing to subagents. Breaks real-time token streaming (subagents return summaries, not token streams). UX regression.
