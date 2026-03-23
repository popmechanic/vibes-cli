/**
 * TinyBase Fixture: Computed Values and Filtered Views
 * Tests: Filtering useRowIds with useCell in child components, useMemo for derived data,
 *        useValueState for filter state, inline computation vs stored computation.
 * Pattern: A task list with category filtering, search, and computed stats.
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
      { title: 'Buy groceries', category: 'personal', done: false, priority: 2, createdAt: Date.now() - 5000 },
      { title: 'Review PR', category: 'work', done: true, priority: 3, createdAt: Date.now() - 4000 },
      { title: 'Fix login bug', category: 'work', done: false, priority: 1, createdAt: Date.now() - 3000 },
      { title: 'Call dentist', category: 'personal', done: false, priority: 2, createdAt: Date.now() - 2000 },
      { title: 'Write tests', category: 'work', done: true, priority: 2, createdAt: Date.now() - 1000 },
    ];
    items.forEach(item => addTask(item));
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Computed Filters Test</h1>
      {count === 0 ? (
        <button onClick={seedDemo}>Load Demo Data</button>
      ) : (
        <>
          <Stats />
          <FilterControls />
          <FilteredTaskList />
        </>
      )}
    </div>
  );
}

function Stats() {
  // Computed stats from row data — compute inline, no need to store derived values
  const allIds = useRowIds('tasks');
  const doneCount = allIds.reduce((sum, id) => {
    const done = useCell('tasks', id, 'done');
    return sum + (done ? 1 : 0);
  }, 0);

  return (
    <div style={{ marginBottom: '1rem', padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px' }}>
      <strong>{allIds.length}</strong> total | <strong>{doneCount}</strong> done | <strong>{allIds.length - doneCount}</strong> remaining
    </div>
  );
}

function FilterControls() {
  // Filter state stored in TinyBase Values — persists across reloads
  const [categoryFilter, setCategoryFilter] = useValueState('filter_category');
  const [showDone, setShowDone] = useValueState('filter_showDone');

  // Search state is ephemeral — it's UI state, not something to persist
  return (
    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
      <select
        value={String(categoryFilter || 'all')}
        onChange={e => setCategoryFilter(e.target.value)}
      >
        <option value="all">All categories</option>
        <option value="work">Work</option>
        <option value="personal">Personal</option>
      </select>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <input
          type="checkbox"
          checked={showDone === true || showDone === 'true'}
          onChange={e => setShowDone(e.target.checked)}
        />
        Show completed
      </label>
    </div>
  );
}

function FilteredTaskList() {
  const allIds = useRowIds('tasks');
  const categoryFilter = useValue('filter_category');
  const showDone = useValue('filter_showDone');

  // Filter inline — no need for useMemo unless the list is very large
  return (
    <div>
      {allIds.map(id => (
        <FilteredTaskItem
          key={id}
          id={id}
          categoryFilter={String(categoryFilter || 'all')}
          showDone={showDone === true || showDone === 'true'}
        />
      ))}
    </div>
  );
}

function FilteredTaskItem({ id, categoryFilter, showDone }) {
  const title = useCell('tasks', id, 'title');
  const category = useCell('tasks', id, 'category');
  const done = useCell('tasks', id, 'done');
  const priority = useCell('tasks', id, 'priority');

  // Filter: hide if doesn't match current filters
  if (categoryFilter !== 'all' && category !== categoryFilter) return null;
  if (!showDone && done) return null;

  const toggleDone = useSetCellCallback(
    'tasks', id, 'done',
    (_e) => (current) => !current,
  );

  const priorityLabel = { 1: 'High', 2: 'Medium', 3: 'Low' };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.5rem 0', borderBottom: '1px solid #eee',
      opacity: done ? 0.5 : 1,
    }}>
      <button onClick={toggleDone}>{done ? '✓' : '○'}</button>
      <span style={{ flex: 1, textDecoration: done ? 'line-through' : 'none' }}>
        {String(title || '')}
      </span>
      <span style={{ fontSize: '0.75rem', color: '#888' }}>{String(category || '')}</span>
      <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
        {priorityLabel[priority] || '?'}
      </span>
    </div>
  );
}
