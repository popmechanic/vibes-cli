/**
 * TinyBase Fixture: Values and State Hooks
 * Tests: useValue, useSetValueCallback, useValueState, useCellState,
 *        useAddRowCallback, useRowIds
 */
export default function App() {
  const { isReady, isSyncing } = useApp();

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>TinyBase Values & State Test</h1>
      <ThemeSelector />
      <NoteList />
    </div>
  );
}

function ThemeSelector() {
  const [theme, setTheme] = useValueState('theme');
  const displayTheme = String(theme || 'light');

  return (
    <div style={{ marginBottom: '1rem' }}>
      <p>Current theme: {displayTheme}</p>
      <button onClick={() => setTheme('light')}>Light</button>
      <button onClick={() => setTheme('dark')}>Dark</button>
    </div>
  );
}

function NoteList() {
  const ids = useRowIds('notes');
  const addNote = useAddRowCallback(
    'notes',
    () => ({
      title: 'New Note',
      body: '',
      createdAt: Date.now(),
    }),
    [],
  );

  return (
    <div>
      <button onClick={() => addNote()}>Add Note</button>
      {ids.map(id => <NoteItem key={id} id={id} />)}
    </div>
  );
}

function NoteItem({ id }) {
  const [title, setTitle] = useCellState('notes', id, 'title');
  const body = useCell('notes', id, 'body');

  return (
    <div style={{ border: '1px solid #ccc', padding: '0.5rem', margin: '0.5rem 0' }}>
      <input
        value={String(title || '')}
        onChange={e => setTitle(e.target.value)}
        style={{ fontWeight: 'bold', width: '100%' }}
      />
      <p style={{ color: '#666' }}>{String(body || '(empty)')}</p>
    </div>
  );
}
