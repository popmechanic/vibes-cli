# TinyBase Safety Constraints Design

**Date:** 2026-03-20
**Status:** Draft
**Builds on:** TinyBase Vibes Integration (same worktree)

## Problem

Generated app code is written by an AI builder from user prompts. The builder can make mistakes: forgetting isReady checks, using useTable on large tables, including import statements, calling store methods directly. When these mistakes happen, the app white-screens with no recovery — the user sees nothing.

The current safety approach is SKILL.md instructions ("don't do X"). This is necessary but insufficient — the builder doesn't always follow instructions perfectly, especially with novel prompts.

## Goal

Add runtime and build-time safety nets that catch common builder mistakes automatically, so that slightly-wrong generated code still produces a working (if degraded) app rather than a white screen.

## Principle

**The template should be forgiving.** If generated code is 90% correct, the user should see 90% of the app — not a blank page.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Error boundary | React ErrorBoundary wrapping `<App />` | Catches throws, shows recovery UI instead of white screen |
| isReady gate | Template-level, not generated code | Builder forgetting `if (!isReady)` shouldn't crash the app |
| useTable warning | Console.warn wrapper when >100 rows | Soft guardrail — doesn't break, just alerts |
| Assembly lint | Warn on forbidden patterns | Catches imports, direct store calls at build time |
| Reference app | Complete working example in SKILL.md | Builder has a known-good pattern to follow |

## Changes

### 1. ErrorBoundary in Template Delta

Add a React class component ErrorBoundary around `<App />` in the vibes delta's AppShell:

```jsx
class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[vibes] App error:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#666' }}>{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })}
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>
            Try Again
          </button>
          <details style={{ marginTop: '1rem', textAlign: 'left', fontSize: '0.8rem' }}>
            <summary>Technical details</summary>
            <pre style={{ overflow: 'auto', padding: '0.5rem', background: '#f5f5f5' }}>
              {this.state.error.stack}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Wrap each `<App />` render in AppShell:
```jsx
// Before:
<App />

// After:
<AppErrorBoundary><App /></AppErrorBoundary>
```

### 2. Template-Level isReady Gate

Move the `isReady` check from generated code responsibility to the template's AppShell. Currently AppShell renders `<App />` immediately and expects App to check `isReady`. Instead:

```jsx
// In AppShell, gate App rendering:
if (!isReady) {
  return <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>Loading...</div>;
}
return (
  <Provider store={store}>
    <AppContext.Provider value={{ isReady: true, isSyncing, user }}>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </AppContext.Provider>
  </Provider>
);
```

`useApp().isReady` is always `true` when App renders — it can still be checked but forgetting it is no longer fatal. Update SKILL.md to note this: "The template gates rendering until the store is ready. `useApp().isReady` is always `true` inside your App component, but you can still check it for explicitness."

### 3. useTable Warning Wrapper

Override the exposed `window.useTable` with a version that warns about large tables:

```javascript
const _rawUseTable = useTable;
window.useTable = function useTableWithWarning(tableId) {
  const table = _rawUseTable(tableId);
  const rowCount = Object.keys(table).length;
  if (rowCount > 100) {
    console.warn(
      `[vibes] useTable('${tableId}') returned ${rowCount} rows. ` +
      `For better performance, use useRowIds('${tableId}') + useCell() in child components.`
    );
  }
  return table;
};
```

This doesn't break anything — the function signature is identical. It just logs a warning to help debug performance issues.

### 4. Assembly-Time Forbidden Pattern Check

In `scripts/assemble.js`, after inserting app code but before writing output, scan for patterns that indicate the builder broke the rules:

```javascript
const FORBIDDEN_PATTERNS = [
  { pattern: /\bimport\s+.+from\s+['"]/, message: 'Generated code contains import statements — all modules are globals' },
  { pattern: /\bcreateStore\b|\bcreateMergeableStore\b/, message: 'Generated code creates its own store — the template manages the store' },
  { pattern: /\bstore\.set|\bstore\.add|\bstore\.del/, message: 'Generated code calls store methods directly — use callback hooks instead' },
];

const warnings = [];
for (const { pattern, message } of FORBIDDEN_PATTERNS) {
  if (pattern.test(cleanedAppCode)) {
    warnings.push(message);
  }
}
if (warnings.length > 0) {
  console.warn('⚠️  Assembly warnings:');
  warnings.forEach(w => console.warn(`  - ${w}`));
}
```

These are warnings, not errors — assembly still succeeds. The strip-code pass already removes `import` statements, but this catches any that slip through.

### 5. Reference App in SKILL.md

Add the complete grocery list example from the design doc as a "Reference App" section in SKILL.md, right after the data API section. This gives the builder a known-good, copy-and-adapt pattern for every new app.

## Files Changed

| File | Change |
|------|--------|
| `skills/vibes/template.delta.html` | Add AppErrorBoundary, move isReady gate to template, add useTable warning wrapper |
| `scripts/assemble.js` | Add forbidden pattern warning check |
| `skills/vibes/SKILL.md` | Add reference app section, update isReady guidance |
| `scripts/__tests__/unit/tinybase-template.test.js` | Add tests for error boundary and isReady gate |
| `scripts/__tests__/unit/assemble-validation.test.js` | Add tests for forbidden pattern warnings |
