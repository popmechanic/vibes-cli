/**
 * TinyBase Fixture: Basic CRUD
 * Tests: useRowIds, useCell, useAddRowCallback, useSetCellCallback (MapCell),
 *        useDelRowCallback, useApp, useRowCount, useState
 */
export default function App() {
  const { isReady, isSyncing } = useApp();
  const [input, setInput] = React.useState('');

  const addItem = useAddRowCallback(
    'items',
    (text) => ({
      text: text ?? '',
      done: false,
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

  const count = useRowCount('items');

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>TinyBase CRUD Test</h1>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Add item..."
          style={{ flex: 1, padding: '0.5rem' }}
        />
        <button onClick={handleAdd}>Add</button>
      </div>
      <p>Total items: {count}</p>
      <ItemList />
    </div>
  );
}

function ItemList() {
  const ids = useRowIds('items');
  return (
    <div>
      {ids.map(id => <Item key={id} id={id} />)}
    </div>
  );
}

function Item({ id }) {
  const text = useCell('items', id, 'text');
  const done = useCell('items', id, 'done');

  const toggleDone = useSetCellCallback(
    'items', id, 'done',
    (_e) => (current) => !current,
  );

  const deleteItem = useDelRowCallback('items', id);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0' }}>
      <button onClick={toggleDone}>{done ? '✓' : '○'}</button>
      <span style={{ flex: 1, textDecoration: done ? 'line-through' : 'none' }}>{text}</span>
      <button onClick={deleteItem} style={{ color: 'red' }}>×</button>
    </div>
  );
}
