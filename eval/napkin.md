# Eval Napkin — Failure Log

> Entries are never reverted. Failed experiments still produce useful failure data.
> The napkin grows monotonically.

## Resolved Patterns

(Summarized entries from earlier iterations — kept for context)

## Active Entries

### Failure: Hooks called inside array iteration methods (iteration 1)
- **Apps:** 03-kanban, 05-collaborative-list, 06-dashboard
- **Prompt categories:** Kanban, Collaborative List, Dashboard
- **What happened:** React error #310 ("Rendered fewer hooks than expected") when list length changes. Apps crash on first user interaction that adds/removes rows.
- **Root cause:** Generated code calls `useCell()` inside `.filter()`, `.map()`, or `.forEach()` on row ID arrays. When the array length changes between renders, the number of hook calls changes, violating React's Rules of Hooks.
- **Pattern:** hooks-in-loop
- **Concrete examples:**
  - Kanban `Column`: `allIds.filter(id => { const status = useCell('tasks', id, 'status'); ... })`
  - Collaborative List `ShoppingItem`: `checkoffIds.filter(cid => { const itemId = useCell('checkoffs', cid, 'itemId'); ... })`
  - Dashboard `MetricCards`: `entryIds.forEach(id => { const cat = useCell('entries', id, 'category'); ... })`
- **SKILL.md section that should have prevented this:** "Patterns That Prevent Bugs" — mentions `useCell` in child components, but doesn't explicitly warn against hooks in loops/callbacks
- **What was missing from SKILL.md:** An explicit rule: "Never call TinyBase hooks inside `.map()`, `.filter()`, `.forEach()`, or any loop/callback. Hooks must be at the top level of a component. To read data for multiple rows, render a child component per row and call hooks inside each child." Need a concrete bad-vs-good code example showing the pattern and its fix.
- **Fix pattern:** Instead of filtering with hooks inline, either (a) use `useTable` to read all data at once then filter plain objects, or (b) render a child component per row that calls hooks at top level and conditionally renders.

### Failure: Host assignment race with useValueState (v2 iteration 1)
- **App:** 03-lobby-game (iteration 1)
- **Prompt category:** Lobby Game (Tier 1 — Ambiguous Boundaries)
- **What happened:** Both Alice and Bob became host. Alice joined first and set `hostEmail` to her email. Bob joined and also set `hostEmail` to his email (overwriting Alice's). After sync converged, Bob was host because his write had a later timestamp (CRDT last-writer-wins).
- **Root cause:** Both users run `if (!hostEmail) setHostEmail(myEmail)` on load. The `!hostEmail` check sees `undefined` on initial load before sync delivers Alice's value. By the time sync delivers Alice's hostEmail, Bob has already written his own — and his later timestamp wins.
- **Pattern:** value-init-race
- **SKILL.md section that should have prevented this:** Multiplayer Guide — "Roles and Slots" section describes slot assignment but doesn't cover first-writer-wins for Values.
- **What was missing from SKILL.md:** A pattern for "first user claims a role" using Values. The current `if (!hostEmail) setHostEmail(myEmail)` pattern races because sync hasn't delivered the existing value before the second client checks. Possible fixes: (a) use a table row keyed by a well-known ID and check for existing rows before writing, (b) use a delay/retry pattern, (c) accept last-writer-wins and use the users table registration order instead of a Value.
- **Fix pattern:** Instead of a Value for host, derive the host from the `users` table — the user with the earliest `joinedAt` timestamp becomes host. This is deterministic and doesn't race.

### Failure: useValueState values not syncing for timer state (v2 iteration 1)
- **App:** 05-shared-timer (iteration 1)
- **Prompt category:** Shared Timer (Tier 2 — Sync Traps)
- **What happened:** Alice started a 10-second timer. The `users` table synced to Bob (both users visible), but the Values (`timerRunning`, `timerEndTime`, `timerDuration`) did not propagate — Bob's tab showed the timer as paused at the original duration while Alice's was counting down.
- **Root cause:** The `stopTimer()` function sets Values to `null` (`setTimerEndTime(null)`, `setTimerDuration(null)`), which in TinyBase deletes the Value. When `startTimer()` is called again immediately after, the CRDT sees a near-simultaneous delete + create with close timestamps. The delete may win in merge resolution, or the re-created Value may not sync to other clients that already received the deletion.
- **Pattern:** value-null-delete-race
- **SKILL.md section that should have prevented this:** Bug Prevention — "Cell Types Can Be Undefined" mentions undefined returns, but doesn't warn about setting Values to null.
- **What was missing from SKILL.md:** A rule: "Never set Values or Cells to `null` to 'clear' them — this deletes the Value/Cell in the CRDT, and rapid delete-then-recreate can cause sync issues. Instead, use a sentinel value like `0`, `false`, or empty string `''` to represent 'cleared' state."
- **Fix pattern:** Use `setTimerEndTime(0)` instead of `setTimerEndTime(null)`. Use `setTimerRunning(false)` (already correct) and `setTimerDuration(0)` instead of null. Check for `timerEndTime > 0` instead of truthiness.

### Refined: Values sync race on initial CRDT merge (v2 iteration 2)
- **App:** 05-shared-timer (iteration 2 — sentinel values fix applied)
- **Prompt category:** Shared Timer (Tier 2 — Sync Traps)
- **What happened:** Even with sentinel values (no nulls), Alice starts timer → Bob joins and his empty CRDT merges, overwriting Alice's `timerRunning=true` back to undefined. After merge completes, subsequent Resume works — both tabs show RUNNING simultaneously.
- **Root cause:** NOT the null-delete issue (that's still valid but not the primary cause here). The real issue: when a new client connects, its empty MergeableStore merges with the server's store. If the new client has no Value entries at all, the merge doesn't overwrite — but the initial sync handshake can introduce timing where the first client's recent Value writes are in-flight and conflict with the merge resolution.
- **Pattern:** values-initial-merge-race
- **Key insight:** Values set BEFORE a second client connects may be lost during CRDT merge. Values set AFTER both clients are connected and synced work correctly. This explains why reaction game (07) works — gamePhase Values are set after both users are in the lobby.
- **What was missing from SKILL.md:** Guidance that shared Values should ideally be set AFTER all clients have connected and completed initial sync. For timer-like apps, consider using a single-row table instead of Values for shared state, since table rows merge more reliably across clients.
- **Potential fix approaches:** (a) Use a shared-state table row instead of Values: `useCellState('timer', 'shared', 'running')`. (b) Add a brief delay before allowing timer start (wait for `isSyncing` to settle). (c) Accept the limitation and document it.
- **Resolution (iteration 3):** Approach (a) worked — table row `useCellState('timer', 'shared', 'running')` syncs correctly once both clients are connected. Also critical: do NOT auto-initialize shared rows in `useEffect` on load — this races with CRDT merge and overwrites the other client's state. Only write shared state in response to user actions, never on mount.
