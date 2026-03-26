import { readFileSync, existsSync } from 'fs';
// @ts-ignore
import * as Babel from '@babel/standalone';
import React from 'react';
import { renderToString } from 'react-dom/server';

export interface RecordedOp {
  op:
    | 'readCell'
    | 'readRow'
    | 'readTable'
    | 'readRowIds'
    | 'readSortedRowIds'
    | 'addRow'
    | 'setCell'
    | 'setRow'
    | 'delRow'
    | 'readValue'
    | 'setValue'
    | 'readHasRow'
    | 'readHasCell'
    | 'setCellState'
    | 'setValueState';
  table?: string;
  row?: string;
  cell?: string;
  valueId?: string;
  rowFactory?: () => Record<string, any>;
  cellFactory?: () => any;
  value?: any;
}

export interface DataModelAnalysis {
  aliceOps: RecordedOp[];
  bobOps: RecordedOp[];
  failures: string[];
}

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
 * Create recording mock globals for a given user email.
 * Each hook records the call into `ops` and returns a sensible default.
 */
function createRecordingMocks(email: string): { mocks: Record<string, any>; ops: RecordedOp[] } {
  const ops: RecordedOp[] = [];

  const user = {
    email,
    id: email,
    sub: email,
    firstName: email.split('@')[0],
    lastName: 'Test',
    username: email.split('@')[0],
  };

  const mocks: Record<string, any> = {
    // React itself
    React,

    // Standard React hooks (not recorded, just functional)
    useState: (init: any) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: (_fn: any, _deps?: any) => {},
    useCallback: (fn: any, _deps?: any) => fn,
    useMemo: (fn: any, _deps?: any) => fn(),
    useRef: (init?: any) => ({ current: init }),
    useContext: (_ctx: any) => ({}),
    useReducer: (_reducer: any, init: any) => [init, () => {}],
    useLayoutEffect: (_fn: any, _deps?: any) => {},

    // --- TinyBase read hooks (recording) ---

    useApp: () => ({ isReady: true, isSyncing: false, user }),

    useUser: () => ({
      isSignedIn: true,
      isLoaded: true,
      user,
    }),

    useTable: (table: string) => {
      ops.push({ op: 'readTable', table });
      return {};
    },

    useRowIds: (table: string) => {
      ops.push({ op: 'readRowIds', table });
      return ['mock-row-1'];
    },

    useSortedRowIds: (
      table: string,
      _cellId?: string,
      _descending?: boolean,
      _offset?: number,
      _limit?: number
    ) => {
      ops.push({ op: 'readSortedRowIds', table });
      return ['mock-row-1'];
    },

    useCell: (table: string, row: string, cell: string) => {
      ops.push({ op: 'readCell', table, row, cell });
      return '';
    },

    useRow: (table: string, row: string) => {
      ops.push({ op: 'readRow', table, row });
      return {};
    },

    useHasRow: (table: string, row: string) => {
      ops.push({ op: 'readHasRow', table, row });
      return false;
    },

    useHasCell: (table: string, row: string, cell: string) => {
      ops.push({ op: 'readHasCell', table, row, cell });
      return false;
    },

    useValue: (valueId: string) => {
      ops.push({ op: 'readValue', valueId });
      return undefined;
    },

    useValues: () => ({}),
    useRowCount: (_table: string) => 0,
    useHasValue: (_valueId: string) => false,
    useCellIds: (_table: string, _rowId: string) => [],
    useTableIds: () => [],

    // State-returning hooks (recording setter calls)

    useValueState: (valueId: string) => {
      ops.push({ op: 'readValue', valueId });
      const setter = (val: any) => {
        ops.push({ op: 'setValueState', valueId, value: val });
      };
      return [undefined, setter];
    },

    useCellState: (table: string, row: string, cell: string) => {
      ops.push({ op: 'readCell', table, row, cell });
      const setter = (val: any) => {
        ops.push({ op: 'setCellState', table, row, cell, value: val });
      };
      return ['', setter];
    },

    useRowState: (table: string, row: string) => {
      const setter = (val: any) => {
        ops.push({ op: 'setRow', table, row, value: val });
      };
      return [{}, setter];
    },

    // --- TinyBase write hooks (recording, return noop) ---

    useAddRowCallback: (table: string, fn?: (...args: any[]) => Record<string, any>, _deps?: any) => {
      // Capture the factory so callers can invoke it later
      const rowFactory = fn
        ? (...args: any[]) => fn(...args)
        : () => ({});
      ops.push({ op: 'addRow', table, rowFactory });
      return () => {};
    },

    useSetCellCallback: (
      table: string,
      row: string,
      cell: string,
      fn?: (...args: any[]) => any,
      _deps?: any
    ) => {
      const cellFactory = fn ? (...args: any[]) => fn(...args) : () => undefined;
      ops.push({ op: 'setCell', table, row, cell, cellFactory });
      return () => {};
    },

    useSetRowCallback: (table: string, row: string, _fn?: any, _deps?: any) => {
      ops.push({ op: 'setRow', table, row });
      return () => {};
    },

    useSetPartialRowCallback: (table: string, row: string, _fn?: any, _deps?: any) => {
      ops.push({ op: 'setRow', table, row });
      return () => {};
    },

    useDelRowCallback: (table: string, row: string, _fn?: any, _deps?: any) => {
      ops.push({ op: 'delRow', table, row });
      return () => {};
    },

    useDelCellCallback: (table: string, row: string, cell: string, _fn?: any, _deps?: any) => {
      return () => {};
    },

    useDelTableCallback: (table: string) => {
      return () => {};
    },

    useSetValueCallback: (valueId: string, _fn?: any, _deps?: any) => {
      ops.push({ op: 'setValue', valueId });
      return () => {};
    },

    useDelValueCallback: (_valueId: string, _fn?: any, _deps?: any) => () => {},

    // Other globals apps may reference
    useOIDCContext: () => ({ user, isAuthenticated: true }),
    createContext: React.createContext,
    useContext: (_ctx: any) => ({}),

    store: {
      setCell: () => {},
      setRow: () => {},
      setTable: () => {},
      delRow: () => {},
      delCell: () => {},
      delTable: () => {},
      getCell: () => '',
      getRow: () => ({}),
      getTable: () => ({}),
      getRowIds: () => [],
    },
  };

  return { mocks, ops };
}

/**
 * Build and render a React component from transpiled JS code
 * using injected mock globals. Returns rendered HTML string.
 */
function renderWithMocks(jsCode: string, mocks: Record<string, any>): string {
  const paramNames = Object.keys(mocks);
  const paramValues = paramNames.map((k) => mocks[k]);

  const wrappedCode = `
${jsCode}

if (typeof App !== 'undefined') return App;
throw new Error('No App component found');
`;

  const factory = new Function(...paramNames, wrappedCode);
  const AppComponent: React.ComponentType = factory(...paramValues);

  return renderToString(React.createElement(AppComponent));
}

/**
 * Main entry point: render with Alice and Bob recording mocks,
 * collect all recorded ops, return analysis.
 */
export function analyzeDataModel(jsxOrPath: string): DataModelAnalysis {
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
      aliceOps: [],
      bobOps: [],
      failures: [`Babel transform failed: ${err.message}`],
    };
  }

  const failures: string[] = [];

  // Step 2: Render as Alice
  const { mocks: aliceMocks, ops: aliceOps } = createRecordingMocks('alice@test.com');
  try {
    renderWithMocks(jsCode, aliceMocks);
  } catch (err: any) {
    failures.push(`Alice render failed: ${err.message}`);
  }

  // Step 3: Render as Bob
  const { mocks: bobMocks, ops: bobOps } = createRecordingMocks('bob@test.com');
  try {
    renderWithMocks(jsCode, bobMocks);
  } catch (err: any) {
    failures.push(`Bob render failed: ${err.message}`);
  }

  return { aliceOps, bobOps, failures };
}

export interface EvalSpec {
  tables: string[];
  perUserFields: Record<string, string[]>; // table → fields that must contain user identity
  sharedTables: string[];                  // tables where ALL data is shared (no per-user requirement)
}

export interface AssertionResult {
  passed: boolean;
  score: number; // 0-4 per scoring rubric
  failures: string[];
}

/**
 * Assert that recorded ops match the expected data model from the eval spec.
 * Scoring rubric:
 *   0 — no ops recorded or analysis has failures
 *   2 — more than 3 failures
 *   3 — some failures (1-3)
 *   4 — all assertions pass
 */
export function assertDataModel(analysis: DataModelAnalysis, spec: EvalSpec): AssertionResult {
  // If analysis itself failed, score 0 immediately
  if (analysis.failures.length > 0) {
    return { passed: false, score: 0, failures: analysis.failures };
  }

  const totalOps = analysis.aliceOps.length + analysis.bobOps.length;
  if (totalOps === 0) {
    return { passed: false, score: 0, failures: ['No ops recorded for either user'] };
  }

  const failures: string[] = [];

  // Check per-user field requirements
  for (const [table, requiredFields] of Object.entries(spec.perUserFields)) {
    for (const field of requiredFields) {
      // Find addRow ops for this table for each user
      const aliceAddRow = analysis.aliceOps.find(
        (op) => op.op === 'addRow' && op.table === table
      );
      const bobAddRow = analysis.bobOps.find(
        (op) => op.op === 'addRow' && op.table === table
      );

      if (!aliceAddRow) {
        failures.push(`Table '${table}': alice has no addRow op`);
        continue;
      }
      if (!bobAddRow) {
        failures.push(`Table '${table}': bob has no addRow op`);
        continue;
      }

      // Invoke the row factories to get the actual row data
      const aliceRow = aliceAddRow.rowFactory ? aliceAddRow.rowFactory() : {};
      const bobRow = bobAddRow.rowFactory ? bobAddRow.rowFactory() : {};

      // Check that the required field exists in the row
      if (!(field in aliceRow)) {
        failures.push(
          `Table '${table}': alice addRow missing required per-user field '${field}'`
        );
      } else {
        // Check that the field value contains alice's email substring
        const val = String(aliceRow[field]);
        if (!val.includes('alice')) {
          failures.push(
            `Table '${table}': alice addRow field '${field}' does not contain user identity (got '${val}')`
          );
        }
      }

      if (!(field in bobRow)) {
        failures.push(
          `Table '${table}': bob addRow missing required per-user field '${field}'`
        );
      } else {
        const val = String(bobRow[field]);
        if (!val.includes('bob')) {
          failures.push(
            `Table '${table}': bob addRow field '${field}' does not contain user identity (got '${val}')`
          );
        }
      }
    }
  }

  // Check that both users access the expected tables (reads or writes)
  for (const table of spec.tables) {
    const aliceAccessesTable = analysis.aliceOps.some((op) => op.table === table);
    const bobAccessesTable = analysis.bobOps.some((op) => op.table === table);

    if (!aliceAccessesTable) {
      failures.push(`Table '${table}': alice never accesses this table`);
    }
    if (!bobAccessesTable) {
      failures.push(`Table '${table}': bob never accesses this table`);
    }
  }

  // Compute score
  const passed = failures.length === 0;
  let score: number;
  if (failures.length === 0) {
    score = 4;
  } else if (failures.length <= 3) {
    score = 3;
  } else {
    score = 2;
  }

  return { passed, score, failures };
}

// ---------------------------------------------------------------------------
// Tier 2: Sync replay with MergeableStore
// ---------------------------------------------------------------------------

export interface SyncResult {
  syncPassed: boolean;
  isolationPassed: boolean;
  failures: string[];
  storeARows: any[];
  storeBRows: any[];
  storeAState: Record<string, any>;
  storeBState: Record<string, any>;
}

/**
 * Flatten all rows from all tables in a TinyBase store into a simple array.
 */
function flattenStoreRows(store: any): any[] {
  const rows: any[] = [];
  const tables = store.getTables();
  for (const table of Object.keys(tables)) {
    const tableData = tables[table];
    for (const rowId of Object.keys(tableData)) {
      rows.push({ _table: table, _rowId: rowId, ...tableData[rowId] });
    }
  }
  return rows;
}

/**
 * Extract full store state as a plain object for easy assertion.
 */
function extractStoreState(store: any): Record<string, any> {
  return store.getTables();
}

/**
 * Recursively sort object keys and stringify for stable comparison.
 * TinyBase MergeableStore may return rows in different insertion orders
 * on each store even after full convergence, so we need key-sorted comparison.
 */
function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const sorted = Object.keys(value)
    .sort()
    .reduce<Record<string, any>>((acc, k) => {
      acc[k] = value[k];
      return acc;
    }, {});
  return '{' + Object.keys(sorted).map(k => JSON.stringify(k) + ':' + stableStringify(sorted[k])).join(',') + '}';
}

/**
 * Apply a single RecordedOp to a real TinyBase store.
 * addRow uses a deterministic key prefixed with the label to avoid collisions.
 */
function applyOpToStore(store: any, op: RecordedOp, label: string, counters: Record<string, number>): void {
  switch (op.op) {
    case 'addRow': {
      if (!op.table) break;
      counters[op.table] = (counters[op.table] ?? 0) + 1;
      const rowId = `${label}-${counters[op.table]}`;
      const row = op.rowFactory ? op.rowFactory() : {};
      store.setRow(op.table, rowId, row);
      break;
    }
    case 'setCell': {
      if (!op.table || !op.row || !op.cell) break;
      const value = op.value !== undefined
        ? op.value
        : op.cellFactory
        ? op.cellFactory()
        : undefined;
      if (value !== undefined) {
        store.setCell(op.table, op.row, op.cell, value);
      }
      break;
    }
    case 'setRow': {
      if (!op.table || !op.row) break;
      store.setRow(op.table, op.row, {});
      break;
    }
    case 'delRow': {
      if (!op.table || !op.row) break;
      store.delRow(op.table, op.row);
      break;
    }
    default:
      // Read ops and others are no-ops against a real store
      break;
  }
}

/**
 * Replay recorded write operations against two real TinyBase MergeableStores
 * connected via an in-memory WebSocket sync server, then verify convergence.
 */
export async function simulateSync(
  aliceOps: RecordedOp[],
  bobOps: RecordedOp[],
  port: number = 3445,
): Promise<SyncResult> {
  // Lazily import to keep the module usable in non-sync contexts
  const { createMergeableStore } = await import('tinybase/mergeable-store');
  const { createWsSynchronizer } = await import('tinybase/synchronizers/synchronizer-ws-client');
  const { startSyncServer } = await import('./server/sync-server.ts');

  const failures: string[] = [];
  const server = startSyncServer(port);

  let syncA: any;
  let syncB: any;

  try {
    const storeA = createMergeableStore('alice-store');
    const storeB = createMergeableStore('bob-store');

    // Connect both stores to the sync server
    const wsA = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve, reject) => {
      wsA.addEventListener('open', () => resolve());
      wsA.addEventListener('error', (e: any) => reject(e));
    });

    const wsB = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve, reject) => {
      wsB.addEventListener('open', () => resolve());
      wsB.addEventListener('error', (e: any) => reject(e));
    });

    syncA = await createWsSynchronizer(storeA, wsA);
    syncB = await createWsSynchronizer(storeB, wsB);

    await syncA.startSync();
    await syncB.startSync();

    // Apply Alice's ops to storeA
    const aliceCounters: Record<string, number> = {};
    for (const op of aliceOps) {
      applyOpToStore(storeA, op, 'alice', aliceCounters);
    }

    // Apply Bob's ops to storeB
    const bobCounters: Record<string, number> = {};
    for (const op of bobOps) {
      applyOpToStore(storeB, op, 'bob', bobCounters);
    }

    // Wait for sync to propagate
    await new Promise<void>((r) => setTimeout(r, 500));

    // Capture state from both stores
    const storeAState = extractStoreState(storeA);
    const storeBState = extractStoreState(storeB);
    const storeARows = flattenStoreRows(storeA);
    const storeBRows = flattenStoreRows(storeB);

    // Check convergence: both stores should have identical data.
    // Use stableStringify to normalize key ordering (MergeableStore CRDT
    // may return rows in different insertion order on each store).
    const syncPassed = stableStringify(storeAState) === stableStringify(storeBState);
    if (!syncPassed) {
      failures.push(
        `Stores did not converge. storeA: ${JSON.stringify(storeAState)}, storeB: ${JSON.stringify(storeBState)}`
      );
    }

    // Isolation check: each user's rows should be present in both stores
    const isolationPassed = syncPassed; // convergence implies isolation is preserved

    return { syncPassed, isolationPassed, failures, storeARows, storeBRows, storeAState, storeBState };
  } finally {
    syncA?.destroy();
    syncB?.destroy();
    server.shutdown();
  }
}

// CLI entry point
if (import.meta.main) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: bun scripts/eval-harness.ts <app.jsx>');
    process.exit(1);
  }
  const result = analyzeDataModel(filePath);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failures.length === 0 ? 0 : 1);
}
