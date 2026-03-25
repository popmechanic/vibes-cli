---
name: Bug Prevention
description: Common TinyBase bugs — reactivity, closure deps, CRDT granularity, callback argument shape, undefined cell guards, demo data seeding
---

# Bug Prevention Patterns

Detailed explanations of the most common bugs agents encounter when generating TinyBase code. Each pattern explains the reasoning so you can apply the principle to novel situations.

---

## Never Call Hooks Inside Loops or Callbacks

React hooks must be called at the **top level** of a component — never inside `.map()`, `.filter()`, `.forEach()`, conditionals, or any other nested function. When the array length changes between renders, the number of hook calls changes, and React crashes with error #310 ("Rendered fewer hooks than expected").

This applies to ALL hooks — `useCell`, `useRow`, `useHasRow`, `useState`, etc.

```jsx
// BAD — hooks inside .filter() and .forEach() crash when list length changes
function Dashboard() {
  const entryIds = useRowIds('entries');
  const totals = {};
  entryIds.forEach(id => {
    const cat = useCell('entries', id, 'category');  // CRASH: hook count varies
    const amt = useCell('entries', id, 'amount');     // CRASH: hook count varies
    totals[cat] = (totals[cat] || 0) + amt;
  });
  // ...
}

// BAD — hooks inside .filter() crash when list length changes
function Column({ status }) {
  const allIds = useRowIds('tasks');
  const filtered = allIds.filter(id => {
    const s = useCell('tasks', id, 'status');  // CRASH: hook count varies
    return s === status;
  });
  // ...
}
```

**Fix option A: Render a child component per row** (preferred — fine-grained reactivity):

```jsx
// GOOD — each child calls hooks at its own top level
function Column({ status }) {
  const allIds = useRowIds('tasks');
  return allIds.map(id => <TaskCard key={id} id={id} showForStatus={status} />);
}
function TaskCard({ id, showForStatus }) {
  const status = useCell('tasks', id, 'status');  // top-level — safe
  if (status !== showForStatus) return null;       // filter by returning null
  const title = useCell('tasks', id, 'title');
  return <div>{title}</div>;
}
```

**Fix option B: Use `useTable` to read all data at once** (OK for small tables):

```jsx
// GOOD — one hook call, then filter plain objects
function Dashboard() {
  const entries = useTable('entries');  // one hook call — always stable
  const totals = {};
  Object.values(entries).forEach(row => {
    totals[row.category] = (totals[row.category] || 0) + (row.amount || 0);
  });
  // ...
}
```

Use option A when the table could be large (tasks, messages, entries). Use option B only for small, bounded tables (players, preferences, slots).

### Conditional Hook Calls

The same rule applies to **ternary expressions and if/else blocks**. A hook inside a conditional runs on some renders but not others — React crashes with error #310.

```jsx
// BAD — hook called conditionally, crashes when booking becomes null
function SlotCard({ id }) {
  const booking = useRow('bookings', id);
  const deleteBooking = booking ? useDelRowCallback('bookings', id) : null;  // CRASH
  // ...
}

// GOOD — call unconditionally, guard the invocation instead
function SlotCard({ id }) {
  const booking = useRow('bookings', id);
  const deleteBooking = useDelRowCallback('bookings', id);  // always called
  // Only invoke deleteBooking when booking exists:
  const handleDelete = () => { if (booking) deleteBooking(); };
  // ...
}
```

---

## Guard useUser() for Public/Preview Mode

`useUser()` provides meaningful identity in **private apps only**. The template installs a `useUser` stub for public apps that returns `{ email: null }`, so `useUser` is technically always defined. Since every app runs in preview mode before being deployed as private, **every use of `useUser()` must be guarded:**

```jsx
// BAD — crashes in preview mode before stub is loaded
const { user: oidcUser } = useUser();
const userEmail = oidcUser.email;  // CRASH: user may be null

// GOOD — works everywhere, real email when deployed private
const oidcUser = typeof useUser === 'function' ? useUser()?.user : null;
const userEmail = oidcUser?.email || 'anonymous';
```

This is the **only** correct pattern. Never call `useUser()` directly without the `typeof` guard.

The `'anonymous'` fallback is for **preview mode only** (testing before deploy). Public apps that need per-user state must use the username gate pattern (see multiplayer-guide.md § Public Multiplayer Apps), not the anonymous fallback. If multiple users all show as `'anonymous'`, per-user state is broken.

---

## useUser() Stub in Public Apps

`useUser` is always defined — the template installs a stub for public apps. The stub returns `{ email: null }`. This means:

- **Do NOT use `typeof useUser === 'function'` as a proxy for "is this a private app"** — it's always true.
- **Check `useUser()?.user?.email` for a truthy string** to determine if real OIDC auth is available.

```jsx
// BAD — always true, even in public apps
if (typeof useUser === 'function') { /* "must be private" — WRONG */ }

// GOOD — actually checks for real auth
const oidcUser = typeof useUser === 'function' ? useUser()?.user : null;
if (oidcUser?.email) { /* real OIDC user with email */ }
```

---

## Reactivity and Performance

TinyBase hooks subscribe to specific data. Subscribing too broadly causes unnecessary re-renders — the UI rebuilds every time any cell in the table changes, even cells not visible on screen. Keep subscriptions narrow by letting each component read only the data it displays:

```jsx
// Each child subscribes only to its own row's cells
function TodoList() {
  const ids = useRowIds('todos');
  return ids.map(id => <TodoItem key={id} id={id} />);
}
function TodoItem({ id }) {
  const text = useCell('todos', id, 'text');
  return <div>{text}</div>;
}
```

---

## String Literals for Table Names

Pass table names as plain string literals directly in hook calls. The template and tooling rely on seeing the actual table name in the code — variables or template literals obscure this and make the code harder to reason about:

```jsx
const ids = useRowIds('todos');           // readable and greppable
const text = useCell('todos', id, 'text');
```

Similarly, call TinyBase hooks directly rather than wrapping them in custom hooks. A `useItems()` wrapper hides which table is being accessed and adds indirection without benefit.

---

## Closure Deps in Callback Hooks

Callback hooks like `useAddRowCallback` capture variables from their closure. Include any value that changes over time in the deps array — otherwise the callback sees a stale snapshot:

```jsx
const oidcUser = typeof useUser === 'function' ? useUser()?.user : null;
const userEmail = oidcUser?.email || 'anonymous';

const addTodo = useAddRowCallback(
  'todos',
  () => ({ createdBy: userEmail, createdAt: Date.now() }),
  [userEmail],  // re-create callback when user changes
);
```

---

## Partial Updates Preserve Concurrent Edits

TinyBase sync uses cell-level CRDTs — each cell tracks its own last-write timestamp independently. `useSetRowCallback` replaces the entire row, which means cells you omit get deleted and concurrent edits to other cells are lost. Use `useSetPartialRowCallback` to update only the cells you intend to change:

```jsx
const updateName = useSetPartialRowCallback(
  'todos', id,
  (newName) => ({ name: newName }),  // only 'name' is touched
);
```

For the same reason, cells must be scalars (string, number, boolean). Storing a JSON-stringified object in a single cell defeats the CRDT granularity — two users editing different fields of the same object will overwrite each other because the entire serialized string is one cell.

---

## Cell Types Can Be Undefined

`useValue()` and `useCell()` return `undefined` when unset, and can return `number` or `boolean` — not just strings. Guard before calling string methods to avoid runtime crashes:

```jsx
const playerId = useValue('playerId');
const display = String(playerId || '');    // safe — works for any type
```

---

## Callback Argument Shape

Each callback hook returns a function that takes ONE argument — the parameter you pass when calling it. The second argument slot is reserved for the Store reference (injected by TinyBase). Passing `(null, value)` sends `null` as your parameter and drops the value:

```jsx
const setPlayerId = useSetValueCallback('playerId', (val) => val);
setPlayerId(userEmail);       // correct — userEmail is the parameter
// setPlayerId(null, userEmail) would pass null as the parameter
```

---

## The Template Handles Infrastructure

The template manages React, store creation, persistence, sync, and the import map. Generated code lives inside the template's scope, so these constraints apply naturally:

- **All hooks and React are globals** — the template exposes them via `window.*`. Writing `import` statements creates duplicate module instances that break React's context system.
- **The store already exists** — `createStore()` or `createMergeableStore()` would create a second, disconnected store. Use hooks to read and write the template's store.
- **Write data through hooks** — callback hooks notify the reactive system so all subscribers update. Direct `store.setCell()` works but bypasses reactivity, so other components won't re-render. (The rare exception: imperative writes in `useEffect` where the row ID is determined at runtime — see the multiplayer guide's "slots" pattern.)
- **AI calls go through `useAI`** — the hook handles auth and proxying through the deploy infrastructure. Direct `fetch()` to AI APIs won't work in production.
- **The "useContext is null" error** means the import map was modified — the template prevents this via `?external=react,react-dom`. If you see it, check that the import map in the base template is intact.

---

## Never Set Values or Cells to Null

Setting a Value or Cell to `null` **deletes** it from the CRDT. If you then immediately re-create it (`setTimerRunning(false)` then `setTimerRunning(true)`), the delete and create have near-identical timestamps, causing sync issues — the other client may receive the deletion but miss the re-creation, or the CRDT merge may resolve in favor of the delete.

```jsx
// BAD — setting to null deletes the Value, causing sync issues on re-create
const stopTimer = () => {
  setTimerRunning(false);
  setTimerEndTime(null);    // DELETES the Value — sync race on next start
  setTimerDuration(null);   // DELETES the Value
};

// GOOD — use sentinel values to represent "cleared" state
const stopTimer = () => {
  setTimerRunning(false);
  setTimerEndTime(0);       // 0 means "no end time" — check with > 0
  setTimerDuration(0);      // 0 means "no duration"
};
```

**Rule:** Use `0`, `false`, or `''` (empty string) as "cleared" sentinel values. Check for them explicitly (`timerEndTime > 0`, `status !== ''`) rather than relying on truthiness. This keeps the Value alive in the CRDT and avoids delete-recreate race conditions.

---

## Demo Data Pattern

Seed demo data via a user-triggered button, not `useEffect` on mount. The store hydrates asynchronously from localStorage/sync — a mount-time write can race with hydration and either lose data or duplicate it:

```jsx
function App() {
  const count = useRowCount('todos');
  const addTodo = useAddRowCallback('todos', (item) => item, []);
  const seedDemo = () => {
    DEFAULTS.forEach(item => addTodo(item));
  };
  return count === 0 ? <button onClick={seedDemo}>Load Demo Data</button> : <TodoList />;
}
```
