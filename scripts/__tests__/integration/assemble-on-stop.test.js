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
  // Tests added in subsequent tasks
});
