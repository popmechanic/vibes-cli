/**
 * Tests for env-utils validation helpers
 */

import { describe, it, expect } from 'vitest';
import { validateOpenRouterKey, validateClerkUserId, validateClerkKey } from '../../lib/env-utils.js';

describe('validateOpenRouterKey', () => {
  it('accepts valid OpenRouter keys', () => {
    expect(validateOpenRouterKey('sk-or-v1-abc123')).toBe(true);
    expect(validateOpenRouterKey('sk-or-something-else')).toBe(true);
  });

  it('rejects keys without sk-or- prefix', () => {
    expect(validateOpenRouterKey('sk-abc123')).toBe(false);
    expect(validateOpenRouterKey('pk_test_abc')).toBe(false);
    expect(validateOpenRouterKey('openrouter-key')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(validateOpenRouterKey(null)).toBe(false);
    expect(validateOpenRouterKey(undefined)).toBe(false);
    expect(validateOpenRouterKey(123)).toBe(false);
    expect(validateOpenRouterKey('')).toBe(false);
  });
});

describe('validateClerkUserId', () => {
  it('accepts valid Clerk user IDs', () => {
    expect(validateClerkUserId('user_2xYz3abc')).toBe(true);
    expect(validateClerkUserId('user_37iciRLpkr53iFohcY')).toBe(true);
  });

  it('rejects IDs without user_ prefix', () => {
    expect(validateClerkUserId('usr_abc123')).toBe(false);
    expect(validateClerkUserId('pk_test_abc')).toBe(false);
    expect(validateClerkUserId('abc123')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(validateClerkUserId(null)).toBe(false);
    expect(validateClerkUserId(undefined)).toBe(false);
    expect(validateClerkUserId(123)).toBe(false);
    expect(validateClerkUserId('')).toBe(false);
  });
});

describe('validateClerkKey', () => {
  it('accepts valid publishable keys', () => {
    expect(validateClerkKey('pk_test_abc123')).toBe(true);
    expect(validateClerkKey('pk_live_abc123')).toBe(true);
  });

  it('rejects invalid keys', () => {
    expect(validateClerkKey('sk_test_abc')).toBeFalsy();
    expect(validateClerkKey('pk_abc')).toBeFalsy();
    expect(validateClerkKey(null)).toBeFalsy();
    expect(validateClerkKey(undefined)).toBeFalsy();
    expect(validateClerkKey('')).toBeFalsy();
  });
});
