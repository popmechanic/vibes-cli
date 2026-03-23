/**
 * TinyBase Fixture: Timer/Interval Pattern for Games
 * Tests: useRef for intervals, useSetCellCallback with MapCell for incrementing,
 *        useCellState for game state, useValue/useSetValueCallback for app-level config
 * Pattern: A simple clicker game with a countdown timer and high score tracking.
 * Demonstrates: safe interval handling with TinyBase hooks (no stale closures).
 */
export default function App() {
  const { isReady, isSyncing } = useApp();

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', textAlign: 'center' }}>
      <h1>Timer Game Test</h1>
      <ClickerGame />
      <HighScores />
    </div>
  );
}

function ClickerGame() {
  // Game state: keep timer state in useState (ephemeral), score in TinyBase (persisted)
  const [timeLeft, setTimeLeft] = React.useState(10);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const timerRef = React.useRef(null);

  // Score persisted in TinyBase Values (survives reload)
  const [currentScore, setCurrentScore] = useValueState('currentScore');
  const score = Number(currentScore || 0);

  // Increment score via callback — avoids stale closures in event handlers
  const handleClick = () => {
    if (!isPlaying) return;
    setCurrentScore(score + 1);
  };

  const startGame = () => {
    setCurrentScore(0);
    setTimeLeft(10);
    setIsPlaying(true);

    // Use ref for interval — clean up properly
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setIsPlaying(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Clean up interval on unmount
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div style={{ marginBottom: '2rem' }}>
      <p style={{ fontSize: '2rem' }}>Score: {score}</p>
      <p>Time: {timeLeft}s</p>
      {isPlaying ? (
        <button
          onClick={handleClick}
          style={{ padding: '1rem 2rem', fontSize: '1.2rem', cursor: 'pointer' }}
        >
          Click!
        </button>
      ) : (
        <div>
          {timeLeft === 0 && <p>Game over! You scored {score} clicks.</p>}
          <SaveScore score={score} />
          <button onClick={startGame} style={{ padding: '0.5rem 1rem', marginTop: '0.5rem' }}>
            {timeLeft === 0 ? 'Play Again' : 'Start Game'}
          </button>
        </div>
      )}
    </div>
  );
}

function SaveScore({ score }) {
  const addScore = useAddRowCallback(
    'scores',
    (s) => ({
      score: s,
      timestamp: Date.now(),
    }),
    [],
  );

  const hasSaved = React.useRef(false);

  React.useEffect(() => {
    if (score > 0 && !hasSaved.current) {
      addScore(score);
      hasSaved.current = true;
    }
    return () => { hasSaved.current = false; };
  }, [score]);

  return null;
}

function HighScores() {
  const scoreIds = useSortedRowIds('scores', 'score', true, 0, 5);
  const count = useRowCount('scores');

  if (count === 0) return null;

  return (
    <div>
      <h2>High Scores</h2>
      {scoreIds.map((id, i) => <ScoreRow key={id} id={id} rank={i + 1} />)}
    </div>
  );
}

function ScoreRow({ id, rank }) {
  const score = useCell('scores', id, 'score');
  const timestamp = useCell('scores', id, 'timestamp');
  const dateStr = timestamp ? new Date(timestamp).toLocaleDateString() : '';
  return (
    <div style={{ padding: '0.25rem 0' }}>
      #{rank}: {String(score || 0)} clicks {dateStr && <span style={{ color: '#888' }}>({dateStr})</span>}
    </div>
  );
}
