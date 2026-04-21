/**
 * Integration tests for scripts/hooks/assemble-on-stop.sh
 *
 * Tests spawn the real hook script against tempdir fixtures containing
 * a valid vibes.json + app.jsx pair, then assert exit code, stderr, and
 * side effects (index.html created/updated, retry file state).
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, statSync, utimesSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';

const PLUGIN_ROOT = resolve(import.meta.dirname, '../../..');
const HOOK_SCRIPT = join(PLUGIN_ROOT, 'scripts/hooks/assemble-on-stop.sh');

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-hook-test-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Create a minimal valid Vibes project at `dir` with a working App component.
 */
function makeVibesProject(dir) {
  writeFileSync(join(dir, 'vibes.json'), JSON.stringify({ name: 'test-app' }) + '\n');
  writeFileSync(join(dir, 'app.jsx'), `
function App() {
  return <div>Hello</div>;
}
`);
}

/**
 * Run the hook script as if Claude Code invoked it. Returns { status, stdout, stderr }.
 */
function runHook(cwd) {
  return spawnSync('bash', [HOOK_SCRIPT], {
    cwd,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      HOME: cwd, // prevent walk-up from escaping the tempdir
    },
    encoding: 'utf-8',
  });
}

/**
 * Set a file's mtime to N seconds in the past so subsequent writes are provably newer.
 */
function ageFile(path, secondsAgo) {
  const now = Date.now() / 1000;
  const past = now - secondsAgo;
  utimesSync(path, past, past);
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tempDirs.length = 0;
});

beforeAll(() => {
  // Sanity — the hook script must exist before any test runs.
  if (!existsSync(HOOK_SCRIPT)) {
    throw new Error(`Hook script not found at ${HOOK_SCRIPT} — run Task 2 first`);
  }
});

describe('assemble-on-stop hook', () => {
  it('exits 0 silently when cwd is not inside a Vibes project', () => {
    const dir = makeTempDir();
    // No vibes.json, no app.jsx anywhere
    const result = runHook(dir);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
    expect(existsSync(join(dir, 'index.html'))).toBe(false);
  });

  it('runs assembly when cwd contains vibes.json + app.jsx', () => {
    const dir = makeTempDir();
    makeVibesProject(dir);
    const result = runHook(dir);
    expect(result.status).toBe(0);
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
  });

  it('walks up from a subdirectory to find the Vibes project root', () => {
    const projectRoot = makeTempDir();
    makeVibesProject(projectRoot);
    const nested = join(projectRoot, 'sub', 'deeper');
    mkdirSync(nested, { recursive: true });

    const result = spawnSync('bash', [HOOK_SCRIPT], {
      cwd: nested,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, HOME: projectRoot },
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(projectRoot, 'index.html'))).toBe(true);
    expect(existsSync(join(nested, 'index.html'))).toBe(false);
  });

  it('skips assembly when index.html is newer than app.jsx', () => {
    const dir = makeTempDir();
    makeVibesProject(dir);

    // Pre-populate index.html and ensure its mtime is newer than app.jsx
    ageFile(join(dir, 'app.jsx'), 10);
    writeFileSync(join(dir, 'index.html'), '<!-- pre-existing -->');

    const result = runHook(dir);
    expect(result.status).toBe(0);
    // The pre-existing content must be preserved (assembler would have overwritten it)
    expect(readFileSync(join(dir, 'index.html'), 'utf-8')).toBe('<!-- pre-existing -->');
  });

  it('reassembles when app.jsx is newer than index.html', () => {
    const dir = makeTempDir();
    makeVibesProject(dir);

    // Pre-populate an old index.html, then touch app.jsx so it's newer
    writeFileSync(join(dir, 'index.html'), '<!-- stale -->');
    ageFile(join(dir, 'index.html'), 10);

    const result = runHook(dir);
    expect(result.status).toBe(0);
    // Assembler should have overwritten the stale placeholder
    expect(readFileSync(join(dir, 'index.html'), 'utf-8')).not.toBe('<!-- stale -->');
  });

  it('exits 2 with assembler stderr when JSX is broken', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'vibes.json'), JSON.stringify({ name: 'test-app' }) + '\n');
    // Empty app.jsx — assemble.js validateAssembly() rejects with "App code is empty"
    writeFileSync(join(dir, 'app.jsx'), '');

    const result = runHook(dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Vibes assembly failed');
    // Assembler's own error surfaces through
    expect(result.stderr.toLowerCase()).toMatch(/assembly|app component|fix/);
  });
});
