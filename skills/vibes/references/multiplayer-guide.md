---
name: Multiplayer Guide
description: Per-user state, shared state, sync architecture, user attribution, users table registration, roles/slots, useUser identity
---

# Multiplayer & Shared App Guide

Patterns for building multiplayer and collaborative apps with TinyBase. For the hook API reference, see SKILL.md.

---

## Data Modeling for Sync

**How sync works under the hood:** The template creates a `MergeableStore` — a CRDT-based store where each cell independently tracks its last-write timestamp. When deployed, data flows through three layers:
1. **localStorage** — immediate persistence via `createLocalPersister`, so data survives page reloads even offline
2. **WebSocket sync** — `createWsSynchronizer` connects to the dispatch worker, merging cell-level changes with other clients
3. **Durable Object + SQLite** — the server-side `AppSyncDO` persists the merged state in a Cloudflare Durable Object with SQL storage

This architecture means: writes are instant (local-first), sync happens in the background, and conflicts resolve automatically at the cell level (last writer wins per cell, not per row). Two users editing different cells of the same row will both succeed. Two users editing the same cell will resolve to whichever write has the later timestamp.

**What goes in TinyBase (syncs across devices):**
- Everything the user would expect to "still be there" when they come back
- Scores, progress, saved items, user-created content, settings
- In multiplayer: shared state that all users need to see

**What stays in useState (ephemeral, local only):**
- UI state: is a modal open, which tab is selected, hover state
- In-progress form input before the user submits (unless using live editing)
- Animations, transitions, temporary visual state

---

## Per-User State vs Shared State

This is the most common mistake in multiplayer apps: storing a personal choice as a global value instead of per-user data. When user A picks "Red Team," that choice must be stored under user A's identity — not as a global `selectedTeam` value that every user overwrites.

**The rule: if each user should have their own version of the data, key it by user email.** Use the user's email as the row ID in a players/users table, and store their personal choices as cells in that row:

```jsx
const oidcUser = typeof useUser === 'function' ? useUser()?.user : null;
const myEmail = oidcUser?.email || 'anonymous';

// PER-USER: each player's team choice — stored in their own row
const [myTeam, setMyTeam] = useCellState('players', myEmail, 'team');
setMyTeam('red');  // only affects MY row

// SHARED: game status visible to everyone — stored as a Value
const [gameStatus, setGameStatus] = useValueState('gameStatus');
```

The mental model: **Values** and **Tables with auto-generated IDs** are shared by all users. **Tables with the user's email as the row ID** are per-user. There's no access control at the data layer — all data syncs to all clients. The distinction is about which row you read and write, not about permissions.

| Data Type | Storage Pattern | Example |
|-----------|----------------|---------|
| Shared setting (set after all join) | `useValueState('setting')` | Game phase, room theme |
| Shared setting (set before others join) | `useCellState('state', 'shared', 'setting')` | Timer state, pre-join config |
| Shared items | `useAddRowCallback('items', ...)` | Chat messages, shared tasks |
| Per-user choice | `useCellState('players', myEmail, 'choice')` | Team selection, avatar, color |
| Per-user items | `useAddRowCallback('items', (x) => ({...x, createdBy: myEmail}))` | My tasks, my scores |

**Values vs Table Row for Shared State:** Values are the simplest pattern for shared state, but they can be lost during initial CRDT merge if set before a second client connects. If your shared state may be set before all users have joined (e.g., a timer one user starts before others open the app), use a single-row table instead:

```jsx
// Instead of: const [timerRunning, setTimerRunning] = useValueState('timerRunning');
// Use a shared-state table with a well-known row ID:
const [timerRunning, setTimerRunning] = useCellState('timer', 'shared', 'running');
const [timerEndTime, setTimerEndTime] = useCellState('timer', 'shared', 'endTime');
```

Table rows merge more reliably because both clients have a row at the same key — the CRDT merges cell-by-cell rather than treating the entire Value as present-or-absent.

---

## OIDC User Fields

**Available from `useUser()`:** `{ email, id (sub), firstName, lastName, username, imageUrl, groups }`. `email` is always present and is the recommended user identifier — it's human-readable and guaranteed unique by the OIDC provider.

---

## User Attribution

Multiplayer apps need user identity. Private apps get this from OIDC email via `useUser()`. Public apps can use the username gate pattern (see [Public Multiplayer Apps](#public-multiplayer-apps) below).

Every row that belongs to a specific user must include `createdBy`. The identity source depends on app type:

**Private apps** — use `useUser()` to get the email:
```jsx
const oidcUser = typeof useUser === 'function' ? useUser()?.user : null;
const userEmail = oidcUser?.email || 'anonymous';
```

**Public multiplayer apps** — use the UUID from localStorage (see [Public Multiplayer Apps](#public-multiplayer-apps)):
```jsx
const [user, setUser] = useState(() => {
  const stored = localStorage.getItem('vibes_user_myapp');
  return stored ? JSON.parse(stored) : null;
});
const userId = user?.id; // UUID — stable identity key
```

Then use the identity key for attribution:
```jsx
const addItem = useAddRowCallback(
  'items',
  (text) => ({
    text,
    createdBy: userId, // email for private apps, UUID for public multiplayer
    createdAt: Date.now(),
  }),
  [userId],
);
```

To show only the current user's data, filter by `createdBy` using `useTable` (never call hooks inside `.filter()` — see bug-prevention.md):
```jsx
const allScores = useTable('scores');
const myScores = Object.entries(allScores).filter(([id, row]) => row.createdBy === userId);
```

**Single-player apps:** All persistent data goes in TinyBase. No user filtering needed — sync just gives the user their data on all their devices.

**Multiplayer/shared apps:** Shared data goes in TinyBase with `createdBy` on user-owned rows. Each client sees all data; filter by user when showing "my stuff." Private apps use email as the identity key; public multiplayer apps use UUID from the username gate.

---

## User Identity in Shared Apps

**Private apps:** `useUser().user.email` is the unique user identifier — every authenticated user has a distinct email from Pocket ID. Authentication already solves user identity, so there's no reason to generate random client IDs in private apps.

**Always guard `useUser()` for public/preview mode** — the template installs a `useUser` stub for public apps that returns `{ email: null }`, so `typeof useUser === 'function'` does NOT distinguish private from public. Check `useUser()?.user?.email` for a truthy string to determine if real auth is available:

```jsx
const oidcUser = typeof useUser === 'function' ? useUser()?.user : null;
const myEmail = oidcUser?.email || 'anonymous';
const myName = oidcUser?.firstName || myEmail.split('@')[0];
```

Once deployed as a private app, `email` is always a real string from the OIDC provider. The `'anonymous'` fallback is for **preview mode only** (testing before deploy) — not for public multiplayer apps.

**Public multiplayer apps:** Use the username gate pattern instead — see [Public Multiplayer Apps](#public-multiplayer-apps) below.

---

## Users Table Registration

**Every shared app needs a `users` table.** Whether it's a game, chat, collaborative doc, or kanban board — store a row per user keyed by their identity key (email for private apps, UUID for public multiplayer) with their display name. Auto-register on load using hooks (not direct `store.*` calls):

```jsx
// Check if user already registered (useRow returns {} for missing rows)
const myRecord = useRow('users', myId);
const isRegistered = Object.keys(myRecord).length > 0;

// Register on first load — useSetRowCallback with the identity key as row ID
const registerUser = useSetRowCallback(
  'users', myId,
  () => ({ name: myName, joinedAt: Date.now() }),
  [myName],
);

useEffect(() => {
  if (myId && !isRegistered) registerUser();
}, [myId, isRegistered]);
```

**Why hooks instead of `store.setRow()`?** The `store` variable exists in the template scope, but using it directly bypasses React's reactivity — other components won't re-render when you call `store.setRow()`. Callback hooks (`useSetRowCallback`, `useSetCellCallback`, etc.) notify the reactive system so all subscribers update automatically. The rule: **always write data through hooks, never through `store.*` methods.**

**Identify the current user by their identity key**, not by position, slot number, or index:
```jsx
const userIds = useRowIds('users');          // all participants
const myRecord = useRow('users', myId);      // my record
const isMe = (id) => id === myId;            // ownership check for any row
```

**Display names, not emails** — show the `name` field from the `users` table in the UI.

---

## Roles and Slots

**For apps with roles or slots** (game seats, assigned tasks, etc.), auto-assign on join. This is a rare case where direct `store` access is justified — the slot ID isn't known until runtime, so hooks (which need fixed IDs at render time) don't fit:
```jsx
// Read slots reactively — useTable is OK for small fixed-size tables
const slots = useTable('slots');

useEffect(() => {
  if (!myEmail) return;
  const taken = Object.values(slots).some(s => s.email === myEmail);
  if (taken) return;
  const openSlot = Object.entries(slots).find(([, s]) => !s.email);
  if (openSlot) store.setCell('slots', openSlot[0], 'email', myEmail);
}, [myEmail, slots]);
```

**When is direct `store.*` access OK?** Only in `useEffect` initialization patterns where the row ID is determined at runtime (like finding an open slot above). For all normal reads and writes, use hooks — they integrate with React's reactivity system and ensure other components re-render on changes.

---

## First-Writer-Wins (Host / Leader Assignment)

**Don't use a Value for "who is the host."** Two clients loading simultaneously will both check `if (!hostEmail) setHostEmail(myEmail)` — the check sees `undefined` before sync delivers the first writer's value, so both write, and the later timestamp wins (CRDT last-writer-wins). The "first user" becomes the last one to load.

**Instead, derive the host from the `users` table:**

```jsx
// Every user registers with joinedAt on load (see Users Table Registration above)
const allUsers = useTable('users');
const usersByJoinTime = Object.entries(allUsers)
  .sort(([, a], [, b]) => (a.joinedAt || 0) - (b.joinedAt || 0));
const hostEmail = usersByJoinTime.length > 0 ? usersByJoinTime[0][0] : null;
const isHost = hostEmail === myEmail;
```

This is deterministic — both clients compute the same host from the same data. No race condition, no Value needed. The same pattern works for any "first user gets a role" scenario.

---

## Public Multiplayer Apps

When a public app's prompt implies per-user state — voting, turns, "each user gets", collaborative editing, teams, scoring, polls — the agent generates a **username picker gate** before the main app. Single-player public apps (calculators, timers, dashboards) skip this entirely.

### Identity Model

localStorage stores a JSON object under `vibes_user_{appName}` (where `appName` is a hardcoded string derived from the app name, e.g. `vibes_user_button_poll`):

```json
{ "id": "crypto.randomUUID()", "name": "Alice" }
```

- **`id` (UUID)** — the stable identity key. Used as `createdBy` in all per-user rows and as the row key in the `users` table. Never changes.
- **`name` (display name)** — cosmetic. Shown in UI, stored as a cell in the `users` table. Can be changed without breaking data.

This mirrors private apps where email is the stable key and firstName is the display name.

### Username Picker

1. On first visit, the app shows a username input before the main UI.
2. Style the picker to feel native to the app — it should feel organically part of the app, not a separate system screen.
3. No uniqueness enforcement on display names. If two people pick the same name, they'll see the issue and one can change it.
4. Username must be a non-empty trimmed string. Validate before accepting.

### Username Picker Placement

The username picker must render **inside** the `App` component, after the `useApp()` call, so TinyBase sync is active when the user registers. The pattern is a `useState` gate:

```jsx
function App() {
  const { isReady } = useApp();
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('vibes_user_myapp');
    return stored ? JSON.parse(stored) : null;
  });

  if (!user) return <UsernamePickerUI onSubmit={(name) => {
    const newUser = { id: crypto.randomUUID(), name: name.trim() };
    localStorage.setItem('vibes_user_myapp', JSON.stringify(newUser));
    setUser(newUser);
  }} />;

  return <MainAppUI user={user} />;
}
```

This is a pattern guide — the agent adapts the actual implementation and styling to fit each app.

### Users Table

The `users` TinyBase table is keyed by UUID:

| Row Key (UUID) | `name` | `joinedAt` |
|---|---|---|
| `a1b2c3...` | Alice | 1711382400000 |
| `d4e5f6...` | Bob | 1711382401000 |

All per-user rows in other tables use `createdBy: uuid` — same pattern as private apps use with email.

### Return Visits

1. On return visits, check localStorage first. If a user object exists (has `id` and `name`), skip the picker and go straight to the app.
2. A "change name" affordance is available somewhere in the UI — the agent decides placement and style to fit the app. Changing the name updates only the `name` cell in the `users` table and the `name` field in localStorage. The UUID and all `createdBy` references remain stable.

### Identity Resolution Summary

The agent provides the current user's identifier regardless of app type:

- **Private app:** `oidcUser.email` (from `useUser()`, checked via `useUser()?.user?.email` being a truthy string — not just `typeof useUser === 'function'`)
- **Public multiplayer app:** UUID from localStorage + `users` table
- **Public single-player app:** no identity needed, no gate shown
