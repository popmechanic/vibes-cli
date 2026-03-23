/**
 * TinyBase Fixture: User Registration Pattern
 * Tests: useRow (empty check for existence), useSetRowCallback (imperative write),
 *        useRowIds, useCell, useEffect for one-time registration,
 *        row keyed by custom ID (not auto-generated)
 */
export default function App() {
  const { isReady, isSyncing } = useApp();

  // Simulate a logged-in user (in real apps, useUser() provides this)
  const myEmail = 'test@example.com';
  const myName = 'Test User';

  // Check if user already registered (useRow returns {} for missing rows)
  const myRecord = useRow('users', myEmail);
  const isRegistered = Object.keys(myRecord).length > 0;

  // Register on first load using hooks — NOT store.setRow()
  const registerUser = useSetRowCallback(
    'users', myEmail,
    () => ({ name: myName, joinedAt: Date.now() }),
    [myName],
  );

  React.useEffect(() => {
    if (myEmail && !isRegistered) registerUser();
  }, [myEmail, isRegistered]);

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>User Registration Test</h1>
      <p>My email: {myEmail}</p>
      <p>Registered: {isRegistered ? 'Yes' : 'No'}</p>
      {isRegistered && (
        <div>
          <p>Name: {String(myRecord.name || '')}</p>
          <p>Joined: {myRecord.joinedAt ? new Date(myRecord.joinedAt).toLocaleString() : 'unknown'}</p>
        </div>
      )}
      <h2>All Users</h2>
      <UserList />
    </div>
  );
}

function UserList() {
  const userIds = useRowIds('users');
  return (
    <div>
      {userIds.length === 0 && <p style={{ color: '#888' }}>No users registered yet</p>}
      {userIds.map(id => <UserRow key={id} id={id} />)}
    </div>
  );
}

function UserRow({ id }) {
  const name = useCell('users', id, 'name');
  return (
    <div style={{ padding: '0.25rem 0', borderBottom: '1px solid #eee' }}>
      <strong>{String(name || '')}</strong>
      <span style={{ marginLeft: '0.5rem', color: '#888', fontSize: '0.8rem' }}>{id}</span>
    </div>
  );
}
