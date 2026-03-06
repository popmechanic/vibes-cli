# Onboarding Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the editor's 5-step SETUP wizard (Clerk + Connect Studio + OpenRouter + Confirm) with a streamlined 4-step wizard (Welcome + Clerk + Cloudflare + Verification) that stores credentials in `~/.vibes/deployments.json` instead of `.env`, and validates Cloudflare credentials server-side via wrangler.

**Architecture:** The editor.html SETUP phase gets a new 4-step wizard UI. Server-side, `editor-api.js` gains registry-backed credential storage (via `lib/registry.js` from the backend migration plan) and a new Cloudflare validation endpoint that shells out to `wrangler whoami` with `CLOUDFLARE_API_KEY`/`CLOUDFLARE_EMAIL` env vars. The `/editor/status` endpoint checks the registry instead of `.env`. Connect Studio steps are removed entirely -- Connect auto-deploys via alchemy on first app deploy (handled by the separate backend migration plan).

**Tech Stack:** Vanilla JS (editor.html is a single-file SPA), Node.js HTTP server (editor-api.js), vitest for server tests

**Depends on:** `docs/plans/2026-03-05-connect-cloudflare-migration-plan.md` Tasks 1 (registry.js). This plan can begin immediately -- Task 1 here creates a minimal registry shim if the full registry.js doesn't exist yet.

---

### Task 1: Create Registry Shim for Editor API

The editor API needs to read/write `~/.vibes/deployments.json`. The full `lib/registry.js` is created by the backend migration plan (Task 1 there). This task creates a thin adapter so editor-api.js can use it, with a fallback shim if the full module doesn't exist yet.

**Files:**
- Create: `scripts/server/registry-adapter.js`
- Test: `scripts/__tests__/unit/registry-adapter.test.js`

**Step 1: Write failing test for registry adapter**

```javascript
// scripts/__tests__/unit/registry-adapter.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `vibes-reg-adapter-${Date.now()}`);

describe('registry-adapter', () => {
  let adapter;

  beforeEach(async () => {
    mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    // Force fresh import
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

```javascript
// scripts/server/registry-adapter.js
/**
 * Registry adapter for the editor API.
 *
 * Reads/writes ~/.vibes/deployments.json for credential storage.
 * Tries to import lib/registry.js (from backend migration plan);
 * falls back to inline implementation if not available yet.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function getVibesHome() {
  return process.env.VIBES_HOME || homedir();
}

function getRegistryPath() {
  return join(getVibesHome(), '.vibes', 'deployments.json');
}

function emptyRegistry() {
  return { version: 1, cloudflare: {}, apps: {} };
}

function loadRegistry() {
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

function saveRegistry(reg) {
  const dir = join(getVibesHome(), '.vibes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(getRegistryPath(), JSON.stringify(reg, null, 2));
}

/**
 * Get Cloudflare API credentials from registry.
 * @returns {{ apiKey: string|null, email: string|null, accountId: string|null }}
 */
export function getCloudflareCredentials() {
  const reg = loadRegistry();
  const cf = reg.cloudflare || {};
  return {
    apiKey: cf.apiKey || null,
    email: cf.email || null,
    accountId: cf.accountId || null,
  };
}

/**
 * Save Cloudflare API credentials to registry.
 * @param {{ apiKey: string, email: string, accountId?: string }} creds
 */
export function saveCloudflareCredentials(creds) {
  const reg = loadRegistry();
  reg.cloudflare = { ...reg.cloudflare, ...creds };
  saveRegistry(reg);
}

/**
 * Get Clerk credentials from the most recently updated app in registry.
 * @returns {{ publishableKey: string|null, secretKey: string|null, appName: string|null }}
 */
export function getClerkCredentials() {
  const reg = loadRegistry();
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
 * @param {{ publishableKey: string, secretKey: string, appName?: string }} creds
 */
export function saveClerkCredentials(creds) {
  const reg = loadRegistry();
  const appName = creds.appName || '_default';
  const existing = reg.apps[appName] || { name: appName };
  reg.apps[appName] = {
    ...existing,
    clerk: {
      publishableKey: creds.publishableKey,
      secretKey: creds.secretKey,
    },
    updatedAt: new Date().toISOString(),
  };
  if (!reg.apps[appName].createdAt) {
    reg.apps[appName].createdAt = new Date().toISOString();
  }
  saveRegistry(reg);
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

Reads/writes ~/.vibes/deployments.json for Clerk and Cloudflare
credentials. Used by the onboarding wizard to persist setup state."
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
      cb(null, ' ⛅️ wrangler\n\n| Account Name   | Account ID                       |\n| My Account     | abc123def456                     |', '');
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

Add these imports at the top of `scripts/server/handlers/editor-api.js` (after line 8):

```javascript
import { getSetupStatus, saveClerkCredentials, saveCloudflareCredentials, getClerkCredentials, getCloudflareCredentials } from '../registry-adapter.js';
```

Add this function after the `runCommand` function (after line 37):

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

Replace the current `.env`-based status check with registry-based checks. Replace the save-to-`.env` logic with save-to-registry logic. Add a new route for Cloudflare validation.

**Files:**
- Modify: `scripts/server/handlers/editor-api.js` (functions `status`, `saveCredentials`)
- Modify: `scripts/server/routes.js` (add new route)

**Step 1: Replace the `checkEditorDeps` function in editor-api.js**

Replace the entire `checkEditorDeps` function (lines 39-81) and `status` function (lines 85-89) with:

```javascript
async function checkEditorDeps(ctx) {
  // Check registry for credentials
  const registryStatus = getSetupStatus();

  // Also check legacy .env as fallback
  const env = loadEnvFile(ctx.projectRoot);
  const clerkKey = env.VITE_CLERK_PUBLISHABLE_KEY || '';
  const clerkOk = registryStatus.clerk.ok || validateClerkKey(clerkKey);

  const cfCreds = getCloudflareCredentials();
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

export async function status(ctx, req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const result = await checkEditorDeps(ctx);
  return res.end(JSON.stringify(result));
}
```

**Step 2: Replace the `saveCredentials` function**

Replace the entire `saveCredentials` function (lines 102-170) with:

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

Add this new handler in `editor-api.js`:

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

**Step 4: Add new route to routes.js**

In `scripts/server/routes.js`, add this line to the `routeTable` object (after line 101):

```javascript
  'POST /editor/credentials/validate-cloudflare': editorApi.validateCloudflare,
```

**Step 5: Remove the `checkStudio` route**

In `scripts/server/routes.js`, remove this line (line 100):

```javascript
  'POST /editor/credentials/check-studio': editorApi.checkStudio,
```

**Step 6: Run existing tests to check for regressions**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run`
Expected: PASS (or only pre-existing failures unrelated to this change)

**Step 7: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/server/handlers/editor-api.js scripts/server/routes.js && git commit -m "Update editor API to use registry for credential storage

- /editor/status checks ~/.vibes/deployments.json instead of .env
- /editor/credentials saves to registry (with .env fallback for assembly)
- New POST /editor/credentials/validate-cloudflare endpoint
- Remove Connect Studio check-studio endpoint"
```

---

### Task 4: Rewrite Wizard HTML -- Step 1 (Welcome) and Step 2 (Clerk)

Replace the SETUP phase HTML in editor.html. The new wizard has 4 steps instead of 5. This task handles the HTML structure and the first two steps.

**Files:**
- Modify: `skills/vibes/templates/editor.html` (lines 2293-2421 -- the entire `phaseSetup` div)

**Step 1: Replace the phaseSetup HTML**

Find the block from `<!-- Phase 1: Setup -->` (line 2292) through the closing `</div>` of `phaseSetup` (line 2421). Replace it with:

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
            OpenRouter API Key <span style="font-weight:400;color:#888;">(optional — enables AI themes)</span>
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

### Task 5: Rewrite Wizard JavaScript -- State and Navigation

Replace the wizard JS functions in editor.html. This task handles wizard state, navigation, validation functions, and the new save/verify flow.

**Files:**
- Modify: `skills/vibes/templates/editor.html` (JS section, lines ~2778-2784 for state, lines ~3157-3473 for wizard functions)

**Step 1: Update wizard state variables**

Find the state variables block (around line 2778-2787). Replace:

```javascript
  let wizardStep = 1;
  let wizardData = { clerkKey: '', clerkSecret: '', studioName: '', apiUrl: '', cloudUrl: '', openRouterKey: '' };
  let sshAvailable = false;
  let studioCheckTimer = null;
  let studioMode = 'existing';
```

With:

```javascript
  let wizardStep = 1;
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

**Step 2: Replace all wizard functions**

Find and replace the block from `function renderChecklist(status)` (line 3157) through `function prefillFromStatus(status) { ... }` (ending around line 3473). Replace it all with:

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

**Step 3: Update the initialization block**

Find the initialization block at the bottom of the script (around lines 5280-5314). Replace the status check logic:

```javascript
  setPhase('generate');
  connectWs();

  // App gallery only needs filesystem data -- load immediately
  checkExistingApps();

  // Check status -> decide setup wizard vs generate
  fetch('/editor/status').then(r => r.json()).then(status => {
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

  populateThemeSelect();
  fetch('/themes/has-key').then(r => r.json()).then(d => { hasOpenRouterKey = !!d.hasKey; }).catch(() => {});
```

**Step 4: Remove dead code**

Remove these functions that are no longer needed (search for each and delete):
- `selectStudioMode`
- `updateStudioNextButton`
- `debouncedCheckStudio`
- `checkStudio`
- `validateAdvancedUrls`
- `startStudioDeploy`
- `wizardSave` (replaced by `wizardFinish`)

Also remove the `deployTargets` state variable (line ~2779) and all references to it (search for `deployTargets`).

Also remove `sshAvailable`, `studioCheckTimer`, `studioMode` state variables.

**Step 5: Verify no JS errors**

Load editor.html in browser at localhost:3333, open dev console, confirm no errors on page load.

**Step 6: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add skills/vibes/templates/editor.html && git commit -m "Rewrite wizard JavaScript for new 4-step onboarding flow

New state management with per-credential validation tracking.
Clerk keys saved on step 2 advance. Cloudflare validated server-side
before advancing to step 3. Connect Studio logic removed entirely."
```

---

### Task 6: Update CSS for the New Wizard

Small CSS tweaks to support the new wizard layout. The existing `.wizard-*` styles mostly work, but we need to remove the 5th dot and add a validation spinner style.

**Files:**
- Modify: `skills/vibes/templates/editor.html` (CSS section, around lines 271-460)

**Step 1: Add validation spinner CSS**

After the existing `.wizard-radio` styles (around line 446), add:

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
    .wizard-step-instructions {
      background: rgba(0,154,206,0.06);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin-bottom: 1rem;
      font-size: 0.8125rem;
      line-height: 1.5;
    }
    .wizard-step-instructions ol {
      margin: 0.5rem 0 0 1.25rem;
      padding: 0;
    }
```

**Step 2: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add skills/vibes/templates/editor.html && git commit -m "Add CSS for wizard validation spinner and instruction blocks"
```

---

### Task 7: Update Deploy Button Logic

The editor's deploy buttons currently check `deployTargets.cloudflare` and `deployTargets.exe`. Since exe.dev is removed and Cloudflare is now always the target, simplify the deploy logic.

**Files:**
- Modify: `skills/vibes/templates/editor.html` (search for `deployTargets` in the JS section)

**Step 1: Find all references to `deployTargets`**

Search for `deployTargets` in the file. There will be references in:
1. State declaration
2. `renderChecklist` function (already updated in Task 5)
3. Deploy button rendering / onclick handlers
4. Status response handling

**Step 2: Replace deploy target logic**

Find the deploy button area in the edit phase. Replace any `deployTargets.cloudflare` checks with `true` (Cloudflare is always available after setup). Remove any `deployTargets.exe` references and exe.dev deploy buttons.

Specifically, search for any code like:
```javascript
if (deployTargets.cloudflare) { ... }
if (deployTargets.exe) { ... }
```
And simplify to just show the Cloudflare deploy option.

**Step 3: Test by loading the editor**

Load editor in browser. After completing the wizard, the deploy button should work without checking `deployTargets`.

**Step 4: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add skills/vibes/templates/editor.html && git commit -m "Simplify deploy buttons to Cloudflare-only

Remove exe.dev deploy target logic. Cloudflare is always the
deploy target after the onboarding wizard completes."
```

---

### Task 8: Update SessionStart Hook for Registry Detection

The session-start hook currently checks for `.env` with Clerk keys and Connect URLs. Update it to check the registry.

**Files:**
- Modify: `hooks/session-start.sh` (lines 14-49)
- Modify: `hooks/session-context.md` (dispatch table)

**Step 1: Update session-start.sh project state detection**

Replace lines 14-49 (the state detection block) with:

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

In `hooks/session-context.md`, replace the dispatch table rows for exe and connect:

Remove these rows:
```
| "deploy" / "put it online" (exe.dev) | `/vibes:exe` |
| "set up sync" / "Connect" / "cloud backend" | `/vibes:connect` |
```

Replace with:
```
| "deploy" / "put it online" | `/vibes:cloudflare` |
```

Also update the Workflow section. Replace:
```
.env with Clerk keys + Connect URLs must exist before generating apps.
If missing, invoke `/vibes:connect` first.
```
With:
```
Clerk keys and Cloudflare credentials must exist before deploying.
If missing, run the editor setup wizard. Connect deploys automatically on first app deploy.
```

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

### Task 9: Integration Test -- Full Wizard Flow

Write an integration test that exercises the complete wizard flow: status check, Clerk save, Cloudflare validate, and final status.

**Files:**
- Create: `scripts/__tests__/integration/wizard-flow.test.js`

**Step 1: Write the integration test**

```javascript
// scripts/__tests__/integration/wizard-flow.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
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

  it('registry file is created on first save', () => {
    adapter.saveClerkCredentials({
      publishableKey: 'pk_test_abc',
      secretKey: 'sk_test_xyz',
    });

    const regPath = join(TEST_DIR, '.vibes', 'deployments.json');
    expect(existsSync(regPath)).toBe(true);

    const reg = JSON.parse(readFileSync(regPath, 'utf8'));
    expect(reg.version).toBe(1);
    expect(Object.keys(reg.apps).length).toBeGreaterThan(0);
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

    // Re-import to force re-read from disk
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
save Cloudflare -> verify status shows both OK."
```

---

### Task 10: Run Full Test Suite and Fix Regressions

**Step 1: Run all tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run`

**Step 2: Fix any failures**

Common issues to watch for:
- Tests that import from `editor-api.js` and expect the old `saveCredentials` payload format
- Tests that reference `deployTargets`, `sshAvailable`, or Connect Studio
- Tests that check for `.env` status fields like `connect` or `ssh`

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

### Task 11: Verification Checklist

**Before claiming complete, verify all of these:**

- [ ] `cd scripts && npx vitest run` -- all tests pass
- [ ] `cd scripts && npm run test:fixtures` -- structural tests pass
- [ ] `echo '{}' | bash hooks/session-start.sh` -- valid JSON output
- [ ] No references to `studioMode` or `studioCheckTimer` in editor.html JS
- [ ] No references to `wizardStep5` in editor.html HTML
- [ ] No references to `deployTargets.exe` in editor.html JS
- [ ] No references to `checkStudio` route in routes.js
- [ ] Wizard shows exactly 4 progress dots (not 5)
- [ ] `/editor/status` returns `clerk` and `cloudflare` fields (not `connect`, `ssh`, `wrangler`)
- [ ] `/editor/credentials` saves to `~/.vibes/deployments.json`
- [ ] `/editor/credentials/validate-cloudflare` endpoint exists
- [ ] Clerk keys also written to `.env` for assembly backward compatibility
- [ ] Session context dispatch table has no `/vibes:connect` or `/vibes:exe`
