/**
 * Tests for env-utils validation helpers
 */

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateOpenRouterKey, loadEnvFile, validateConnectUrl, deriveStudioUrls, writeEnvFile } from '../../lib/env-utils.js';

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

describe('validateConnectUrl', () => {
  it('accepts valid API URLs', () => {
    expect(validateConnectUrl('https://studio.exe.xyz/api/', 'api')).toBe(true);
    expect(validateConnectUrl('https://example.com', 'api')).toBe(true);
  });
  it('rejects invalid API URLs', () => {
    expect(validateConnectUrl('http://example.com', 'api')).toBe(false);
    expect(validateConnectUrl('fpcloud://example.com', 'api')).toBe(false);
    expect(validateConnectUrl('', 'api')).toBe(false);
    expect(validateConnectUrl(null, 'api')).toBe(false);
  });
  it('accepts valid Cloud URLs', () => {
    expect(validateConnectUrl('fpcloud://studio.exe.xyz?protocol=wss', 'cloud')).toBe(true);
  });
  it('rejects invalid Cloud URLs', () => {
    expect(validateConnectUrl('https://studio.exe.xyz', 'cloud')).toBe(false);
    expect(validateConnectUrl('', 'cloud')).toBe(false);
    expect(validateConnectUrl(null, 'cloud')).toBe(false);
  });
});

describe('deriveStudioUrls', () => {
  it('derives URLs from simple studio name', () => {
    const urls = deriveStudioUrls('my-studio');
    expect(urls.apiUrl).toBe('https://my-studio.exe.xyz/api/');
    expect(urls.cloudUrl).toBe('fpcloud://my-studio.exe.xyz?protocol=wss');
  });
  it('handles full hostnames (with dots)', () => {
    const urls = deriveStudioUrls('custom.example.com');
    expect(urls.apiUrl).toBe('https://custom.example.com/api/');
    expect(urls.cloudUrl).toBe('fpcloud://custom.example.com?protocol=wss');
  });
  it('trims whitespace', () => {
    const urls = deriveStudioUrls('  my-studio  ');
    expect(urls.apiUrl).toBe('https://my-studio.exe.xyz/api/');
  });
  it('throws on empty input', () => {
    expect(() => deriveStudioUrls('')).toThrow();
    expect(() => deriveStudioUrls(null)).toThrow();
    expect(() => deriveStudioUrls(undefined)).toThrow();
  });
});

describe('writeEnvFile', () => {
  let tempDir;
  function makeTempDir() {
    tempDir = join(tmpdir(), 'env-write-test-' + Date.now());
    mkdirSync(tempDir, { recursive: true });
    return tempDir;
  }
  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('creates new .env file', () => {
    const dir = makeTempDir();
    writeEnvFile(dir, { KEY: 'value' });
    const content = readFileSync(join(dir, '.env'), 'utf8');
    expect(content).toContain('KEY=value');
  });

  it('merges keys into existing file', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'EXISTING=hello\n');
    writeEnvFile(dir, { NEW: 'world' });
    const content = readFileSync(join(dir, '.env'), 'utf8');
    expect(content).toContain('EXISTING=hello');
    expect(content).toContain('NEW=world');
  });

  it('overwrites matching keys', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'KEY=old\n');
    writeEnvFile(dir, { KEY: 'new' });
    const content = readFileSync(join(dir, '.env'), 'utf8');
    expect(content).toContain('KEY=new');
    expect(content).not.toContain('KEY=old');
  });

  it('preserves comments and blank lines', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), '# This is a comment\n\nKEY=value\n');
    writeEnvFile(dir, { OTHER: 'test' });
    const content = readFileSync(join(dir, '.env'), 'utf8');
    expect(content).toContain('# This is a comment');
    expect(content).toContain('KEY=value');
    expect(content).toContain('OTHER=test');
  });

  it('preserves unrelated keys', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.env'), 'A=1\nB=2\nC=3\n');
    writeEnvFile(dir, { B: 'updated' });
    const content = readFileSync(join(dir, '.env'), 'utf8');
    expect(content).toContain('A=1');
    expect(content).toContain('B=updated');
    expect(content).toContain('C=3');
  });
});
