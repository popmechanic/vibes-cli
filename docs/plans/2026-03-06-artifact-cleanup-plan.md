# Artifact Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all editor-generated artifacts (`app.jsx`, `index.html`) out of the plugin directory into per-app directories at `~/.vibes/apps/{name}/`.

**Architecture:** Every app gets its own directory from the moment it's created. The server tracks the active app via `ctx.currentApp` (string name, null on startup). A shared `currentAppDir(ctx)` helper resolves all artifact paths. No files are ever written to `ctx.projectRoot`.

**Tech Stack:** Node.js (ESM), vitest for tests

**Design doc:** `docs/plans/2026-03-06-artifact-cleanup-design.md`

---

### Task 1: Add `currentAppDir` helper and slug generation

**Files:**
- Create: `scripts/server/app-context.js`
- Test: `scripts/__tests__/unit/app-context.test.js`

**Step 1: Write the failing tests**

```javascript
// scripts/__tests__/unit/app-context.test.js
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { currentAppDir, slugifyPrompt, resolveAppName } from '../../server/app-context.js';

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
```

**Step 2: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/app-context.test.js`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// scripts/server/app-context.js
import { join } from 'path';
import { existsSync } from 'fs';

const FILLER_WORDS = new Set([
  'build', 'me', 'a', 'an', 'the', 'my', 'for', 'make', 'create',
  'app', 'that', 'with', 'i', 'want', 'need', 'please', 'can', 'you',
  'some', 'this', 'it', 'of', 'to', 'and', 'in', 'on', 'is',
]);

/**
 * Get the directory for the currently active app, or null if none.
 */
export function currentAppDir(ctx) {
  if (!ctx.currentApp) return null;
  return join(ctx.appsDir, ctx.currentApp);
}

/**
 * Convert a user prompt into a filesystem-safe slug.
 * Returns "untitled" if no meaningful words remain.
 */
export function slugifyPrompt(prompt) {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w && !FILLER_WORDS.has(w));

  if (words.length === 0) return 'untitled';

  return words.slice(0, 4).join('-').slice(0, 63);
}

/**
 * Given a base slug and the apps directory, return a name that doesn't
 * collide with existing directories. Appends -2, -3, etc. on collision.
 */
export function resolveAppName(appsDir, slug) {
  if (!existsSync(join(appsDir, slug))) return slug;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${slug}-${i}`;
    if (!existsSync(join(appsDir, candidate))) return candidate;
  }
  return `${slug}-${Date.now()}`;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/app-context.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/server/app-context.js scripts/__tests__/unit/app-context.test.js
git commit -m "Add currentAppDir helper, slugifyPrompt, and resolveAppName"
```

---

### Task 2: Add throttled backup helper

**Files:**
- Modify: `scripts/server/app-context.js`
- Modify: `scripts/__tests__/unit/app-context.test.js`

**Step 1: Add failing tests**

Append to `scripts/__tests__/unit/app-context.test.js`:

```javascript
import { writeFileSync, readdirSync } from 'fs';
import { throttledBackup } from '../../server/app-context.js';

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

  it('creates backup after cooldown expires', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'app.jsx');
    writeFileSync(filePath, 'v1');
    const timestamps = {};

    throttledBackup(filePath, 'test-app', timestamps);
    // Fake the timestamp to 31 seconds ago
    timestamps['test-app'] = Date.now() - 31000;

    throttledBackup(filePath, 'test-app', timestamps);
    const backups = readdirSync(dir).filter(f => f.includes('.bak.'));
    expect(backups.length).toBe(2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/app-context.test.js`
Expected: FAIL — throttledBackup not found

**Step 3: Add implementation to `app-context.js`**

Append to `scripts/server/app-context.js`:

```javascript
import { createBackup } from '../lib/backup.js';

const BACKUP_COOLDOWN_MS = 30_000;

/**
 * Create a backup of filePath only if the last backup for this app
 * was more than 30 seconds ago. Mutates the timestamps map.
 */
export function throttledBackup(filePath, appName, timestamps) {
  const now = Date.now();
  const last = timestamps[appName] || 0;
  if (now - last < BACKUP_COOLDOWN_MS) return;
  createBackup(filePath);
  timestamps[appName] = now;
}
```

Update the import at top of `app-context.js` to include `createBackup`.

**Step 4: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/app-context.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/server/app-context.js scripts/__tests__/unit/app-context.test.js
git commit -m "Add throttledBackup with 30s cooldown"
```

---

### Task 3: Initialize `ctx.currentApp` and `ctx.backupTimestamps` in config

**Files:**
- Modify: `scripts/server/config.js:91-104` (the return object in `loadConfig`)

**Step 1: Add `currentApp: null` and `backupTimestamps: {}` to the ctx return object**

In `scripts/server/config.js`, in the `return` statement of `loadConfig()` (line 91), add:

```javascript
  return {
    projectRoot,
    port,
    mode,
    initialPrompt,
    themes,
    animations,
    themeColors,
    themeRootCss,
    openRouterKey,
    appsDir,
    themeDir,
    animationDir,
    currentApp: null,
    backupTimestamps: {},
  };
```

**Step 2: Run existing tests to verify no regressions**

Run: `cd scripts && npx vitest run`
Expected: All existing tests PASS

**Step 3: Commit**

```bash
git add scripts/server/config.js
git commit -m "Initialize ctx.currentApp and ctx.backupTimestamps in config"
```

---

### Task 4: Update `handleGenerate` to use app directories

**Files:**
- Modify: `scripts/server/handlers/generate.js:18-248`

**Step 1: Update imports**

Add at top of `generate.js`:
```javascript
import { currentAppDir, slugifyPrompt, resolveAppName, throttledBackup } from '../app-context.js';
```

**Step 2: Replace auto-archive with app directory creation**

Replace lines 26-37 (the auto-archive block) with:

```javascript
  // Auto-save previous app before switching
  if (ctx.currentApp) {
    try {
      const prevDir = currentAppDir(ctx);
      const prevIndexPath = join(prevDir, 'index.html');
      const assembled = assembleAppFrame(ctx);
      writeFileSync(prevIndexPath, assembled);
      console.log(`[Generate] Auto-saved index.html for "${ctx.currentApp}"`);
    } catch (e) {
      console.warn(`[Generate] Auto-save failed for "${ctx.currentApp}": ${e.message}`);
    }
  }

  // Create app directory from prompt
  const slug = slugifyPrompt(userPrompt);
  const appName = resolveAppName(ctx.appsDir, slug);
  const appDir = join(ctx.appsDir, appName);
  mkdirSync(appDir, { recursive: true });
  ctx.currentApp = appName;
  onEvent({ type: 'app_created', name: appName });
  console.log(`[Generate] Created app directory: ${appName}`);

  const appJsxPath = join(appDir, 'app.jsx');
```

**Step 3: Update `runClaude` cwd to use app directory**

In the `runClaude` call (around line 245), change `cwd: ctx.projectRoot` to:
```javascript
  await runClaude(prompt, { skipChat: true, maxTurns, model, cwd: currentAppDir(ctx), tools: 'Write' }, onEvent);
```

**Step 4: Update `assembleAppFrame` to use `currentAppDir`**

In the `assembleAppFrame` function (lines 254-286), change the app path resolution:

```javascript
export function assembleAppFrame(ctx) {
  const templatePath = TEMPLATES.vibesBasic;
  if (!existsSync(templatePath)) {
    return `<html><body><h1>Template not found</h1><p>${templatePath}</p></body></html>`;
  }

  let template = readFileSync(templatePath, 'utf-8');

  const appDir = currentAppDir(ctx);
  if (!appDir) {
    return `<html><body><h1>No app active</h1></body></html>`;
  }

  const appPath = join(appDir, 'app.jsx');
  if (!existsSync(appPath)) {
    return `<html><body><h1>app.jsx not found</h1></body></html>`;
  }

  const appCode = readFileSync(appPath, 'utf-8');
  const strippedCode = stripForTemplate(appCode, { stripReactHooks: false });

  if (!template.includes(APP_PLACEHOLDER)) {
    return `<html><body><h1>Template missing placeholder</h1><p>${APP_PLACEHOLDER}</p></body></html>`;
  }
  template = template.replace(APP_PLACEHOLDER, strippedCode);

  const envDir = ctx.projectRoot; // .env still lives in plugin root
  const envVars = loadEnvFile(envDir);
  template = populateConnectConfig(template, envVars);

  if (!envVars.VITE_API_URL || !envVars.VITE_CLOUD_URL) {
    if (!assembleAppFrame._warnedMissingConnect) {
      assembleAppFrame._warnedMissingConnect = true;
      console.log('[preview] Connect URLs not configured — sync disabled until first deploy');
    }
  }

  return template;
}
```

**Step 5: Remove unused `unlinkSync` and `copyFileSync` imports if no longer needed**

Check the import line at top — remove `unlinkSync` and `copyFileSync` if nothing else in the file uses them.

**Step 6: Run existing tests**

Run: `cd scripts && npx vitest run`
Expected: PASS (generate handler isn't directly unit-tested; assembly tests use assemble.js not assembleAppFrame)

**Step 7: Commit**

```bash
git add scripts/server/handlers/generate.js
git commit -m "Update generate handler to write into per-app directories"
```

---

### Task 5: Update `editor-api.js` handlers

**Files:**
- Modify: `scripts/server/handlers/editor-api.js`

**Step 1: Add import**

```javascript
import { currentAppDir, throttledBackup } from '../app-context.js';
```

**Step 2: Update `appExists`** (line 166-169)

```javascript
export function appExists(ctx, req, res) {
  const appDir = currentAppDir(ctx);
  const exists = appDir ? existsSync(join(appDir, 'app.jsx')) : false;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ exists, currentApp: ctx.currentApp }));
}
```

**Step 3: Update `loadApp`** (line 538-547)

Replace the file copy with setting `ctx.currentApp`:

```javascript
export function loadApp(ctx, req, res, url) {
  const params = url.searchParams;
  const name = sanitizeAppName(params.get('name'));
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const src = join(ctx.appsDir, name, 'app.jsx');
  if (!existsSync(src)) { res.writeHead(404); return res.end('App not found'); }

  // Auto-save current app before switching
  if (ctx.currentApp) {
    try {
      const { assembleAppFrame } = await import('./generate.js');
      const html = assembleAppFrame(ctx);
      writeFileSync(join(currentAppDir(ctx), 'index.html'), html);
    } catch (e) {
      console.warn(`[LoadApp] Auto-save failed for "${ctx.currentApp}": ${e.message}`);
    }
  }

  ctx.currentApp = name;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true, currentApp: name }));
}
```

Note: Since this uses `await import()`, the function signature needs to become `async`:

```javascript
export async function loadApp(ctx, req, res, url) {
```

**Step 4: Update `saveApp` to become "duplicate/copy"** (line 549-560)

```javascript
export function saveApp(ctx, req, res, url) {
  const params = url.searchParams;
  const name = sanitizeAppName(params.get('name'));
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const appDir = currentAppDir(ctx);
  if (!appDir || !existsSync(join(appDir, 'app.jsx'))) {
    res.writeHead(404); return res.end('No active app to save');
  }
  if (name === ctx.currentApp) {
    // Already saved in place — no-op
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  const dest = join(ctx.appsDir, name);
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(appDir, 'app.jsx'), join(dest, 'app.jsx'));
  if (existsSync(join(appDir, 'index.html'))) {
    copyFileSync(join(appDir, 'index.html'), join(dest, 'index.html'));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true }));
}
```

**Step 5: Update `writeApp` with throttled backup** (line 624-632)

```javascript
export function writeApp(ctx, req, res) {
  const appDir = currentAppDir(ctx);
  if (!appDir) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No active app' }));
  }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const appPath = join(appDir, 'app.jsx');
    throttledBackup(appPath, ctx.currentApp, ctx.backupTimestamps);
    writeFileSync(appPath, Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}
```

**Step 6: Add `renameApp` endpoint**

```javascript
export function renameApp(ctx, req, res, url) {
  const params = url.searchParams;
  const from = sanitizeAppName(params.get('from'));
  const to = sanitizeAppName(params.get('to'));
  if (!from || !to) { res.writeHead(400); return res.end('Missing from or to'); }
  const srcDir = join(ctx.appsDir, from);
  const destDir = join(ctx.appsDir, to);
  if (!existsSync(srcDir)) { res.writeHead(404); return res.end('Source app not found'); }
  if (existsSync(destDir)) { res.writeHead(409); return res.end('Destination name already exists'); }
  renameSync(srcDir, destDir);
  if (ctx.currentApp === from) ctx.currentApp = to;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true, name: to }));
}
```

Add `renameSync` to the `fs` import at top of the file.

**Step 7: Add `deleteApp` endpoint**

```javascript
export function deleteApp(ctx, req, res, url) {
  const params = url.searchParams;
  const name = sanitizeAppName(params.get('name'));
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const dir = join(ctx.appsDir, name);
  if (!existsSync(dir)) { res.writeHead(404); return res.end('App not found'); }
  rmSync(dir, { recursive: true, force: true });
  if (ctx.currentApp === name) ctx.currentApp = null;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true }));
}
```

Add `rmSync` to the `fs` import at top.

**Step 8: Run tests**

Run: `cd scripts && npx vitest run`
Expected: PASS

**Step 9: Commit**

```bash
git add scripts/server/handlers/editor-api.js
git commit -m "Update editor-api handlers to use per-app directories"
```

---

### Task 6: Update routes.js

**Files:**
- Modify: `scripts/server/routes.js`

**Step 1: Update imports**

```javascript
import { currentAppDir } from './app-context.js';
```

**Step 2: Update `serveAppJsx`** (lines 46-54)

```javascript
function serveAppJsx(ctx, req, res) {
  const appDir = currentAppDir(ctx);
  if (!appDir) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end('// No app active\n');
  }
  const appPath = join(appDir, 'app.jsx');
  if (!existsSync(appPath)) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end('// app.jsx not yet generated\n');
  }
  res.writeHead(200, { 'Content-Type': 'text/javascript' });
  return res.end(readFileSync(appPath, 'utf-8'));
}
```

**Step 3: Update `serveAppFrame`** (lines 73-87)

```javascript
function serveAppFrame(ctx, req, res) {
  const appDir = currentAppDir(ctx);
  if (!appDir || !existsSync(join(appDir, 'app.jsx'))) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!DOCTYPE html>
<html><head><style>
  body { margin: 0; display: flex; align-items: center; justify-content: center;
         height: 100vh; font-family: system-ui; color: #888; background: inherit; }
</style></head>
<body><p>Waiting for app to be generated...</p></body></html>`);
  }
  const assembled = assembleAppFrame(ctx);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  return res.end(assembled);
}
```

**Step 4: Register new endpoints in route table**

Add to `routeTable`:

```javascript
  'POST /editor/apps/rename':            editorApi.renameApp,
  'POST /editor/apps/delete':            editorApi.deleteApp,
```

**Step 5: Run tests**

Run: `cd scripts && npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add scripts/server/routes.js
git commit -m "Update routes to use currentAppDir and register rename/delete endpoints"
```

---

### Task 7: Update `deploy.js`

**Files:**
- Modify: `scripts/server/handlers/deploy.js`

**Step 1: Update to use `currentAppDir`**

Add import:
```javascript
import { currentAppDir } from '../app-context.js';
```

Replace lines 48-49 in `handleDeploy`:
```javascript
  const appDir = currentAppDir(ctx);
  if (!appDir) {
    onEvent({ type: 'error', message: 'No app active. Generate or load an app first.' });
    return;
  }
  const appJsxPath = join(appDir, 'app.jsx');
  const indexHtmlPath = join(appDir, 'index.html');
```

**Step 2: Update the assemble subprocess call** (lines 52-56)

The assemble subprocess should write output to the app directory:
```javascript
  const assembleResult = await new Promise((resolve) => {
    const child = spawn('node', [
      join(ctx.projectRoot, 'scripts/assemble.js'),
      appJsxPath,
      indexHtmlPath,
    ], {
      cwd: ctx.projectRoot,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // ... rest unchanged
  });
```

The `appJsxPath` and `indexHtmlPath` now point into the app directory, so assemble.js reads/writes there. The `cwd` stays `ctx.projectRoot` so `.env` is found.

**Step 3: Update the post-deploy save** (lines 172-179)

Remove the `copyFileSync` to `appsDir` — the app is already there:

```javascript
  // App is already in its directory — no need to copy
  console.log(`[Deploy] App "${appName}" deployed from ${appDir}`);
```

**Step 4: Run tests**

Run: `cd scripts && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/server/handlers/deploy.js
git commit -m "Update deploy handler to read from per-app directory"
```

---

### Task 8: Update `theme.js` and `chat.js`

**Files:**
- Modify: `scripts/server/handlers/theme.js`
- Modify: `scripts/server/handlers/chat.js`

**Step 1: Update `theme.js`**

Add import:
```javascript
import { currentAppDir } from '../app-context.js';
```

Replace every `const appJsxPath = join(ctx.projectRoot, 'app.jsx')` (lines 76, 212, 270) with:
```javascript
  const appDir = currentAppDir(ctx);
  if (!appDir) {
    onEvent({ type: 'error', message: 'No app active.' });
    return;
  }
  const appJsxPath = join(appDir, 'app.jsx');
```

This appears in three functions: `handleThemeSwitch` (line 76), the legacy theme switch (line 212), and `handlePaletteTheme` (line 270).

**Step 2: Update `chat.js`**

Add import:
```javascript
import { currentAppDir } from '../app-context.js';
```

Replace every reference to `join(ctx.projectRoot, '.vibes-tmp')` — keep `.vibes-tmp` in `ctx.projectRoot` (transient, not app-specific).

The chat handler doesn't directly reference `app.jsx` by path (Claude reads it via the Read tool using `cwd`). Find the `cwd` passed to `runClaude` and update it to use `currentAppDir(ctx)`:

Search for `cwd: ctx.projectRoot` in chat.js and replace with:
```javascript
  cwd: currentAppDir(ctx) || ctx.projectRoot,
```

**Step 3: Run tests**

Run: `cd scripts && npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add scripts/server/handlers/theme.js scripts/server/handlers/chat.js
git commit -m "Update theme and chat handlers to use per-app directories"
```

---

### Task 9: Update `ws-dispatch.js` and `config.js`

**Files:**
- Modify: `scripts/server/ws-dispatch.js`
- Modify: `scripts/server/config.js`

**Step 1: Remove `save_app` from ws-dispatch**

In `scripts/server/ws-dispatch.js`, delete the `save_app` handler (lines 62-71). Remove `copyFileSync` from the `fs` import if nothing else uses it.

**Step 2: Update `getRecommendedThemeIds` in config.js**

Add import:
```javascript
import { currentAppDir } from './app-context.js';
```

Update `getRecommendedThemeIds` (line 198):
```javascript
export function getRecommendedThemeIds(ctx) {
  const appDir = currentAppDir(ctx);
  if (!appDir) return new Set();
  const appPath = join(appDir, 'app.jsx');
  if (!existsSync(appPath)) return new Set();

  const code = readFileSync(appPath, 'utf-8').toLowerCase();
  // ... rest unchanged
```

**Step 3: Update `create-theme.js`**

Check `scripts/server/handlers/create-theme.js` line 140 — it references `join(ctx.projectRoot, 'app.jsx')`. Update:

```javascript
import { currentAppDir } from '../app-context.js';

// At line 140:
const appDir = currentAppDir(ctx);
const appJsxPath = appDir ? join(appDir, 'app.jsx') : null;
```

**Step 4: Run tests**

Run: `cd scripts && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/server/ws-dispatch.js scripts/server/config.js scripts/server/handlers/create-theme.js
git commit -m "Remove save_app handler, update config and create-theme to use per-app dirs"
```

---

### Task 10: Clean up stale references and run full test suite

**Files:**
- Verify: all files in `scripts/server/`

**Step 1: Grep for remaining `ctx.projectRoot.*app.jsx` references**

Run: `cd scripts && grep -rn "ctx\.projectRoot.*app\.jsx\|projectRoot.*app\.jsx" server/`

Expected: Zero matches. If any remain, update them to use `currentAppDir(ctx)`.

**Step 2: Grep for remaining `ctx.projectRoot.*index.html` references**

Run: `cd scripts && grep -rn "ctx\.projectRoot.*index\.html\|projectRoot.*index\.html" server/`

Expected: Zero matches (except `.vibes-tmp` which is allowed).

**Step 3: Run the full test suite**

Run: `cd scripts && npx vitest run`
Expected: All tests PASS

**Step 4: Manual smoke test**

Start the preview server and verify:
1. Server starts with prompt view (no app loaded)
2. Generate creates `~/.vibes/apps/{slug}/app.jsx`
3. `GET /app.jsx` serves from app directory
4. `GET /app-frame` assembles from app directory
5. Theme switch reads/writes in app directory
6. Deploy reads from app directory
7. Load switches `ctx.currentApp` without copying files
8. No `app.jsx` or `index.html` in the plugin directory

Run: `node scripts/preview-server.js --mode=editor`

**Step 5: Commit any remaining cleanup**

```bash
git add -A
git commit -m "Clean up remaining projectRoot references for artifact cleanup"
```
