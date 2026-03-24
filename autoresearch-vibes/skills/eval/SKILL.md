---
name: eval
description: >
  Run the TinyBase autoresearch eval loop v2 — spawn sonnet subagents to
  generate apps from inlined reference docs, run static analysis pre-checks,
  test with two simulated users via Chrome DevTools MCP, apply graded scoring
  (0–4 per app, aggregate percentage), and iterate. Use when asked to run
  evals, improve TinyBase docs, or start an autoresearch loop.
---

# TinyBase Autoresearch Eval Loop (v2)

You are running an automated improvement loop for `skills/vibes/SKILL.md`.
Each iteration generates apps via sonnet subagents, tests them for per-user
state isolation, and uses failures to improve the documentation.

## Prerequisites Check

Before starting, verify:
1. Chrome DevTools MCP is available (check for `chrome-devtools` tools)
2. `eval/eval-shim.js` exists
3. `eval/config.md` exists with prompt battery
4. `eval/napkin.md` exists
5. TinyBase and ws are installed in `scripts/` (`cd scripts && npm ls tinybase ws`)
6. Sync server can start (`bun scripts/server/sync-server.ts` — should print "TinyBase sync server running")
7. `scripts/eval-static-check.js` exists
8. Verify eval specs exist: `ls eval/specs/*.md` should show 10 files

If any prerequisite is missing, stop and inform the user.

## Iteration Protocol

### Phase 1: Read Current State

1. Read `eval/scoreboard.md` — know the current best score and iteration number
2. Read `eval/napkin.md` — focus on "Active Entries" section
3. Note which prompts are currently failing

### Phase 2: Improve SKILL.md (skip on iteration 1)

Based on napkin entries with "What was missing from SKILL.md":
1. Read the 4 reference files that constitute the SKILL.md documentation:
   - `skills/vibes/references/data-api.md`
   - `skills/vibes/references/generation-rules.md`
   - `skills/vibes/references/bug-prevention.md`
   - `skills/vibes/references/multiplayer-guide.md`
2. Make targeted edits addressing the napkin's identified gaps
3. Keep changes focused — one concept per iteration

### Phase 3: Generate Apps via Subagents

For each prompt in the battery (see `eval/config.md`):

1. Read the 4 reference files that constitute the SKILL.md documentation:
   - `skills/vibes/references/data-api.md`
   - `skills/vibes/references/generation-rules.md`
   - `skills/vibes/references/bug-prevention.md`
   - `skills/vibes/references/multiplayer-guide.md`

2. Build the generator prompt by inlining all 4 files' content between delimiters, plus the seed prompt:

```
You are generating a React web app using TinyBase for reactive data with real-time sync.

IMPORTANT: Do NOT read any files from the filesystem. Do NOT search the codebase.
All the documentation you need is provided below. Generate code using ONLY
the reference content in this prompt.

--- BEGIN DATA API REFERENCE ---
{content of data-api.md}
--- END DATA API REFERENCE ---

--- BEGIN GENERATION RULES ---
{content of generation-rules.md}
--- END GENERATION RULES ---

--- BEGIN BUG PREVENTION ---
{content of bug-prevention.md}
--- END BUG PREVENTION ---

--- BEGIN MULTIPLAYER GUIDE ---
{content of multiplayer-guide.md}
--- END MULTIPLAYER GUIDE ---

Generate the app for this prompt:
"{seed_prompt}"

Requirements:
- This is a PRIVATE app (requires auth). Use useUser() for identity.
- Output ONLY the JSX code. No explanation, no markdown fences.
- Follow every rule in the reference content exactly.
- The app must support multiple simultaneous users.
```

3. Spawn the generator agent using the Agent tool:
   - `model: "sonnet"`
   - `prompt:` the constructed prompt above
   - `description:` "Generate {app-name} app"

4. Extract JSX from the agent's response, save to `eval/generated/iter-NN/NN-name.jsx`

5. If the agent doesn't return within 120 seconds or returns an error, score the app 0 and log "generation timeout" or "generation error" to napkin.

### Phase 4: Static Analysis

For each generated `.jsx` file:

1. Run: `bun scripts/eval-static-check.js eval/generated/iter-NN/NN-name.jsx`

2. Parse the JSON output: `{ critical: string[], warnings: string[], passed: boolean }`

3. If `passed` is false (critical failures found):
   - Score = 0
   - Log to napkin with format:
     ```
     ## Static Fail: [check ID] — [app name] (iteration [N])
     - **Check:** [check description from output]
     - **SKILL.md section that should prevent this:** [identify which reference file]
     - **What was missing:** [specific gap]
     ```
   - Skip browser test for this app

4. If `passed` is true but `warnings` is non-empty:
   - Log warnings to napkin
   - Continue to browser test

### Phase 5: Assemble and Test

For each app that passed static analysis:

#### 5a: Assemble

```bash
bun scripts/assemble.js eval/generated/iter-NN/NN-name.jsx eval/generated/iter-NN/NN-name.html --eval-mode
```

#### 5b: Copy to unique filename

Sync room isolation — IMPORTANT: do NOT use shared `eval-test.html`:

```bash
cp eval/generated/iter-NN/NN-name.html ./eval-NN-name.html
```

#### 5c: Restart sync server

Prevent cross-app data bleed:

```bash
lsof -ti:3334 | xargs kill 2>/dev/null
bun scripts/server/sync-server.ts &
sleep 2
```

#### 5d: Start preview server if not running

```bash
bun scripts/server.ts --mode=preview &
```

#### 5e: Open two tabs in isolated browser contexts

- Tab 1: `http://localhost:3333/eval-NN-name.html?testUser=alice@test.com` (isolatedContext: aliceN)
- Tab 2: `http://localhost:3333/eval-NN-name.html?testUser=bob@test.com` (isolatedContext: bobN)

#### 5f: Wait for both tabs to load

Verify no crash (take_snapshot).

#### 5g: Run the interaction script from the spec

Use the spec at `eval/specs/NN-name.md`:
- Follow each numbered step
- Use click, type_text, press_key for actions
- Use take_snapshot and evaluate_script for assertions
- Wait 2-3 seconds between user actions for sync

#### 5h: Score the app

Based on assertion results:
- **Score 0:** App crashed (React error, blank screen)
- **Score 1:** App renders but sync broken (Alice's data never appears in Bob's tab)
- **Score 2:** Sync works but per-user state leaks (Alice's action changes Bob's per-user state)
- **Score 3:** All Basic assertions pass but at least one Edge assertion fails
- **Score 4:** All assertions pass

#### 5i: Record failures in napkin

Use the standard format:

```
## Failure: [descriptive title]
- **App:** [prompt-name] (iteration [N])
- **Score:** [0-4]
- **Prompt category:** [Tier 1/2/3]
- **What happened:** [observed behavior]
- **Root cause:** [code pattern that caused it]
- **Pattern:** [generalized pattern name]
- **SKILL.md section that should have prevented this:** [section name]
- **What was missing from SKILL.md:** [specific gap — this drives the next iteration]
```

#### 5j: Close both tabs before moving to the next app

### Phase 6: Score and Decide

1. Compute aggregate: `sum(all_app_scores) / (10 * 4) * 100`
2. Update `eval/scoreboard.md`:
   - Fill in the iteration row with per-app scores and aggregate
3. Compare to previous best aggregate:
   - **Improved:** `git commit` all changes (SKILL.md refs + eval artifacts)
   - **Worse:** `git checkout <last-good-sha> -- skills/vibes/references/`, commit eval artifacts separately
   - **Same score, same apps pass:** Stagnation — revert, try different approach
   - **Same score, different apps pass/fail:** Lateral movement — analyze napkin

### Phase 7: Check Stopping Criteria

- 3 consecutive iterations with no aggregate improvement -> stop, summarize findings
- Aggregate = 100% -> add new prompts from napkin discoveries if any, otherwise stop
- Oscillation (2+ consecutive) -> stop, surface to human
- 30 iterations reached -> mandatory human checkpoint
- Every 10 iterations -> pause, produce summary for human review

## Context Window Management

By iteration 15+, summarize napkin entries older than 5 iterations into
the "Resolved Patterns" section. Only load specs for currently-failing
prompts in full detail.

## Important Rules

- SKILL.md reference files are the ONLY files that change between iterations (besides eval artifacts)
- Napkin entries are NEVER reverted — they always persist
- Specs are cached from setup — reuse across iterations
- The eval-shim, assemble --eval-mode, static checker, and sync server are stable infrastructure — do not modify during the loop
- Generator agents are sonnet model, instruction-isolated, with inlined reference content
- Each app uses a unique filename for sync room isolation
- Sync server restarts between app tests
