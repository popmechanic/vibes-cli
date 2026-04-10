/**
 * Unit tests for vibes-json.js
 *
 * Tests reading, writing, and initializing vibes.json files in project directories.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'vibes-json-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
  tempDirs.length = 0;
});

describe('readVibesJson', () => {
  it('reads existing vibes.json', async () => {
    const { readVibesJson } = await import('../../lib/vibes-json.js');
    const dir = makeTempDir();
    const data = { name: 'my-app', version: '1.0.0' };
    writeFileSync(join(dir, 'vibes.json'), JSON.stringify(data));

    const result = readVibesJson(dir);
    expect(result).toEqual(data);
  });

  it('returns null when vibes.json does not exist', async () => {
    const { readVibesJson } = await import('../../lib/vibes-json.js');
    const dir = makeTempDir();

    const result = readVibesJson(dir);
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    const { readVibesJson } = await import('../../lib/vibes-json.js');
    const dir = makeTempDir();
    writeFileSync(join(dir, 'vibes.json'), 'not valid json {{{');

    const result = readVibesJson(dir);
    expect(result).toBeNull();
  });
});

describe('writeVibesJson', () => {
  it('writes vibes.json to project directory', async () => {
    const { writeVibesJson, readVibesJson } = await import('../../lib/vibes-json.js');
    const dir = makeTempDir();
    const data = { name: 'my-app', deployedUrl: 'https://my-app.vibes.diy' };

    writeVibesJson(dir, data);

    const result = readVibesJson(dir);
    expect(result).toEqual(data);
  });

  it('merges with existing vibes.json (shallow merge)', async () => {
    const { writeVibesJson, readVibesJson } = await import('../../lib/vibes-json.js');
    const dir = makeTempDir();

    // Write initial data
    writeFileSync(join(dir, 'vibes.json'), JSON.stringify({ name: 'original', existing: 'keep-me' }));

    // Merge new fields
    writeVibesJson(dir, { deployedUrl: 'https://my-app.vibes.diy', name: 'updated' });

    const result = readVibesJson(dir);
    expect(result.name).toBe('updated');
    expect(result.existing).toBe('keep-me');
    expect(result.deployedUrl).toBe('https://my-app.vibes.diy');
  });
});

describe('initVibesJson', () => {
  it('creates vibes.json with name derived from folder name', async () => {
    const { initVibesJson, readVibesJson } = await import('../../lib/vibes-json.js');
    const base = makeTempDir();
    const dir = join(base, 'My Cool App');
    mkdirSync(dir);

    initVibesJson(dir);

    const result = readVibesJson(dir);
    expect(result).not.toBeNull();
    expect(result.name).toBe('my-cool-app');
  });

  it('does not overwrite existing vibes.json', async () => {
    const { initVibesJson, readVibesJson } = await import('../../lib/vibes-json.js');
    const dir = makeTempDir();
    const existing = { name: 'my-existing-app', custom: 'value' };
    writeFileSync(join(dir, 'vibes.json'), JSON.stringify(existing));

    initVibesJson(dir);

    const result = readVibesJson(dir);
    expect(result).toEqual(existing);
  });

  it('creates .vibes subdirectory', async () => {
    const { initVibesJson } = await import('../../lib/vibes-json.js');
    const base = makeTempDir();
    const dir = join(base, 'test-project');
    mkdirSync(dir);

    initVibesJson(dir);

    expect(existsSync(join(dir, '.vibes'))).toBe(true);
  });

  it('slugifies folder name with special characters', async () => {
    const { initVibesJson, readVibesJson } = await import('../../lib/vibes-json.js');
    const base = makeTempDir();
    const dir = join(base, 'Hello World! 2024');
    mkdirSync(dir);

    initVibesJson(dir);

    const result = readVibesJson(dir);
    // Consecutive non-alphanumeric chars collapse to a single hyphen
    expect(result.name).toBe('hello-world-2024');
  });

  it('trims leading and trailing hyphens from slug', async () => {
    const { initVibesJson, readVibesJson } = await import('../../lib/vibes-json.js');
    const base = makeTempDir();
    const dir = join(base, '--my-app--');
    mkdirSync(dir);

    initVibesJson(dir);

    const result = readVibesJson(dir);
    expect(result.name).toBe('my-app');
  });

  it('truncates slug to max 63 chars', async () => {
    const { initVibesJson, readVibesJson } = await import('../../lib/vibes-json.js');
    const base = makeTempDir();
    const longName = 'a'.repeat(100);
    const dir = join(base, longName);
    mkdirSync(dir);

    initVibesJson(dir);

    const result = readVibesJson(dir);
    expect(result.name.length).toBeLessThanOrEqual(63);
  });
});
