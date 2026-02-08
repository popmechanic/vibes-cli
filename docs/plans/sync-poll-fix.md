# Fix: Second-Device Sync Requires Refresh

**PR:** [#1593](https://github.com/fireproof-storage/fireproof/pull/1593) on `fix/nginx-duplicate-cors-headers`
**File:** `use-fireproof/clerk/use-fireproof-clerk.ts`
**Date:** 2026-02-08

## The Problem

When a user opens a Fireproof app on a second device (or incognito tab), signs in with Clerk, and the sync status shows "synced" — the data from the first device doesn't appear. A manual page refresh fixes it every time. After that first refresh, subsequent real-time updates sync normally without intervention.

## Root Cause

There are two separate issues in the sync pipeline. The first was already addressed in the PR; the second was discovered during testing.

### Issue 1: Attach Errors Not Retried (original PR fix)

The `useFireproofClerk` hook caught errors from `database.attach()` but only retried if the error message contained specific keywords ("timeout", "auth", "token", "expired", "unauthorized"). Any other error — network hiccups, transient server issues — was swallowed silently with no recovery.

**Fix:** Replace keyword matching with universal retry using exponential backoff (2s, 4s, 8s... up to 30s, max 8 attempts). Tab visibility resets the retry budget.

### Issue 2: Synced Data Invisible Until Database Read (new fix)

This is the one users actually hit. `database.attach()` resolves when the WebSocket connection is established — not when historical data has been synced. After the promise resolves, data streams in through a background metadata channel. Here's the gap:

```
attach() resolves
     │
     ▼
syncStatus = "synced"    ← Hook reports success here
     │
     ▼
Background: metadata stream delivers historical data
     │
     ▼
CRDT receives metadata but doesn't process it   ← Data sits in a pending state
     │
     ▼
Nothing triggers processing
     │
     ▼
useLiveQuery never re-queries
     │
     ▼
User sees empty app
```

The CRDT processes pending metadata lazily — only when something queries the database (`allDocs()`, `query()`, etc.). Until that happens, the streamed data sits unprocessed. `useLiveQuery` only re-queries when subscriptions fire (via `ledger._no_update_notify()` on clock tock events), and the sync path never triggers those subscriptions.

On page refresh, the database reopens from IndexedDB (which now contains the synced data from the previous session's background stream), the initial `useLiveQuery` query returns the data, and everything works from there.

## The Fix

After `attach()` succeeds, poll `database.allDocs()` periodically. The read forces the CRDT to process pending sync metadata, which advances the clock, fires tock events, triggers subscriptions, and causes `useLiveQuery` to re-query.

### When to Stop Polling

This is an initialization-only problem. Once the CRDT has processed the initial catch-up data, real-time updates flow through the normal subscription path (`onTick`/`onTock`). The poll uses two exit conditions:

1. **Stable count (fast path):** If `allDocs().rows.length` is unchanged for 3 consecutive polls (6 seconds), the initial sync has settled. Stop.
2. **Hard ceiling:** Stop after 20 seconds regardless.

Typical case: 4-5 IndexedDB reads over ~10 seconds, then done forever. No writes, no network calls, no ongoing cost.

### Constants

```typescript
const SYNC_POLL_INTERVAL_MS = 2000;     // Poll every 2 seconds
const SYNC_STABLE_THRESHOLD = 3;        // 3 stable polls = settled
const SYNC_POLL_MAX_MS = 20 * 1000;     // Hard ceiling
```

### The Effect

```typescript
useEffect(() => {
  if (attachState.status !== "attached") return;

  let stopped = false;
  let lastCount = -1;
  let stableRuns = 0;

  const poll = async () => {
    if (stopped) return;
    try {
      const { rows } = await database.allDocs();
      const count = rows.length;

      if (count === lastCount) {
        stableRuns++;
        if (stableRuns >= SYNC_STABLE_THRESHOLD) {
          console.debug("[fireproof-clerk] Initial sync settled, polling stopped");
          stopped = true;
          return;
        }
      } else {
        stableRuns = 0;
      }
      lastCount = count;
    } catch {
      // ignore polling errors
    }
    if (!stopped) {
      setTimeout(poll, SYNC_POLL_INTERVAL_MS);
    }
  };

  const startTimer = setTimeout(poll, SYNC_POLL_INTERVAL_MS);
  const maxTimer = setTimeout(() => {
    if (!stopped) {
      console.debug("[fireproof-clerk] Sync poll hit max duration, stopping");
      stopped = true;
    }
  }, SYNC_POLL_MAX_MS);

  return () => {
    stopped = true;
    clearTimeout(startTimer);
    clearTimeout(maxTimer);
  };
}, [attachState.status, database]);
```

## Why This is a Workaround

The proper fix belongs in `core/blockstore/loader.ts`. The `handleMetaStream()` function processes incoming sync metadata but never calls `ledger._notify()` or fires clock events that would trigger subscriptions. The existing test file `core/tests/fireproof/attachable-subscription.test.ts` documents this exact gap — subscriptions fire for local writes but not for remotely synced data.

The poll workaround is appropriate for the clerk hook because:
- It's cheap (a few IndexedDB reads)
- It's self-limiting (stops once sync settles)
- It doesn't touch internals or private APIs
- It works regardless of how the core eventually fixes the notification gap

When the core properly notifies subscribers on sync, this poll becomes a no-op — `allDocs()` still runs a few times but the data will already be visible via subscriptions, and the stable count exits quickly.

## How We Discovered This

1. Deployed a test app, tested on mobile in a private tab — data didn't sync
2. `syncStatus` showed "synced" (green) — so `attach()` succeeded, retry fix was irrelevant
3. Added a diagnostic panel that polled `database.allDocs()` and `database.query()` every 2 seconds
4. Data appeared without refresh — the diagnostic's read calls were the fix
5. Stripped the diagnostics, moved the polling into the hook, confirmed it worked alone

## Testing

Test app deployed at `https://sync-retry-test.exe.xyz` (may be torn down).
