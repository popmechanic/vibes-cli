import { describe, it, expect } from 'vitest';
import { evalStaticCheck } from '../../eval-static-check.js';

describe('evalStaticCheck', () => {
  describe('critical checks', () => {
    it('C1: fails when useApp() is missing', () => {
      const code = 'function App() {\n  return <div>Hello</div>;\n}';
      const result = evalStaticCheck(code);
      expect(result.critical).toContain('C1: Missing useApp() call — sync will never activate');
      expect(result.passed).toBe(false);
    });

    it('C1: passes when useApp() is present', () => {
      const code = 'function App() {\n  const { isReady } = useApp();\n  return <div>Hello</div>;\n}';
      const result = evalStaticCheck(code);
      expect(result.critical.find(c => c.startsWith('C1'))).toBeUndefined();
    });

    it('C2: fails on import statements', () => {
      const code = 'import React from "react";\nfunction App() {\n  const { isReady } = useApp();\n  return <div/>;\n}';
      const result = evalStaticCheck(code);
      expect(result.critical).toContain('C2: Import statement found — breaks React singleton');
      expect(result.passed).toBe(false);
    });

    it('C3: fails on createStore', () => {
      const code = 'const store = createMergeableStore();\nfunction App() {\n  const { isReady } = useApp();\n  return <div/>;\n}';
      const result = evalStaticCheck(code);
      expect(result.critical.find(c => c.startsWith('C3'))).toBeDefined();
      expect(result.passed).toBe(false);
    });

    it('C4: fails on new Store()', () => {
      const code = 'const s = new MergeableStore();\nfunction App() {\n  const { isReady } = useApp();\n  return <div/>;\n}';
      const result = evalStaticCheck(code);
      expect(result.critical.find(c => c.startsWith('C4'))).toBeDefined();
      expect(result.passed).toBe(false);
    });
  });

  describe('warning checks', () => {
    it('C5: fails on useCell inside .filter() (promoted from W1)', () => {
      const code = [
        'function App() {',
        '  const { isReady } = useApp();',
        '  const ids = useRowIds("tasks");',
        '  const filtered = ids.filter(id => {',
        '    const status = useCell("tasks", id, "status");',
        '    return status === "todo";',
        '  });',
        '  return <div/>;',
        '}',
      ].join('\n');
      const result = evalStaticCheck(code);
      expect(result.critical.find(c => c.startsWith('C5'))).toBeDefined();
      expect(result.passed).toBe(false);
    });

    it('W2: warns on direct store.setCell', () => {
      const code = 'function App() {\n  const { isReady } = useApp();\n  store.setCell("t", "r", "c", 1);\n  return <div/>;\n}';
      const result = evalStaticCheck(code);
      expect(result.warnings.find(w => w.startsWith('W2'))).toBeDefined();
    });

    it('W3: warns on JSON.stringify near callback hook', () => {
      const code = 'function App() {\n  const { isReady } = useApp();\n  const add = useAddRowCallback("t", (d) => ({ data: JSON.stringify(d) }), []);\n  return <div/>;\n}';
      const result = evalStaticCheck(code);
      expect(result.warnings.find(w => w.startsWith('W3'))).toBeDefined();
    });

    it('W4: warns on sync status string', () => {
      const code = 'function App() {\n  const { isReady } = useApp();\n  return <div><span>"Connected"</span></div>;\n}';
      const result = evalStaticCheck(code);
      expect(result.warnings.find(w => w.startsWith('W4'))).toBeDefined();
    });

    it('W5: warns on optional chaining on email', () => {
      const code = 'function App() {\n  const { isReady } = useApp();\n  const e = oidcUser?.email;\n  return <div/>;\n}';
      const result = evalStaticCheck(code);
      expect(result.warnings.find(w => w.startsWith('W5'))).toBeDefined();
    });

    it('W6: warns on anonymous fallback', () => {
      const code = 'function App() {\n  const { isReady } = useApp();\n  const name = email || "anonymous";\n  return <div/>;\n}';
      const result = evalStaticCheck(code);
      expect(result.warnings.find(w => w.startsWith('W6'))).toBeDefined();
    });
  });
});
