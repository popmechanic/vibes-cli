import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { currentAppDir, slugifyPrompt, resolveAppName, throttledBackup } from '../../server/app-context.js';

const tempDirs = [];
function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'app-ctx-test-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tempDirs.length = 0;
});

describe('currentAppDir', () => {
  it('returns null when no app is active', () => {
    const ctx = { currentApp: null, appsDir: '/tmp/apps' };
    expect(currentAppDir(ctx)).toBeNull();
  });

  it('returns the app directory path when app is active', () => {
    const ctx = { currentApp: 'my-app', appsDir: '/tmp/apps' };
    expect(currentAppDir(ctx)).toBe('/tmp/apps/my-app');
  });
});

describe('slugifyPrompt', () => {
  it('strips filler words and joins with hyphens', () => {
    expect(slugifyPrompt('Build me a recipe tracker for my family')).toBe('recipe-tracker-family');
  });

  it('handles single meaningful word', () => {
    expect(slugifyPrompt('Create a dashboard')).toBe('dashboard');
  });

  it('strips non-alphanumeric characters', () => {
    expect(slugifyPrompt("What's the best todo app?")).toBe('whats-best-todo');
  });

  it('truncates to 63 characters', () => {
    const long = 'word '.repeat(20);
    expect(slugifyPrompt(long).length).toBeLessThanOrEqual(63);
  });

  it('returns "untitled" for empty or all-filler prompts', () => {
    expect(slugifyPrompt('build me a')).toBe('untitled');
    expect(slugifyPrompt('')).toBe('untitled');
  });

  it('takes at most 4 words', () => {
    expect(slugifyPrompt('recipe tracker family meal planner extra words')).toBe('recipe-tracker-family-meal');
  });
});

describe('resolveAppName', () => {
  it('returns the slug when no collision', () => {
    const dir = makeTempDir();
    expect(resolveAppName(dir, 'my-app')).toBe('my-app');
  });

  it('appends -2 on first collision', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'my-app'));
    expect(resolveAppName(dir, 'my-app')).toBe('my-app-2');
  });

  it('increments suffix on multiple collisions', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'my-app'));
    mkdirSync(join(dir, 'my-app-2'));
    mkdirSync(join(dir, 'my-app-3'));
    expect(resolveAppName(dir, 'my-app')).toBe('my-app-4');
  });
});

describe('throttledBackup', () => {
  it('creates a backup on first call', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'app.jsx');
    writeFileSync(filePath, 'const App = () => <div/>;');
    const timestamps = {};

    throttledBackup(filePath, 'test-app', timestamps);

    const files = readdirSync(dir);
    expect(files.some(f => f.includes('.bak.'))).toBe(true);
  });

  it('skips backup within cooldown period', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'app.jsx');
    writeFileSync(filePath, 'v1');
    const timestamps = {};

    throttledBackup(filePath, 'test-app', timestamps);
    const count1 = readdirSync(dir).filter(f => f.includes('.bak.')).length;

    throttledBackup(filePath, 'test-app', timestamps);
    const count2 = readdirSync(dir).filter(f => f.includes('.bak.')).length;

    expect(count2).toBe(count1);
  });

  it('creates backup after cooldown expires', async () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'app.jsx');
    writeFileSync(filePath, 'v1');
    const timestamps = {};

    throttledBackup(filePath, 'test-app', timestamps);
    // Fake the timestamp to 31 seconds ago
    timestamps['test-app'] = Date.now() - 31000;

    // Wait 1 second so the backup timestamp differs (second-resolution filenames)
    await new Promise(r => setTimeout(r, 1100));

    throttledBackup(filePath, 'test-app', timestamps);
    const backups = readdirSync(dir).filter(f => f.includes('.bak.'));
    expect(backups.length).toBe(2);
  });
});
