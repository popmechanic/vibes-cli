# Onboarding Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the editor's 5-step SETUP wizard (Clerk + Connect Studio + OpenRouter + Confirm) with a streamlined 4-step wizard (Welcome + Clerk + Cloudflare + Verification) that stores credentials in `~/.vibes/deployments.json` instead of `.env`, and validates Cloudflare credentials server-side via wrangler.

**Architecture:** The editor.html SETUP phase gets a new 4-step wizard UI. Server-side, `editor-api.js` gains registry-backed credential storage (via `lib/registry.js` from the backend migration plan) and a new Cloudflare validation endpoint that shells out to `wrangler whoami` with `CLOUDFLARE_API_KEY`/`CLOUDFLARE_EMAIL` env vars. The `/editor/status` endpoint checks the registry instead of `.env`. Connect Studio steps are removed entirely -- Connect auto-deploys via alchemy on first app deploy (handled by the separate backend migration plan).

**Tech Stack:** Vanilla JS (editor.html is a single-file SPA), Node.js HTTP server (editor-api.js), vitest for server tests

**Depends on:** `docs/plans/2026-03-05-connect-cloudflare-migration-plan.md` Tasks 1 (registry.js). This plan can begin immediately -- Task 1 here creates a thin adapter that delegates to `lib/registry.js` when available, falling back to an inline implementation until the migration plan is executed.

**Important note on line references:** This plan never references specific line numbers because tasks edit the same files sequentially, causing line shifts. Instead, all edit locations are identified by function names, HTML element IDs, or search patterns. Use your editor's search to find each target.

---

### Task 1: Create Registry Adapter for Editor API

The editor API needs to read/write `~/.vibes/deployments.json`. The full `lib/registry.js` is created by the backend migration plan (Task 1 there). This task creates a **true adapter** that tries to import `../lib/registry.js` first and delegates to it. If that module doesn't exist yet (migration plan not implemented), it falls back to an inline implementation with the **same function signatures and schema** so the two are interchangeable. Once the migration plan is implemented, the inline fallback becomes dead code and should be removed.

**Security:** The registry file stores a Cloudflare Global API Key, which grants full account access. The file MUST be written with `0o600` permissions (owner read/write only).

**Files:**
- Create: `scripts/server/registry-adapter.js`
- Test: `scripts/__tests__/unit/registry-adapter.test.js`

**Step 1: Write failing test for registry adapter**

```javascript
// scripts/__tests__/unit/registry-adapter.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `vibes-reg-adapter-${Date.now()}`);

describe('registry-adapter', () => {
  let adapter;

  beforeEach(async () => {
    vi.resetModules();
    mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    // Force fresh import (resetModules ensures no cached module)
    const mod = await import('../../server/registry-adapter.js');
    adapter = mod;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  describe('getCloudflareCredentials', () => {
    it('returns null fields when registry has no cloudflare config', () => {
      const creds = adapter.getCloudflareCredentials();
      expect(creds.apiKey).toBeFalsy();
      expect(creds.email).toBeFalsy();
    });

    it('returns stored credentials', () => {
      const reg = { version: 1, cloudflare: { apiKey: 'abc123', email: 'test@example.com' }, apps: {} };
      writeFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), JSON.stringify(reg));
      const creds = adapter.getCloudflareCredentials();
      expect(creds.apiKey).toBe('abc123');
      expect(creds.email).toBe('test@example.com');
    });
  });

  describe('saveCloudflareCredentials', () => {
    it('writes credentials to registry', () => {
      adapter.saveCloudflareCredentials({ apiKey: 'key123', email: 'user@test.com' });
      const raw = JSON.parse(readFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), 'utf8'));
      expect(raw.cloudflare.apiKey).toBe('key123');
      expect(raw.cloudflare.email).toBe('user@test.com');
    });

    it('writes registry file with 0o600 permissions', () => {
      adapter.saveCloudflareCredentials({ apiKey: 'key123', email: 'user@test.com' });
      const regPath = join(TEST_DIR, '.vibes', 'deployments.json');
      const stat = statSync(regPath);
      // 0o600 = 33152 on most systems; check owner-only bits
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe('getClerkCredentials', () => {
    it('returns null when no apps exist', () => {
      const creds = adapter.getClerkCredentials();
      expect(creds.publishableKey).toBeFalsy();
    });

    it('returns most recent app clerk credentials', () => {
      const reg = {
        version: 1,
        cloudflare: {},
        apps: {
          'my-app': {
            name: 'my-app',
            updatedAt: '2026-03-06T10:00:00Z',
            clerk: { publishableKey: 'pk_test_abc', secretKey: 'sk_test_xyz' }
          }
        }
      };
      writeFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), JSON.stringify(reg));
      const creds = adapter.getClerkCredentials();
      expect(creds.publishableKey).toBe('pk_test_abc');
      expect(creds.secretKey).toBe('sk_test_xyz');
    });
  });

  describe('saveClerkCredentials', () => {
    it('stores clerk credentials under a default app entry', () => {
      adapter.saveClerkCredentials({ publishableKey: 'pk_test_new', secretKey: 'sk_test_new' });
      const raw = JSON.parse(readFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), 'utf8'));
      // Should be stored under some app entry
      const apps = Object.values(raw.apps);
      expect(apps.length).toBeGreaterThan(0);
      expect(apps[0].clerk.publishableKey).toBe('pk_test_new');
    });
  });

  describe('getSetupStatus', () => {
    it('reports both missing when registry is empty', () => {
      const status = adapter.getSetupStatus();
      expect(status.clerk.ok).toBe(false);
      expect(status.cloudflare.ok).toBe(false);
    });

    it('reports clerk ok when credentials exist', () => {
      const reg = {
        version: 1,
        cloudflare: {},
        apps: {
          'test': { name: 'test', clerk: { publishableKey: 'pk_test_abc', secretKey: 'sk_test_xyz' } }
        }
      };
      writeFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), JSON.stringify(reg));
      const status = adapter.getSetupStatus();
      expect(status.clerk.ok).toBe(true);
    });

    it('reports cloudflare ok when credentials exist', () => {
      const reg = {
        version: 1,
        cloudflare: { apiKey: 'abc', email: 'test@test.com' },
        apps: {}
      };
      writeFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), JSON.stringify(reg));
      const status = adapter.getSetupStatus();
      expect(status.cloudflare.ok).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run __tests__/unit/registry-adapter.test.js`
Expected: FAIL -- module not found

**Step 3: Implement registry adapter**

The adapter tries to import `../lib/registry.js` (the migration plan's module) and delegates
to its `loadRegistry`, `saveRegistry`, `getCloudflareConfig`, `setCloudflareConfig`, `getApp`,
and `setApp` functions. If the import fails (module doesn't exist yet), it falls back to an
inline implementation that uses the **exact same schema and function signatures** so the two
are interchangeable. The inline fallback is clearly marked for removal once the migration plan
lands.

```javascript
// scripts/server/registry-adapter.js
/**
 * Registry adapter for the editor API.
 *
 * Delegates to ../lib/registry.js (from the backend migration plan) when
 * available. Falls back to an inline implementation with identical schema
 * and function signatures if that module doesn't exist yet.
 *
 * TODO: Once the migration plan (2026-03-05-connect-cloudflare-migration-plan.md)
 * Task 1 is implemented, remove the inline fallback block below and rely
 * entirely on ../lib/registry.js.
 *
 * SECURITY: The registry file contains a Cloudflare Global API Key.
 * All writes use 0o600 permissions (owner read/write only).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// --- Try to delegate to lib/registry.js ---
let _registry = null;
try {
  _registry = await import('../lib/registry.js');
} catch {
  // lib/registry.js doesn't exist yet — use inline fallback below
}

// ============================================================
// INLINE FALLBACK — same schema/signatures as lib/registry.js
// Remove this entire block once lib/registry.js exists.
// ============================================================

function getVibesHome() {
  return process.env.VIBES_HOME || homedir();
}

function getRegistryPath() {
  return join(getVibesHome(), '.vibes', 'deployments.json');
}

function emptyRegistry() {
  return { version: 1, cloudflare: {}, apps: {} };
}

// Matches lib/registry.js: loadRegistry()
function _loadRegistry() {
  if (_registry) return _registry.loadRegistry();
  const path = getRegistryPath();
  if (!existsSync(path)) return emptyRegistry();
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!data.version || !data.apps) return emptyRegistry();
    return data;
  } catch {
    return emptyRegistry();
  }
}

// Matches lib/registry.js: saveRegistry(reg)
function _saveRegistry(reg) {
  if (_registry) {
    _registry.saveRegistry(reg);
  } else {
    const dir = join(getVibesHome(), '.vibes');
    mkdirSync(dir, { recursive: true });
    const path = getRegistryPath();
    writeFileSync(path, JSON.stringify(reg, null, 2), { mode: 0o600 });
    // Also chmod in case the file already existed with broader permissions
    try { chmodSync(path, 0o600); } catch { /* best effort */ }
  }
  // Ensure 0o600 regardless of which backend wrote the file
  try {
    const path = _registry ? join(getVibesHome(), '.vibes', 'deployments.json') : getRegistryPath();
    chmodSync(path, 0o600);
  } catch { /* best effort */ }
}

// ============================================================
// Public API — editor-specific convenience functions that wrap
// the registry primitives. These are NOT in lib/registry.js;
// they live here because they serve the editor wizard only.
// ============================================================

/**
 * Get Cloudflare API credentials from registry.
 * Delegates to lib/registry.js getCloudflareConfig() when available.
 * @returns {{ apiKey: string|null, email: string|null, accountId: string|null }}
 */
export function getCloudflareCredentials() {
  if (_registry) {
    const cf = _registry.getCloudflareConfig();
    return { apiKey: cf.apiKey || null, email: cf.email || null, accountId: cf.accountId || null };
  }
  const reg = _loadRegistry();
  const cf = reg.cloudflare || {};
  return {
    apiKey: cf.apiKey || null,
    email: cf.email || null,
    accountId: cf.accountId || null,
  };
}

/**
 * Save Cloudflare API credentials to registry.
 * Delegates to lib/registry.js setCloudflareConfig() when available.
 * @param {{ apiKey: string, email: string, accountId?: string }} creds
 */
export function saveCloudflareCredentials(creds) {
  if (_registry) {
    _registry.setCloudflareConfig(creds);
  } else {
    const reg = _loadRegistry();
    reg.cloudflare = { ...reg.cloudflare, ...creds };
    _saveRegistry(reg);
  }
}

/**
 * Get Clerk credentials from the most recently updated app in registry.
 * @returns {{ publishableKey: string|null, secretKey: string|null, appName: string|null }}
 */
export function getClerkCredentials() {
  const reg = _loadRegistry();
  const apps = Object.values(reg.apps);
  if (apps.length === 0) {
    return { publishableKey: null, secretKey: null, appName: null };
  }
  // Sort by updatedAt descending, pick most recent
  apps.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const latest = apps[0];
  const clerk = latest.clerk || {};
  return {
    publishableKey: clerk.publishableKey || null,
    secretKey: clerk.secretKey || null,
    appName: latest.name || null,
  };
}

/**
 * Save Clerk credentials. If no app name provided, uses '_default'.
 * Delegates to lib/registry.js setApp() when available.
 * @param {{ publishableKey: string, secretKey: string, appName?: string }} creds
 */
export function saveClerkCredentials(creds) {
  const appName = creds.appName || '_default';
  if (_registry) {
    const existing = _registry.getApp(appName) || { name: appName };
    _registry.setApp(appName, {
      ...existing,
      clerk: { publishableKey: creds.publishableKey, secretKey: creds.secretKey },
    });
  } else {
    const reg = _loadRegistry();
    const existing = reg.apps[appName] || { name: appName };
    reg.apps[appName] = {
      ...existing,
      clerk: { publishableKey: creds.publishableKey, secretKey: creds.secretKey },
      updatedAt: new Date().toISOString(),
    };
    if (!reg.apps[appName].createdAt) {
      reg.apps[appName].createdAt = new Date().toISOString();
    }
    _saveRegistry(reg);
  }
}

/**
 * Get Connect URLs for an app from the registry.
 * These are populated by alchemy at deploy time.
 * @param {string} [appName] - App name to look up; defaults to most recent app.
 * @returns {{ apiUrl: string|null, cloudUrl: string|null }}
 */
export function getConnectUrls(appName) {
  const reg = _loadRegistry();
  let app;
  if (appName && reg.apps[appName]) {
    app = reg.apps[appName];
  } else {
    // Fall back to most recent app
    const apps = Object.values(reg.apps);
    apps.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    app = apps[0];
  }
  if (!app || !app.connect) return { apiUrl: null, cloudUrl: null };
  return {
    apiUrl: app.connect.apiUrl || null,
    cloudUrl: app.connect.cloudUrl || null,
  };
}

/**
 * Get overall setup status for the wizard.
 * @returns {{ clerk: { ok: boolean, detail: string }, cloudflare: { ok: boolean, detail: string } }}
 */
export function getSetupStatus() {
  const clerk = getClerkCredentials();
  const cf = getCloudflareCredentials();

  const clerkOk = !!(clerk.publishableKey &&
    (clerk.publishableKey.startsWith('pk_test_') || clerk.publishableKey.startsWith('pk_live_')));
  const cfOk = !!(cf.apiKey && cf.email);

  return {
    clerk: {
      ok: clerkOk,
      detail: clerkOk ? `${clerk.publishableKey.slice(0, 12)}...` : 'No Clerk keys in registry',
    },
    cloudflare: {
      ok: cfOk,
      detail: cfOk ? `${cf.email}` : 'No Cloudflare credentials in registry',
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run __tests__/unit/registry-adapter.test.js`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/server/registry-adapter.js scripts/__tests__/unit/registry-adapter.test.js && git commit -m "Add registry adapter for editor API credential storage

Thin adapter that delegates to lib/registry.js when available,
with inline fallback using identical schema/signatures. File
permissions set to 0o600 (owner-only) since it contains the
Cloudflare Global API Key."
```

---

### Task 2: Add Cloudflare Validation Endpoint to Editor API

This task adds a `POST /editor/credentials/validate-cloudflare` endpoint that validates Cloudflare Global API Key + email by running `wrangler whoami` with those credentials injected as environment variables. Also updates `/editor/status` to use the registry adapter.

**Files:**
- Modify: `scripts/server/handlers/editor-api.js`
- Modify: `scripts/server/routes.js`
- Test: `scripts/__tests__/unit/editor-api-cloudflare.test.js`

**Step 1: Write failing test for Cloudflare validation**

```javascript
// scripts/__tests__/unit/editor-api-cloudflare.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

describe('validateCloudflareCredentials', () => {
  let validateCloudflareCredentials;
  let execFile;

  beforeEach(async () => {
    vi.resetModules();
    const cp = await import('child_process');
    execFile = cp.execFile;
    // Import the function under test
    const mod = await import('../../server/handlers/editor-api.js');
    validateCloudflareCredentials = mod.validateCloudflareCredentials;
  });

  it('returns valid when wrangler succeeds with account info', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      cb(null, ' wrangler\n\n| Account Name   | Account ID                       |\n| My Account     | abc123def456                     |', '');
    });

    const result = await validateCloudflareCredentials('testkey', 'user@test.com');
    expect(result.valid).toBe(true);
    expect(result.accountId).toBeTruthy();
  });

  it('returns invalid when wrangler fails', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      cb(new Error('Authentication failed'), '', 'not authenticated');
    });

    const result = await validateCloudflareCredentials('badkey', 'bad@test.com');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('passes CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL as env vars', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      // Verify env vars are passed
      expect(opts.env.CLOUDFLARE_API_KEY).toBe('mykey');
      expect(opts.env.CLOUDFLARE_EMAIL).toBe('me@test.com');
      cb(null, 'Account ID: abc123', '');
    });

    await validateCloudflareCredentials('mykey', 'me@test.com');
    expect(execFile).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run __tests__/unit/editor-api-cloudflare.test.js`
Expected: FAIL -- `validateCloudflareCredentials` is not exported

**Step 3: Add `validateCloudflareCredentials` to editor-api.js**

Add this import at the top of `scripts/server/handlers/editor-api.js`, after the existing imports (search for `import { loadOpenRouterKey }`):

```javascript
import { getSetupStatus, saveClerkCredentials, saveCloudflareCredentials, getClerkCredentials, getCloudflareCredentials } from '../registry-adapter.js';
```

Add this function after the `runCommand` function (search for the closing `}` of `function runCommand`):

```javascript
/**
 * Validate Cloudflare Global API Key + email by running wrangler whoami.
 * @param {string} apiKey - Cloudflare Global API Key
 * @param {string} email - Cloudflare account email
 * @returns {Promise<{valid: boolean, accountId?: string, error?: string}>}
 */
export function validateCloudflareCredentials(apiKey, email) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      CLOUDFLARE_API_KEY: apiKey,
      CLOUDFLARE_EMAIL: email,
    };
    try {
      execFile('npx', ['wrangler', 'whoami'], { timeout: 15000, env }, (err, stdout, stderr) => {
        const output = ((stdout || '') + (stderr || '')).trim();
        if (err || output.includes('not authenticated') || output.includes('could not authenticate')) {
          resolve({ valid: false, error: 'Authentication failed. Check your Global API Key and email.' });
          return;
        }
        // Try to extract account ID from wrangler output table
        const idMatch = output.match(/([a-f0-9]{32})/);
        resolve({
          valid: true,
          accountId: idMatch ? idMatch[1] : null,
        });
      });
    } catch {
      resolve({ valid: false, error: 'Failed to run wrangler' });
    }
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run __tests__/unit/editor-api-cloudflare.test.js`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/server/handlers/editor-api.js scripts/__tests__/unit/editor-api-cloudflare.test.js && git commit -m "Add Cloudflare credential validation via wrangler whoami

New validateCloudflareCredentials() function shells out to wrangler
with CLOUDFLARE_API_KEY/CLOUDFLARE_EMAIL env vars to verify credentials."
```

---

### Task 3: Update `/editor/status` and `/editor/credentials` Endpoints

Replace the current `.env`-based status check with registry-based checks. Replace the save-to-`.env` logic with save-to-registry logic. Add a new route for Cloudflare validation. Remove the Connect Studio check route.

**Files:**
- Modify: `scripts/server/handlers/editor-api.js` (functions `checkEditorDeps`, `status`, `saveCredentials`, `checkStudio`)
- Modify: `scripts/server/routes.js` (route table)

**Step 1: Replace the `checkEditorDeps` function in editor-api.js**

Search for `async function checkEditorDeps(ctx)` and replace the entire function body (everything through its closing `}` and the returned object) with:

```javascript
async function checkEditorDeps(ctx) {
  // Check registry for credentials
  const registryStatus = getSetupStatus();

  // Also check legacy .env as fallback for Clerk
  const env = loadEnvFile(ctx.projectRoot);
  const clerkKey = env.VITE_CLERK_PUBLISHABLE_KEY || '';
  const clerkOk = registryStatus.clerk.ok || validateClerkKey(clerkKey);

  const cloudflareOk = registryStatus.cloudflare.ok;

  const orKey = loadOpenRouterKey(ctx.projectRoot);
  const openrouterOk = !!orKey;

  return {
    clerk: {
      ok: clerkOk,
      detail: registryStatus.clerk.ok
        ? registryStatus.clerk.detail
        : (clerkOk ? `${clerkKey.slice(0, 12)}... (legacy .env)` : 'No Clerk keys found'),
    },
    cloudflare: {
      ok: cloudflareOk,
      detail: registryStatus.cloudflare.detail,
    },
    openrouter: {
      ok: openrouterOk,
      detail: openrouterOk ? `sk-or-...${orKey.slice(-6)}` : 'No OPENROUTER_API_KEY',
    },
  };
}
```

Note: The returned object no longer includes `wrangler`, `ssh`, or `connect` keys. It now has a `cloudflare` key. This is an intentional schema change. All consumers are updated in subsequent tasks.

**Step 2: Replace the `saveCredentials` function**

Search for `export async function saveCredentials(ctx, req, res)` and replace the entire function with:

```javascript
export async function saveCredentials(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    const errors = {};

    // Validate Clerk keys
    if (body.clerkPublishableKey) {
      if (!validateClerkKey(body.clerkPublishableKey)) {
        errors.clerkPublishableKey = 'Invalid Clerk publishable key (must start with pk_test_ or pk_live_)';
      }
    }
    if (body.clerkSecretKey) {
      if (!validateClerkSecretKey(body.clerkSecretKey)) {
        errors.clerkSecretKey = 'Invalid Clerk secret key (must start with sk_test_ or sk_live_)';
      }
    }

    // Validate Cloudflare credentials
    if (body.cloudflareApiKey) {
      if (!body.cloudflareEmail) {
        errors.cloudflareEmail = 'Cloudflare email is required with API key';
      }
    }

    // Validate OpenRouter key
    if (body.openRouterKey) {
      if (!body.openRouterKey.startsWith('sk-or-')) {
        errors.openRouterKey = 'Invalid OpenRouter key (must start with sk-or-)';
      }
    }

    if (Object.keys(errors).length > 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, errors }));
    }

    // Save to registry
    if (body.clerkPublishableKey && body.clerkSecretKey) {
      saveClerkCredentials({
        publishableKey: body.clerkPublishableKey,
        secretKey: body.clerkSecretKey,
      });
    }

    if (body.cloudflareApiKey && body.cloudflareEmail) {
      saveCloudflareCredentials({
        apiKey: body.cloudflareApiKey,
        email: body.cloudflareEmail,
        accountId: body.cloudflareAccountId || null,
      });
    }

    // Also write Clerk keys to .env for assembly compatibility
    const envVars = {};
    if (body.clerkPublishableKey) {
      envVars.VITE_CLERK_PUBLISHABLE_KEY = body.clerkPublishableKey;
    }
    if (body.clerkSecretKey) {
      envVars.VITE_CLERK_SECRET_KEY = body.clerkSecretKey;
    }
    if (body.openRouterKey) {
      envVars.OPENROUTER_API_KEY = body.openRouterKey;
      ctx.openRouterKey = body.openRouterKey;
      console.log('OpenRouter API key updated from wizard');
    }
    if (Object.keys(envVars).length > 0) {
      writeEnvFile(ctx.projectRoot, envVars);
    }

    const statusResult = await checkEditorDeps(ctx);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, status: statusResult }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, errors: { _: err.message } }));
  }
}
```

**Step 3: Add Cloudflare validation route handler**

Add this new handler anywhere in `editor-api.js` (suggestion: after `saveCredentials`):

```javascript
export async function validateCloudflare(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body.apiKey || !body.email) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ valid: false, error: 'API key and email are required' }));
    }

    const result = await validateCloudflareCredentials(body.apiKey, body.email);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ valid: false, error: err.message }));
  }
}
```

**Step 4: Delete the `checkStudio` function**

Search for `export async function checkStudio(ctx, req, res)` and delete the entire function.

**Step 5: Update routes.js**

In `scripts/server/routes.js`, find the route table object (search for `const routeTable`).

Add this new route:
```javascript
  'POST /editor/credentials/validate-cloudflare': editorApi.validateCloudflare,
```

Remove this route:
```javascript
  'POST /editor/credentials/check-studio': editorApi.checkStudio,
```

**Step 6: Run existing tests to check for regressions**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run`
Expected: PASS (or only pre-existing failures unrelated to this change)

**Step 7: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/server/handlers/editor-api.js scripts/server/routes.js && git commit -m "Update editor API to use registry for credential storage

- /editor/status returns clerk + cloudflare + openrouter (drops wrangler/ssh/connect)
- /editor/credentials saves to registry (with .env fallback for assembly)
- New POST /editor/credentials/validate-cloudflare endpoint
- Remove Connect Studio check-studio endpoint and handler"
```

---

### Task 4: Relax Assembly Connect URL Gate

`assemble.js` currently hard-gates on `VITE_API_URL` and `VITE_CLOUD_URL` in `.env`. With the new architecture, Connect URLs are not available until the first deploy (alchemy provisions them at deploy time). Assembly runs BEFORE deploy, so this gate blocks the entire flow.

This task relaxes the gate so assembly succeeds with just a Clerk publishable key. The Connect config placeholders (`__VITE_API_URL__`, `__VITE_CLOUD_URL__`) will be left as empty strings in the assembled HTML; `deploy-cloudflare.js` (from the migration plan) will re-assemble with real URLs after alchemy provisions Connect.

**Files:**
- Modify: `scripts/assemble.js`
- Modify: `scripts/assemble-sell.js` (same gate pattern)
- Test: `scripts/__tests__/unit/assemble-validation.test.js` (existing tests)

**Step 1: Modify the Connect validation block in assemble.js**

Search for `// Validate Connect credentials - fail fast if invalid` in `scripts/assemble.js`. Replace the validation block (from that comment through the `console.log('Connect mode:` line) with:

```javascript
  // Validate Clerk key - required for all apps
  const hasClerkKey = validateClerkKey(envVars.VITE_CLERK_PUBLISHABLE_KEY);

  if (!hasClerkKey) {
    throw new Error(
      'Valid Clerk publishable key required.\n\n' +
      'Expected in .env:\n' +
      '  VITE_CLERK_PUBLISHABLE_KEY=pk_test_... or pk_live_...\n\n' +
      'Run the editor setup wizard to configure credentials.'
    );
  }

  // Connect URLs are optional at assembly time — they'll be populated
  // at deploy time when alchemy provisions the Connect instance.
  // If present, they'll be substituted; if absent, placeholders become empty strings.
  if (envVars.VITE_API_URL) {
    console.log('Connect mode: Clerk auth + cloud sync enabled');
  } else {
    console.log('Connect mode: Clerk auth enabled (Connect URLs will be set at deploy time)');
  }
```

**Step 2: Apply same change to assemble-sell.js**

Search for the equivalent Connect validation block in `scripts/assemble-sell.js` (search for `hasValidConnect` or `Validate Connect credentials`). Apply the same relaxation -- require Clerk key, but make Connect URLs optional.

**Step 3: Run existing assembly tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run __tests__/unit/assemble-validation.test.js`

Some tests may expect the old error message. Update any test that asserts the exact error text to match the new message. Tests that validate placeholder substitution should still pass since `populateConnectConfig` handles empty values gracefully (it replaces placeholders with empty strings).

**Step 4: Run structural fixture tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npm run test:fixtures`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/assemble.js scripts/assemble-sell.js && git commit -m "Relax assembly to not require Connect URLs

Assembly now only requires a Clerk publishable key. Connect URLs
(VITE_API_URL, VITE_CLOUD_URL) are optional at assembly time and
will be populated at deploy time when alchemy provisions Connect."
```

---

### Task 5: Rewrite Wizard HTML -- All 4 Steps

Replace the SETUP phase HTML in editor.html. The new wizard has 4 steps instead of 5. This task replaces the entire `phaseSetup` div.

**Files:**
- Modify: `skills/vibes/templates/editor.html` (the `phaseSetup` div)

**Step 1: Replace the phaseSetup HTML**

Search for `<!-- Phase 1: Setup -->` and find the containing `<div class="phase setup-phase" id="phaseSetup">`. Replace from that opening tag through its closing `</div>` (the one that ends the phaseSetup div, right before `<!-- Phase 2: Generate -->`) with:

```html
  <!-- Phase 1: Setup -->
  <div class="phase setup-phase" id="phaseSetup">
    <div class="setup-card" style="width:520px;">
      <div class="setup-title">
        <span>&#9889;</span> Setup Wizard
      </div>
      <div class="wizard-progress" id="wizardProgress">
        <div class="wizard-dot active" data-step="1"></div>
        <div class="wizard-dot-line"></div>
        <div class="wizard-dot" data-step="2"></div>
        <div class="wizard-dot-line"></div>
        <div class="wizard-dot" data-step="3"></div>
        <div class="wizard-dot-line"></div>
        <div class="wizard-dot" data-step="4"></div>
      </div>

      <!-- Step 1: Welcome -->
      <div class="wizard-step active" id="wizardStep1">
        <div class="wizard-section-title">Welcome to Vibes</div>
        <div class="wizard-help">
          Let's get you set up! Vibes needs two services to build and deploy your apps:
        </div>
        <div style="margin: 1rem 0;">
          <div class="setup-item">
            <div class="setup-icon" id="welcomeClerkIcon" style="background:#999;color:white;">1</div>
            <div>
              <div class="setup-label">Clerk <span style="font-size:0.7rem;color:#888;">(authentication)</span></div>
              <div class="setup-detail">Handles user sign-in for your apps</div>
            </div>
          </div>
          <div class="setup-item">
            <div class="setup-icon" id="welcomeCfIcon" style="background:#999;color:white;">2</div>
            <div>
              <div class="setup-label">Cloudflare <span style="font-size:0.7rem;color:#888;">(hosting &amp; sync)</span></div>
              <div class="setup-detail">Deploys your apps and syncs data automatically</div>
            </div>
          </div>
        </div>
        <div class="wizard-help" style="font-size:0.75rem;color:#666;">
          Each service has a free tier. Setup takes about 5 minutes.
        </div>
        <div id="setupChecklist"></div>
        <div class="setup-actions" style="margin-top:1rem;">
          <button class="btn btn-secondary" onclick="skipSetup()">Skip for now</button>
          <button class="btn btn-primary" id="wizardStartBtn" onclick="setWizardStep(2)">Get started</button>
        </div>
      </div>

      <!-- Step 2: Clerk Keys -->
      <div class="wizard-step" id="wizardStep2">
        <div class="wizard-section-title">Clerk Authentication</div>
        <div class="wizard-help">
          Clerk handles user sign-in for your apps. Create a free account, then copy your keys.
        </div>
        <div style="background:rgba(0,154,206,0.06);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.8125rem;line-height:1.5;">
          <strong>Quick steps:</strong>
          <ol style="margin:0.5rem 0 0 1.25rem;padding:0;">
            <li>Go to <a class="wizard-link" href="https://dashboard.clerk.com" target="_blank">dashboard.clerk.com</a></li>
            <li>Create an application (any name)</li>
            <li>Go to <strong>API Keys</strong> in the sidebar</li>
            <li>Copy both keys below</li>
          </ol>
        </div>
        <label style="font-size:0.75rem;font-weight:700;display:block;margin-bottom:0.25rem;">Publishable Key</label>
        <input class="wizard-input" id="wizardClerkKey" type="text" placeholder="pk_test_..." oninput="validateWizardClerkInputs()" autocomplete="off" />
        <label style="font-size:0.75rem;font-weight:700;display:block;margin-bottom:0.25rem;margin-top:0.5rem;">Secret Key</label>
        <input class="wizard-input" id="wizardClerkSecret" type="password" placeholder="sk_test_..." oninput="validateWizardClerkInputs()" autocomplete="off" />
        <div class="wizard-help" id="wizardClerkHint" style="color:var(--vibes-red);display:none;"></div>
        <div class="setup-actions" style="margin-top:1rem;">
          <button class="btn btn-secondary" onclick="setWizardStep(1)">Back</button>
          <button class="btn btn-primary" id="wizardClerkNext" onclick="saveClerkAndAdvance()" disabled>Next</button>
        </div>
      </div>

      <!-- Step 3: Cloudflare -->
      <div class="wizard-step" id="wizardStep3">
        <div class="wizard-section-title">Cloudflare Deployment</div>
        <div class="wizard-help">
          Cloudflare Workers hosts your apps and syncs data. Create a free account, then paste your Global API Key.
        </div>
        <div style="background:rgba(0,154,206,0.06);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.8125rem;line-height:1.5;">
          <strong>Quick steps:</strong>
          <ol style="margin:0.5rem 0 0 1.25rem;padding:0;">
            <li>Go to <a class="wizard-link" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank">Cloudflare API Tokens</a></li>
            <li>Scroll to <strong>Global API Key</strong> and click "View"</li>
            <li>Copy the key and your account email below</li>
          </ol>
        </div>
        <label style="font-size:0.75rem;font-weight:700;display:block;margin-bottom:0.25rem;">Account Email</label>
        <input class="wizard-input" id="wizardCfEmail" type="email" placeholder="you@example.com" oninput="validateWizardCfInputs()" autocomplete="off" />
        <label style="font-size:0.75rem;font-weight:700;display:block;margin-bottom:0.25rem;margin-top:0.5rem;">Global API Key</label>
        <input class="wizard-input" id="wizardCfKey" type="password" placeholder="Paste your Global API Key..." oninput="validateWizardCfInputs()" autocomplete="off" />
        <div class="wizard-help" id="wizardCfHint" style="display:none;"></div>
        <div class="setup-actions" style="margin-top:1rem;">
          <button class="btn btn-secondary" onclick="setWizardStep(2)">Back</button>
          <button class="btn btn-primary" id="wizardCfNext" onclick="validateAndAdvanceCf()" disabled>Verify &amp; Continue</button>
        </div>
      </div>

      <!-- Step 4: Verification & Save -->
      <div class="wizard-step" id="wizardStep4">
        <div class="wizard-section-title">All Set!</div>
        <div class="wizard-help">Your credentials have been verified and saved.</div>
        <div class="wizard-summary-table" id="wizardSummary"></div>

        <!-- Optional: OpenRouter -->
        <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid rgba(0,0,0,0.1);">
          <div style="font-size:0.75rem;font-weight:700;margin-bottom:0.25rem;">
            OpenRouter API Key <span style="font-weight:400;color:#888;">(optional -- enables AI themes)</span>
          </div>
          <div style="display:flex;gap:0.5rem;">
            <input class="wizard-input" id="wizardOpenRouterKey" type="password" placeholder="sk-or-..." oninput="validateOpenRouterKey()" style="flex:1;" />
            <button class="btn btn-secondary" id="wizardOrSaveBtn" onclick="saveOpenRouterKey()" disabled style="white-space:nowrap;">Save Key</button>
          </div>
          <div class="wizard-help" id="wizardOpenRouterHint" style="display:none;"></div>
          <div style="font-size:0.7rem;color:#888;margin-top:0.25rem;">
            <a class="wizard-link" href="https://openrouter.ai/keys" target="_blank" style="font-size:0.7rem;">Get a key at openrouter.ai</a>
          </div>
        </div>

        <div class="setup-actions" style="margin-top:1.5rem;">
          <button class="btn btn-primary" id="wizardFinishBtn" onclick="wizardFinish()" style="width:100%;">Start Building</button>
        </div>
      </div>
    </div>
  </div>
```

**Step 2: Verify the HTML renders correctly**

Run the preview server manually and check localhost:3333 in a browser. The wizard should show 4 dots and the Welcome step.

**Step 3: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add skills/vibes/templates/editor.html && git commit -m "Replace wizard HTML with new 4-step onboarding flow

Steps: Welcome -> Clerk -> Cloudflare -> Verification
Removes Connect Studio and separate OpenRouter steps.
Cloudflare replaces exe.dev/Connect as the deploy target."
```

---

### Task 6: Rewrite Wizard JavaScript -- State, Navigation, and Validation

Replace the wizard JS functions in editor.html. This task handles wizard state, navigation, validation functions, the save/verify flow, AND all deploy button state management that depended on the old status schema.

**Scope of exe.dev/SSH cleanup:** Beyond the targeted blocks replaced in the steps below, there are ~15 scattered references to exe.dev/SSH throughout editor.html that must also be removed. After completing all steps, run the verification grep in Step 10 to catch any survivors. Common locations for stale references:
- `renderChecklist` may contain exe.dev checklist items
- Old `saveCredentials` success callback may set `deployTargets.exe`
- Status fetch callbacks may read `status.ssh`
- Any `sshAvailable` assignments or conditionals
- Any `deployExe`, `deploy-exe`, or `exe.dev` string literals

**Files:**
- Modify: `skills/vibes/templates/editor.html` (JS section -- state variables, wizard functions, deploy functions, init block)

**Step 1: Update wizard state variables**

Search for `let deployTargets = { cloudflare: false, exe: false };` and the surrounding state block. Replace these specific variables:

```javascript
  // DELETE these lines:
  let deployTargets = { cloudflare: false, exe: false };
  let sshAvailable = false;
  let studioCheckTimer = null;
  let studioMode = 'existing';
  let wizardData = { clerkKey: '', clerkSecret: '', studioName: '', apiUrl: '', cloudUrl: '', openRouterKey: '' };

  // REPLACE with:
  let cloudflareReady = false;
  let wizardData = {
    clerkKey: '',
    clerkSecret: '',
    cfEmail: '',
    cfApiKey: '',
    cfAccountId: '',
    openRouterKey: '',
  };
  let wizardValidation = {
    clerk: 'unchecked',       // unchecked | checking | valid | invalid
    cloudflare: 'unchecked',  // unchecked | checking | valid | invalid
  };
```

Keep `let wizardStep = 1;` unchanged.

**Step 2: Replace all wizard functions**

First, search for `async function checkSetup()` -- this function precedes the wizard block and references DOM elements (`setupActions`, `setupSkipBtn`) that no longer exist in the new wizard HTML. Delete the entire `checkSetup` function (from `async function checkSetup() {` through its closing `}`).

Then, search for `function renderChecklist(status)` -- this is the start of the main wizard function block. Delete everything from that function through `function prefillFromStatus(status) { ... }` (inclusive). The block to delete ends just before the comment `// === Phase 2: Generate ===`.

Replace the entire deleted block with:

```javascript
  function renderChecklist(status) {
    // Update welcome screen icons based on status
    const clerkIcon = document.getElementById('welcomeClerkIcon');
    const cfIcon = document.getElementById('welcomeCfIcon');
    if (clerkIcon) {
      if (status.clerk?.ok) {
        clerkIcon.className = 'setup-icon pass';
        clerkIcon.innerHTML = '&#10003;';
      }
    }
    if (cfIcon) {
      if (status.cloudflare?.ok) {
        cfIcon.className = 'setup-icon pass';
        cfIcon.innerHTML = '&#10003;';
      }
    }

    // Auto-advance if all credentials present
    if (status.clerk?.ok && status.cloudflare?.ok) {
      setTimeout(() => goToGenerate(), 800);
    }
  }

  function skipSetup() {
    goToGenerate();
  }

  function goToGenerate() {
    setPhase('generate');
    fetch('/editor/initial-prompt').then(r => r.json()).then(data => {
      if (data.prompt) document.getElementById('generatePrompt').value = data.prompt;
    }).catch(() => {});
    document.getElementById('generatePrompt').focus();
  }

  function setWizardStep(n) {
    wizardStep = n;
    document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
    const step = document.getElementById('wizardStep' + n);
    if (step) step.classList.add('active');
    // Update progress dots
    document.querySelectorAll('.wizard-dot').forEach(dot => {
      const s = parseInt(dot.dataset.step);
      dot.classList.toggle('active', s === n);
      dot.classList.toggle('done', s < n);
    });
    if (n === 4) renderWizardSummary();
  }

  function validateWizardClerkInputs() {
    const keyInput = document.getElementById('wizardClerkKey');
    const secretInput = document.getElementById('wizardClerkSecret');
    const hint = document.getElementById('wizardClerkHint');
    const nextBtn = document.getElementById('wizardClerkNext');

    const key = keyInput.value.trim();
    const secret = secretInput.value.trim();

    const keyValid = key.startsWith('pk_test_') || key.startsWith('pk_live_');
    const secretValid = secret.startsWith('sk_test_') || secret.startsWith('sk_live_');

    keyInput.classList.toggle('valid', key && keyValid);
    keyInput.classList.toggle('invalid', key && !keyValid);
    secretInput.classList.toggle('valid', secret && secretValid);
    secretInput.classList.toggle('invalid', secret && !secretValid);

    if (key && !keyValid) {
      hint.textContent = 'Publishable key must start with pk_test_ or pk_live_';
      hint.style.display = '';
    } else if (secret && !secretValid) {
      hint.textContent = 'Secret key must start with sk_test_ or sk_live_';
      hint.style.display = '';
    } else {
      hint.style.display = 'none';
    }

    const valid = keyValid && secretValid;
    nextBtn.disabled = !valid;
    if (valid) {
      wizardData.clerkKey = key;
      wizardData.clerkSecret = secret;
      wizardValidation.clerk = 'valid';
    } else {
      wizardValidation.clerk = (key || secret) ? 'invalid' : 'unchecked';
    }
  }

  async function saveClerkAndAdvance() {
    const btn = document.getElementById('wizardClerkNext');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const res = await fetch('/editor/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clerkPublishableKey: wizardData.clerkKey,
          clerkSecretKey: wizardData.clerkSecret,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.errors ? Object.values(data.errors).join('; ') : 'Failed to save');
      }
      wizardValidation.clerk = 'valid';
      setWizardStep(3);
    } catch (err) {
      const hint = document.getElementById('wizardClerkHint');
      hint.textContent = err.message;
      hint.style.display = '';
      hint.style.color = 'var(--vibes-red)';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Next';
    }
  }

  function validateWizardCfInputs() {
    const emailInput = document.getElementById('wizardCfEmail');
    const keyInput = document.getElementById('wizardCfKey');
    const nextBtn = document.getElementById('wizardCfNext');

    const email = emailInput.value.trim();
    const key = keyInput.value.trim();

    const emailValid = email.includes('@') && email.includes('.');
    const keyValid = key.length >= 20;  // Global API keys are 37+ chars

    emailInput.classList.toggle('valid', email && emailValid);
    emailInput.classList.toggle('invalid', email && !emailValid);
    keyInput.classList.toggle('valid', key && keyValid);
    keyInput.classList.toggle('invalid', key && !keyValid);

    wizardData.cfEmail = email;
    wizardData.cfApiKey = key;

    nextBtn.disabled = !(emailValid && keyValid);
  }

  async function validateAndAdvanceCf() {
    const btn = document.getElementById('wizardCfNext');
    const hint = document.getElementById('wizardCfHint');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    hint.style.display = 'none';
    wizardValidation.cloudflare = 'checking';

    try {
      const res = await fetch('/editor/credentials/validate-cloudflare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: wizardData.cfApiKey,
          email: wizardData.cfEmail,
        }),
      });
      const data = await res.json();

      if (data.valid) {
        wizardData.cfAccountId = data.accountId || '';
        wizardValidation.cloudflare = 'valid';
        cloudflareReady = true;

        // Save Cloudflare credentials to registry
        await fetch('/editor/credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cloudflareApiKey: wizardData.cfApiKey,
            cloudflareEmail: wizardData.cfEmail,
            cloudflareAccountId: wizardData.cfAccountId,
          }),
        });

        setWizardStep(4);
      } else {
        wizardValidation.cloudflare = 'invalid';
        hint.textContent = data.error || 'Cloudflare credentials could not be verified.';
        hint.style.color = 'var(--vibes-red)';
        hint.style.display = '';
      }
    } catch (err) {
      wizardValidation.cloudflare = 'invalid';
      hint.textContent = 'Failed to verify: ' + err.message;
      hint.style.color = 'var(--vibes-red)';
      hint.style.display = '';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verify & Continue';
    }
  }

  function renderWizardSummary() {
    const table = document.getElementById('wizardSummary');
    const rows = [
      ['Clerk', wizardData.clerkKey ? wizardData.clerkKey.slice(0, 15) + '...' : 'Not set', wizardValidation.clerk === 'valid'],
      ['Cloudflare', wizardData.cfEmail || 'Not set', wizardValidation.cloudflare === 'valid'],
    ];
    table.innerHTML = rows.map(([label, value, ok]) =>
      `<div class="wizard-summary-row">
        <span class="wizard-summary-key">${label}</span>
        <span class="wizard-summary-value">
          <span style="color:${ok ? 'var(--vibes-green)' : 'var(--vibes-red)'}; margin-right:0.5rem;">${ok ? '&#10003;' : '&#10007;'}</span>
          ${escapeHtml(value)}
        </span>
      </div>`
    ).join('');
  }

  function validateOpenRouterKey() {
    const input = document.getElementById('wizardOpenRouterKey');
    const hint = document.getElementById('wizardOpenRouterHint');
    const saveBtn = document.getElementById('wizardOrSaveBtn');

    const key = input.value.trim();

    if (!key) {
      input.classList.remove('valid', 'invalid');
      hint.style.display = 'none';
      saveBtn.disabled = true;
      wizardData.openRouterKey = '';
      return;
    }

    const valid = key.startsWith('sk-or-');
    input.classList.toggle('valid', valid);
    input.classList.toggle('invalid', !valid);

    if (!valid) {
      hint.textContent = 'OpenRouter keys start with sk-or-';
      hint.style.color = 'var(--vibes-red)';
      hint.style.display = '';
    } else {
      hint.style.display = 'none';
    }

    saveBtn.disabled = !valid;
    wizardData.openRouterKey = valid ? key : '';
  }

  async function saveOpenRouterKey() {
    const btn = document.getElementById('wizardOrSaveBtn');
    const hint = document.getElementById('wizardOpenRouterHint');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const res = await fetch('/editor/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openRouterKey: wizardData.openRouterKey }),
      });
      if (!res.ok) throw new Error('Failed to save');
      hint.textContent = 'Saved!';
      hint.style.color = 'var(--vibes-green)';
      hint.style.display = '';
      hasOpenRouterKey = true;
    } catch (err) {
      hint.textContent = err.message;
      hint.style.color = 'var(--vibes-red)';
      hint.style.display = '';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Key';
    }
  }

  function wizardFinish() {
    goToGenerate();
  }

  function prefillFromStatus(status) {
    // If clerk keys exist in registry, skip to step 3
    if (status.clerk?.ok && !status.cloudflare?.ok) {
      wizardValidation.clerk = 'valid';
      setWizardStep(3);
      return;
    }
    // If both exist, auto-advance (handled by renderChecklist)
  }
```

**Step 3: Replace `updateDeployButtons` function**

Search for `function updateDeployButtons()` and replace the entire function with:

```javascript
  function updateDeployButtons() {
    const cfBtn = document.getElementById('deployCf');
    if (cfBtn) {
      cfBtn.disabled = !cloudflareReady;
      const cfDetail = document.getElementById('deployCfDetail');
      cfDetail.textContent = cloudflareReady ? 'Ready' : 'Run setup wizard first';
      cfDetail.classList.toggle('ready', cloudflareReady);
    }
  }
```

**Step 4: Replace `toggleDeployMenu` function**

Search for `function toggleDeployMenu()` and replace the entire function with:

```javascript
  function toggleDeployMenu() {
    const menu = document.getElementById('deployMenu');
    const opening = !menu.classList.contains('open');
    menu.classList.toggle('open');
    if (opening) {
      deployMenuOpenTime = Date.now();
      // Position below the deploy button
      const btn = document.querySelector('#deployDropdown button');
      const rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 6) + 'px';
      menu.style.right = (window.innerWidth - rect.right + 4) + 'px';
      // Refresh deploy status from registry
      fetch('/editor/status').then(r => r.json()).then(status => {
        cloudflareReady = status.cloudflare?.ok || false;
        updateDeployButtons();
      }).catch(() => {});
    }
  }
```

**Step 5: Replace deploy menu HTML in `setPhase` function**

Search for `function setPhase(phase)`. Inside this function, there is a block that builds the deploy dropdown HTML (search for `deploy-dropdown`). Find the HTML template string that creates the deploy menu buttons. Replace the entire deploy menu HTML (the template literal inside the `innerHTML` assignment that contains `deployCf` and `deployExe`) with a version that only has the Cloudflare button:

Find the template literal that contains `id="deployExe"` and replace the entire `deployDropdown` innerHTML assignment block. The new HTML should be:

```javascript
        headerRight.innerHTML += `<div class="navbar-button-wrapper deploy-dropdown" id="deployDropdown">
          <button style="background:var(--vibes-green)" onclick="toggleDeployMenu()">
            <div class="navbar-button-icon">
              <svg width="35" height="35" viewBox="0 0 35 35" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="17.5" cy="17.5" r="17.5" fill="#231F20"/>
                <path d="M17.5 9l7 7h-4.5v7h-5v-7H10.5l7-7z" fill="var(--vibes-cream)"/>
                <rect x="11" y="25" width="13" height="2" rx="1" fill="var(--vibes-cream)"/>
              </svg>
            </div>
            <div class="navbar-button-label">Deploy</div>
          </button>
          <div class="deploy-menu" id="deployMenu">
            <div class="deploy-menu-header">
              <label>App Name</label>
              <input type="text" id="deployNameInput" placeholder="my-app"
                onclick="event.stopPropagation()" />
            </div>
            <button class="deploy-option" id="deployCf" onclick="startDeploy('cloudflare')" disabled>
              <span class="deploy-option-icon">&#9729;</span>
              <div>
                <div>Cloudflare Workers</div>
                <div class="deploy-option-detail" id="deployCfDetail">Checking...</div>
              </div>
            </button>
          </div>
        </div>`;
```

Remove the `updateDeployButtons();` call that follows if it still references the old function (it should still work with the new one).

**Step 6: Replace `startDeploy` function**

Search for `function startDeploy(target)` and replace the entire function with:

```javascript
  function startDeploy(target) {
    if (isThinking || !ws || ws.readyState !== WebSocket.OPEN) return;
    const nameInput = document.getElementById('deployNameInput');
    const name = (nameInput ? nameInput.value.trim() : '').replace(/[^a-z0-9-]/g, '');
    if (!name) {
      nameInput.style.borderColor = 'var(--vibes-red)';
      nameInput.focus();
      return;
    }
    nameInput.style.borderColor = 'var(--vibes-near-black)';
    document.getElementById('deployMenu').classList.remove('open');
    addMessage('user', 'Deploy "' + name + '" to Cloudflare Workers');
    ws.send(JSON.stringify({ type: 'deploy', target: 'cloudflare', name }));
  }
```

**Step 7: Update the initialization block**

Search for the status fetch in the init block (find `fetch('/editor/status').then`). Replace the entire `.then` callback chain (from the `fetch` call through its `.catch`) with:

```javascript
  // Check status -> decide setup wizard vs generate
  fetch('/editor/status').then(r => r.json()).then(status => {
    cloudflareReady = status.cloudflare?.ok || false;

    if (status.clerk?.ok && status.cloudflare?.ok) {
      // Credentials present -- stay in generate phase
      fetch('/editor/initial-prompt').then(r => r.json()).then(data => {
        if (data.prompt) document.getElementById('generatePrompt').value = data.prompt;
      }).catch(() => {});
      document.getElementById('generatePrompt').focus();
    } else {
      // Missing credentials -- show wizard
      setPhase('setup');
      renderChecklist(status);
      prefillFromStatus(status);
    }
  }).catch(err => {
    document.getElementById('generatePrompt').focus();
  });
```

**Step 8: Verify no JS errors**

Load editor.html in browser at localhost:3333, open dev console, confirm no errors on page load.

**Step 9: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add skills/vibes/templates/editor.html && git commit -m "Rewrite wizard JavaScript for new 4-step onboarding flow

New state management with per-credential validation tracking.
Clerk keys saved on step 2 advance. Cloudflare validated server-side
before advancing to step 3. All Connect Studio JS removed.
Deploy buttons simplified to Cloudflare-only with cloudflareReady flag."
```

**Step 10: Verify complete exe.dev/SSH removal**

Run these greps against editor.html. ALL must return zero matches:

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard
grep -n 'deployTargets\.exe' skills/vibes/templates/editor.html
grep -n 'status\.ssh' skills/vibes/templates/editor.html
grep -n 'sshAvailable' skills/vibes/templates/editor.html
grep -n 'deployExe\|deploy-exe\|deploy_exe' skills/vibes/templates/editor.html
grep -n 'exe\.dev\|exe\.xyz' skills/vibes/templates/editor.html
grep -n 'studioMode\|studioCheckTimer' skills/vibes/templates/editor.html
```

If any matches are found, delete or replace them:
- `deployTargets.exe` references → delete the containing line/block (replaced by `cloudflareReady`)
- `status.ssh` references → delete the containing conditional (SSH status no longer returned)
- `sshAvailable` assignments/reads → delete entirely
- `deployExe`/`deploy-exe` → delete the containing block (exe.dev deploy target removed)
- `exe.dev`/`exe.xyz` string literals in help text or comments → rewrite to reference Cloudflare
- `studioMode`/`studioCheckTimer` → delete entirely (Connect Studio state removed in Step 1)

After cleanup, re-run the greps to confirm zero matches, then amend the commit:

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add skills/vibes/templates/editor.html && git commit --amend --no-edit
```

---

### Task 7: Clean Up WebSocket Handlers -- Remove Studio Deploy

The `ws-dispatch.js` file still has a `deploy-studio` entry in its dispatch table, and `deploy.js` still exports `handleDeployStudio`. The editor.html WebSocket message handler still processes `studio-progress`, `studio-complete`, and `studio-error` messages. All of these reference removed Connect Studio functionality.

**Files:**
- Modify: `scripts/server/ws-dispatch.js`
- Modify: `scripts/server/handlers/deploy.js`
- Modify: `skills/vibes/templates/editor.html` (WS message handlers)

**Step 1: Remove `deploy-studio` from ws-dispatch.js**

In `scripts/server/ws-dispatch.js`:

1. Search for the import line `import { handleDeploy, handleDeployStudio } from './handlers/deploy.js';` and change it to:
   ```javascript
   import { handleDeploy } from './handlers/deploy.js';
   ```

2. Search for `'deploy-studio':` in the dispatch table and delete that entire line:
   ```javascript
   // DELETE this line:
   'deploy-studio':  (msg) => handleDeployStudio(ctx, onEvent, msg.studioName, msg.clerkPublishableKey, msg.clerkSecretKey),
   ```

**Step 2: Remove `handleDeployStudio` from deploy.js**

In `scripts/server/handlers/deploy.js`:

1. Search for `export async function handleDeployStudio` and delete the entire function (from the `/**` comment above it through its final closing `}`).

2. Also update `handleDeploy` to remove the exe.dev target. Search for the target validation at the top of `handleDeploy`:
   ```javascript
   if (!target || (target !== 'cloudflare' && target !== 'exe')) {
   ```
   Replace with:
   ```javascript
   if (!target || target !== 'cloudflare') {
     onEvent({ type: 'error', message: 'Invalid deploy target. Use "cloudflare".' });
   ```

3. Search for the `deployScript` selection block that chooses between `deploy-cloudflare.js` and `deploy-exe.js`. Replace it with:
   ```javascript
   const deployScript = join(ctx.projectRoot, 'scripts/deploy-cloudflare.js');
   const deployArgs = ['--name', appName, '--file', indexHtmlPath];
   ```

**Step 3: Remove studio WS message handlers from editor.html**

In `skills/vibes/templates/editor.html`, search for `msg.type === 'studio-progress'`. Delete the three consecutive `else if` blocks for `studio-progress`, `studio-complete`, and `studio-error`. Specifically, delete from:
```javascript
      } else if (msg.type === 'studio-progress') {
```
through:
```javascript
        if (hint) { hint.textContent = msg.message; hint.style.color = 'var(--vibes-red)'; }
      }
```

These blocks reference DOM elements (`studioDeployLog`, `studioDeployBtn`, `wizardNewStudioName`, `wizardDeployHint`) that no longer exist and functions (`updateStudioNextButton`) that were deleted.

**Step 4: Run tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/server/ws-dispatch.js scripts/server/handlers/deploy.js skills/vibes/templates/editor.html && git commit -m "Remove Connect Studio deploy from WebSocket handlers

Delete deploy-studio dispatch entry, handleDeployStudio function,
and studio-progress/complete/error WS message handlers in editor.
Deploy handler now only supports Cloudflare target."
```

---

### Task 8: Inject Registry Credentials and Re-assemble Before Deploy

Two gaps exist in the deploy flow:

1. **Cloudflare credentials:** The wizard stores Cloudflare Global API Key in the registry, but `deploy-cloudflare.js` spawns `wrangler` via `process.env`. If the user authenticated via the wizard (rather than `wrangler login`), wrangler won't find credentials.

2. **Connect URLs:** Task 4 relaxed the assembly gate so apps can build without Connect URLs. But after alchemy provisions Connect on the first deploy, the assembled `index.html` still has empty sync URLs. There is no re-assembly step. **Note:** The migration plan's `deploy-cloudflare.js` modifications handle the alchemy provisioning and URL population. However, for deployments triggered through the editor (which use `handleDeploy` in `deploy.js`), we need to inject any available Connect URLs from the registry into the assembly environment so subsequent deploys produce a fully-populated `index.html`.

The fix: in `scripts/server/handlers/deploy.js`, read credentials from the registry and inject them into both the assembly and deploy subprocess environments.

**Files:**
- Modify: `scripts/server/handlers/deploy.js`

**Step 1: Add registry import to deploy.js**

At the top of `scripts/server/handlers/deploy.js`, after the existing imports, add:

```javascript
import { getCloudflareCredentials, getConnectUrls, getClerkCredentials } from '../registry-adapter.js';
```

(Relative path: `scripts/server/handlers/deploy.js` → `scripts/server/registry-adapter.js` = `../registry-adapter.js`)

**Step 2: Create a helper that builds the enriched env**

After the imports, add a helper function:

```javascript
/**
 * Build subprocess environment with registry credentials injected.
 * Assembly needs Clerk + Connect URLs; deploy needs Cloudflare creds.
 */
function buildDeployEnv(appName) {
  const env = { ...process.env };

  // Inject Cloudflare credentials from registry (for wrangler)
  if (!env.CLOUDFLARE_API_KEY || !env.CLOUDFLARE_EMAIL) {
    const cfCreds = getCloudflareCredentials();
    if (cfCreds.apiKey) env.CLOUDFLARE_API_KEY = cfCreds.apiKey;
    if (cfCreds.email) env.CLOUDFLARE_EMAIL = cfCreds.email;
  }

  // Inject Connect URLs from registry (for assembly)
  // These are populated by alchemy after first deploy — may still be empty on first deploy
  const connect = getConnectUrls(appName);
  if (connect.apiUrl && !env.VITE_API_URL) {
    env.VITE_API_URL = connect.apiUrl;
  }
  if (connect.cloudUrl && !env.VITE_CLOUD_URL) {
    env.VITE_CLOUD_URL = connect.cloudUrl;
  }

  // Inject Clerk key from registry (in case .env doesn't have it)
  const clerk = getClerkCredentials();
  if (clerk.publishableKey && !env.VITE_CLERK_PUBLISHABLE_KEY) {
    env.VITE_CLERK_PUBLISHABLE_KEY = clerk.publishableKey;
  }

  return env;
}
```

**Step 3: Use enriched env for both assembly and deploy subprocesses**

Search for the block in `handleDeploy` where the assembly child process is spawned (the one that runs `assemble.js`). Replace its `env: { ...process.env },` with:

```javascript
      env: buildDeployEnv(appName),
```

Then find the deploy child process spawn (the one that runs `deploy-cloudflare.js`). Replace its `env: { ...process.env },` with:

```javascript
      env: buildDeployEnv(appName),
```

Using the same helper for both ensures assembly gets Connect URLs (if available from a previous deploy) and the deploy process gets Cloudflare credentials.

**Step 4: Verify no syntax errors**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && node -e "import('./server/handlers/deploy.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`
Expected: "OK" (no import errors)

**Step 5: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/server/handlers/deploy.js && git commit -m "Inject registry credentials into assembly and deploy subprocesses

Build enriched env from registry for both assembly (Clerk key,
Connect URLs) and deploy (Cloudflare API key/email). Connect URLs
from previous deploys are injected into assembly so subsequent
deploys produce fully-populated index.html. First deploy may still
have empty Connect URLs — alchemy provisions them at deploy time."
```

---

### Task 9: Add CSS for Wizard Validation Spinner

Small CSS additions to support the new wizard layout. The existing `.wizard-*` styles mostly work, but we need a validation spinner style.

**Files:**
- Modify: `skills/vibes/templates/editor.html` (CSS section)

**Step 1: Add validation spinner CSS**

Search for `.wizard-radio.selected` in the CSS section. After the `.wizard-radio` style block, add:

```css
    .wizard-checking {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(0,0,0,0.1);
      border-top-color: var(--vibes-blue);
      border-radius: 50%;
      animation: wizardSpin 0.8s linear infinite;
    }
    @keyframes wizardSpin {
      to { transform: rotate(360deg); }
    }
```

**Step 2: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add skills/vibes/templates/editor.html && git commit -m "Add CSS for wizard validation spinner"
```

---

### Task 10: Update SessionStart Hook for Registry Detection

The session-start hook currently checks for `.env` with Clerk keys and Connect URLs. Update it to check the registry.

**Files:**
- Modify: `hooks/session-start.sh`
- Modify: `hooks/session-context.md`

**Step 1: Update session-start.sh project state detection**

Search for `# Detect project state and build dynamic hints` in `hooks/session-start.sh`. Replace everything from that comment through the `index.html` detection block (ending at the `fi` before the `# Escape for JSON` comment) with:

```bash
# Detect project state and build dynamic hints
state_hints=""

REGISTRY="$HOME/.vibes/deployments.json"
if [ -f "$REGISTRY" ]; then
    # Check for Cloudflare credentials
    has_cf=false
    if grep -q '"apiKey"' "$REGISTRY" 2>/dev/null; then
        has_cf=true
    fi

    # Check for Clerk credentials
    has_clerk=false
    if grep -q '"publishableKey"' "$REGISTRY" 2>/dev/null; then
        has_clerk=true
    fi

    if [ "$has_cf" = true ] && [ "$has_clerk" = true ]; then
        state_hints=$'\n\n## Project State\nVibes registry found with Clerk and Cloudflare credentials — ready to generate and deploy.'
    elif [ "$has_clerk" = true ]; then
        state_hints=$'\n\n## Project State\nVibes registry has Clerk keys but no Cloudflare credentials. Run the editor setup wizard or add Cloudflare Global API Key.'
    else
        state_hints=$'\n\n## Project State\nVibes registry exists but is missing credentials. Run the editor setup wizard.'
    fi
elif [ -f "${PWD}/.env" ]; then
    has_clerk_keys=false
    if grep -q "VITE_CLERK_PUBLISHABLE_KEY=pk_" "${PWD}/.env" 2>/dev/null; then
        has_clerk_keys=true
    fi
    if [ "$has_clerk_keys" = true ]; then
        state_hints=$'\n\n## Project State\nLegacy .env found with Clerk keys. Run the editor to set up Cloudflare deploy.'
    else
        state_hints=$'\n\n## Project State\n.env found but missing Clerk keys. Run the editor setup wizard.'
    fi
else
    state_hints=$'\n\n## Project State\nNo credentials found. Run the editor setup wizard to configure Clerk and Cloudflare.'
fi

if [ -f "${PWD}/app.jsx" ]; then
    state_hints="${state_hints}"$'\napp.jsx exists — invoke the matching build skill (/vibes:vibes or /vibes:sell) to reassemble.'
fi

if [ -f "${PWD}/index.html" ]; then
    if grep -q "TenantProvider" "${PWD}/index.html" 2>/dev/null; then
        state_hints="${state_hints}"$'\nindex.html exists (sell template) — reassemble with /vibes:sell, deploy with /vibes:cloudflare.'
    else
        state_hints="${state_hints}"$'\nindex.html exists (vibes template) — reassemble with /vibes:vibes, deploy with /vibes:cloudflare.'
    fi
fi
```

**Step 2: Update session-context.md dispatch table**

In `hooks/session-context.md`, find the `## Skill Dispatch` table. Make these changes:

Remove these rows:
```
| "deploy" / "put it online" (exe.dev) | `/vibes:exe` |
| "set up sync" / "Connect" / "cloud backend" | `/vibes:connect` |
```

Replace with:
```
| "deploy" / "put it online" | `/vibes:cloudflare` |
```

Also update the `## Workflow` section. Search for the paragraph containing `.env with Clerk keys + Connect URLs must exist`. Replace it with:
```
Clerk keys and Cloudflare credentials must exist before deploying.
If missing, run the editor setup wizard. Connect deploys automatically on first app deploy.
```

Also search for `If missing, invoke `/vibes:connect` first.` and delete that line if it still exists.

**Step 3: Test the hook**

Run: `echo '{}' | bash /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/hooks/session-start.sh`
Expected: Valid JSON with `additionalContext` field, no errors

**Step 4: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add hooks/session-start.sh hooks/session-context.md && git commit -m "Update SessionStart hook for registry-based credential detection

Check ~/.vibes/deployments.json for Clerk and Cloudflare credentials.
Remove /vibes:connect and /vibes:exe from dispatch table."
```

---

### Task 11: Integration Test -- Full Wizard Flow

Write an integration test that exercises the complete wizard flow: status check, Clerk save, Cloudflare validate, and final status.

**Files:**
- Create: `scripts/__tests__/integration/wizard-flow.test.js`

**Step 1: Write the integration test**

```javascript
// scripts/__tests__/integration/wizard-flow.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `vibes-wizard-flow-${Date.now()}`);
const PROJECT_DIR = join(TEST_DIR, 'project');

describe('wizard flow integration', () => {
  let adapter;

  beforeEach(async () => {
    mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
    mkdirSync(PROJECT_DIR, { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    vi.resetModules();
    adapter = await import('../../server/registry-adapter.js');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  it('starts with empty status', () => {
    const status = adapter.getSetupStatus();
    expect(status.clerk.ok).toBe(false);
    expect(status.cloudflare.ok).toBe(false);
  });

  it('step 2: saving Clerk credentials updates status', () => {
    adapter.saveClerkCredentials({
      publishableKey: 'pk_test_abc123',
      secretKey: 'sk_test_xyz789',
    });

    const status = adapter.getSetupStatus();
    expect(status.clerk.ok).toBe(true);
    expect(status.cloudflare.ok).toBe(false);
  });

  it('step 3: saving Cloudflare credentials updates status', () => {
    adapter.saveClerkCredentials({
      publishableKey: 'pk_test_abc123',
      secretKey: 'sk_test_xyz789',
    });
    adapter.saveCloudflareCredentials({
      apiKey: 'globalkey123456789012345678901234567',
      email: 'user@example.com',
    });

    const status = adapter.getSetupStatus();
    expect(status.clerk.ok).toBe(true);
    expect(status.cloudflare.ok).toBe(true);
  });

  it('registry file is created on first save with secure permissions', () => {
    adapter.saveClerkCredentials({
      publishableKey: 'pk_test_abc',
      secretKey: 'sk_test_xyz',
    });

    const regPath = join(TEST_DIR, '.vibes', 'deployments.json');
    expect(existsSync(regPath)).toBe(true);

    const reg = JSON.parse(readFileSync(regPath, 'utf8'));
    expect(reg.version).toBe(1);
    expect(Object.keys(reg.apps).length).toBeGreaterThan(0);

    // Verify 0o600 permissions
    const stat = statSync(regPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('credentials survive registry reload', () => {
    adapter.saveClerkCredentials({
      publishableKey: 'pk_test_persist',
      secretKey: 'sk_test_persist',
    });
    adapter.saveCloudflareCredentials({
      apiKey: 'persist_key_12345678901234567890',
      email: 'persist@test.com',
    });

    const status = adapter.getSetupStatus();
    expect(status.clerk.ok).toBe(true);
    expect(status.cloudflare.ok).toBe(true);

    const creds = adapter.getClerkCredentials();
    expect(creds.publishableKey).toBe('pk_test_persist');

    const cf = adapter.getCloudflareCredentials();
    expect(cf.email).toBe('persist@test.com');
  });
});
```

**Step 2: Run the test**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run __tests__/integration/wizard-flow.test.js`
Expected: PASS

**Step 3: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/__tests__/integration/wizard-flow.test.js && git commit -m "Add integration test for wizard credential flow

Tests complete wizard lifecycle: empty status -> save Clerk ->
save Cloudflare -> verify status shows both OK. Validates 0o600
file permissions on registry."
```

---

### Task 12: Run Full Test Suite and Fix Regressions

**Step 1: Run all tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run`

**Step 2: Fix any failures**

Common issues to watch for:
- Tests that import from `editor-api.js` and expect the old `saveCredentials` payload format (old keys: `VITE_CLERK_PUBLISHABLE_KEY`, new keys: `clerkPublishableKey`)
- Tests that reference `deployTargets`, `sshAvailable`, or Connect Studio
- Tests that check for status response fields like `connect`, `ssh`, or `wrangler` (now replaced by `cloudflare`)
- Tests that import `handleDeployStudio` from `deploy.js`

Fix each failing test to match the new API contract.

**Step 3: Run structural fixture tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npm run test:fixtures`
Expected: PASS

**Step 4: Test the hook output**

Run: `echo '{}' | bash /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/hooks/session-start.sh`
Expected: Valid JSON, no errors

**Step 5: Commit any test fixes**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add -A && git commit -m "Fix test regressions from onboarding wizard changes"
```

---

### Task 13: Update CLAUDE.md Workflow Sequence

CLAUDE.md contains the authoritative Workflow Sequence that agents follow. It still documents the old `CR → CO → G → A → D → V` flow with Connect as a mandatory step. Since CLAUDE.md instructions override default behavior, future agents will enforce the old flow unless this is updated.

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the Workflow Sequence diagram**

Search for the Workflow Sequence section. Find the dependency graph:
```
CR (credentials) → CO (connect) → G (generate) → A (assemble) → D (deploy) → V (verify)
```

Replace it with:
```
CR (credentials) → G (generate) → A (assemble) → D (deploy + auto-connect) → V (verify)
```

**Step 2: Update the hard rules**

Find and replace the hard rules block:
```
**Hard rules:**
- Deploy is mandatory — Clerk auth requires a public URL. No local-only path.
- Connect is always required — no value in local-only Fireproof.
- Iterate loop always includes re-deploy: edit app.jsx → A → D → V.
```

Replace with:
```
**Hard rules:**
- Deploy is mandatory — Clerk auth requires a public URL. No local-only path.
- Connect auto-deploys on first app deploy (via alchemy). No manual Connect step.
- Iterate loop always includes re-deploy: edit app.jsx → A → D → V.
```

**Step 3: Update the Node registry table**

Remove the CO row entirely:
```
| CO | CONNECT | Clerk PK+SK | .env with API_URL+CLOUD_URL | CR | .env has VITE_API_URL |
```

Update the A (ASSEMBLE) row prereqs from `G + CO` to `G + CR`:
```
| A | ASSEMBLE | app.jsx + .env [+ sell config] | index.html | G + CR; SaaS: + S | -- |
```

Update the SaaS assembly prereq similarly: `G + CR + S → A`.

**Step 4: Update the Hard dependencies block**

Find:
```
CR → CO       Connect needs Clerk keys
CO → G        Generate needs Connect configured
G + CO → A    Assembly needs app.jsx + .env
G + CO + S → A  SaaS assembly needs all three
```

Replace with:
```
CR → G        Generate needs Clerk key
G + CR → A    Assembly needs app.jsx + Clerk key
G + CR + S → A  SaaS assembly needs all three
A → D         Deploy needs index.html (Connect auto-provisions on first deploy)
```

**Step 5: Update the Connect Studio Environment section**

Search for `### Connect Studio Environment`. This section documents `VITE_API_URL` and `VITE_CLOUD_URL` for manual Studio setup. Add a note at the top:

```
> **Note:** With the new onboarding wizard, Connect auto-deploys via alchemy on first app deploy. The manual Studio configuration below is only needed for advanced/custom Connect setups.
```

**Step 6: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add CLAUDE.md && git commit -m "Update CLAUDE.md workflow sequence for auto-connect architecture

Remove CO (connect) node from dependency graph. Connect now
auto-deploys via alchemy on first app deploy. Assembly only
requires Clerk key — Connect URLs populated at deploy time."
```

---

### Task 14: Verification Checklist

**Before claiming complete, verify all of these:**

- [ ] `cd scripts && npx vitest run` -- all tests pass
- [ ] `cd scripts && npm run test:fixtures` -- structural tests pass
- [ ] `echo '{}' | bash hooks/session-start.sh` -- valid JSON output
- [ ] No references to `checkSetup` function in editor.html JS (deleted; references removed DOM elements)
- [ ] No references to `studioMode` or `studioCheckTimer` in editor.html JS
- [ ] No references to `wizardStep5` in editor.html HTML
- [ ] No references to `deployTargets` in editor.html JS (replaced by `cloudflareReady`)
- [ ] No references to `checkStudio` route in routes.js
- [ ] No references to `handleDeployStudio` in ws-dispatch.js or deploy.js
- [ ] No `studio-progress`, `studio-complete`, or `studio-error` handlers in editor.html WS message block
- [ ] No `deploy-studio` entry in ws-dispatch.js dispatch table
- [ ] Wizard shows exactly 4 progress dots (not 5)
- [ ] `/editor/status` returns `clerk` and `cloudflare` fields (not `connect`, `ssh`, `wrangler`)
- [ ] `/editor/credentials` saves to `~/.vibes/deployments.json`
- [ ] `~/.vibes/deployments.json` written with `0o600` permissions
- [ ] `/editor/credentials/validate-cloudflare` endpoint exists
- [ ] Clerk keys also written to `.env` for assembly backward compatibility
- [ ] Session context dispatch table has no `/vibes:connect` or `/vibes:exe`
- [ ] `deploy.js` `handleDeploy` injects `CLOUDFLARE_API_KEY`/`CLOUDFLARE_EMAIL` from registry into subprocess env
- [ ] `deploy.js` `handleDeploy` also injects `VITE_API_URL`/`VITE_CLOUD_URL`/`VITE_CLERK_PUBLISHABLE_KEY` from registry into assembly subprocess env
- [ ] `deploy.js` `handleDeploy` only accepts `target === 'cloudflare'` (not `exe`)
- [ ] Deploy menu in editor only shows Cloudflare option (no exe.dev button)
- [ ] `updateDeployButtons` reads `cloudflareReady` (not `deployTargets.cloudflare`)
- [ ] `toggleDeployMenu` reads `status.cloudflare?.ok` (not `status.wrangler?.ok`)
- [ ] Zero matches for: `grep -n 'deployTargets\.exe\|status\.ssh\|sshAvailable\|deployExe\|deploy-exe\|exe\.dev\|exe\.xyz\|studioMode\|studioCheckTimer' skills/vibes/templates/editor.html`
- [ ] CLAUDE.md Workflow Sequence diagram shows `CR → G → A → D(+auto-connect) → V` (no CO node)
- [ ] CLAUDE.md hard rules say "Connect auto-deploys" (not "Connect is always required")
- [ ] CLAUDE.md Node registry table has no CO row
- [ ] CLAUDE.md Hard dependencies block has no `CR → CO` or `CO → G` lines
- [ ] Registry adapter exports `getConnectUrls` function
- [ ] Registry adapter unit tests use `vi.resetModules()` in `beforeEach`
