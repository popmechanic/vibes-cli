/**
 * TinyBase Fixture: Existence Check Hooks
 * Tests: useHasRow, useHasCell, useHasValue, useCellIds, useTableIds
 * Pattern: Safe detail view that handles deleted rows gracefully
 */
export default function App() {
  const { isReady, isSyncing } = useApp();
  const [selectedId, setSelectedId] = React.useState(null);

  const addItem = useAddRowCallback(
    'items',
    (text) => ({
      name: text,
      description: 'A sample item',
      createdAt: Date.now(),
    }),
    [],
  );

  const count = useRowCount('items');

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Existence Checks Test</h1>
      <StoreInfo />
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={() => addItem('Item ' + (count + 1))}>Add Item</button>
      </div>
      {selectedId ? (
        <ItemDetail id={selectedId} onBack={() => setSelectedId(null)} />
      ) : (
        <ItemList onSelect={setSelectedId} />
      )}
    </div>
  );
}

function StoreInfo() {
  const tableIds = useTableIds();
  const hasTheme = useHasValue('theme');
  return (
    <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '1rem' }}>
      <p>Tables in store: {tableIds.length > 0 ? tableIds.join(', ') : '(none)'}</p>
      <p>Theme value set: {hasTheme ? 'yes' : 'no'}</p>
    </div>
  );
}

function ItemList({ onSelect }) {
  const ids = useRowIds('items');
  return (
    <div>
      {ids.length === 0 && <p style={{ color: '#888' }}>No items yet</p>}
      {ids.map(id => (
        <ItemRow key={id} id={id} onSelect={() => onSelect(id)} />
      ))}
    </div>
  );
}

function ItemRow({ id, onSelect }) {
  const name = useCell('items', id, 'name');
  const hasDescription = useHasCell('items', id, 'description');
  return (
    <div
      onClick={onSelect}
      style={{ padding: '0.5rem', borderBottom: '1px solid #eee', cursor: 'pointer' }}
    >
      <strong>{String(name || '')}</strong>
      {hasDescription && <span style={{ marginLeft: '0.5rem', color: '#888' }}>(has description)</span>}
    </div>
  );
}

function ItemDetail({ id, onBack }) {
  const exists = useHasRow('items', id);
  if (!exists) {
    return (
      <div>
        <p>This item was deleted.</p>
        <button onClick={onBack}>Go back</button>
      </div>
    );
  }
  return <ItemContent id={id} onBack={onBack} />;
}

function ItemContent({ id, onBack }) {
  const name = useCell('items', id, 'name');
  const description = useCell('items', id, 'description');
  const cellIds = useCellIds('items', id);
  const deleteItem = useDelRowCallback('items', id);

  return (
    <div>
      <button onClick={onBack}>← Back</button>
      <h2>{String(name || '')}</h2>
      <p>{String(description || '')}</p>
      <p style={{ fontSize: '0.8rem', color: '#888' }}>
        Cells: {cellIds.join(', ')}
      </p>
      <button onClick={() => { deleteItem(); onBack(); }} style={{ color: 'red' }}>
        Delete Item
      </button>
    </div>
  );
}
