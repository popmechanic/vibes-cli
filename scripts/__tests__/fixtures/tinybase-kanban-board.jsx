/**
 * TinyBase Fixture: Kanban Board
 * Tests: Status-based columns, cross-column movement, ordered items within columns,
 *        useRowIds + filtering per column, useSetCellCallback for status changes.
 * Pattern: The most common complex app pattern — combines filtering, ordering,
 *          and status management without external drag-and-drop libraries.
 */
export default function App() {
  const { isReady, isSyncing } = useApp();
  const count = useRowCount('cards');

  const addCard = useAddRowCallback(
    'cards',
    (item) => item,
    [],
  );

  const seedDemo = () => {
    addCard({ title: 'Research competitors', status: 'todo', order: 0, createdAt: Date.now() });
    addCard({ title: 'Design wireframes', status: 'todo', order: 1, createdAt: Date.now() });
    addCard({ title: 'Build landing page', status: 'doing', order: 0, createdAt: Date.now() });
    addCard({ title: 'Set up CI/CD', status: 'doing', order: 1, createdAt: Date.now() });
    addCard({ title: 'Write README', status: 'done', order: 0, createdAt: Date.now() });
  };

  return (
    <div style={{ padding: '1rem', fontFamily: 'system-ui' }}>
      <h1 style={{ marginBottom: '1rem' }}>Kanban Board</h1>
      {count === 0 ? (
        <button onClick={seedDemo}>Load Demo Data</button>
      ) : (
        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto' }}>
          <Column status="todo" title="To Do" color="#f59e0b" />
          <Column status="doing" title="In Progress" color="#3b82f6" />
          <Column status="done" title="Done" color="#22c55e" />
        </div>
      )}
    </div>
  );
}

function Column({ status, title, color }) {
  const allIds = useRowIds('cards');
  const [input, setInput] = React.useState('');
  const columnCount = useRowCount('cards');

  const addCard = useAddRowCallback(
    'cards',
    (text) => ({
      title: text,
      status,
      order: columnCount,
      createdAt: Date.now(),
    }),
    [status, columnCount],
  );

  const handleAdd = () => {
    if (input.trim()) {
      addCard(input.trim());
      setInput('');
    }
  };

  return (
    <div style={{
      minWidth: '250px', background: '#f8f9fa', borderRadius: '8px',
      padding: '0.75rem', flex: 1,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: `3px solid ${color}`,
      }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{title}</h3>
        <ColumnCount status={status} />
      </div>

      {/* Filter cards by status — each card decides if it belongs here */}
      {allIds.map(id => <KanbanCard key={id} id={id} columnStatus={status} />)}

      <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.5rem' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="+ Add card..."
          style={{ flex: 1, padding: '0.4rem', border: '1px dashed #ccc', borderRadius: '4px', background: 'transparent', fontSize: '0.85rem' }}
        />
      </div>
    </div>
  );
}

function ColumnCount({ status }) {
  const allIds = useRowIds('cards');
  let count = 0;
  for (const id of allIds) {
    const s = useCell('cards', id, 'status');
    if (s === status) count++;
  }
  return <span style={{ color: '#888', fontSize: '0.8rem' }}>({count})</span>;
}

function KanbanCard({ id, columnStatus }) {
  const title = useCell('cards', id, 'title');
  const status = useCell('cards', id, 'status');

  // Only render in the matching column
  if (status !== columnStatus) return null;

  const deleteCard = useDelRowCallback('cards', id);

  // Move between columns by changing the status cell
  const moveLeft = () => {
    const prev = { doing: 'todo', done: 'doing' };
    if (prev[status]) store.setCell('cards', id, 'status', prev[status]);
  };

  const moveRight = () => {
    const next = { todo: 'doing', doing: 'done' };
    if (next[status]) store.setCell('cards', id, 'status', next[status]);
  };

  return (
    <div style={{
      background: '#fff', padding: '0.6rem', borderRadius: '6px',
      marginBottom: '0.4rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      display: 'flex', alignItems: 'center', gap: '0.25rem',
    }}>
      {status !== 'todo' && (
        <button onClick={moveLeft} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.7rem', padding: '2px' }}>←</button>
      )}
      <span style={{ flex: 1, fontSize: '0.9rem' }}>{String(title || '')}</span>
      {status !== 'done' && (
        <button onClick={moveRight} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.7rem', padding: '2px' }}>→</button>
      )}
      <button onClick={deleteCard} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#ccc', fontSize: '0.8rem' }}>×</button>
    </div>
  );
}
