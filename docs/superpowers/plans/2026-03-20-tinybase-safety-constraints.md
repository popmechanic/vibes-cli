# TinyBase Safety Constraints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime and build-time safety nets so that slightly-wrong generated TinyBase app code produces a degraded-but-working app instead of a white screen.

**Architecture:** ErrorBoundary catches runtime throws, template-level isReady gate removes a common builder mistake, useTable warning wrapper alerts on performance issues, assembly-time lint catches structural problems, and a reference app in SKILL.md gives the builder a proven pattern.

**Tech Stack:** React class component (ErrorBoundary), vitest for tests

---

## File Structure

### Modified Files

| File | Changes |
|------|---------|
| `skills/vibes/template.delta.html` | Add AppErrorBoundary class, move isReady gate to template, add useTable warning wrapper |
| `scripts/assemble.js` | Add forbidden pattern warning check after assembly |
| `skills/vibes/SKILL.md` | Add reference app section, update isReady docs |
| `scripts/__tests__/unit/tinybase-template.test.js` | Add tests for error boundary and isReady gate presence |

---

## Task 1: ErrorBoundary + isReady Gate in Template

Add a React error boundary around `<App />` and move the isReady check from generated code responsibility to the template.

**Files:**
- Modify: `skills/vibes/template.delta.html`
- Modify: `scripts/__tests__/unit/tinybase-template.test.js`

- [ ] **Step 1: Write failing tests**

Add to `scripts/__tests__/unit/tinybase-template.test.js`:

```javascript
it('vibes delta has AppErrorBoundary class', () => {
  const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
  expect(delta).toContain('class AppErrorBoundary');
  expect(delta).toContain('getDerivedStateFromError');
  expect(delta).toContain('componentDidCatch');
});

it('vibes delta wraps App in AppErrorBoundary', () => {
  const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
  expect(delta).toContain('<AppErrorBoundary>');
  expect(delta).toContain('</AppErrorBoundary>');
});

it('vibes delta has template-level isReady gate', () => {
  const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
  // The template should gate rendering BEFORE mounting App
  // Look for isReady check in AppShell that returns loading UI
  expect(delta).toMatch(/if\s*\(\s*!isReady\s*\)/);
});

it('vibes delta has useTable warning wrapper assigned to window', () => {
  const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
  expect(delta).toMatch(/window\.useTable\s*=\s*function useTableWithWarning/);
});
```

- [ ] **Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/tinybase-template.test.js`
Expected: 4 new tests FAIL

- [ ] **Add AppErrorBoundary to template delta**

In `skills/vibes/template.delta.html`, add the AppErrorBoundary class component BEFORE the AppShell function (after the `store` and error component declarations, around line 85):

```jsx
  // --- Error Boundary ---
  class AppErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error, info) { console.error('[vibes] App error:', error, info); }
    render() {
      if (this.state.error) {
        return React.createElement('div', {
          style: { padding: '2rem', textAlign: 'center', fontFamily: 'system-ui' }
        },
          React.createElement('h2', null, 'Something went wrong'),
          React.createElement('p', { style: { color: '#666' } }, this.state.error.message),
          React.createElement('button', {
            onClick: () => this.setState({ error: null }),
            style: { marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }
          }, 'Try Again'),
          React.createElement('details', {
            style: { marginTop: '1rem', textAlign: 'left', fontSize: '0.8rem' }
          },
            React.createElement('summary', null, 'Technical details'),
            React.createElement('pre', {
              style: { overflow: 'auto', padding: '0.5rem', background: '#f5f5f5' }
            }, this.state.error.stack)
          )
        );
      }
      return this.props.children;
    }
  }
```

Note: Using `React.createElement` instead of JSX for the error boundary because it's a class component defined in the Babel-transpiled section. JSX would also work here since we're inside a `<script type="text/babel">` block, but createElement is more explicit for class components.

- [ ] **Move isReady gate to AppShell**

In the AppShell function, add an isReady gate BEFORE the `config.public || !hasOidc` branch. This ensures App never renders before the store is hydrated:

```jsx
    // Template-level isReady gate — App never sees !isReady
    if (!isReady) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5, fontFamily: 'system-ui' }}>
          Loading...
        </div>
      );
    }
```

This goes right after the `useEffect` block and the `hasOidc` calculation, BEFORE the first return statement.

- [ ] **Wrap App in AppErrorBoundary**

Find every `<App />` in AppShell and wrap it:

```jsx
// Before:
<App />

// After:
<AppErrorBoundary><App /></AppErrorBoundary>
```

There are two occurrences: one in the public/no-OIDC branch, one in the SignedIn branch.

- [ ] **Add useTable warning wrapper**

After the TinyBase hook global exports (around line 24), replace the useTable assignment:

```javascript
  // useTable warning wrapper — alerts when table has >100 rows
  const _rawUseTable = useTable;
  window.useTable = function useTableWithWarning(tableId) {
    const table = _rawUseTable(tableId);
    if (typeof table === 'object' && table !== null) {
      const rowCount = Object.keys(table).length;
      if (rowCount > 100) {
        console.warn(
          `[vibes] useTable('${tableId}') returned ${rowCount} rows. ` +
          `For better performance, use useRowIds('${tableId}') + useCell() in child components.`
        );
      }
    }
    return table;
  };
```

Remove the original `window.useTable = useTable;` line (replace it with the wrapper above).

- [ ] **Rebuild merged templates**

Run: `bun scripts/merge-templates.js --force`
Expected: Templates regenerated

- [ ] **Run tests**

Run: `cd scripts && npx vitest run __tests__/unit/tinybase-template.test.js`
Expected: All tests PASS (old + new)

- [ ] **Commit**

```bash
git add skills/vibes/template.delta.html scripts/__tests__/unit/tinybase-template.test.js
git commit -m "feat: add ErrorBoundary, isReady gate, and useTable warning to template"
```

---

## Task 2: Assembly-Time Forbidden Pattern Check

Add warnings during assembly when generated code contains patterns that indicate builder mistakes.

**Files:**
- Modify: `scripts/assemble.js`
- Modify: `scripts/__tests__/unit/assemble-validation.test.js`

- [ ] **Step 1: Write failing test**

Add to `scripts/__tests__/unit/assemble-validation.test.js`:

```javascript
import { checkForbiddenPatterns } from '../../lib/assembly-utils.js';

describe('forbidden pattern warnings', () => {
  it('warns on import statements', () => {
    const warnings = checkForbiddenPatterns('import React from "react";\nfunction App() {}');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('import');
  });

  it('warns on createStore calls', () => {
    const warnings = checkForbiddenPatterns('const s = createMergeableStore()');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('store');
  });

  it('warns on direct store method calls', () => {
    const warnings = checkForbiddenPatterns('store.setCell("t", "r", "c", 1)');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('returns empty array for clean code', () => {
    const warnings = checkForbiddenPatterns('export default function App() { return <div>Hi</div>; }');
    expect(warnings).toEqual([]);
  });
});
```

- [ ] **Run test to verify it fails**

Run: `cd scripts && npx vitest run __tests__/unit/assemble-validation.test.js`
Expected: FAIL — `checkForbiddenPatterns` doesn't exist

- [ ] **Implement checkForbiddenPatterns**

Add to `scripts/lib/assembly-utils.js`:

```javascript
const FORBIDDEN_PATTERNS = [
  { pattern: /\bimport\s+.+from\s+['"]/, message: 'Generated code contains import statements — all modules are globals provided by the template' },
  { pattern: /\bcreateStore\b|\bcreateMergeableStore\b/, message: 'Generated code creates its own store — the template manages the store' },
  { pattern: /\bstore\.set[A-Z]|\bstore\.add[A-Z]|\bstore\.del[A-Z]/, message: 'Generated code calls store methods directly — use callback hooks instead' },
];

export function checkForbiddenPatterns(code) {
  const warnings = [];
  for (const { pattern, message } of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      warnings.push(message);
    }
  }
  return warnings;
}
```

- [ ] **Update the static import in assemble.js**

At the top of `scripts/assemble.js`, find the import from `assembly-utils.js` and add `checkForbiddenPatterns`:

```javascript
import { APP_PLACEHOLDER, validateAssembly, loadAndValidateTemplate, checkForbiddenPatterns } from './lib/assembly-utils.js';
```

- [ ] **Add warning call to assemble.js**

After `const cleanedAppCode = stripForTemplate(...)` and before the template replacement, add:

```javascript
  // Check for common builder mistakes
  const assemblyWarnings = checkForbiddenPatterns(cleanedAppCode);
  if (assemblyWarnings.length > 0) {
    console.warn('Assembly warnings:');
    assemblyWarnings.forEach(w => console.warn(`  - ${w}`));
  }
```

- [ ] **Run tests**

Run: `cd scripts && npx vitest run __tests__/unit/assemble-validation.test.js`
Expected: All tests PASS

- [ ] **Commit**

```bash
git add scripts/assemble.js scripts/lib/assembly-utils.js scripts/__tests__/unit/assemble-validation.test.js
git commit -m "feat: add assembly-time warnings for forbidden code patterns"
```

---

## Task 3: Reference App in SKILL.md

Add a complete working example to SKILL.md so the builder has a proven pattern to study and adapt.

**Files:**
- Modify: `skills/vibes/SKILL.md`

- [ ] **Step 1: Add Reference App section**

In `skills/vibes/SKILL.md`, find the "Common Mistakes" section. INSERT a new section BEFORE it called "## Reference App":

```markdown
## Reference App

Complete working example — a shared grocery list. Study this pattern before generating code:

\`\`\`jsx
export default function App() {
  const { isReady, user } = useApp();
  return (
    <div className="max-w-md mx-auto p-4">
      <h1 className="text-xl font-bold mb-4">Grocery List</h1>
      <AddItem user={user} />
      <ItemList />
    </div>
  );
}

function AddItem({ user }) {
  const [input, setInput] = useState('');
  const addItem = useAddRowCallback(
    'items',
    (text) => ({
      name: text ?? '',
      bought: false,
      addedBy: user?.name ?? 'someone',
      createdAt: Date.now(),
    }),
    [user],
  );
  const handleAdd = () => {
    if (input.trim()) {
      addItem(input.trim());
      setInput('');
    }
  };
  return (
    <div className="flex gap-2 mb-4">
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        className="flex-1 border rounded px-3 py-2"
        placeholder="Add item..."
      />
      <button onClick={handleAdd} className="btn">Add</button>
    </div>
  );
}

function ItemList() {
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;
  const totalItems = useRowCount('items');
  const itemIds = useSortedRowIds('items', 'createdAt', true, page * PAGE_SIZE, PAGE_SIZE);
  return (
    <div>
      {itemIds.map(id => <GroceryItem key={id} id={id} />)}
      {totalItems > (page + 1) * PAGE_SIZE && (
        <button onClick={() => setPage(p => p + 1)} className="w-full py-2 text-sm opacity-60">
          Load more
        </button>
      )}
    </div>
  );
}

function GroceryItem({ id }) {
  const name = useCell('items', id, 'name');
  const bought = useCell('items', id, 'bought');
  const addedBy = useCell('items', id, 'addedBy');
  const toggleBought = useSetCellCallback(
    'items', id, 'bought',
    (_e) => (current) => !current,
  );
  const remove = useDelRowCallback('items', id);

  return (
    <div className="flex items-center gap-2 py-2 border-b">
      <button onClick={toggleBought} className="w-6 h-6 flex items-center justify-center">
        {bought ? '\u2713' : '\u25CB'}
      </button>
      <span className={bought ? 'line-through opacity-40 flex-1' : 'flex-1'}>
        {name}
      </span>
      <span className="text-xs opacity-50">{addedBy}</span>
      <button onClick={remove} className="text-red-400 text-sm">x</button>
    </div>
  );
}
\`\`\`

**Key patterns demonstrated:**
- `useApp()` for status (isReady always true inside App — template gates rendering)
- `useAddRowCallback` with deps array including `user`
- `useSortedRowIds` with pagination (PAGE_SIZE 25)
- `useCell` in child components for fine-grained reactivity (not useTable)
- `useSetCellCallback` with MapCell pattern for toggles
- `useDelRowCallback` for deletion
- No imports, no store access, no schema
```

- [ ] **Step 2: Update isReady guidance**

Find all mentions of `isReady` in SKILL.md. Update to note:
> The template gates rendering until the store is ready. `useApp().isReady` is always `true` inside your App component. You can still check it for explicitness, but forgetting it won't crash the app.

Remove the "DON'T forget isReady check" from Common Mistakes (it's no longer fatal — the template handles it).

- [ ] **Commit**

```bash
git add skills/vibes/SKILL.md
git commit -m "feat: add reference app and update isReady docs in SKILL.md"
```

---

## Task 4: Rebuild and Verify

Ensure everything works together.

- [ ] **Rebuild all templates**

```bash
bun scripts/build-components.js --force
bun scripts/build-design-tokens.js --force
bun scripts/merge-templates.js --force
```

- [ ] **Run full test suite**

```bash
cd scripts && npx vitest run
```

Expected: All tests pass

- [ ] **Verify assembly with fixture**

```bash
bun scripts/assemble.js scripts/__tests__/fixtures/minimal.jsx /tmp/safety-test.html
```

Expected: File created, no warnings (minimal fixture is clean)

- [ ] **Final commit if any loose changes**

```bash
git add -A && git status
# Only commit if there are changes
```
