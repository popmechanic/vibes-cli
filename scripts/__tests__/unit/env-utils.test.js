/**
 * Tests for env-utils validation helpers
 */

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateOpenRouterKey, validateClerkUserId, validateClerkKey, loadEnvFile } from '../../lib/env-utils.js';

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

describe('loadEnvFile', () => {
  let tempDir;

  function makeTempDir() {
    tempDir = join(tmpdir(), 'env-utils-test-' + Date.now());
    mkdirSync(tempDir, { recursive: true });
    return tempDir;
  }

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('strips double-quoted values', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'KEY="value"\n');
    const env = loadEnvFile(dir);
    expect(env.KEY).toBe('value');
  });

  it('strips single-quoted values', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), "KEY='value'\n");
    const env = loadEnvFile(dir);
    expect(env.KEY).toBe('value');
  });

  it('handles unquoted values', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'KEY=value\n');
    const env = loadEnvFile(dir);
    expect(env.KEY).toBe('value');
  });

  it('preserves internal quotes', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), `KEY="it's a test"\n`);
    const env = loadEnvFile(dir);
    expect(env.KEY).toBe("it's a test");
  });

  it('handles empty values', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'KEY=\n');
    const env = loadEnvFile(dir);
    expect(env.KEY).toBe('');
  });

  it('skips comments and blank lines', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), '# comment\n\nKEY=value\n# another comment\n');
    const env = loadEnvFile(dir);
    expect(Object.keys(env)).toEqual(['KEY']);
    expect(env.KEY).toBe('value');
  });

  it('returns empty object when .env does not exist', () => {
    const dir = makeTempDir();
    const env = loadEnvFile(dir);
    expect(env).toEqual({});
  });

  it('parses multiple keys', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'A="hello"\nB=world\nC=\'quoted\'\n');
    const env = loadEnvFile(dir);
    expect(env.A).toBe('hello');
    expect(env.B).toBe('world');
    expect(env.C).toBe('quoted');
  });
});
