/**
 * TinyBase Fixture: Per-User State Isolation in Multiplayer
 * Tests: The critical pattern agents get wrong — distinguishing shared state from
 *        per-user state. Demonstrates: using email as row key for user-scoped data,
 *        shared state that all players see, and per-user state only the owner sees.
 *
 * Scenario: A "Pick Your Team" game lobby where:
 * - Each player picks a team (personal choice, keyed by their identity)
 * - A shared scoreboard shows all teams
 * - The game status is global (shared by all)
 *
 * KEY INSIGHT: When a user picks "Red Team", that choice must be stored WITH their
 * identity as the key — not as a global "selectedTeam" value, which would make
 * every user appear to have chosen the same team.
 */
export default function App() {
  const { isReady, isSyncing } = useApp();

  // Simulate auth — in real private apps, useUser() provides this
  const myEmail = 'player1@example.com';
  const myName = 'Player 1';

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Per-User State Test</h1>
      <p style={{ color: '#888', fontSize: '0.85rem' }}>Playing as: {myName} ({myEmail})</p>

      {/* Register this user */}
      <UserRegistration email={myEmail} name={myName} />

      {/* Shared state: game status visible to all */}
      <GameStatus />

      {/* Per-user state: MY team choice, keyed by MY email */}
      <TeamPicker email={myEmail} />

      {/* Shared view: all players and their choices */}
      <PlayerList currentEmail={myEmail} />
    </div>
  );
}

function UserRegistration({ email, name }) {
  const myRecord = useRow('players', email);
  const isRegistered = Object.keys(myRecord).length > 0;

  const registerUser = useSetRowCallback(
    'players', email,
    () => ({ name, team: '', joinedAt: Date.now() }),
    [name],
  );

  React.useEffect(() => {
    if (email && !isRegistered) registerUser();
  }, [email, isRegistered]);

  return null;
}

function GameStatus() {
  // Game status is SHARED — all players see the same value
  const [status, setStatus] = useValueState('gameStatus');
  const displayStatus = String(status || 'waiting');

  return (
    <div style={{ padding: '0.75rem', background: '#f5f5f5', borderRadius: '8px', marginBottom: '1rem' }}>
      <strong>Game Status:</strong> {displayStatus}
      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <button onClick={() => setStatus('waiting')}>Waiting</button>
        <button onClick={() => setStatus('picking')}>Start Picking</button>
        <button onClick={() => setStatus('playing')}>Start Game</button>
      </div>
    </div>
  );
}

function TeamPicker({ email }) {
  // CRITICAL PATTERN: The team choice is stored in the player's OWN row,
  // keyed by their email. This way each player has their own choice.
  //
  // WRONG: useValueState('selectedTeam') — this would be global,
  //   and every player would overwrite the same value
  //
  // CORRECT: useCellState('players', email, 'team') — scoped to this player's row
  const [team, setTeam] = useCellState('players', email, 'team');

  const teams = [
    { id: 'red', label: 'Red Team', color: '#ef4444' },
    { id: 'blue', label: 'Blue Team', color: '#3b82f6' },
    { id: 'green', label: 'Green Team', color: '#22c55e' },
  ];

  return (
    <div style={{ marginBottom: '1rem' }}>
      <h3>Pick Your Team</h3>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {teams.map(t => (
          <button
            key={t.id}
            onClick={() => setTeam(t.id)}
            style={{
              padding: '0.5rem 1rem',
              background: team === t.id ? t.color : '#eee',
              color: team === t.id ? '#fff' : '#333',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: team === t.id ? 'bold' : 'normal',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {team && <p style={{ marginTop: '0.5rem' }}>You chose: <strong>{String(team)}</strong></p>}
    </div>
  );
}

function PlayerList({ currentEmail }) {
  // SHARED VIEW: shows ALL players and their teams
  const playerIds = useRowIds('players');

  return (
    <div>
      <h3>All Players</h3>
      {playerIds.length === 0 && <p style={{ color: '#888' }}>No players yet</p>}
      {playerIds.map(id => (
        <PlayerRow key={id} email={id} isMe={id === currentEmail} />
      ))}
    </div>
  );
}

function PlayerRow({ email, isMe }) {
  const name = useCell('players', email, 'name');
  const team = useCell('players', email, 'team');

  const teamColors = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e' };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.5rem', borderBottom: '1px solid #eee',
      background: isMe ? '#f0f8ff' : 'transparent',
    }}>
      <span style={{ flex: 1 }}>
        {String(name || email)} {isMe && <span style={{ color: '#888' }}>(you)</span>}
      </span>
      {team ? (
        <span style={{
          padding: '0.15rem 0.5rem', borderRadius: '4px',
          background: teamColors[team] || '#888', color: '#fff', fontSize: '0.8rem',
        }}>
          {String(team)}
        </span>
      ) : (
        <span style={{ color: '#aaa', fontSize: '0.8rem' }}>not picked</span>
      )}
    </div>
  );
}
