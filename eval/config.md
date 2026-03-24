# Autoresearch Eval Configuration

## Prompt Battery

### Tier 1 — Ambiguous Boundaries

These prompts have genuine tension between shared and per-user state. The correct implementation is non-obvious from the seed prompt alone.

| # | Seed Prompt | State Isolation Challenge |
|---|-------------|--------------------------|
| 1 | "An auction app where users bid on items and the highest bid wins" | Per-user bid history vs shared current high bid and item state |
| 2 | "A voting poll where users vote once per question and see live results" | Per-user vote (must not allow re-vote) vs shared aggregate result display |
| 3 | "A game with a lobby where the host starts the game and players join" | Per-user ready/join state vs shared lobby and game progression |
| 4 | "An inventory app where users have personal collections and can trade items with each other" | Per-user inventory vs shared trade offers visible to both parties |

### Tier 2 — Sync Traps

These prompts appear shared-only but require careful isolation to avoid state leaks or race conditions.

| # | Seed Prompt | State Isolation Challenge |
|---|-------------|--------------------------|
| 5 | "A shared countdown timer that one user starts and all users see ticking down" | Shared timer value vs per-user trigger authority (only one user starts it) |
| 6 | "A collaborative ranking app where users each rank items and see the averaged result" | Per-user ranking input vs shared averaged output |
| 7 | "A reaction speed game where everyone sees a prompt and the first to click wins" | Shared prompt display vs per-user click timestamp; winner is shared state |

### Tier 3 — Regression + Negative Control

These prompts match the original v1 battery. They verify that improvements to Tier 1 and 2 do not break previously-passing cases.

| # | Seed Prompt | State Isolation Challenge |
|---|-------------|--------------------------|
| 8 | "A shared task board with personal filters and status columns" | Shared tasks vs per-user view preferences |
| 9 | "A chat room with user status indicators" | Shared messages vs per-user typing/online status |
| 10 | "A collaborative whiteboard where everyone draws on the same canvas" | Has NO per-user state — verifies SKILL.md doesn't overcorrect |

## Scoring Rubric

Each app receives a score of 0–4 per test run. Aggregate score is computed across all 10 prompts.

| Score | Label | Meaning |
|-------|-------|---------|
| 0 | Crash | App does not render, throws an unrecoverable error, or fails static analysis with a critical failure |
| 1 | Renders (sync broken) | App renders but sync does not work at all — state does not propagate between tabs |
| 2 | Partial sync (state leaks) | Sync works but state isolation is incorrect — per-user state bleeds across users, or shared state is siloed per-user |
| 3 | Isolation correct (basic pass, edge fail) | Core isolation is correct but edge cases fail (e.g., vote locking breaks on refresh, lobby host reassignment missing) |
| 4 | Full pass | All tested behaviors work correctly including edge cases |

**Aggregate score formula:**

```
aggregate = sum(all scores) / (10 * 4) * 100%
```

A perfect score is 100% (all 10 apps score 4). Stopping criteria reference this aggregate.

## Static Analysis

Before browser tests, run the static checker against each generated app:

```bash
bun scripts/eval-static-check.js <path-to-app.html>
```

**Critical failures (C1–C4)** — auto-fail the app (score = 0), do not proceed to browser test:

| Code | Description |
|------|-------------|
| C1 | Uses `useTable` or `useRow` across users without a `userId`-scoped row key |
| C2 | Calls `store.setRow` or `store.setCell` inside a `useEffect` with no dependency guard |
| C3 | Shared and per-user tables written to the same TinyBase table ID |
| C4 | No `useApp()` readiness gate before sync-dependent renders |

**Warnings (W1–W6)** — logged to napkin, do not auto-fail:

| Code | Description |
|------|-------------|
| W1 | `userId` derived from param but not memoized |
| W2 | `useAddRowCallback` used for per-user state (prefer `store.setRow` with stable key) |
| W3 | Missing `isSyncing` indicator in UI |
| W4 | Timer or interval not cleared on unmount |
| W5 | Vote/bid enforcement done only in UI (no store-level guard) |
| W6 | Whiteboard or canvas state stored per-user instead of shared |

## Subagent Generation

Each prompt is handled by a generator subagent spawned independently:

- **Model:** sonnet
- **Timeout:** 120 seconds per subagent
- **Context:** Inlined SKILL.md reference content + seed prompt only. No prior app code or iteration history is passed to the generator.
- **Output:** A single self-contained HTML file written to `eval/apps/eval-NN-name.html`

The orchestrator agent coordinates subagents sequentially. If a subagent times out, score = 0, log to napkin, continue.

## Sync Room Isolation

Each app uses a unique filename that determines its TinyBase sync room:

- Filename pattern: `eval-NN-name.html` (e.g., `eval-01-auction.html`, `eval-07-reaction-speed.html`)
- The eval runner restarts the sync server between each app test to ensure no cross-app state leaks
- Two-tab testing uses the same filename loaded in two browser tabs with different `?testUser=` params

## Test Users

- Alice: `?testUser=alice@test.com`
- Bob: `?testUser=bob@test.com`

## Stopping Criteria

- **Score plateau:** 3 consecutive iterations with no improvement in aggregate score
- **Perfect score:** Aggregate reaches 100% (all 10 apps score 4) — add new prompts from napkin discoveries and continue
- **Oscillation:** Fixing one prompt breaks another on 2+ consecutive iterations — surface to human
- **Hard cap:** 30 iterations max before requiring human review

## Human Checkpoints

After every 10 iterations (or on perfect score), pause and produce a summary including:
- Aggregate score trend across iterations
- Which prompts improved, regressed, or remain stuck
- Napkin patterns identified but not yet resolved
- Recommended next approach

## Revert Mechanics

- **Score improved:** `git commit` SKILL.md + eval artifacts
- **Score worse:** `git checkout <last-good-sha> -- skills/vibes/SKILL.md`, commit eval artifacts separately
- **Same score, same prompts pass:** True stagnation — revert and try a different approach
- **Same score, different prompts pass/fail:** Lateral movement — analyze napkin before deciding

## Context Window Management

Summarize napkin entries older than 5 iterations into a "resolved patterns" section. Skim specs for currently-passing prompts. Do not re-read full app code for prompts scored 4 on the previous iteration unless they regress.

## Spec Caching

Specs are generated on iteration 1 and reused. Regenerate only after a human checkpoint (treated as baseline reset — no revert logic applies to spec changes).

## Test Timeouts

60 seconds per individual app browser test. Log timeout to napkin as score = 0, continue to next prompt.
