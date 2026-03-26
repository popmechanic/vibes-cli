import { describe, it, expect } from 'vitest';
import { ssrSmokeTest } from '../../eval-ssr-check.js';

describe('ssrSmokeTest', () => {
  it('passes for valid component with useApp + useTable + early return guard', () => {
    const jsx = `
function App() {
  const { isReady } = useApp();
  const tasks = useTable('tasks');

  if (!isReady) return <div>Loading...</div>;

  const ids = Object.keys(tasks);
  return (
    <div>
      <h1>Tasks ({ids.length})</h1>
      <ul>
        {ids.map(id => (
          <li key={id}>{tasks[id].name}</li>
        ))}
      </ul>
    </div>
  );
}
`;
    const result = ssrSmokeTest(jsx);
    expect(result.passed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.hookCounts).toBeDefined();
    // All 4 renders should have the same hook count
    const counts = result.hookCounts!;
    expect(counts.length).toBe(4);
    expect(new Set(counts).size).toBe(1);
  });

  it('passes conditional hook after isReady guard (all configs have isReady=true)', () => {
    // Note: isReady is always true in the template — the SSR check no longer
    // uses isReady=false configs. Conditional hooks after isReady are caught by
    // static analysis (C5) or by identity-dependent hook count differences.
    const jsx = `
function App() {
  const { isReady } = useApp();

  if (!isReady) return <div>Loading...</div>;

  const tasks = useTable('tasks');
  const rowIds = useRowIds('tasks');

  return (
    <div>
      <h1>Tasks</h1>
      {rowIds.map(id => (
        <li key={id}>{tasks[id].name}</li>
      ))}
    </div>
  );
}
`;
    const result = ssrSmokeTest(jsx);
    // With all configs having isReady=true, the early return never fires
    // so hook counts are consistent. Static analysis (C5) is the correct
    // check for hooks-in-loop.
    expect(result.passed).toBe(true);
  });

  it('passes hooks inside .map() in SSR (detected by static analysis C5 instead)', () => {
    // Note: hooks-in-loop is now detected by static analysis (C5 in
    // eval-static-check.js) rather than SSR hook counting. The SSR check
    // uses paired comparison (same-row-count configs) which won't catch
    // this pattern since each render is independent (not a re-render).
    const jsx = `
function App() {
  const { isReady } = useApp();
  const rowIds = useRowIds('tasks');

  return (
    <div>
      {rowIds.map(id => {
        const cell = useCell('tasks', id, 'name');
        return <div key={id}>{cell}</div>;
      })}
    </div>
  );
}
`;
    const result = ssrSmokeTest(jsx);
    // SSR paired comparison passes because same-row-count configs produce
    // identical hook counts. The static check (C5) is the correct detection.
    expect(result.passed).toBe(true);
    expect(result.hookCounts).toBeDefined();
    const counts = result.hookCounts!;
    // Configs with 2 rows should match each other, 3 rows should match each other
    expect(counts[0]).toBe(counts[2]); // both 2-row configs
    expect(counts[1]).toBe(counts[3]); // both 3-row configs
  });

  it('passes the whiteboard pattern (shared shapes table, no per-user conditional hooks)', () => {
    const jsx = `
function App() {
  const { isReady, user } = useApp();
  const shapes = useTable('shapes');
  const addShape = useAddRowCallback('shapes', (e) => ({
    type: 'rect',
    x: 100,
    y: 100,
    color: '#ff0000',
    owner: user.email
  }), [user]);

  if (!isReady) return <div>Loading canvas...</div>;

  const shapeIds = Object.keys(shapes);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <button onClick={addShape}>Add Shape</button>
      {shapeIds.map(id => {
        const shape = shapes[id];
        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: shape.x,
              top: shape.y,
              width: 50,
              height: 50,
              backgroundColor: shape.color,
              border: shape.owner === user.email ? '2px solid black' : 'none'
            }}
          />
        );
      })}
    </div>
  );
}
`;
    const result = ssrSmokeTest(jsx);
    expect(result.passed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.hookCounts).toBeDefined();
    const counts = result.hookCounts!;
    expect(new Set(counts).size).toBe(1);
  });

  it('handles Babel transform errors gracefully (syntax error)', () => {
    const jsx = `
function App() {
  const { isReady } = useApp(;  // syntax error
  return <div>Hello</div>;
}
`;
    const result = ssrSmokeTest(jsx);
    expect(result.passed).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/transform|syntax|parse/i);
  });
});
