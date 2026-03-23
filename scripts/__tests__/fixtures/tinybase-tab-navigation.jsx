/**
 * TinyBase Fixture: Tab/View Navigation
 * Tests: useValueState for persistent view state, conditional rendering by view,
 *        useRowIds in multiple views, tab UI pattern without react-router.
 * Pattern: Multi-tab app with shared data — view state persists across reloads.
 */
export default function App() {
  const { isReady, isSyncing } = useApp();
  const [activeTab, setActiveTab] = useValueState('activeTab');
  const tab = String(activeTab || 'all');
  const count = useRowCount('tasks');

  const addTask = useAddRowCallback(
    'tasks',
    (item) => item,
    [],
  );

  const seedDemo = () => {
    addTask({ title: 'Design UI', status: 'done', createdAt: Date.now() - 3000 });
    addTask({ title: 'Build API', status: 'active', createdAt: Date.now() - 2000 });
    addTask({ title: 'Write docs', status: 'active', createdAt: Date.now() - 1000 });
    addTask({ title: 'Deploy app', status: 'todo', createdAt: Date.now() });
  };

  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'todo', label: 'To Do' },
    { id: 'active', label: 'Active' },
    { id: 'done', label: 'Done' },
  ];

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '500px', margin: '0 auto' }}>
      <h1>Tab Navigation Test</h1>
      {count === 0 ? (
        <button onClick={seedDemo}>Load Demo Data</button>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid #eee', marginBottom: '1rem' }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding: '0.5rem 1rem',
                  border: 'none',
                  borderBottom: tab === t.id ? '2px solid #333' : '2px solid transparent',
                  fontWeight: tab === t.id ? 'bold' : 'normal',
                  cursor: 'pointer',
                  background: 'transparent',
                  marginBottom: '-2px',
                }}
              >
                {t.label} <TabCount status={t.id} />
              </button>
            ))}
          </div>
          <TaskList statusFilter={tab} />
        </>
      )}
    </div>
  );
}

function TabCount({ status }) {
  const allIds = useRowIds('tasks');
  if (status === 'all') return <span style={{ color: '#888' }}>({allIds.length})</span>;

  // Count matching — each hook call is fine since tabs are fixed, not dynamic
  let count = 0;
  for (const id of allIds) {
    const s = useCell('tasks', id, 'status');
    if (s === status) count++;
  }
  return <span style={{ color: '#888' }}>({count})</span>;
}

function TaskList({ statusFilter }) {
  const ids = useRowIds('tasks');
  return (
    <div>
      {ids.map(id => (
        <TaskItem key={id} id={id} filter={statusFilter} />
      ))}
    </div>
  );
}

function TaskItem({ id, filter }) {
  const title = useCell('tasks', id, 'title');
  const status = useCell('tasks', id, 'status');

  // Filter by tab
  if (filter !== 'all' && status !== filter) return null;

  const [currentStatus, setStatus] = useCellState('tasks', id, 'status');
  const deleteTask = useDelRowCallback('tasks', id);

  const statusColors = { todo: '#888', active: '#2563eb', done: '#16a34a' };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.5rem 0', borderBottom: '1px solid #f0f0f0',
    }}>
      <select
        value={String(currentStatus || 'todo')}
        onChange={e => setStatus(e.target.value)}
        style={{ color: statusColors[currentStatus] || '#333' }}
      >
        <option value="todo">To Do</option>
        <option value="active">Active</option>
        <option value="done">Done</option>
      </select>
      <span style={{ flex: 1, textDecoration: status === 'done' ? 'line-through' : 'none' }}>
        {String(title || '')}
      </span>
      <button onClick={deleteTask} style={{ color: 'red', border: 'none', cursor: 'pointer' }}>×</button>
    </div>
  );
}
