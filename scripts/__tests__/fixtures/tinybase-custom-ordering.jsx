/**
 * TinyBase Fixture: Custom Ordering with Drag-Like Reordering
 * Tests: Numeric 'order' cell for manual sorting, useSortedRowIds with order cell,
 *        useSetCellCallback for reordering, batch position updates.
 * Pattern: Manually orderable list using up/down buttons (no drag library needed).
 */
export default function App() {
  const { isReady, isSyncing } = useApp();
  const count = useRowCount('tasks');

  const addTask = useAddRowCallback(
    'tasks',
    (item) => item,
    [],
  );

  const seedDemo = () => {
    const items = [
      { title: 'Design mockups', order: 0 },
      { title: 'Write API endpoints', order: 1 },
      { title: 'Build frontend', order: 2 },
      { title: 'Write tests', order: 3 },
      { title: 'Deploy to production', order: 4 },
    ];
    items.forEach(item => addTask(item));
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '500px', margin: '0 auto' }}>
      <h1>Custom Ordering Test</h1>
      {count === 0 ? (
        <button onClick={seedDemo}>Load Demo Data</button>
      ) : (
        <>
          <AddTaskForm />
          <OrderedList />
        </>
      )}
    </div>
  );
}

function AddTaskForm() {
  const [input, setInput] = React.useState('');
  const count = useRowCount('tasks');

  const addTask = useAddRowCallback(
    'tasks',
    (text) => ({
      title: text,
      order: count,  // append at end
    }),
    [count],
  );

  const handleAdd = () => {
    if (input.trim()) {
      addTask(input.trim());
      setInput('');
    }
  };

  return (
    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        placeholder="New task..."
        style={{ flex: 1, padding: '0.5rem' }}
      />
      <button onClick={handleAdd}>Add</button>
    </div>
  );
}

function OrderedList() {
  // useSortedRowIds sorts by the 'order' cell — ascending for manual ordering
  const sortedIds = useSortedRowIds('tasks', 'order', false);

  return (
    <div>
      {sortedIds.map((id, index) => (
        <OrderedItem
          key={id}
          id={id}
          index={index}
          isFirst={index === 0}
          isLast={index === sortedIds.length - 1}
          allIds={sortedIds}
        />
      ))}
    </div>
  );
}

function OrderedItem({ id, index, isFirst, isLast, allIds }) {
  const title = useCell('tasks', id, 'title');
  const order = useCell('tasks', id, 'order');
  const deleteTask = useDelRowCallback('tasks', id);

  // Swap order values with the adjacent item
  const moveUp = () => {
    if (isFirst) return;
    const otherId = allIds[index - 1];
    const otherOrder = Number(order) - 1;
    // Use store for batch swap — both cells need to change atomically
    store.setCell('tasks', id, 'order', otherOrder);
    store.setCell('tasks', otherId, 'order', Number(order));
  };

  const moveDown = () => {
    if (isLast) return;
    const otherId = allIds[index + 1];
    const otherOrder = Number(order) + 1;
    store.setCell('tasks', id, 'order', otherOrder);
    store.setCell('tasks', otherId, 'order', Number(order));
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.5rem', borderBottom: '1px solid #eee',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <button onClick={moveUp} disabled={isFirst} style={{ fontSize: '0.7rem', padding: '0 4px' }}>▲</button>
        <button onClick={moveDown} disabled={isLast} style={{ fontSize: '0.7rem', padding: '0 4px' }}>▼</button>
      </div>
      <span style={{ flex: 1 }}>{String(title || '')}</span>
      <span style={{ color: '#ccc', fontSize: '0.75rem' }}>#{String(order ?? '?')}</span>
      <button onClick={deleteTask} style={{ color: 'red', border: 'none', cursor: 'pointer' }}>×</button>
    </div>
  );
}
