---
name: Bug Prevention
description: Common TinyBase bugs — reactivity, closure deps, CRDT granularity, callback argument shape, undefined cell guards, demo data seeding
---

# Bug Prevention Patterns

Detailed explanations of the most common bugs agents encounter when generating TinyBase code. Each pattern explains the reasoning so you can apply the principle to novel situations.

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
const addTodo = useAddRowCallback(
  'todos',
  () => ({ createdBy: oidcUser.email, createdAt: Date.now() }),
  [oidcUser.email],  // re-create callback when user changes
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
