#!/usr/bin/env node
/**
 * TinyBase Fixture Verification Script
 *
 * Assembles all tinybase-*.jsx fixture files, loads each in headless Chromium
 * via Playwright, and counts how many load with zero console errors.
 *
 * Output: A single number — count of passing fixtures.
 * Exit code: 0 always (the metric is the number, not pass/fail).
 *
 * Usage:
 *   node scripts/verify-tinybase-fixtures.mjs
 *   # or
 *   bun scripts/verify-tinybase-fixtures.mjs
 */

import { execSync } from 'child_process';
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, resolve, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCRIPTS_DIR = __dirname;
const PROJECT_ROOT = resolve(SCRIPTS_DIR, '..');
const FIXTURES_DIR = join(SCRIPTS_DIR, '__tests__/fixtures');
const TMP_DIR = join('/tmp', `vibes-tinybase-verify-${Date.now()}`);

// Deploy-time placeholders that assemble.js leaves behind — replace with safe defaults
const DEPLOY_PLACEHOLDERS = {
  '__APP_PUBLIC__': 'true',
  '__APP_NAME__': 'test-fixture',
  '__WS_URL__': '',
};

// Infrastructure errors to ignore — these are expected in local testing
// (no deploy API, no WS server, no favicon assets)
const IGNORE_PATTERNS = [
  /vibes-ai\.js/,                  // AI proxy script — not loaded locally
  /favicon/i,                       // Favicon assets not present locally
  /Failed to load resource/,        // Asset 404s expected without server
  /manifest/i,                      // Manifest not present locally
  /ERR_CONNECTION_REFUSED/,         // No WS server in test
  /404 \(Not Found\)/,              // HTTP 404s for infrastructure assets
];

// Dynamic import for playwright
let chromium;
try {
  const pw = await import('playwright');
  chromium = pw.chromium;
} catch (e) {
  console.error('Playwright not installed. Run: npm install --save-dev playwright && npx playwright install chromium');
  process.exit(1);
}

// Find all tinybase-*.jsx fixtures
const fixtures = readdirSync(FIXTURES_DIR)
  .filter(f => f.startsWith('tinybase-') && f.endsWith('.jsx'))
  .sort();

if (fixtures.length === 0) {
  console.log('0');
  process.exit(0);
}

// Create temp dir
mkdirSync(TMP_DIR, { recursive: true });

// Assemble each fixture and patch deploy-time placeholders
const assembled = [];
for (const fixture of fixtures) {
  const name = basename(fixture, '.jsx');
  const input = join(FIXTURES_DIR, fixture);
  const output = join(TMP_DIR, `${name}.html`);

  try {
    execSync(`bun "${join(SCRIPTS_DIR, 'assemble.js')}" "${input}" "${output}"`, {
      stdio: 'pipe',
      cwd: TMP_DIR,
      env: { ...process.env, VIBES_ROOT: PROJECT_ROOT },
    });

    // Patch deploy-time placeholders with safe test defaults
    let html = readFileSync(output, 'utf8');
    for (const [placeholder, value] of Object.entries(DEPLOY_PLACEHOLDERS)) {
      html = html.replaceAll(placeholder, value);
    }
    writeFileSync(output, html);

    assembled.push({ name, fixture, output });
  } catch (e) {
    const stderr = e.stderr?.toString() || e.message;
    process.stderr.write(`ASSEMBLY_FAIL: ${fixture}: ${stderr.trim()}\n`);
  }
}

if (assembled.length === 0) {
  process.stderr.write('No fixtures assembled successfully.\n');
  console.log('0');
  rmSync(TMP_DIR, { recursive: true, force: true });
  process.exit(0);
}

// Start a simple HTTP server to serve assembled files (avoids CORS issues with file://)
const server = createServer((req, res) => {
  const filePath = join(TMP_DIR, req.url === '/' ? 'index.html' : req.url);
  if (existsSync(filePath)) {
    const content = readFileSync(filePath);
    const ext = filePath.split('.').pop();
    const mimeTypes = { html: 'text/html', js: 'application/javascript', css: 'text/css' };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const PORT = 9876;
await new Promise(resolve => server.listen(PORT, resolve));

// Launch headless browser
const browser = await chromium.launch({ headless: true });
let passing = 0;
const results = [];

for (const { name, fixture, output } of assembled) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];

  // Capture console errors (filtering infrastructure noise)
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const isInfrastructure = IGNORE_PATTERNS.some(p => p.test(text));
      if (!isInfrastructure) {
        errors.push(text);
      }
    }
  });

  // Capture uncaught exceptions
  page.on('pageerror', err => {
    const text = err.message;
    const isInfrastructure = IGNORE_PATTERNS.some(p => p.test(text));
    if (!isInfrastructure) {
      errors.push(text);
    }
  });

  try {
    const url = `http://localhost:${PORT}/${name}.html`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    // Wait for React/Babel transpilation and rendering
    await page.waitForTimeout(5000);

    if (errors.length === 0) {
      passing++;
      results.push({ name, status: 'PASS', errors: [] });
    } else {
      results.push({ name, status: 'FAIL', errors });
    }
  } catch (e) {
    results.push({ name, status: 'FAIL', errors: [`Page load failed: ${e.message}`] });
  }

  await context.close();
}

await browser.close();
server.close();

// Print detailed results to stderr
for (const r of results) {
  if (r.status === 'FAIL') {
    process.stderr.write(`FAIL: ${r.name} (${r.errors.length} errors)\n`);
    for (const e of r.errors) {
      process.stderr.write(`  - ${e}\n`);
    }
  } else {
    process.stderr.write(`PASS: ${r.name}\n`);
  }
}
process.stderr.write(`\n${passing}/${assembled.length} fixtures passing\n`);

// Clean up
rmSync(TMP_DIR, { recursive: true, force: true });

// Output: single number (the metric)
console.log(passing);
