---
name: eval
description: >
  Run the TinyBase autoresearch eval loop — generate apps from the prompt
  battery, test each with two simulated users via Chrome DevTools MCP,
  score SKILL.md improvements, and iterate. Use when asked to run evals,
  improve TinyBase docs, or start an autoresearch loop.
---

# TinyBase Autoresearch Eval Loop

You are running an automated improvement loop for `skills/vibes/SKILL.md`.
Each iteration generates apps, tests them for per-user state isolation,
and uses failures to improve the documentation.

## Prerequisites Check

Before starting, verify:
1. Chrome DevTools MCP is available (check for `chrome-devtools` tools)
2. `eval/eval-shim.js` exists
3. `eval/config.md` exists with prompt battery
4. `eval/napkin.md` exists
5. TinyBase and ws are installed in `scripts/` (`cd scripts && npm ls tinybase ws`)
6. Sync server can start (`bun scripts/server/sync-server.ts` — should print "TinyBase sync server running")

If any prerequisite is missing, stop and inform the user.

## Iteration Protocol

### Phase 1: Read Current State

1. Read `eval/scoreboard.md` — know the current best score and iteration number
2. Read `eval/napkin.md` — focus on "Active Entries" section
3. Note which prompts are currently failing

### Phase 2: Improve SKILL.md (skip on iteration 1)

Based on napkin entries with "What was missing from SKILL.md":
1. Read the current TinyBase sections of `skills/vibes/SKILL.md`
2. Make targeted edits addressing the napkin's identified gaps
3. Keep changes focused — one concept per iteration

### Phase 3: Generate and Test Each Prompt

For each prompt in the battery (see `eval/config.md`):

#### 3a: Self-Brainstorm (iteration 1 only, or after baseline reset)

If `eval/specs/NN-name.md` does not exist for this prompt:
1. Take the seed prompt from `eval/config.md`
2. Ask yourself the brainstorm questions — select answers that produce
   apps requiring BOTH shared and per-user state
3. Write the spec to `eval/specs/NN-name.md`
4. Extract hard assertions at the bottom of the spec:
   - "User A does X -> User B's [specific UI element] should NOT change"
   - "User A does X -> User B's store SHOULD contain the data (sync works)"
5. Extract soft checks: console errors, reload persistence

#### 3b: Generate App

1. Using the cached spec, generate app code following current SKILL.md
2. Save to `eval/generated/iter-NN/NN-name.jsx`

#### 3c: Assemble and Serve

```bash
bun scripts/assemble.js eval/generated/iter-NN/NN-name.jsx eval/generated/iter-NN/NN-name.html --eval-mode
```

Copy assembled HTML to project root for serving:
```bash
cp eval/generated/iter-NN/NN-name.html ./eval-test.html
```

Start the preview server and sync server if not already running:
```bash
bun scripts/server.ts --mode=preview &
bun scripts/server/sync-server.ts &
```

#### 3d: Two-Tab Testing via Chrome DevTools MCP

1. Open Tab 1: `http://localhost:3333/eval-test.html?testUser=alice@test.com`
2. Open Tab 2: `http://localhost:3333/eval-test.html?testUser=bob@test.com`
3. Wait for both tabs to load and sync to connect

**Run hard assertions:**
- In Tab 1: perform User A's actions (click buttons, select options, submit forms)
- Wait 2-3 seconds for sync
- In Tab 2: check that User B's UI shows ONLY User B's state
- Use `evaluate_script` to inspect store state:
  `store.getTable('tableName')` — verify data synced
  Check DOM elements — verify UI renders correct user's data

**Run soft checks:**
- Check console for errors (`read_console_messages`)
- Reload Tab 2 — does state persist?
- Have both users act simultaneously — any corruption?

#### 3e: Record Results

**If assertions pass:** Note "PASS" in the spec file for this iteration.

**If assertions fail:** Add a napkin entry:

```
## Failure: [descriptive title]
- **App:** [prompt-name] (iteration [N])
- **Prompt category:** [category]
- **What happened:** [observed behavior]
- **Root cause:** [code pattern that caused it]
- **Pattern:** [generalized pattern name]
- **SKILL.md section that should have prevented this:** [section name]
- **What was missing from SKILL.md:** [specific gap — this drives the next iteration]
```

**If test errors/crashes:** Log with "test error" category in napkin. Note crash cause.

**If test hangs > 60s:** Abandon, log timeout to napkin, continue to next prompt.

### Phase 4: Score and Decide

1. Count passes: `score = passes / total_prompts`
2. Update `eval/scoreboard.md` with iteration results
3. Compare to previous best:
   - **Score improved:** `git commit` all changes (SKILL.md + eval artifacts)
   - **Score worse:** `git checkout <last-good-sha> -- skills/vibes/SKILL.md`
     then commit eval artifacts (napkin, scoreboard) separately
   - **Same score, same prompts pass:** Stagnation — revert SKILL.md, try different approach
   - **Same score, different prompts pass:** Lateral movement — analyze napkin,
     decide whether the trade-off is worth keeping

### Phase 5: Check Stopping Criteria

- 3 consecutive iterations with no improvement -> stop, summarize findings
- All prompts pass -> add new prompts from napkin discoveries if any,
  otherwise stop and celebrate
- Oscillation (2+ consecutive) -> stop, surface to human
- 30 iterations reached -> mandatory human checkpoint
- Every 10 iterations -> pause, produce summary for human review

## Context Window Management

By iteration 15+, summarize napkin entries older than 5 iterations into
the "Resolved Patterns" section. Only load specs for currently-failing
prompts in full detail.

## Important Rules

- SKILL.md is the ONLY file that changes between iterations (besides eval artifacts)
- Napkin entries are NEVER reverted — they always persist
- Specs are cached — reuse from iteration 1 unless after a human-approved baseline reset
- The eval-shim, assemble --eval-mode, and sync server are stable infrastructure — do not modify them during the loop
