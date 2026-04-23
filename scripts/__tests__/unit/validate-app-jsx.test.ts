/**
 * Tests for validateAppJsx — parse-check app.jsx using Bun.Transpiler.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { validateAppJsx } from '../../lib/validate-app-jsx.ts';

const TMP = join(import.meta.dirname, '.tmp-validate-test');

beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('validateAppJsx', () => {
  it('returns ok for a minimal valid component', () => {
    const p = join(TMP, 'app.jsx');
    writeFileSync(p, 'function App() { return <div>Hi</div>; }\nexport default App;');
    expect(validateAppJsx(p)).toEqual({ ok: true });
  });

  it('returns ok for JSX that uses TinyBase-style globals (no imports)', () => {
    const p = join(TMP, 'app.jsx');
    writeFileSync(p, `
      function App() {
        const ids = useRowIds('todos');
        return <ul>{ids.map(id => <li key={id} />)}</ul>;
      }
      export default App;
    `);
    expect(validateAppJsx(p)).toEqual({ ok: true });
  });

  it('returns not-ok with error for unclosed JSX tag', () => {
    const p = join(TMP, 'app.jsx');
    writeFileSync(p, 'function App() { return <div>Hi; }\nexport default App;');
    const r = validateAppJsx(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it('returns not-ok for unterminated template literal', () => {
    const p = join(TMP, 'app.jsx');
    writeFileSync(p, 'const s = `hello world');
    const r = validateAppJsx(p);
    expect(r.ok).toBe(false);
  });

  it('truncates long error messages to 500 chars', () => {
    const p = join(TMP, 'app.jsx');
    writeFileSync(p, '(' .repeat(2000));
    const r = validateAppJsx(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeLessThanOrEqual(500);
  });
});
