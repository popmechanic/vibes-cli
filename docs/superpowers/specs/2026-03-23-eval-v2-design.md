# Eval v2 Design: Harder Autoresearch Eval Loop

**Date:** 2026-03-23
**Status:** Approved
**Goal:** Increase eval difficulty to match real-world failure rates by eliminating self-evaluation bias, testing ambiguous state boundaries, and adding static analysis pre-checks.

---

## Problem Statement

The v1 eval achieved 100% pass rate after one iteration, but real-world app generation has a much higher failure rate — particularly around multiplayer state synchronization. Three root causes:

1. **Self-evaluation bias**: The same agent that knows the docs generates the apps AND knows the test assertions. Real users' agents only see SKILL.md.
2. **Too-easy prompts**: Current battery has obvious shared/per-user splits. Real apps fail on ambiguous boundaries.
3. **Shallow testing**: Single-action tests miss silent state bleed (app renders fine but data leaks across users) and sync-not-working (data stays local).

### Real Failure Modes to Target

- **(B) Silent state bleed**: App renders, no errors, but Alice's actions change Bob's UI when they shouldn't. Caused by per-user state stored as global Values, or missing email-keyed rows.
- **(C) Sync doesn't work**: Data stays local, second tab never sees changes. Caused by missing `useApp()`, `useState` instead of TinyBase, or `createStore` creating a disconnected store.

---

## Architecture

### Overview

```
Phase 1: Generate (parallel subagents)
  For each of 10 prompts:
    → Spawn generator subagent (sonnet, instruction-isolated)
    → Agent receives inlined SKILL.md reference content + seed prompt
    → Returns app.jsx

Phase 2: Static Analysis (< 1 second total)
  For each app.jsx:
    → Run eval-static-check.js
    → Critical failures → auto-FAIL, skip browser test
    → Warnings → flag, continue

Phase 3: Browser Test (sequential, ~3 min per app)
  Start sync server + preview server
  For each app that passed static check:
    → Assemble with --eval-mode
    → Open Alice tab + Bob tab (isolated browser contexts)
    → Run multi-step interaction script
    → Check hard assertions on both tabs
    → Check console errors
    → Record result (graded 0-4)

Phase 4: Score & Decide
  → Compute aggregate score
  → Update scoreboard + napkin
  → If improved: commit SKILL.md + artifacts
  → If worse: revert SKILL.md, commit artifacts only
```

---

## Component 1: Subagent Generation

### Design

The eval orchestrator spawns a separate **generator agent** for each prompt using the `Agent` tool with:
- `model: "sonnet"` — matches the model most real users run
- Instruction-based isolation — the agent prompt explicitly forbids reading eval artifacts

The orchestrator **inlines** the full content of all 4 reference files into the generator prompt. This ensures:
1. The agent has no reason to browse the filesystem
2. File path resolution issues are eliminated
3. The agent sees exactly what a real `/vibes` terminal session would provide

**Generation timeout:** 120 seconds per app. If the generator agent doesn't return in time, the app is scored 0 (crash) and logged to napkin as "generation timeout."

### Generator Agent Prompt Template

```
You are generating a React web app using TinyBase for reactive data with real-time sync.

IMPORTANT: Do NOT read any files from the filesystem. Do NOT search the codebase.
All the documentation you need is provided below. Generate code using ONLY
the reference content in this prompt.

--- BEGIN DATA API REFERENCE ---
{inlined content of skills/vibes/references/data-api.md}
--- END DATA API REFERENCE ---

--- BEGIN GENERATION RULES ---
{inlined content of skills/vibes/references/generation-rules.md}
--- END GENERATION RULES ---

--- BEGIN BUG PREVENTION ---
{inlined content of skills/vibes/references/bug-prevention.md}
--- END BUG PREVENTION ---

--- BEGIN MULTIPLAYER GUIDE ---
{inlined content of skills/vibes/references/multiplayer-guide.md}
--- END MULTIPLAYER GUIDE ---

Generate the app for this prompt:
"{seed_prompt}"

Requirements:
- This is a PRIVATE app (requires auth). Use useUser() for identity.
- Output ONLY the JSX code. No explanation, no markdown fences.
- Follow every rule in the reference content exactly.
- The app must support multiple simultaneous users.
```

### Isolation Strategy

The generator agent is instruction-isolated, not sandbox-isolated. The `Agent` tool does not support filesystem sandboxing. Mitigations:

1. **Inlined content** — the agent has all docs in its prompt, so it has no reason to read files
2. **Explicit instruction** — "Do NOT read any files from the filesystem"
3. **No tool hints** — the prompt does not mention eval specs, napkin, or assertions
4. **Residual risk** — if the agent disobeys and reads `eval/specs/`, bias could leak. This risk is accepted as low-probability given the inlined content and explicit instruction.

### What the Generator Does NOT See

- Eval specs (`eval/specs/*.md`)
- Assertion lists or test scripts
- Napkin entries (`eval/napkin.md`)
- The eval skill itself (`autoresearch-vibes/skills/eval/SKILL.md`)
- Scoreboard or iteration history

### What the Generator DOES See

- The 4 SKILL.md reference files (inlined in prompt — same content as a real `/vibes` terminal session)
- The one-sentence seed prompt
- A system directive to generate multiplayer-capable code

---

## Component 2: Prompt Battery

### Design Principles

- Seed prompts are **one sentence, intentionally vague** — no hints about table design
- Prompts target **ambiguous shared/per-user boundaries** — where the split isn't obvious
- Three tiers: hard (ambiguous), medium (sync traps), regression + control
- 10 prompts total (up from 7)

### Prompt Battery

#### Tier 1 — Ambiguous Boundaries (hardest)

| # | Seed Prompt | State Isolation Challenge | Key Failure Mode |
|---|------------|--------------------------|------------------|
| 1 | "An auction app where users bid on items and the highest bid wins" | Per-user bid history vs shared current-highest. Derived cross-user state (who's winning). Concurrent bid race. | Computed aggregation across users; temptation to store "highest bid" as single Value that gets overwritten |
| 2 | "A voting poll where users vote once per question and see live results" | Per-user "has voted" flag + shared vote tally. Must prevent double-voting AND show live aggregate. | Per-user flag + shared aggregation; hooks-in-loop for tally computation |
| 3 | "A game with a lobby where the host starts the game and players join" | Role-based (host vs player). Phase transitions (lobby → playing → results). Per-user readiness vs shared game state. | State machine transitions; role-based conditional writes; who is "host"? |
| 4 | "An inventory app where users have personal collections and can trade items with each other" | Ownership transfer: remove from Alice, add to Bob. Per-user inventory views. Cross-user writes. | Cross-user data mutation; ownership modeled as cell value, not table structure |

#### Tier 2 — Sync Traps (likely to produce failure C)

| # | Seed Prompt | State Isolation Challenge | Key Failure Mode |
|---|------------|--------------------------|------------------|
| 5 | "A shared countdown timer that one user starts and all users see ticking down" | Timer tick is local useState, start/stop must sync. | Temptation to put countdown in TinyBase (wrong — too frequent) or start/stop in useState (wrong — doesn't sync) |
| 6 | "A collaborative ranking app where users each rank items and see the averaged result" | Per-user rankings + shared aggregate. Custom ordering. | Temptation to store rank as array (cells are scalars only); hooks-in-loop for aggregation |
| 7 | "A reaction speed game where everyone sees a prompt and the first to click wins" | Timestamp-based winner detection. Per-user reaction time vs shared round winner. | Concurrent writes to shared "winner" Value; race condition |

#### Tier 3 — Regression + Negative Control

| # | Seed Prompt | State Isolation Challenge | Key Failure Mode |
|---|------------|--------------------------|------------------|
| 8 | "A shared task board with personal filters and status columns" | Shared tasks vs per-user view preferences | Regression: hooks-in-loop (v1 failure); filter isolation |
| 9 | "A chat room with user status indicators" | Shared messages vs per-user status | Regression: basic per-user isolation (should pass easily) |
| 10 | "A collaborative whiteboard where everyone draws on the same canvas" | All shared, no per-user state | Negative control: verify SKILL.md doesn't overcorrect |

### Sync Room Isolation

Each app must use a unique filename when served (not a shared `eval-test.html`). The TinyBase sync room is keyed by the URL path, so reusing the same path across apps would cause data bleed between tests.

```bash
# Correct: unique filename per app
cp eval/generated/iter-NN/01-auction.html ./eval-01-auction.html
# URL: http://localhost:3333/eval-01-auction.html?testUser=alice@test.com

# Wrong: shared filename (v1 pattern — causes cross-app data bleed)
cp eval/generated/iter-NN/01-auction.html ./eval-test.html
```

The sync server should be restarted between test apps to ensure a clean sync state.

### Spec Format

Each prompt gets a spec file at `eval/specs/NN-name.md` containing:

```markdown
# Spec: [App Name]

## Seed Prompt
[One sentence — exactly what the generator agent sees]

## Expected Data Model
[What a correct implementation should look like — tables, Values, key patterns]

## Interaction Script
[Multi-step sequence of actions for the two-tab test]
1. Alice: [action]
2. Wait 2s for sync
3. Bob: [check assertion]
4. Bob: [action]
5. Wait 2s
6. Alice: [check assertion]
...

## Hard Assertions

### Basic (score 3 requires all basic assertions to pass)
1. [assertion]
2. [assertion]

### Edge (score 4 requires all basic + edge assertions to pass)
3. [assertion]
4. [assertion]

## Static Analysis Expectations
[Which checks should pass/fail for this app type]
```

The assertion tier split enables graded scoring: score 2 = at least one basic assertion fails on per-user isolation, score 3 = all basic pass but edge fails, score 4 = all pass.

---

## Component 3: Static Analysis Pre-Check

### Design

A single script `scripts/eval-static-check.js` that scans a `.jsx` file for known anti-patterns using regex matching. No AST parsing — fast and sufficient for 90% of cases.

### Input/Output

```
Input:  path to .jsx file
Output: {
  critical: string[],   // auto-FAIL, skip browser test
  warnings: string[],   // flag in napkin, continue to browser test
  passed: boolean        // true if no critical failures
}
```

### Check Catalog

#### Critical Checks (auto-FAIL)

| ID | Check | Regex/Pattern | Failure Mode |
|----|-------|---------------|-------------|
| C1 | Missing `useApp()` | Code does not contain `useApp()` | Sync never activates |
| C2 | Import statements | Line matching `/^\s*import\s/m` | React singleton / duplicate modules |
| C3 | Store creation | `createStore` or `createMergeableStore` | Disconnected store |
| C4 | Store constructor | `new Store` or similar | Disconnected store |

#### Warning Checks (flag, continue)

| ID | Check | Regex/Pattern | Failure Mode |
|----|-------|---------------|-------------|
| W1 | Hooks in loops | `useCell`/`useRow`/`useHasRow` appearing between `.filter(`/`.map(`/`.forEach(` and a closing `)` at the same or lower indent level. Known limitation: heuristic, may miss deeply nested cases. | React crash #310 |
| W2 | Direct store writes | Any `store.set` or `store.del` call anywhere in code. The TinyBase pattern strongly prefers callback hooks; direct store access is almost always wrong regardless of context. Rare legitimate uses (slot assignment in useEffect) are acceptable false positives. | Reactivity bypass |
| W3 | JSON in cells | `JSON.stringify` in callback hook context | CRDT granularity broken |
| W4 | Sync status UI | String literals containing "Connected", "Online", "LIVE", "Syncing", "Offline" in JSX context | Duplicate indicators |
| W5 | Optional chaining on email | `oidcUser?.email` or `email?.split` | Suggests uncertainty about identity |
| W6 | Anonymous fallback | `|| 'anonymous'` or `|| 'unknown'` near email usage | Breaks multi-user identity |

**Dropped from v1 proposal:** `useState` for persistent data (W3 in original). Too many false positives — `useState([])` and `useState({})` are common for legitimate UI state. Browser testing catches sync failures more reliably.

### Integration with Eval Loop

```
for each app.jsx:
  result = evalStaticCheck(appPath)
  if (result.critical.length > 0):
    score = 0  // auto-fail
    log critical failures to napkin
    skip browser test
  else:
    log warnings to napkin
    proceed to browser test
```

---

## Scoring Rubric

Graded scoring replaces binary pass/fail:

| Score | Level | Meaning | How Detected |
|-------|-------|---------|-------------|
| 0 | Crash | App errors on load or first interaction, or fails critical static check | Static analysis critical failure, or React error in browser |
| 1 | Renders | App loads but sync is broken — data stays local | Two-tab test: Alice adds data, Bob never sees it |
| 2 | Partial sync | Shared data syncs but per-user state leaks across users | Two-tab test: Alice's action changes Bob's per-user state |
| 3 | Isolation correct | Per-user isolation works for basic cases but edge cases fail | Two-tab test: multi-step interaction reveals subtle bleed |
| 4 | Full pass | All hard assertions pass including edge cases | All checks pass |

### Aggregate Score

```
iteration_score = sum(app_scores) / (num_apps * 4) * 100
```

A perfect run scores 100%. A run where everything renders but nothing syncs scores 25%.

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `eval/config.md` | Rewrite | New 10-prompt battery with tiers |
| `eval/specs/*.md` | Rewrite | New specs for all 10 prompts with interaction scripts |
| `scripts/eval-static-check.js` | Create | Static analysis checker |
| `autoresearch-vibes/skills/eval/SKILL.md` | Rewrite | Updated eval loop protocol: subagent generation, static check phase, graded scoring |
| `eval/scoreboard.md` | Reset | New format with graded scores |

### Files NOT Changed

| File | Reason |
|------|--------|
| `eval/eval-shim.js` | Already fixed in v1 (useUser shape, OIDC token) |
| `eval/napkin.md` | Napkin is append-only; v1 entries preserved |
| `skills/vibes/SKILL.md` | Only changes via the autoresearch loop itself, not during setup |
| `scripts/assemble.js` | `--eval-mode` already works |
| `scripts/server/sync-server.ts` | Already works |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Generator agent reads eval artifacts despite instruction | Inlined content removes incentive to browse; explicit "do NOT read files" instruction; residual risk accepted as low-probability |
| Static analysis regex has false positives | Warnings don't auto-fail; only critical checks do. Browser test is authoritative. |
| Browser tests take too long (10 apps x 3 min = 30 min) | Static analysis auto-fails ~30-50% of apps before browser phase. Sequential runtime of ~15-20 min for remaining apps is acceptable. |
| Sonnet generates significantly worse code than Opus | This is the point — we're testing docs quality, not model capability. If docs are good enough for Sonnet, they're good enough for everyone. |
| Generator agent hangs or loops | 120-second generation timeout; auto-fail and log to napkin |
| Sync room data bleeds between test apps | Unique filename per app + sync server restart between tests (see Sync Room Isolation) |
| Graded scoring boundary (2 vs 3) is subjective | Assertions are explicitly marked `[basic]` or `[edge]` in specs; score boundary is deterministic |

---

## Success Criteria

The eval v2 is successful if:
1. Baseline (iteration 1) pass rate is **below 70%** — proving the battery is harder than v1
2. At least 2 iterations of SKILL.md improvements produce measurable score increases
3. Failures map to **specific, actionable** SKILL.md gaps (not vague "agent was confused")
4. The static analysis catches at least 1 failure that would otherwise require browser testing
