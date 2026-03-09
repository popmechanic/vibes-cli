/**
 * Tests for HMR module (isRenderable + createHmrWatcher).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRenderable, createHmrWatcher } from '../../server/hmr.ts';

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

// --- createHmrWatcher tests ---

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, any>;
  return {
    ...actual,
    watchFile: vi.fn(),
    unwatchFile: vi.fn(),
    readFileSync: vi.fn(() => ''),
  };
});

vi.mock('../../server/handlers/generate.ts', () => ({
  assembleAppFrame: vi.fn((_ctx: any, code: string) => `<html>${code}</html>`),
}));

// Import the mocked fs after vi.mock declaration (vitest hoists vi.mock)
import { watchFile, unwatchFile, readFileSync } from 'fs';

describe('createHmrWatcher', () => {
  let watcher: ReturnType<typeof createHmrWatcher>;
  let broadcast: ReturnType<typeof vi.fn>;

  const ctx = { projectRoot: '/tmp/test-project' } as any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    broadcast = vi.fn();
    watcher = createHmrWatcher(ctx, broadcast);
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
  });

  it('start() begins fs polling and stop() ends it', () => {
    watcher.start();
    expect(watchFile).toHaveBeenCalledTimes(1);
    expect(watchFile).toHaveBeenCalledWith(
      '/tmp/test-project/app.jsx',
      { interval: 1000 },
      expect.any(Function),
    );

    watcher.stop();
    expect(unwatchFile).toHaveBeenCalledTimes(1);
    expect(unwatchFile).toHaveBeenCalledWith('/tmp/test-project/app.jsx');
  });

  it('start() is idempotent — multiple calls do not re-register polling', () => {
    watcher.start();
    watcher.start();
    expect(watchFile).toHaveBeenCalledTimes(1);
  });

  it('stop() without start() is safe', () => {
    expect(() => watcher.stop()).not.toThrow();
    expect(unwatchFile).not.toHaveBeenCalled();
  });

  it('onToolResult ignores events when not active', () => {
    // Don't call start() — watcher is inactive
    watcher.onToolResult({ _toolName: 'Write', _filePath: '/tmp/test-project/app.jsx' });
    vi.advanceTimersByTime(1000);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('onToolResult ignores non-Write tool events', () => {
    watcher.start();
    (readFileSync as any).mockReturnValue('function App() { return <div/>; }\nexport default App;');

    watcher.onToolResult({ _toolName: 'Read', _filePath: '/tmp/test-project/app.jsx' });
    vi.advanceTimersByTime(1000);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('onToolResult ignores Write events to non-app.jsx files', () => {
    watcher.start();
    (readFileSync as any).mockReturnValue('function App() { return <div/>; }\nexport default App;');

    watcher.onToolResult({ _toolName: 'Write', _filePath: '/tmp/test-project/other.js' });
    vi.advanceTimersByTime(1000);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('onToolResult broadcasts hmr_update for valid Write to app.jsx', () => {
    const validCode = 'function App() { return <div>Hello</div>; }\nexport default App;';
    watcher.start();
    (readFileSync as any).mockReturnValue(validCode);

    watcher.onToolResult({ _toolName: 'Write', _filePath: '/tmp/test-project/app.jsx' });
    // Debounce is 500ms
    vi.advanceTimersByTime(600);

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'hmr_update',
      codeLength: validCode.length,
    }));
  });

  it('does not broadcast duplicate snapshots', () => {
    const validCode = 'function App() { return <div>Hello</div>; }\nexport default App;';
    watcher.start();
    (readFileSync as any).mockReturnValue(validCode);

    watcher.onToolResult({ _toolName: 'Write', _filePath: '/tmp/test-project/app.jsx' });
    vi.advanceTimersByTime(600);
    expect(broadcast).toHaveBeenCalledTimes(1);

    // Same code again — should not broadcast
    watcher.onToolResult({ _toolName: 'Write', _filePath: '/tmp/test-project/app.jsx' });
    vi.advanceTimersByTime(600);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('does not broadcast non-renderable code', () => {
    watcher.start();
    (readFileSync as any).mockReturnValue('function App() { return <div>');

    watcher.onToolResult({ _toolName: 'Write', _filePath: '/tmp/test-project/app.jsx' });
    vi.advanceTimersByTime(600);
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('createHmrWatcher with currentApp', () => {
  let watcher: ReturnType<typeof createHmrWatcher>;
  let broadcast: ReturnType<typeof vi.fn>;

  const ctx = {
    projectRoot: '/tmp/test-project',
    appsDir: '/tmp/test-project/apps',
    currentApp: 'my-app',
  } as any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    broadcast = vi.fn();
    watcher = createHmrWatcher(ctx, broadcast);
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
  });

  it('watches the currentApp directory when currentApp is set', () => {
    watcher.start();
    expect(watchFile).toHaveBeenCalledWith(
      '/tmp/test-project/apps/my-app/app.jsx',
      { interval: 1000 },
      expect.any(Function),
    );
  });

  it('reads from currentApp path on tool result', () => {
    const validCode = 'function App() { return <div>Hello</div>; }\nexport default App;';
    watcher.start();
    (readFileSync as any).mockReturnValue(validCode);

    watcher.onToolResult({ _toolName: 'Write', _filePath: '/tmp/test-project/apps/my-app/app.jsx' });
    vi.advanceTimersByTime(600);

    expect(readFileSync).toHaveBeenCalledWith('/tmp/test-project/apps/my-app/app.jsx', 'utf-8');
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('restarts polling when currentApp changes', () => {
    const validCode = 'function App() { return <div>Hello</div>; }\nexport default App;';
    watcher.start();
    (readFileSync as any).mockReturnValue(validCode);

    // Initially watching my-app
    expect(watchFile).toHaveBeenCalledWith(
      '/tmp/test-project/apps/my-app/app.jsx',
      expect.anything(),
      expect.any(Function),
    );

    // Switch app
    ctx.currentApp = 'other-app';
    watcher.onToolResult({ _toolName: 'Write', _filePath: '/tmp/test-project/apps/other-app/app.jsx' });
    vi.advanceTimersByTime(600);

    // Should have unwatched old path and watched new path
    expect(unwatchFile).toHaveBeenCalledWith('/tmp/test-project/apps/my-app/app.jsx');
    expect(watchFile).toHaveBeenCalledWith(
      '/tmp/test-project/apps/other-app/app.jsx',
      expect.anything(),
      expect.any(Function),
    );

    // Restore for cleanup
    ctx.currentApp = 'my-app';
  });
});
