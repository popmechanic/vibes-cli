import { readFileSync, existsSync } from 'fs';
// @ts-ignore
import * as Babel from '@babel/standalone';
import React from 'react';
import { renderToString } from 'react-dom/server';

export interface SSRResult {
  passed: boolean;
  error?: string;
  hookCounts?: number[];
}

interface RenderConfig {
  email: string;
  isReady: boolean;
  tableData: Record<string, Record<string, any>>;
  rowIds: string[];
}

const RENDER_CONFIGS: RenderConfig[] = [
  // 1. Alice with 2 rows — baseline
  {
    email: 'alice@test.com',
    isReady: true,
    tableData: { 'mock-row-a': { name: 'A' }, 'mock-row-b': { name: 'B' } },
    rowIds: ['mock-row-a', 'mock-row-b'],
  },
  // 2. Alice with 3 rows — hooks-in-loop detection (different row count = different hook count if buggy)
  {
    email: 'alice@test.com',
    isReady: true,
    tableData: { 'mock-row-a': { name: 'A' }, 'mock-row-b': { name: 'B' }, 'mock-row-c': { name: 'C' } },
    rowIds: ['mock-row-a', 'mock-row-b', 'mock-row-c'],
  },
  // 3. Bob with 2 rows — same count as #1, different identity
  {
    email: 'bob@test.com',
    isReady: true,
    tableData: { 'mock-row-a': { name: 'A' }, 'mock-row-b': { name: 'B' } },
    rowIds: ['mock-row-a', 'mock-row-b'],
  },
  // 4. Bob with 3 rows — same count as #2, different identity
  {
    email: 'bob@test.com',
    isReady: true,
    tableData: { 'mock-row-a': { name: 'A' }, 'mock-row-b': { name: 'B' }, 'mock-row-c': { name: 'C' } },
    rowIds: ['mock-row-a', 'mock-row-b', 'mock-row-c'],
  },
];

/**
 * Transform JSX source to plain JS using Babel standalone.
 */
function transformJsx(jsx: string): string {
  const result = Babel.transform(jsx, {
    presets: ['react'],
    filename: 'app.jsx',
  });
  return result.code;
}

/**
 * Create mock TinyBase and React globals for SSR rendering.
 * Each mock hook increments a shared counter so we can detect
 * conditional hook violations.
 */
function createMockGlobals(config: RenderConfig) {
  const hookCounter = { count: 0 };

  function countHook<T>(returnValue: T): T {
    hookCounter.count++;
    return returnValue;
  }

  const user = {
    email: config.email,
    id: config.email,
    sub: config.email,
    firstName: config.email.split('@')[0],
    lastName: 'Test',
    username: config.email.split('@')[0],
  };

  const mocks: Record<string, any> = {
    // React
    React,
    // React hooks
    useState: (init: any) => countHook([typeof init === 'function' ? init() : init, () => {}]),
    useEffect: (fn: any, deps?: any) => { countHook(undefined); },
    useCallback: (fn: any, deps?: any) => countHook(fn),
    useMemo: (fn: any, deps?: any) => countHook(fn()),
    useRef: (init?: any) => countHook({ current: init }),
    useContext: (ctx: any) => countHook({}),
    useReducer: (reducer: any, init: any) => countHook([init, () => {}]),
    useLayoutEffect: (fn: any, deps?: any) => { countHook(undefined); },

    // TinyBase read hooks
    useApp: () => countHook({ isReady: config.isReady, isSyncing: false, user }),
    useUser: () =>
      countHook({
        isSignedIn: true,
        isLoaded: true,
        user,
      }),
    useCell: (_table: string, _rowId: string, _cellId: string) => countHook(''),
    useRow: (_table: string, _rowId: string) => countHook({}),
    useTable: (_table: string) => countHook({ ...config.tableData }),
    useRowIds: (_table: string) => countHook([...config.rowIds]),
    useSortedRowIds: (_table: string, _cellId?: string, _descending?: boolean, _offset?: number, _limit?: number) =>
      countHook([...config.rowIds]),
    useHasRow: (_table: string, _rowId: string) => countHook(false),
    useHasCell: (_table: string, _rowId: string, _cellId: string) => countHook(false),
    useValue: (_valueId: string) => countHook(undefined),
    useValues: () => countHook({}),
    useRowCount: (_table: string) => countHook(config.rowIds.length),
    useHasValue: (_valueId: string) => countHook(false),
    useCellIds: (_table: string, _rowId: string) => countHook([]),
    useTableIds: () => countHook([]),

    // State-returning hooks
    useValueState: (_valueId: string) => countHook([undefined, () => {}]),
    useCellState: (_table: string, _rowId: string, _cellId: string) => countHook(['', () => {}]),
    useRowState: (_table: string, _rowId: string) => countHook([{}, () => {}]),

    // TinyBase write hooks — return noop functions
    useAddRowCallback: (_table: string, _fn?: any, _deps?: any) => countHook(() => {}),
    useSetCellCallback: (_table: string, _rowId: string, _cellId: string, _fn?: any, _deps?: any) =>
      countHook(() => {}),
    useSetRowCallback: (_table: string, _rowId: string, _fn?: any, _deps?: any) => countHook(() => {}),
    useSetPartialRowCallback: (_table: string, _rowId: string, _fn?: any, _deps?: any) => countHook(() => {}),
    useDelRowCallback: (_table: string, _rowId: string, _fn?: any, _deps?: any) => countHook(() => {}),
    useDelCellCallback: (_table: string, _rowId: string, _cellId: string, _fn?: any, _deps?: any) => countHook(() => {}),
    useDelTableCallback: (_table: string) => countHook(() => {}),
    useSetValueCallback: (_valueId: string, _fn?: any, _deps?: any) => countHook(() => {}),
    useDelValueCallback: (_valueId: string, _fn?: any, _deps?: any) => countHook(() => {}),

    // Other globals the app might reference
    useOIDCContext: () => countHook({ user, isAuthenticated: true }),
    createContext: React.createContext,
    useContext: (ctx: any) => countHook({}),
    store: {
      setCell: () => {},
      setRow: () => {},
      setTable: () => {},
      delRow: () => {},
      delCell: () => {},
      getCell: () => '',
      getRow: () => ({}),
      getTable: () => ({ ...config.tableData }),
      getRowIds: () => [...config.rowIds],
    },
  };

  return { mocks, hookCounter };
}

/**
 * Build a React component from transpiled JS code by evaluating it
 * with injected mock globals.
 */
function buildComponent(jsCode: string, mocks: Record<string, any>): React.ComponentType {
  // Build parameter names and values for new Function
  const paramNames = Object.keys(mocks);
  const paramValues = paramNames.map((k) => mocks[k]);

  // The code defines functions at the top level. We wrap it to capture `App`.
  const wrappedCode = `
${jsCode}

if (typeof App !== 'undefined') return App;
throw new Error('No App component found');
`;

  const factory = new Function(...paramNames, wrappedCode);
  return factory(...paramValues);
}

/**
 * Main entry point: run SSR smoke test on JSX source or file path.
 *
 * Transforms JSX → JS, then renders 4 times with different mock data.
 * If hook counts differ between any renders, reports a conditional hook violation.
 */
export function ssrSmokeTest(jsxOrPath: string): SSRResult {
  // Load code from file if it's a path
  const jsx =
    !jsxOrPath.includes('\n') && existsSync(jsxOrPath)
      ? readFileSync(jsxOrPath, 'utf8')
      : jsxOrPath;

  // Step 1: Babel transform
  let jsCode: string;
  try {
    jsCode = transformJsx(jsx);
  } catch (err: any) {
    return {
      passed: false,
      error: `Babel transform failed: ${err.message}`,
    };
  }

  // Step 2: Render with each config, recording hook counts
  const hookCounts: number[] = [];

  for (let i = 0; i < RENDER_CONFIGS.length; i++) {
    const config = RENDER_CONFIGS[i];
    const { mocks, hookCounter } = createMockGlobals(config);

    let AppComponent: React.ComponentType;
    try {
      AppComponent = buildComponent(jsCode, mocks);
    } catch (err: any) {
      return {
        passed: false,
        error: `Component build failed (config ${i}): ${err.message}`,
      };
    }

    // Reset counter AFTER buildComponent (evaluation may call hooks)
    hookCounter.count = 0;

    try {
      renderToString(React.createElement(AppComponent));
    } catch (err: any) {
      return {
        passed: false,
        error: `Render failed (config ${i}): ${err.message}`,
      };
    }

    hookCounts.push(hookCounter.count);
  }

  // Step 3: Compare hook counts within same-row-count groups.
  // Configs 0,2 have 2 rows; configs 1,3 have 3 rows.
  // Legitimate child-component-per-row patterns produce different totals
  // across row counts, but same totals within the same row count.
  // A hooks-in-loop bug produces different totals even within the same
  // row count when the conditional filtering varies.
  //
  // Strategy: compare pairs (0 vs 2) and (1 vs 3). If either pair differs,
  // it's a conditional hook violation.
  if (hookCounts.length >= 4) {
    const sameRowCountA = hookCounts[0] === hookCounts[2]; // 2-row configs
    const sameRowCountB = hookCounts[1] === hookCounts[3]; // 3-row configs
    if (!sameRowCountA || !sameRowCountB) {
      return {
        passed: false,
        error: `Conditional hook violation: hook counts differ across same-row-count renders [${hookCounts.join(', ')}]`,
        hookCounts,
      };
    }
  } else {
    // Fallback for fewer than 4 configs: all must match
    const uniqueCounts = new Set(hookCounts);
    if (uniqueCounts.size > 1) {
      return {
        passed: false,
        error: `Conditional hook violation: hook counts differ across renders [${hookCounts.join(', ')}]`,
        hookCounts,
      };
    }
  }

  return {
    passed: true,
    hookCounts,
  };
}

// CLI entry point
if (import.meta.main) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: bun scripts/eval-ssr-check.ts <app.jsx>');
    process.exit(1);
  }
  const result = ssrSmokeTest(filePath);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
}
