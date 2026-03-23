/**
 * TinyBase Fixture: Sorted & Paginated Lists
 * Tests: useSortedRowIds, useRowCount, useAddRowCallback, useCell, useState
 */
export default function App() {
  const { isReady, isSyncing } = useApp();

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>TinyBase Pagination Test</h1>
      <SeedButton />
      <PaginatedList />
    </div>
  );
}

function SeedButton() {
  const count = useRowCount('entries');
  const addEntry = useAddRowCallback(
    'entries',
    (item) => item,
    [],
  );

  const seedData = () => {
    const items = [
      { title: 'Alpha', priority: 1, createdAt: Date.now() - 5000 },
      { title: 'Beta', priority: 3, createdAt: Date.now() - 4000 },
      { title: 'Gamma', priority: 2, createdAt: Date.now() - 3000 },
      { title: 'Delta', priority: 1, createdAt: Date.now() - 2000 },
      { title: 'Epsilon', priority: 2, createdAt: Date.now() - 1000 },
    ];
    items.forEach(item => addEntry(item));
  };

  if (count === 0) {
    return <button onClick={seedData}>Load Demo Data</button>;
  }
  return <p>{count} entries</p>;
}

function PaginatedList() {
  const PAGE_SIZE = 3;
  const [page, setPage] = React.useState(0);
  const totalCount = useRowCount('entries');
  const entryIds = useSortedRowIds('entries', 'createdAt', true, page * PAGE_SIZE, PAGE_SIZE);

  return (
    <div>
      {entryIds.map(id => <EntryRow key={id} id={id} />)}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        {page > 0 && <button onClick={() => setPage(p => p - 1)}>← Prev</button>}
        {totalCount > (page + 1) * PAGE_SIZE && <button onClick={() => setPage(p => p + 1)}>Next →</button>}
      </div>
      <p style={{ fontSize: '0.8rem', color: '#888' }}>
        Page {page + 1} of {Math.ceil(totalCount / PAGE_SIZE) || 1}
      </p>
    </div>
  );
}

function EntryRow({ id }) {
  const title = useCell('entries', id, 'title');
  const priority = useCell('entries', id, 'priority');

  return (
    <div style={{ padding: '0.25rem 0', borderBottom: '1px solid #eee' }}>
      <strong>{String(title || '')}</strong>
      <span style={{ marginLeft: '0.5rem', color: '#888' }}>
        Priority: {String(priority ?? '?')}
      </span>
    </div>
  );
}
