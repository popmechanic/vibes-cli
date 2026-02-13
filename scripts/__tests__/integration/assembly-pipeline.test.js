/**
 * Integration tests for the assembly pipeline using test fixtures.
 *
 * Runs fixture JSX files through assemble.js / assemble-sell.js and
 * validates the output HTML structure.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const SCRIPTS_DIR = resolve(__dirname, '../..');
const FIXTURES_DIR = resolve(__dirname, '../fixtures');

// Safe placeholder patterns used by sell templates
const SAFE_PLACEHOLDERS = ['__PURE__', '__esModule', '__VIBES_CONFIG__', '__CLERK_LOAD_ERROR__', '__VIBES_SYNC_STATUS__', '__VIBES_SHARED_LEDGER__', '__VIBES_REGISTRY_URL__'];

function createWorkDir() {
  const dir = join(tmpdir(), `vibes-assembly-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  // Write placeholder .env
  writeFileSync(join(dir, '.env'), [
    'VITE_CLERK_PUBLISHABLE_KEY=pk_test_placeholder_for_testing_only',
    'VITE_API_URL=http://localhost:8080/api/',
    'VITE_CLOUD_URL=fpcloud://localhost:8080?protocol=ws',
  ].join('\n'));

  return dir;
}

describe('Assembly Pipeline', () => {
  let workDir;

  beforeEach(() => {
    workDir = createWorkDir();
  });

  afterEach(() => {
    if (workDir && existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  describe('minimal.jsx', () => {
    it('assembles without errors', () => {
      const fixture = join(FIXTURES_DIR, 'minimal.jsx');
      const appJsx = join(workDir, 'app.jsx');
      const output = join(workDir, 'index.html');

      copyFileSync(fixture, appJsx);
      execSync(`node ${join(SCRIPTS_DIR, 'assemble.js')} "${appJsx}" "${output}"`, {
        stdio: 'pipe',
        cwd: workDir,
      });

      expect(existsSync(output)).toBe(true);
    });

    it('has no placeholder remaining', () => {
      const fixture = join(FIXTURES_DIR, 'minimal.jsx');
      const appJsx = join(workDir, 'app.jsx');
      const output = join(workDir, 'index.html');

      copyFileSync(fixture, appJsx);
      execSync(`node ${join(SCRIPTS_DIR, 'assemble.js')} "${appJsx}" "${output}"`, {
        stdio: 'pipe',
        cwd: workDir,
      });

      const html = readFileSync(output, 'utf8');
      expect(html).not.toContain('__VIBES_APP_CODE__');
    });

    it('contains import map and Babel tag', () => {
      const fixture = join(FIXTURES_DIR, 'minimal.jsx');
      const appJsx = join(workDir, 'app.jsx');
      const output = join(workDir, 'index.html');

      copyFileSync(fixture, appJsx);
      execSync(`node ${join(SCRIPTS_DIR, 'assemble.js')} "${appJsx}" "${output}"`, {
        stdio: 'pipe',
        cwd: workDir,
      });

      const html = readFileSync(output, 'utf8');
      expect(html).toContain('"imports"');
      expect(html).toContain('text/babel');
    });
  });

  describe('fireproof-basic.jsx', () => {
    it('assembles with useFireproofClerk present', () => {
      const fixture = join(FIXTURES_DIR, 'fireproof-basic.jsx');
      const appJsx = join(workDir, 'app.jsx');
      const output = join(workDir, 'index.html');

      copyFileSync(fixture, appJsx);
      execSync(`node ${join(SCRIPTS_DIR, 'assemble.js')} "${appJsx}" "${output}"`, {
        stdio: 'pipe',
        cwd: workDir,
      });

      const html = readFileSync(output, 'utf8');
      expect(html).not.toContain('__VIBES_APP_CODE__');
      expect(html).toContain('useFireproofClerk');
    });
  });

  describe('sell-ready.jsx', () => {
    it('assembles with sell assembler', () => {
      const fixture = join(FIXTURES_DIR, 'sell-ready.jsx');
      const appJsx = join(workDir, 'app.jsx');
      const output = join(workDir, 'index.html');

      copyFileSync(fixture, appJsx);

      const cmd = [
        `node ${join(SCRIPTS_DIR, 'assemble-sell.js')}`,
        `"${appJsx}" "${output}"`,
        `--app-name test-app`,
        `--app-title "Test App"`,
        `--domain test.workers.dev`,
        `--billing-mode off`,
      ].join(' ');

      execSync(cmd, { stdio: 'pipe', cwd: workDir });

      expect(existsSync(output)).toBe(true);
    });

    it('has getRouteInfo for sell routing', () => {
      const fixture = join(FIXTURES_DIR, 'sell-ready.jsx');
      const appJsx = join(workDir, 'app.jsx');
      const output = join(workDir, 'index.html');

      copyFileSync(fixture, appJsx);

      const cmd = [
        `node ${join(SCRIPTS_DIR, 'assemble-sell.js')}`,
        `"${appJsx}" "${output}"`,
        `--app-name test-app`,
        `--app-title "Test App"`,
        `--domain test.workers.dev`,
        `--billing-mode off`,
      ].join(' ');

      execSync(cmd, { stdio: 'pipe', cwd: workDir });

      const html = readFileSync(output, 'utf8');
      expect(html).toContain('getRouteInfo');
    });

    it('has no unreplaced config placeholders', () => {
      const fixture = join(FIXTURES_DIR, 'sell-ready.jsx');
      const appJsx = join(workDir, 'app.jsx');
      const output = join(workDir, 'index.html');

      copyFileSync(fixture, appJsx);

      const cmd = [
        `node ${join(SCRIPTS_DIR, 'assemble-sell.js')}`,
        `"${appJsx}" "${output}"`,
        `--app-name test-app`,
        `--app-title "Test App"`,
        `--domain test.workers.dev`,
        `--billing-mode off`,
      ].join(' ');

      execSync(cmd, { stdio: 'pipe', cwd: workDir });

      const html = readFileSync(output, 'utf8');
      const allPlaceholders = html.match(/__[A-Z_]+__/g) || [];
      const unreplaced = allPlaceholders.filter(p => !SAFE_PLACEHOLDERS.includes(p));
      expect(unreplaced).toEqual([]);
    });

    it('includes paywall test checklist copy', () => {
      const fixture = join(FIXTURES_DIR, 'sell-ready.jsx');
      const appJsx = join(workDir, 'app.jsx');
      const output = join(workDir, 'index.html');

      copyFileSync(fixture, appJsx);

      const cmd = [
        `node ${join(SCRIPTS_DIR, 'assemble-sell.js')}`,
        `"${appJsx}" "${output}"`,
        `--app-name test-app`,
        `--app-title "Test App"`,
        `--domain test.workers.dev`,
        `--billing-mode off`,
      ].join(' ');

      execSync(cmd, { stdio: 'pipe', cwd: workDir });

      const html = readFileSync(output, 'utf8');
      expect(html).toContain('Subscription status is managed by Clerk Commerce');
    });
  });
});
