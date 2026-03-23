/**
 * TinyBase Fixture: Multi-Table Cross References
 * Tests: Multiple tables with ID-based references (no joins, no nested objects).
 * Pattern: Tasks with categories — store categoryId as a cell, look up separately.
 * Demonstrates: flat data modeling, cross-table references, filtering by foreign key.
 */
export default function App() {
  const { isReady, isSyncing } = useApp();
  const categoryCount = useRowCount('categories');
  const taskCount = useRowCount('tasks');

  const addCategory = useAddRowCallback(
    'categories',
    (name) => ({ name, color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') }),
    [],
  );

  const seedDemo = () => {
    addCategory('Work');
    addCategory('Personal');
    addCategory('Shopping');
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Multi-Table References Test</h1>
      <p>Categories: {categoryCount} | Tasks: {taskCount}</p>
      {categoryCount === 0 && <button onClick={seedDemo}>Load Demo Data</button>}
      <div style={{ display: 'flex', gap: '2rem', marginTop: '1rem' }}>
        <div style={{ flex: 1 }}>
          <h2>Categories</h2>
          <CategoryList />
        </div>
        <div style={{ flex: 2 }}>
          <h2>Tasks</h2>
          <AddTask />
          <TaskList />
        </div>
      </div>
    </div>
  );
}

function CategoryList() {
  const ids = useRowIds('categories');
  return (
    <div>
      {ids.map(id => <CategoryItem key={id} id={id} />)}
    </div>
  );
}

function CategoryItem({ id }) {
  const name = useCell('categories', id, 'name');
  const color = useCell('categories', id, 'color');
  return (
    <div style={{ padding: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: String(color || '#ccc'), display: 'inline-block' }} />
      <span>{String(name || '')}</span>
      <span style={{ color: '#aaa', fontSize: '0.7rem' }}>({id})</span>
    </div>
  );
}

function AddTask() {
  const [input, setInput] = React.useState('');
  const categoryIds = useRowIds('categories');

  // Default to first category
  const [selectedCategory, setSelectedCategory] = React.useState('');

  const addTask = useAddRowCallback(
    'tasks',
    (data) => ({
      title: data.title,
      categoryId: data.categoryId,  // Cross-reference: store category ID as a scalar cell
      done: false,
      createdAt: Date.now(),
    }),
    [],
  );

  const handleAdd = () => {
    if (input.trim() && (selectedCategory || categoryIds[0])) {
      addTask({ title: input.trim(), categoryId: selectedCategory || categoryIds[0] });
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
        style={{ flex: 1, padding: '0.25rem' }}
      />
      <select
        value={selectedCategory || categoryIds[0] || ''}
        onChange={e => setSelectedCategory(e.target.value)}
        style={{ padding: '0.25rem' }}
      >
        {categoryIds.map(id => <CategoryOption key={id} id={id} />)}
      </select>
      <button onClick={handleAdd}>Add</button>
    </div>
  );
}

function CategoryOption({ id }) {
  const name = useCell('categories', id, 'name');
  return <option value={id}>{String(name || id)}</option>;
}

function TaskList() {
  const ids = useRowIds('tasks');
  return (
    <div>
      {ids.map(id => <TaskItem key={id} id={id} />)}
    </div>
  );
}

function TaskItem({ id }) {
  const title = useCell('tasks', id, 'title');
  const done = useCell('tasks', id, 'done');
  const categoryId = useCell('tasks', id, 'categoryId');

  // Cross-reference: look up category name from the other table
  const categoryName = useCell('categories', String(categoryId || ''), 'name');
  const categoryColor = useCell('categories', String(categoryId || ''), 'color');

  const toggleDone = useSetCellCallback(
    'tasks', id, 'done',
    (_e) => (current) => !current,
  );

  const deleteTask = useDelRowCallback('tasks', id);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', borderBottom: '1px solid #eee' }}>
      <button onClick={toggleDone}>{done ? '✓' : '○'}</button>
      <span style={{ flex: 1, textDecoration: done ? 'line-through' : 'none' }}>
        {String(title || '')}
      </span>
      <span style={{
        fontSize: '0.75rem',
        padding: '0.1rem 0.4rem',
        borderRadius: '4px',
        background: String(categoryColor || '#eee'),
        color: '#fff',
      }}>
        {String(categoryName || '?')}
      </span>
      <button onClick={deleteTask} style={{ color: 'red', fontSize: '0.8rem' }}>×</button>
    </div>
  );
}
