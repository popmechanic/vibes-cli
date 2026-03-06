window.__VIBES_THEMES__ = [{ id: "pitch", name: "Pitch Scoreboard" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "pitch");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}

const { useFireproofClerk } = window;

/* @theme:typography */
const styleTag = document.createElement("style");
styleTag.textContent = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Inter:wght@400;500;600&display=swap');`;
document.head.appendChild(styleTag);
/* @theme:typography:end */

function PitchLines() {
  return (
    <>
      {/* @theme:decoration */}
      <svg className="pitch-bg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="pitchGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.25 0.05 163)" />
            <stop offset="100%" stopColor="oklch(0.20 0.045 163)" />
          </linearGradient>
        </defs>
        <rect width="800" height="600" fill="url(#pitchGrad)" />
        <rect x="60" y="40" width="680" height="520" fill="none" stroke="oklch(0.35 0.05 165 / 0.2)" strokeWidth="1.5" />
        <line x1="400" y1="40" x2="400" y2="560" stroke="oklch(0.35 0.05 165 / 0.2)" strokeWidth="1.5" />
        <circle cx="400" cy="300" r="80" fill="none" stroke="oklch(0.35 0.05 165 / 0.2)" strokeWidth="1.5">
          <animateTransform attributeName="transform" type="rotate" from="0 400 300" to="360 400 300" dur="60s" repeatCount="indefinite" />
        </circle>
        <circle cx="400" cy="300" r="3" fill="oklch(0.35 0.05 165 / 0.3)">
          <animate attributeName="r" values="3;5;3" dur="4s" repeatCount="indefinite" />
        </circle>
        <rect x="60" y="180" width="120" height="240" fill="none" stroke="oklch(0.35 0.05 165 / 0.15)" strokeWidth="1" />
        <rect x="620" y="180" width="120" height="240" fill="none" stroke="oklch(0.35 0.05 165 / 0.15)" strokeWidth="1" />
        {[...Array(20)].map((_, i) => (
          <circle key={i} cx={80 + Math.random() * 640} cy={60 + Math.random() * 480} r="1" fill="oklch(0.86 0.18 90 / 0.08)">
            <animate attributeName="opacity" values="0.04;0.12;0.04" dur={`${3 + Math.random() * 4}s`} begin={`${Math.random() * 3}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </svg>
      {/* @theme:decoration:end */}
    </>
  );
}

function XIcon({ winning, size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={`piece-icon ${winning ? "winning-piece" : ""}`}>
      <line x1="12" y1="12" x2="36" y2="36" stroke={winning ? "var(--comp-accent-text)" : "var(--comp-accent)"} strokeWidth="3.5" strokeLinecap="square">
        <animate attributeName="x2" from="12" to="36" dur="0.25s" fill="freeze" />
        <animate attributeName="y2" from="12" to="36" dur="0.25s" fill="freeze" />
      </line>
      <line x1="36" y1="12" x2="12" y2="36" stroke={winning ? "var(--comp-accent-text)" : "var(--comp-accent)"} strokeWidth="3.5" strokeLinecap="square">
        <animate attributeName="x2" from="36" to="12" dur="0.25s" begin="0.15s" fill="freeze" />
        <animate attributeName="y2" from="12" to="36" dur="0.25s" begin="0.15s" fill="freeze" />
      </line>
    </svg>
  );
}

function OIcon({ winning, size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={`piece-icon ${winning ? "winning-piece" : ""}`}>
      <circle cx="24" cy="24" r="13" fill="none" stroke={winning ? "var(--comp-accent-text)" : "var(--comp-text)"} strokeWidth="3.5" strokeDasharray="82" strokeDashoffset="82" strokeLinecap="square">
        <animate attributeName="stroke-dashoffset" from="82" to="0" dur="0.35s" fill="freeze" />
      </circle>
    </svg>
  );
}

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

function checkWinner(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  return board.every(c => c) ? { winner: "draw", line: null } : null;
}

function App() {
  const theme = useVibesTheme();
  const { database, useLiveQuery } = useFireproofClerk("tictactoe-pitch");

  const [board, setBoard] = React.useState(Array(9).fill(null));
  const [currentPlayer, setCurrentPlayer] = React.useState("X");
  const [result, setResult] = React.useState(null);
  const [winningCells, setWinningCells] = React.useState([]);
  const [scores, setScores] = React.useState({ X: 0, O: 0, draws: 0 });
  const [streaks, setStreaks] = React.useState({ X: 0, O: 0 });
  const [lastWinner, setLastWinner] = React.useState(null);
  const [matchNum, setMatchNum] = React.useState(1);
  const [shakeBoard, setShakeBoard] = React.useState(false);
  const [history, setHistory] = React.useState([]);

  const matches = useLiveQuery("type", { key: "match" });

  React.useEffect(() => {
    if (matches.rows.length > 0) {
      let sx = 0, so = 0, sd = 0, skx = 0, sko = 0, lw = null;
      const sorted = [...matches.rows].sort((a, b) => (a.doc.num || 0) - (b.doc.num || 0));
      sorted.forEach(r => {
        const d = r.doc;
        if (d.winner === "X") { sx++; sko = 0; skx++; lw = "X"; }
        else if (d.winner === "O") { so++; skx = 0; sko++; lw = "O"; }
        else { sd++; skx = 0; sko = 0; lw = null; }
      });
      setScores({ X: sx, O: so, draws: sd });
      setStreaks({ X: skx, O: sko });
      setLastWinner(lw);
      setMatchNum(sorted.length + 1);
      setHistory(sorted.map(r => r.doc).slice(-8).reverse());
    }
  }, [matches.rows]);

  const handleClick = React.useCallback((idx) => {
    if (board[idx] || result) return;
    const newBoard = [...board];
    newBoard[idx] = currentPlayer;
    setBoard(newBoard);

    const check = checkWinner(newBoard);
    if (check) {
      setResult(check);
      if (check.line) {
        setWinningCells(check.line);
      } else {
        setShakeBoard(true);
        setTimeout(() => setShakeBoard(false), 600);
      }
      const now = new Date();
      database.put({
        type: "match",
        winner: check.winner,
        num: matchNum,
        board: newBoard,
        ts: now.toISOString(),
        time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      });
    } else {
      setCurrentPlayer(currentPlayer === "X" ? "O" : "X");
    }
  }, [board, currentPlayer, result, matchNum, database]);

  const rematch = React.useCallback(() => {
    setBoard(Array(9).fill(null));
    setResult(null);
    setWinningCells([]);
    setCurrentPlayer(result?.winner === "draw" ? "X" : result?.winner === "X" ? "O" : "X");
    setShakeBoard(false);
  }, [result]);

  const clearAll = React.useCallback(async () => {
    const all = await database.allDocs();
    for (const row of all.rows) {
      await database.del(row.key);
    }
    setBoard(Array(9).fill(null));
    setResult(null);
    setWinningCells([]);
    setCurrentPlayer("X");
    setScores({ X: 0, O: 0, draws: 0 });
    setStreaks({ X: 0, O: 0 });
    setLastWinner(null);
    setMatchNum(1);
    setHistory([]);
  }, [database]);

  const totalGames = scores.X + scores.O + scores.draws;

  return (
    <>
      <style>{`
        /* @theme:tokens */
        :root {
          --comp-bg: oklch(0.27 0.055 163);
          --comp-text: oklch(0.95 0.01 100);
          --comp-border: oklch(0.39 0.065 165);
          --comp-accent: oklch(0.86 0.18 90);
          --comp-accent-text: oklch(0.20 0.04 163);
          --comp-muted: oklch(0.55 0.04 165);
          --color-background: oklch(0.22 0.05 163);
          --grid-color: oklch(0.39 0.065 165 / 0.15);
        }
        /* @theme:tokens:end */

        /* @theme:surfaces */
        .pitch-app {
          font-family: 'Inter', sans-serif;
          color: var(--comp-text);
          background: var(--color-background);
        }
        .pitch-bg {
          position: fixed; inset: 0; width: 100%; height: 100%;
          z-index: 0; pointer-events: none; opacity: 0.6;
        }
        .stat-card {
          background: var(--comp-bg);
          border: 1px solid var(--comp-border);
          transition: border-color 0.2s ease;
        }
        .stat-card:hover { border-color: var(--comp-accent); }
        .stat-card.highlight {
          background: var(--comp-accent);
          color: var(--comp-accent-text);
          border-color: var(--comp-accent);
        }
        .stat-card.highlight .stat-label { color: var(--comp-accent-text); opacity: 0.7; }
        .stat-card.highlight .stat-num { color: var(--comp-accent-text); }
        .stat-label {
          font-family: 'Inter', sans-serif;
          font-size: 0.65rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--comp-muted);
        }
        .stat-num {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--comp-text);
        }
        .board-cell {
          background: oklch(0.24 0.048 163);
          border: 1px solid var(--comp-border);
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
        }
        .board-cell:hover:not(.filled):not(.won) {
          background: oklch(0.30 0.06 163);
          border-color: var(--comp-accent);
        }
        .board-cell:active:not(.filled) { transform: scale(0.95); }
        .board-cell.won {
          background: var(--comp-accent);
          border-color: var(--comp-accent);
        }
        .turn-indicator {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          color: var(--comp-accent);
          border: 1px solid var(--comp-border);
          background: var(--comp-bg);
        }
        .turn-indicator.game-over {
          background: var(--comp-accent);
          color: var(--comp-accent-text);
          border-color: var(--comp-accent);
        }
        .rematch-btn {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          background: var(--comp-accent);
          color: var(--comp-accent-text);
          border: none;
          cursor: pointer;
          transition: transform 0.15s ease, opacity 0.15s ease;
        }
        .rematch-btn:hover { transform: translateY(-1px); opacity: 0.9; }
        .rematch-btn:active { transform: scale(0.97); }
        .clear-btn {
          font-family: 'Inter', sans-serif;
          font-size: 0.7rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--comp-muted);
          background: none;
          border: 1px solid var(--comp-border);
          cursor: pointer;
          transition: color 0.15s ease, border-color 0.15s ease;
        }
        .clear-btn:hover { color: var(--comp-text); border-color: var(--comp-text); }
        .feed-item {
          border-left: 2px solid var(--comp-border);
          transition: border-color 0.2s ease;
        }
        .feed-item:first-child { border-left-color: var(--comp-accent); }
        .feed-time {
          font-family: 'Space Grotesk', monospace;
          font-size: 0.7rem;
          font-variant-numeric: tabular-nums;
          color: var(--comp-muted);
        }
        .feed-result {
          font-family: 'Inter', sans-serif;
          font-size: 0.8rem;
          color: var(--comp-text);
        }
        .feed-winner { color: var(--comp-accent); font-weight: 600; }
        .section-title {
          font-family: 'Inter', sans-serif;
          font-size: 0.65rem;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--comp-muted);
          border-bottom: 1px solid var(--comp-border);
        }
        .streak-badge {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 0.65rem;
          font-weight: 600;
          color: var(--comp-accent);
          border: 1px solid var(--comp-accent);
          background: oklch(0.86 0.18 90 / 0.1);
        }
        .match-tag {
          font-family: 'Space Grotesk', monospace;
          font-size: 0.6rem;
          font-variant-numeric: tabular-nums;
          color: var(--comp-muted);
          letter-spacing: 0.08em;
        }
        .piece-icon { filter: drop-shadow(0 0 2px oklch(0 0 0 / 0.3)); }
        .winning-piece { filter: drop-shadow(0 0 4px oklch(0.86 0.18 90 / 0.4)); }
        .mini-cell {
          background: oklch(0.24 0.048 163);
          border: 1px solid oklch(0.35 0.05 165 / 0.4);
        }
        .mini-x { color: var(--comp-accent); font-family: 'Space Grotesk', sans-serif; font-weight: 700; }
        .mini-o { color: var(--comp-text); font-family: 'Space Grotesk', sans-serif; font-weight: 700; }
        /* @theme:surfaces:end */

        /* @theme:motion */
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes placePiece {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes winPulse {
          0%, 100% { box-shadow: inset 0 0 0 0 oklch(0.86 0.18 90 / 0); }
          50% { box-shadow: inset 0 0 20px 2px oklch(0.86 0.18 90 / 0.3); }
        }
        @keyframes shakeBoard {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-4px); }
          30% { transform: translateX(4px); }
          45% { transform: translateX(-3px); }
          60% { transform: translateX(3px); }
          75% { transform: translateX(-1px); }
          90% { transform: translateX(1px); }
        }
        @keyframes resultFlash {
          0% { opacity: 0; transform: scale(0.9); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes streakGlow {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
        .cell-enter { animation: placePiece 0.3s ease forwards; }
        .cell-won { animation: winPulse 1.2s ease infinite; }
        .board-shake { animation: shakeBoard 0.5s ease; }
        .result-flash { animation: resultFlash 0.3s ease forwards; }
        .streak-glow { animation: streakGlow 2s ease infinite; }
        .feed-enter { animation: fadeSlideIn 0.3s ease forwards; }
        /* @theme:motion:end */

        /* Layout-only */
        .pitch-app { min-height: 100vh; position: relative; overflow: hidden; }
        .app-content { position: relative; z-index: 1; max-width: 960px; margin: 0 auto; padding: 1.5rem 1rem; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
        .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; margin-bottom: 1.5rem; }
        .stat-card { padding: 0.75rem; display: flex; flex-direction: column; gap: 0.25rem; }
        .stat-num { font-size: 2rem; line-height: 1; }
        .main-grid { display: grid; grid-template-columns: 1fr 200px; gap: 1.5rem; align-items: start; }
        .board-section { display: flex; flex-direction: column; gap: 1rem; align-items: center; }
        .board-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; width: 100%; max-width: 340px; }
        .board-cell { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; }
        .turn-indicator { padding: 0.5rem 1rem; text-align: center; font-size: 0.85rem; }
        .actions { display: flex; gap: 0.5rem; align-items: center; }
        .rematch-btn { padding: 0.6rem 1.5rem; font-size: 0.85rem; }
        .clear-btn { padding: 0.4rem 0.8rem; }
        .feed-section { display: flex; flex-direction: column; gap: 0; }
        .section-title { padding-bottom: 0.5rem; margin-bottom: 0.75rem; }
        .feed-item { padding: 0.5rem 0 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.15rem; }
        .feed-mini-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; width: 42px; margin-top: 0.25rem; }
        .mini-cell { width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; font-size: 0.5rem; line-height: 1; }
        .streak-badge { padding: 0.15rem 0.4rem; display: inline-block; }
        .match-tag { margin-top: 0.25rem; }
        @media (max-width: 700px) {
          .main-grid { grid-template-columns: 1fr; }
          .stats-row { grid-template-columns: repeat(2, 1fr); }
          .board-grid { max-width: 280px; }
          .feed-section { flex-direction: row; flex-wrap: wrap; gap: 0.5rem; }
          .feed-item { flex: 1; min-width: 120px; }
        }
      `}</style>

      <div className="pitch-app grid-background">
        <PitchLines />
        <div className="app-content">
          <div className="header">
            <div>
              <div className="stat-label">MATCH_{String(matchNum).padStart(2, "0")}</div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
                TIC-TAC-TOE
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="stat-label">TOTAL PLAYED</div>
              <div className="stat-num" style={{ fontSize: "1.3rem" }}>{totalGames}</div>
            </div>
          </div>

          <div className="stats-row">
            <div className={`stat-card ${lastWinner === "X" ? "highlight" : ""}`}>
              <div className="stat-label">PLAYER_X</div>
              <div className="stat-num">{scores.X}</div>
              {streaks.X >= 2 && <span className="streak-badge streak-glow">STREAK_{String(streaks.X).padStart(2, "0")}</span>}
            </div>
            <div className={`stat-card ${lastWinner === "O" ? "highlight" : ""}`}>
              <div className="stat-label">PLAYER_O</div>
              <div className="stat-num">{scores.O}</div>
              {streaks.O >= 2 && <span className="streak-badge streak-glow">STREAK_{String(streaks.O).padStart(2, "0")}</span>}
            </div>
            <div className="stat-card">
              <div className="stat-label">DRAWS</div>
              <div className="stat-num">{scores.draws}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">WIN_RATE_X</div>
              <div className="stat-num">{totalGames ? Math.round((scores.X / totalGames) * 100) : 0}%</div>
            </div>
          </div>

          <div className="main-grid">
            <div className="board-section">
              <div className={`turn-indicator ${result ? "game-over result-flash" : ""}`}>
                {result
                  ? result.winner === "draw"
                    ? "DRAW — NO WINNER"
                    : `PLAYER_${result.winner} WINS`
                  : `PLAYER_${currentPlayer}'S TURN`}
              </div>

              <div className={`board-grid ${shakeBoard ? "board-shake" : ""}`}>
                {board.map((cell, i) => {
                  const isWon = winningCells.includes(i);
                  return (
                    <div
                      key={i}
                      className={`board-cell ${cell ? "filled" : ""} ${isWon ? "won cell-won" : ""}`}
                      onClick={() => handleClick(i)}
                    >
                      {cell && (
                        <div className="cell-enter">
                          {cell === "X" ? <XIcon winning={isWon} /> : <OIcon winning={isWon} />}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="actions">
                {result && (
                  <button className="rematch-btn result-flash" onClick={rematch}>
                    REMATCH
                  </button>
                )}
                {totalGames > 0 && (
                  <button className="clear-btn" onClick={clearAll}>
                    RESET ALL
                  </button>
                )}
              </div>
            </div>

            <div className="feed-section">
              <div className="section-title">MATCH LOG</div>
              {history.length === 0 && (
                <div style={{ padding: "1rem 0" }}>
                  <div className="stat-label">NO MATCHES YET</div>
                  <div style={{ color: "var(--comp-muted)", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                    Play to see history
                  </div>
                </div>
              )}
              {history.map((h, i) => (
                <div key={h._id || i} className="feed-item feed-enter" style={{ animationDelay: `${i * 0.05}s` }}>
                  <div className="feed-time">{h.time || "—"}</div>
                  <div className="feed-result">
                    {h.winner === "draw" ? (
                      "Draw"
                    ) : (
                      <><span className="feed-winner">PLAYER_{h.winner}</span> wins</>
                    )}
                  </div>
                  {h.board && (
                    <div className="feed-mini-board">
                      {h.board.map((c, ci) => (
                        <div key={ci} className="mini-cell">
                          {c === "X" ? <span className="mini-x">×</span> : c === "O" ? <span className="mini-o">○</span> : null}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="match-tag">T-{String(h.num || 0).padStart(3, "0")}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
