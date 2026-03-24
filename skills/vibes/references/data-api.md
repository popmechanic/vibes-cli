---
name: TinyBase Data API
description: >
  TinyBase hook API reference, data access patterns, user identity via useUser(),
  game/timer patterns, AI integration hooks, sharing, reference app, bug prevention checklist.
inject: system-prompt
---

## TinyBase Data API

TinyBase is a reactive data store with fine-grained hooks. Data persists across sessions and syncs in real-time via WebSocket when deployed. The template manages all store setup, persistence, and synchronization — your code only uses hooks.

### Globals Available (provided by the template)

All of these are globally available — no imports needed. React globals: `React, useState, useEffect, useRef, useCallback, useMemo, createContext, useContext`. Auth (private apps only): `useUser, SignInButton, UserButton, SignedIn, SignedOut`. TinyBase existence/introspection hooks: `useHasRow, useHasCell, useHasValue, useCellIds, useTableIds`.

### TinyBase Hook API Reference

Every callback hook returns a function that takes **one argument** (the parameter). Do not call with `(null, value)` — the second argument is the Store, not your value.

**Reading data:**
```
useCell(tableId, rowId, cellId)        → Cell | undefined     (string, number, boolean, or undefined)
useRow(tableId, rowId)                 → {cellId: Cell}       (object of all cells in the row)
useTable(tableId)                      → {rowId: Row}         (re-renders on ANY change — use sparingly)
useValue(valueId)                      → Value | undefined    (string, number, boolean, or undefined)
useValues()                            → {valueId: Value}     (all app-level values)
useRowIds(tableId)                     → string[]             (all row IDs in the table)
useSortedRowIds(tableId, cellId?, descending?, offset?, limit?) → string[]
useRowCount(tableId)                   → number
useHasRow(tableId, rowId)              → boolean          (true if row exists — use for safe detail views)
useHasCell(tableId, rowId, cellId)     → boolean          (true if cell exists and is not undefined)
useHasValue(valueId)                   → boolean          (true if value has been set)
useCellIds(tableId, rowId)             → string[]         (all cell names in a row — for dynamic/flexible schemas)
useTableIds()                          → string[]         (all table names in the store)
```

**Writing data — callback hooks (all return `(parameter) → void`):**
```
useAddRowCallback(tableId, (parameter) → Row, deps?)
  Call:     addItem('my text')
  Callback: (text) => ({ text, createdAt: Date.now() })
  Returns:  the new row ID (string) via optional `then` callback

useSetCellCallback(tableId, rowId, cellId, (parameter) → Cell | MapCell, deps?)
  Call:     setName('new name')
  Callback: (newName) => newName                          — direct value
  Callback: (_e) => (currentValue) => !currentValue       — MapCell toggle pattern

useSetValueCallback(valueId, (parameter) → Value, deps?)
  Call:     setTheme('dark')
  Callback: (newTheme) => newTheme

useSetRowCallback(tableId, rowId, (parameter) → Row, deps?)
  Replaces the ENTIRE row — cells you omit get deleted. Prefer useSetPartialRowCallback.

useSetPartialRowCallback(tableId, rowId, (parameter) → Partial<Row>, deps?)
  Call:     updateItem({ name: 'new', done: true })
  Only updates the cells you return. Other cells preserved.

useDelRowCallback(tableId, rowId)
  Call:     deleteItem()   — no arguments needed

useDelCellCallback(tableId, rowId, cellId)
  Call:     clearName()    — no arguments needed

useDelTableCallback(tableId)
  Call:     clearAllTodos()  — removes every row in the table

useDelValueCallback(valueId)
  Call:     clearTheme()     — removes a stored Value
```

**State hooks (read + write like useState, but persisted and synced):**
```
useCellState(tableId, rowId, cellId)   → [Cell | undefined, (newValue: Cell) → void]
useRowState(tableId, rowId)            → [Row, (newRow: Row) → void]
useValueState(valueId)                 → [Value | undefined, (newValue: Value) → void]
```

**App context:**
```
useApp()  → { isReady: boolean, isSyncing: boolean }
  Required in root App component — activates sync. isReady is always true (template gates rendering).

useUser() → { isSignedIn: boolean, isLoaded: boolean, user: { email, id, firstName, lastName, username } }
  Private apps only. Email is always present. Use oidcUser.email as the user identifier.
```

### Step 0: Classify Your App Before Designing Tables

Before writing any code, determine whether the app involves multiple users acting independently. This changes everything about how you structure data.

**Ask:** Can two people use this app at the same time and see each other's actions?

- **Single-user** (todo list, personal tracker, recipe book) — All data goes in TinyBase tables with auto-generated IDs. No user identity needed. Sync just gives the user their data on all their devices.

- **Multi-user** (chat, game, shared board, auction, poll, collaborative tool) — Every piece of state needs a clear owner. Read `${CLAUDE_SKILL_DIR}/references/multiplayer-guide.md` before designing tables. Plan each table as one of:
  - **Shared state** — all users see the same data (messages, tasks, game board). Use auto-generated row IDs or a well-known row key like `'shared'`.
  - **Per-user state** — each user has their own version (my vote, my team, my filter preference). Key rows by `oidcUser.email`.
  - **User-attributed items** — shared collection where each item belongs to someone (bids, inventory). Auto-generated row IDs with a `createdBy` or `owner` cell.

**Common trap:** A prompt like "auction app" or "shared timer" doesn't say "multiplayer" but absolutely requires per-user vs shared state reasoning. If two users could have different views or make independent choices, it's multi-user.

---

### Data Access Patterns

### Always Call useApp()

Call `useApp()` in the root App component — this activates the sync connection. Without it, TinyBase data stays local-only and never syncs across devices.

```jsx
function App() {
  const { isReady, isSyncing } = useApp();
  // ... rest of your app
}
```

This is not optional. Never skip it. Never move it to a child component.

### Getting the Signed-In User

Do not use `useApp().user` — it is always null. Use `useUser()` instead:

```jsx
const { user: oidcUser, isSignedIn } = useUser();
const userEmail = oidcUser.email;   // always a string — OIDC guarantees it
const userName = oidcUser.firstName || oidcUser.email.split('@')[0];
```

`useUser()` is a global (no import needed). It returns `{ isSignedIn, isLoaded, user }` where `user` has `.email`, `.id`, `.firstName`, `.lastName`, `.username`.

**Email is always present** — the OIDC provider guarantees it, so use `oidcUser.email` directly (no `?.`, no fallback). The template gates rendering behind auth, so by the time your component runs, the user is always signed in and `email` is always a string. If you add optional chaining or a fallback like `|| 'anonymous'`, you're guarding against a case that can't happen — and the fallback creates a bug where every user appears identical.

**For auth gating:**
```jsx
const { isSignedIn } = useUser();
if (!isSignedIn) return <SignInButton />;
```

`useUser()` is only available in private apps (apps deployed with the Private toggle). In public apps, `useUser` is undefined — check with `typeof useUser === 'function'` before calling it.

For detailed code examples (reactivity, master-detail, filtering, forms, custom ordering, multi-table references), read `${CLAUDE_SKILL_DIR}/references/tinybase-patterns.md`.

**Essential patterns at a glance:**

```jsx
// List rows — useRowIds + child components (fine-grained reactivity)
const ids = useRowIds('todos');
ids.map(id => <TodoItem key={id} id={id} />);

// Read cells in child components
const text = useCell('todos', id, 'text');

// Add rows
const addTodo = useAddRowCallback('todos', (text) => ({
  text, done: false, createdAt: Date.now(),
}), []);

// Toggle with MapCell pattern
const toggleDone = useSetCellCallback('todos', id, 'done', (_e) => (cur) => !cur);

// State hooks — [value, setter] like useState but persisted
const [name, setName] = useCellState('todos', id, 'name');
const [theme, setTheme] = useValueState('theme');

// Pagination
const itemIds = useSortedRowIds('items', 'createdAt', true, page * 25, 25);

// Delete
const deleteTodo = useDelRowCallback('todos', id);
```

### Choosing Your Pattern

- **useCellState** = Read + write a single cell. Best for: inline editing, toggles.
- **useValueState** = Read + write an app-level value. Best for: settings, preferences.
- **useCell / useRow** = Read-only. Prefer `useCell` for fine-grained reactivity.
- **useAddRowCallback** = Create new rows. Best for: forms, new items.
- **useSetCellCallback** = Update a cell (supports MapCell toggle pattern). Best for: onClick handlers.
- **useSetPartialRowCallback** = Update multiple cells without replacing the row. Best for: form saves.
- **useRowIds + child components** = List all rows. Each child reads its own data.
- **useSortedRowIds** = Sorted/paginated lists. Best for: tables, feeds, leaderboards.
- **useValue / useSetValueCallback** = Read / write app-level values via callbacks.

### Common App Architectures

| App Type | Tables | Key Patterns |
|----------|--------|-------------|
| **Todo/Task list** | `tasks` | `useRowIds` + child items, `useSetCellCallback` for toggles, `useSortedRowIds` for ordering |
| **Kanban board** | `cards` | Status cell for columns, filter by status per column, `store.setCell` for cross-column moves |
| **Chat / Messaging** | `messages`, `users` | `useSortedRowIds('messages', 'timestamp')`, user email as row key in `users` table, auto-scroll with `useRef` |
| **Recipe / Content app** | `items` | Master-detail with `useState(selectedId)`, `useHasRow` for safe detail view, `useCellState` for live editing |
| **Multiplayer game** | `players`, `state` | Email-keyed rows in `players` for per-user state, shared game state in a `state` table row (`useCellState('state', 'shared', 'phase')`), turn tracking via shared cell |
| **Dashboard / Analytics** | `entries`, `preferences` | `useSortedRowIds` with pagination, computed stats inline, per-user filter prefs in `preferences` table keyed by email |
| **Settings / Preferences** | `preferences` | `useCellState('preferences', myEmail, 'theme')` for per-user settings — persists and syncs |

### Game and Timer Patterns

Timer countdown is local UI state (`useState`), scores and progress belong in TinyBase. For turn-based games, store board state as shared data and player identity as per-user rows keyed by email. Full patterns: `${CLAUDE_SKILL_DIR}/references/game-patterns.md`.

### Multiplayer and Shared Apps

For multiplayer apps, read the full guide: `${CLAUDE_SKILL_DIR}/references/multiplayer-guide.md`.

Key principles:
- **Per-user state**: key rows by `oidcUser.email` — `useCellState('players', myEmail, 'team')`
- **Shared state**: use a table row with a well-known key — `useCellState('state', 'shared', 'gameStatus')` — or auto-generated row IDs for shared items
- **User attribution**: add `createdBy: userEmail` to user-owned rows, filter by it to show "my stuff"
- **Users table**: every shared app registers users on load via `useSetRowCallback('users', myEmail, ...)`
- **Write through hooks**, not `store.*` — hooks notify React's reactivity system
- **Private apps required** — multiplayer needs auth for user identity (`useUser()`)
- **Direct `store.*` access**: only in `useEffect` when the row ID is determined at runtime (e.g., slot assignment)

---

## AI Features (Optional)

If the user's prompt suggests AI features (chatbot, summarize, generate, analyze, recommend), read the full guide: `${CLAUDE_SKILL_DIR}/references/ai-integration.md`.

Quick summary:
- **Detection signals**: "chatbot", "AI", "summarize", "generate", "smart"
- **Ask for OpenRouter key**: `https://openrouter.ai/keys`
- **`useAI()` returns**: `{ callAI, streamAI, loading, error, clearError }`
- **Isolate in a child component** — prevents AI loading state from re-rendering data components
- **Deploy with**: `--ai-key "sk-or-v1-..."` flag on deploy command

---

## Sharing / Inviting Users

Sharing is handled at the deployment level — the WebSocket sync room is scoped per app. Users who have the app URL can collaborate in real-time. Access control is managed by the deploy infrastructure.

---

## Reference App

Complete working example — a shared grocery list. Study this pattern before generating code:

```jsx
export default function App() {
  const { isReady, isSyncing } = useApp();
  return (
    <div className="max-w-md mx-auto p-4">
      <h1 className="text-xl font-bold mb-4">Grocery List</h1>
      <AddItem />
      <ItemList />
    </div>
  );
}

function AddItem() {
  const [input, setInput] = useState('');
  const addItem = useAddRowCallback(
    'items',
    (text) => ({
      name: text ?? '',
      bought: false,
      createdAt: Date.now(),
    }),
    [],
  );
  const handleAdd = () => {
    if (input.trim()) {
      addItem(input.trim());
      setInput('');
    }
  };
  return (
    <div className="flex gap-2 mb-4">
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        className="flex-1 border rounded px-3 py-2"
        placeholder="Add item..."
      />
      <button onClick={handleAdd} className="btn">Add</button>
    </div>
  );
}

function ItemList() {
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;
  const totalItems = useRowCount('items');
  const itemIds = useSortedRowIds('items', 'createdAt', true, page * PAGE_SIZE, PAGE_SIZE);
  return (
    <div>
      {itemIds.map(id => <GroceryItem key={id} id={id} />)}
      {totalItems > (page + 1) * PAGE_SIZE && (
        <button onClick={() => setPage(p => p + 1)} className="w-full py-2 text-sm opacity-60">
          Load more
        </button>
      )}
    </div>
  );
}

function GroceryItem({ id }) {
  const name = useCell('items', id, 'name');
  const bought = useCell('items', id, 'bought');
  const toggleBought = useSetCellCallback(
    'items', id, 'bought',
    (_e) => (current) => !current,
  );
  const remove = useDelRowCallback('items', id);

  return (
    <div className="flex items-center gap-2 py-2 border-b">
      <button onClick={toggleBought} className="w-6 h-6 flex items-center justify-center">
        {bought ? '✓' : '○'}
      </button>
      <span className={bought ? 'line-through opacity-40 flex-1' : 'flex-1'}>
        {name}
      </span>
      <button onClick={remove} className="text-red-400 text-sm">x</button>
    </div>
  );
}
```

**Key patterns demonstrated:**
- `useApp()` activates sync — called in root component
- `useAddRowCallback` with deps array for closures
- `useSortedRowIds` with pagination (PAGE_SIZE 25)
- `useCell` in child components for fine-grained reactivity
- `useSetCellCallback` with MapCell pattern `(_e) => (current) => !current` for toggles
- `useDelRowCallback` for deletion
- No imports, no store access, no schema — all hooks are globals

---

## Patterns That Prevent Bugs

Quick checklist — for detailed explanations and code examples, read `${CLAUDE_SKILL_DIR}/references/bug-prevention.md`.

- **NEVER call hooks inside loops** — `useCell` inside `.map()`, `.filter()`, `.forEach()` crashes when list length changes (React error #310). Render a child component per row instead, or use `useTable` for small tables.
- **Use `useCell` in child components**, not `useTable` — avoids re-rendering the entire list on every change
- **Use string literals for table names** — `useRowIds('todos')`, not variables or constants
- **Include closure deps** in callback hooks — `[oidcUser.email]` not `[]` when using email
- **Use `useSetPartialRowCallback`** instead of `useSetRowCallback` — preserves concurrent edits to other cells
- **Cells are scalars only** — strings, numbers, booleans. Objects in cells break CRDT granularity
- **Guard cell values** — `useCell`/`useValue` return `undefined` when unset; use `String(val || '')`
- **One argument per callback** — `setVal(x)` not `setVal(null, x)`. Second arg is the Store reference.
- **No imports, no `createStore`, no `store.*` writes** — hooks are globals, the template manages infrastructure
- **Seed demo data via button**, not `useEffect` on mount — hydration races cause data loss or duplication
- **Every app needs a "Load Demo Data" button** — visible when table is empty (`useRowCount('tableName') === 0`)
- **`isReady` is always true** — the template gates rendering. Use `useApp()` for sync activation, not readiness checks.
- **No sync/connection status UI — not even decorative** — the template renders a built-in `SyncStatusDot` (top-right corner). Never render anything that implies connection state, including static labels like "Online", "LIVE", "Connected", "Crew Online", or user-online counts. Use `isSyncing` for logic only (e.g., disabling a button), never for display.
- **Never set Values or Cells to `null`** — this deletes them from the CRDT. Use sentinel values (`0`, `false`, `''`) to represent "cleared" state. Rapid delete-then-recreate causes sync failures.
- **Derive roles from data, not Values** — don't use `if (!hostEmail) setHostEmail(myEmail)` for first-writer-wins. Both clients race. Instead, derive the host from the `users` table (earliest `joinedAt` wins).
