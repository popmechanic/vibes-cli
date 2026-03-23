---
name: TinyBase Patterns
description: Data patterns — reactivity, master-detail, filtering, forms, ordering, pagination, multi-table references, kanban
---

# TinyBase Data Patterns

Detailed patterns for structuring TinyBase data in Vibes apps. For the hook API reference and quick-start guidance, see SKILL.md.

---

## Fine-Grained Reactivity

Each component should call its own hooks — this limits re-renders to only the component whose data changed:

```jsx
// Each child subscribes only to its own row's cells
function TodoList() {
  const ids = useRowIds('todos');
  return ids.map(id => <TodoItem key={id} id={id} />);
}
function TodoItem({ id }) {
  const text = useCell('todos', id, 'text');
  const done = useCell('todos', id, 'done');
  return <div>{text}</div>;
}

// Avoid for large tables — useTable re-renders on ANY cell change
function App() {
  const todos = useTable('todos');
  // Every keystroke in every todo re-renders this entire component
}
```

Reserve `useTable` for small, fixed-size tables (settings, game slots, categories) where re-rendering the whole table is acceptable. For anything with user-generated rows, use `useRowIds` + child components.

---

## Safe Detail Views with useHasRow

In multiplayer, another user might delete a row while you're viewing it. `useHasRow` prevents rendering undefined values:

```jsx
function ItemDetail({ id, onBack }) {
  const exists = useHasRow('items', id);
  if (!exists) return <p>This item was deleted. <button onClick={onBack}>Go back</button></p>;
  return <ItemContent id={id} />;
}

function ItemContent({ id }) {
  const name = useCell('items', id, 'name');
  const description = useCell('items', id, 'description');
  return <div><h2>{name}</h2><p>{description}</p></div>;
}
```

---

## Adding Rows with useAddRowCallback

```jsx
const addTodo = useAddRowCallback(
  'todos',
  (text) => ({
    text: text ?? '',
    done: false,
    createdBy: oidcUser.email,
    createdAt: Date.now(),
  }),
  [oidcUser.email],  // deps — include anything from closure that changes
);
```

---

## Toggling/Incrementing with MapCell Pattern

```jsx
const toggleDone = useSetCellCallback(
  'todos', id, 'done',
  (_e) => (currentValue) => !currentValue,
);
```

---

## Partial Updates (Prefer Over Full Row Replacement)

```jsx
const updateName = useSetPartialRowCallback(
  'todos', id,
  (newName) => ({ name: newName }),
);
```

---

## Listing Rows — useRowIds + Child Components

```jsx
function TodoList() {
  const ids = useRowIds('todos');
  return ids.map(id => <TodoItem key={id} id={id} />);
}
```

---

## Pagination with useSortedRowIds

```jsx
const PAGE_SIZE = 25;
const itemIds = useSortedRowIds('items', 'createdAt', true, page * PAGE_SIZE, PAGE_SIZE);
```

---

## Values for App-Level State

```jsx
const theme = useValue('theme');
const setTheme = useSetValueCallback('theme', (newTheme) => newTheme);
// Call with ONE argument — the parameter that gets passed to the callback:
setTheme('dark');  // callback receives 'dark', returns 'dark', stored as value

// The second argument is the Store reference, not your value:
// setTheme(null, 'dark');  // null becomes the parameter, 'dark' is dropped
```

---

## Deleting Rows

```jsx
const deleteTodo = useDelRowCallback('todos', id);
```

---

## Convenience State Hooks — Familiar [value, setValue] Pattern

```jsx
// Read + write a single cell (like useState but persisted and synced)
const [name, setName] = useCellState('todos', id, 'name');

// Read + write an app-level value
const [theme, setTheme] = useValueState('theme');

// Read + write an entire row
const [row, setRow] = useRowState('todos', id);
```

These are simpler than callback hooks when you need both the value and a setter. Data is persisted and synced automatically — unlike `useState`, which is ephemeral.

---

## Multi-Table References (No Joins)

TinyBase has no JOIN or relational queries. For related data, store the foreign key as a scalar cell and look it up with `useCell` from the other table:

```jsx
// Tasks reference categories by ID — store categoryId as a cell
const addTask = useAddRowCallback('tasks', (data) => ({
  title: data.title,
  categoryId: data.categoryId,  // foreign key — just a string
  done: false,
}), []);

// In a child component, look up the related record:
function TaskItem({ id }) {
  const categoryId = useCell('tasks', id, 'categoryId');
  const categoryName = useCell('categories', String(categoryId || ''), 'name');
  // Guard with String() — categoryId could be undefined if not set yet
  return <span>{categoryName}</span>;
}
```

Keep the data flat — store the category ID as a string cell, not an embedded object. Since TinyBase sync works at the cell level, an object serialized into one cell loses the granularity that makes concurrent edits safe:

```jsx
// Flat: each field is its own cell, syncs independently
addTask({ title: 'Buy milk', categoryId: '1' });

// Nested object in a cell would serialize as one value —
// two users editing different fields would overwrite each other
```

---

## Master-Detail Navigation

Most apps need a list view that navigates to a detail/edit view. Use `useState` for the selected ID — view routing is ephemeral UI state (refreshing the page should return to the list). Use `useHasRow` in the detail view to handle the case where the item was deleted while you were viewing it:

```jsx
function App() {
  const [selectedId, setSelectedId] = React.useState(null);
  return selectedId
    ? <Detail id={selectedId} onBack={() => setSelectedId(null)} />
    : <List onSelect={setSelectedId} />;
}

function Detail({ id, onBack }) {
  const exists = useHasRow('items', id);
  if (!exists) return <p>Deleted. <button onClick={onBack}>Back</button></p>;
  return <Editor id={id} onBack={onBack} />;
}
```

This pattern avoids react-router (which would add a React singleton risk via esm.sh) while providing clean navigation with back buttons.

---

## Custom Ordering (Sortable Lists, Kanban)

For manually ordered lists, add a numeric `order` cell and sort with `useSortedRowIds`. This avoids pulling in drag-and-drop libraries (which risk the React singleton problem) and works naturally with sync:

```jsx
// Sort by 'order' cell — ascending for manual ordering
const sortedIds = useSortedRowIds('tasks', 'order', false);

// New items get order = current count (append at end)
const addTask = useAddRowCallback('tasks', (text) => ({
  title: text, order: count,
}), [count]);
```

To reorder (via up/down buttons or drag handles), swap the `order` values between adjacent items. This is one of the rare cases where direct `store.setCell()` is appropriate — you need to update two rows atomically, and the row IDs are determined at runtime:

```jsx
const moveUp = () => {
  const otherId = sortedIds[index - 1];
  store.setCell('tasks', id, 'order', Number(order) - 1);
  store.setCell('tasks', otherId, 'order', Number(order));
};
```

---

## Form Editing: Live vs Draft

Two approaches for editing TinyBase data through forms, each suited to different UX needs:

**Live editing** — `useCellState` writes on every keystroke. Other users see changes in real-time. Best for collaborative editing where there's no "save" action:
```jsx
function EditableTitle({ id }) {
  const [title, setTitle] = useCellState('items', id, 'title');
  return <input value={String(title || '')} onChange={e => setTitle(e.target.value)} />;
}
```

**Draft-then-save** — buffer in `useState`, write to TinyBase on submit. Best for forms with validation, cancel buttons, or where you want the user to confirm before persisting:
```jsx
function NewItemForm({ onSave }) {
  const [title, setTitle] = React.useState('');
  const handleSubmit = () => { if (title.trim()) onSave(title.trim()); };
  return <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} />;
}
```

Choose live editing when immediate sync matters (multiplayer whiteboards, shared docs). Choose draft-then-save when the user needs to review before committing (contact forms, settings panels, new item creation).

---

## Filtering and Computed Views

To show a filtered subset of rows, render all IDs and let each child decide whether to display itself. This keeps TinyBase subscriptions simple — no derived tables or complex queries needed:

```jsx
function FilteredList() {
  const allIds = useRowIds('tasks');
  const categoryFilter = useValue('filter_category');
  return allIds.map(id => (
    <FilteredItem key={id} id={id} filter={String(categoryFilter || 'all')} />
  ));
}

function FilteredItem({ id, filter }) {
  const category = useCell('tasks', id, 'category');
  if (filter !== 'all' && category !== filter) return null;
  const title = useCell('tasks', id, 'title');
  return <div>{title}</div>;
}
```

For computed stats (counts, sums), calculate inline in the component. Store the filter preference in TinyBase Values so it persists across reloads, but keep ephemeral UI state (search text while typing) in `useState`.
