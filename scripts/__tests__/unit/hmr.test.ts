/**
 * Tests for HMR module (isRenderable + createHmrWatcher).
 */
import { describe, it, expect } from 'vitest';
import { isRenderable } from '../../server/hmr.ts';

describe('isRenderable', () => {
  it('accepts a complete React component with export default', () => {
    const code = `function App() { return <div>Hello</div>; }\nexport default App;`;
    expect(isRenderable(code)).toBe(true);
  });

  it('rejects mid-function code', () => {
    const code = `function App() { return <div>He`;
    expect(isRenderable(code)).toBe(false);
  });

  it('rejects code without export default', () => {
    const code = `function App() { return <div>Hello</div>; }`;
    expect(isRenderable(code)).toBe(false);
  });

  it('handles comments with unmatched braces', () => {
    const code = `// this has a { without closing\nfunction App() { return <div>Hi</div>; }\nexport default App;`;
    expect(isRenderable(code)).toBe(true);
  });

  it('handles JSX with embedded expressions', () => {
    const code = `function App() { const x = [1,2,3]; return <div>{x.map(i => <span key={i}>{i}</span>)}</div>; }\nexport default App;`;
    expect(isRenderable(code)).toBe(true);
  });

  it('handles template literals with nested braces', () => {
    const code = 'function App() { const s = `${JSON.stringify({a:1})}`; return <div>{s}</div>; }\nexport default App;';
    expect(isRenderable(code)).toBe(true);
  });

  it('rejects unterminated template literal', () => {
    const code = 'function App() { const s = `hello ${world';
    expect(isRenderable(code)).toBe(false);
  });

  it('accepts arrow function export default', () => {
    const code = `const App = () => <div>Hello</div>;\nexport default App;`;
    expect(isRenderable(code)).toBe(true);
  });

  it('accepts export default inline', () => {
    const code = `export default function App() { return <div>Hello</div>; }`;
    expect(isRenderable(code)).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isRenderable('')).toBe(false);
  });

  it('rejects code with only export default but invalid syntax', () => {
    const code = `export default {{{`;
    expect(isRenderable(code)).toBe(false);
  });

  it('accepts React component with style tag', () => {
    const code = `function App() {
  return (
    <>
      <style>{\`
        :root { --bg: #000; }
        .app { color: white; }
      \`}</style>
      <div className="app">Hello</div>
    </>
  );
}
export default App;`;
    expect(isRenderable(code)).toBe(true);
  });
});

describe('isRenderable edge cases', () => {
  it('handles regex with braces', () => {
    const code = `function App() { const r = /{[^}]+}/g; return <div>test</div>; }\nexport default App;`;
    expect(isRenderable(code)).toBe(true);
  });

  it('handles multiline JSX', () => {
    const code = `function App() {
  return (
    <div>
      <h1>Title</h1>
      <p>Content</p>
    </div>
  );
}
export default App;`;
    expect(isRenderable(code)).toBe(true);
  });
});
