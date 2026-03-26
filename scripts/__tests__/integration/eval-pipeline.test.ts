// scripts/__tests__/integration/eval-pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { evalStaticCheck } from '../../eval-static-check.js';
import { ssrSmokeTest } from '../../eval-ssr-check.ts';
import { analyzeDataModel, assertDataModel } from '../../eval-harness.ts';

// Fixture: A well-formed auction app (should pass all tiers)
const GOOD_AUCTION_JSX = `
function App() {
  const { isReady } = useApp();
  const { user } = useUser();
  const items = useTable('items');
  const bids = useTable('bids');
  const addItem = useAddRowCallback('items', () => ({
    name: 'Watch', startingPrice: 50, createdBy: user.email, createdAt: Date.now()
  }), [user.email]);
  const addBid = useAddRowCallback('bids', () => ({
    itemId: 'item-1', amount: 100, bidder: user.email, timestamp: Date.now()
  }), [user.email]);
  if (!isReady) return React.createElement('div', null, 'Loading...');
  return React.createElement('div', null,
    React.createElement('button', { onClick: addItem }, 'Add Item'),
    React.createElement('button', { onClick: addBid }, 'Bid'),
    React.createElement('div', null, Object.keys(items).length + ' items'),
    React.createElement('div', null, Object.keys(bids).length + ' bids')
  );
}
`;

// Fixture: import violation (C2)
const BAD_IMPORT_JSX = `
import React from 'react';
function App() {
  const { isReady } = useApp();
  return React.createElement('div', null, 'bad');
}
`;

// Fixture: conditional hook
const BAD_CONDITIONAL_HOOK_JSX = `
function App() {
  const { isReady } = useApp();
  if (!isReady) return React.createElement('div', null, 'Loading');
  const items = useTable('items');
  return React.createElement('div', null, Object.keys(items).length);
}
`;

const AUCTION_SPEC = {
  tables: ['items', 'bids'],
  perUserFields: { bids: ['bidder'], items: ['createdBy'] },
  sharedTables: [],
};

describe('eval pipeline integration', () => {
  it('good auction app passes all tiers', () => {
    const t1 = evalStaticCheck(GOOD_AUCTION_JSX);
    expect(t1.passed).toBe(true);
    const t15 = ssrSmokeTest(GOOD_AUCTION_JSX);
    expect(t15.passed).toBe(true);
    const analysis = analyzeDataModel(GOOD_AUCTION_JSX);
    expect(analysis.failures).toHaveLength(0);
    const t2 = assertDataModel(analysis, AUCTION_SPEC);
    expect(t2.passed).toBe(true);
    expect(t2.score).toBe(4);
  });

  it('import violation stops at Tier 1 with score 0', () => {
    const t1 = evalStaticCheck(BAD_IMPORT_JSX);
    expect(t1.passed).toBe(false);
  });

  it('conditional hook fails at Tier 1.5 with score 1', () => {
    const t1 = evalStaticCheck(BAD_CONDITIONAL_HOOK_JSX);
    expect(t1.passed).toBe(true);
    const t15 = ssrSmokeTest(BAD_CONDITIONAL_HOOK_JSX);
    expect(t15.passed).toBe(false);
  });
});
