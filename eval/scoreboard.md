# Eval Scoreboard (v2)

## Iteration Results

| Iteration | Aggregate | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | SKILL.md Change |
|-----------|-----------|----|----|----|----|----|----|----|----|----|----|-----------------|
| (no iterations yet) | | | | | | | | | | | | |

## Scoring Key

- 0 = Crash (static check fail or React error)
- 1 = Renders (sync broken — data stays local)
- 2 = Partial sync (shared data syncs, per-user state leaks)
- 3 = Isolation correct (basic assertions pass, edge fails)
- 4 = Full pass (all assertions pass)
- Aggregate = sum / (10 * 4) * 100%

## v1 Final Results (preserved for reference)

| Iteration | Score | Note |
|-----------|-------|------|
| 1 | 4/7 (57%) | Baseline — hooks-in-loop caused 3 failures |
| 2 | 7/7 (100%) | Added hooks-in-loop rule to bug-prevention.md |
