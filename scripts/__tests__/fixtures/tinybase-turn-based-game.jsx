/**
 * TinyBase Fixture: Turn-Based Game Pattern
 * Tests: Shared game state (currentTurn, board) vs per-user identity (players table),
 *        useValueState for turn management, useTable for small fixed-size boards,
 *        win detection computed inline.
 * Scenario: Simplified tic-tac-toe demonstrating multiplayer game state management.
 */
export default function App() {
  const { isReady, isSyncing } = useApp();

  // Simulate two players — in real app, useUser() provides identity
  const myEmail = 'player1@example.com';
  const myName = 'Player 1';

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
      <h1>Turn-Based Game Test</h1>
      <PlayerSetup email={myEmail} name={myName} />
      <GameBoard myEmail={myEmail} />
      <GameControls />
    </div>
  );
}

function PlayerSetup({ email, name }) {
  const myRecord = useRow('players', email);
  const isRegistered = Object.keys(myRecord).length > 0;

  const registerPlayer = useSetRowCallback(
    'players', email,
    () => ({ name, symbol: '', joinedAt: Date.now() }),
    [name],
  );

  React.useEffect(() => {
    if (email && !isRegistered) registerPlayer();
  }, [email, isRegistered]);

  // Auto-assign symbol (X or O) based on join order
  const playerIds = useRowIds('players');
  const mySymbol = useCell('players', email, 'symbol');

  React.useEffect(() => {
    if (!isRegistered || mySymbol) return;
    const index = playerIds.indexOf(email);
    if (index === 0) store.setCell('players', email, 'symbol', 'X');
    else if (index === 1) store.setCell('players', email, 'symbol', 'O');
  }, [isRegistered, mySymbol, playerIds.length]);

  return null;
}

function GameBoard({ myEmail }) {
  // Game state: SHARED — all players see the same board
  const [currentTurn, setCurrentTurn] = useValueState('currentTurn');
  const turn = String(currentTurn || 'X');

  // Board: 9 cells, each is a cell in the 'board' table with row IDs '0'-'8'
  const boardCount = useRowCount('board');

  // Initialize board if empty
  const addCell = useAddRowCallback('board', (item) => item, []);
  React.useEffect(() => {
    if (boardCount === 0) {
      for (let i = 0; i < 9; i++) {
        store.setRow('board', String(i), { value: '', position: i });
      }
    }
  }, [boardCount]);

  // My symbol
  const mySymbol = useCell('players', myEmail, 'symbol');

  // Check if it's my turn
  const isMyTurn = turn === mySymbol;

  return (
    <div>
      <p style={{ marginBottom: '0.5rem' }}>
        {mySymbol ? `You are ${mySymbol}` : 'Waiting for symbol...'}
        {' · '}
        {isMyTurn ? <strong>Your turn!</strong> : `Waiting for ${turn}...`}
      </p>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 80px)',
        gap: '4px', justifyContent: 'center', margin: '1rem 0',
      }}>
        {[0,1,2,3,4,5,6,7,8].map(i => (
          <BoardCell
            key={i}
            position={String(i)}
            isMyTurn={isMyTurn}
            mySymbol={String(mySymbol || '')}
            onPlay={() => setCurrentTurn(turn === 'X' ? 'O' : 'X')}
          />
        ))}
      </div>
      <WinChecker />
    </div>
  );
}

function BoardCell({ position, isMyTurn, mySymbol, onPlay }) {
  const value = useCell('board', position, 'value');
  const isEmpty = !value;

  const handleClick = () => {
    if (!isEmpty || !isMyTurn || !mySymbol) return;
    store.setCell('board', position, 'value', mySymbol);
    onPlay();
  };

  return (
    <button
      onClick={handleClick}
      disabled={!isEmpty || !isMyTurn}
      style={{
        width: '80px', height: '80px', fontSize: '2rem', fontWeight: 'bold',
        border: '2px solid #333', cursor: isEmpty && isMyTurn ? 'pointer' : 'default',
        background: isEmpty ? '#fff' : '#f5f5f5',
        color: value === 'X' ? '#2563eb' : '#ef4444',
      }}
    >
      {String(value || '')}
    </button>
  );
}

function WinChecker() {
  // Read all board cells to check for a winner — computed inline
  const cells = [];
  for (let i = 0; i < 9; i++) {
    cells.push(useCell('board', String(i), 'value'));
  }

  const lines = [
    [0,1,2], [3,4,5], [6,7,8], // rows
    [0,3,6], [1,4,7], [2,5,8], // cols
    [0,4,8], [2,4,6],          // diagonals
  ];

  let winner = null;
  for (const [a,b,c] of lines) {
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) {
      winner = cells[a];
      break;
    }
  }

  const isDraw = !winner && cells.every(c => c);

  if (winner) return <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{String(winner)} wins!</p>;
  if (isDraw) return <p style={{ fontSize: '1.2rem' }}>Draw!</p>;
  return null;
}

function GameControls() {
  const resetGame = () => {
    for (let i = 0; i < 9; i++) {
      store.setCell('board', String(i), 'value', '');
    }
    store.setValue('currentTurn', 'X');
  };

  return (
    <button onClick={resetGame} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
      Reset Game
    </button>
  );
}
