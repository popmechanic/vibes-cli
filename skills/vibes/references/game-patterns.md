---
name: Game Patterns
description: Timer and countdown patterns, turn-based game state, score persistence, ephemeral vs synced state for games
---

# Game and Timer Patterns

Patterns for building games, timers, and turn-based apps with TinyBase. For the hook API reference, see SKILL.md.

---

## Timer and Countdown Patterns

Games frequently use `setInterval` for countdowns. Keep timer state in `useState` (it's ephemeral — restarting the page should reset the timer) and scores in TinyBase (they should persist). Use `useRef` for the interval handle so cleanup works correctly:

```jsx
const [timeLeft, setTimeLeft] = React.useState(30);
const timerRef = React.useRef(null);
const [score, setScore] = useValueState('score');

const startGame = () => {
  setScore(0);
  setTimeLeft(30);
  timerRef.current = setInterval(() => {
    setTimeLeft(prev => {
      if (prev <= 1) { clearInterval(timerRef.current); return 0; }
      return prev - 1;
    });
  }, 1000);
};

// Clean up on unmount
React.useEffect(() => () => clearInterval(timerRef.current), []);
```

The key insight: timer countdown is local UI state (`useState`), but scores, achievements, and progress belong in TinyBase so they survive page reloads and sync across devices.

---

## Turn-Based Games

For games like tic-tac-toe, chess, or trivia, the state breaks down into three categories:

1. **Board/game state** — shared, all players see the same thing. Use a table with fixed row IDs (e.g., `'0'`-`'8'` for a 3x3 grid) or Values for simple state
2. **Whose turn it is** — shared. `useValueState('currentTurn')` stores `'X'` or `'O'`
3. **Player identity** — per-user. Each player's symbol/role stored in `useCellState('players', myEmail, 'symbol')`

Check if it's the current user's turn by comparing the turn value to their symbol. Win detection is computed inline from the board state — no need to store it since it's derivable:

```jsx
const [currentTurn] = useValueState('currentTurn');
const mySymbol = useCell('players', myEmail, 'symbol');
const isMyTurn = currentTurn === mySymbol;
```
