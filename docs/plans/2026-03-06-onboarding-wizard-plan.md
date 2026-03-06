# Onboarding Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the editor's 5-step SETUP wizard (Clerk + Connect Studio + OpenRouter + Confirm) with a streamlined 4-step wizard (Welcome + Clerk + Cloudflare + Verification) that stores credentials in `~/.vibes/deployments.json` via `lib/registry.js`, validates Cloudflare credentials server-side via the Cloudflare HTTP API, and relies on `deploy-cloudflare.js`'s existing first-deploy flow (alchemy + auto-reassembly) for Connect provisioning.

**Architecture:** The editor.html SETUP phase gets a new 4-step wizard UI. Server-side, `editor-api.js` uses `lib/registry.js` directly (already imported) for credential storage. A new Cloudflare validation endpoint calls `GET /client/v4/accounts` with `X-Auth-Key`/`X-Auth-Email` headers. The `/editor/status` endpoint checks the registry instead of `.env`. Connect Studio steps are removed entirely -- `deploy-cloudflare.js` already handles first-deploy Connect provisioning via alchemy, writes Connect URLs to `.env`, and auto-reassembles.

**Tech Stack:** Vanilla JS (editor.html is a single-file SPA), Node.js HTTP server (editor-api.js), vitest for server tests

**Registry API** (`scripts/lib/registry.js` -- already exists on main):

| Function | Purpose |
|----------|---------|
| `loadRegistry()` | Load `~/.vibes/deployments.json`, returns empty registry if missing |
| `saveRegistry(reg)` | Write registry to disk (currently no `0o600` -- this plan adds it) |
| `getApp(name)` | Get app entry by name |
| `setApp(name, entry)` | Create/update app entry (adds timestamps) |
| `getCloudflareConfig()` | Get `reg.cloudflare` object (`{ accountId, workersSubdomain }`) |
| `setCloudflareConfig(config)` | Merge into `reg.cloudflare` (spread merge) |
| `isFirstDeploy(name)` | True if app has no `connect.apiUrl` |
| `validateName(name)` | Validate app name format |
| `deriveConnectUrls(url)` | Transform HTTPS URL to `{ apiUrl, cloudUrl }` |

**Schema note:** The current `cloudflare` config stores `{ accountId, workersSubdomain }`. This plan adds `apiKey` and `email` fields via `setCloudflareConfig()` (spread merge, non-breaking). These fields are used by the wizard for Cloudflare Global API Key auth and by the deploy handler to inject env vars for wrangler.

**Deploy flow note:** `deploy-cloudflare.js` reads Clerk keys from `.env` via `loadEnvFile()`, NOT from `process.env`. The wizard MUST write Clerk keys to `.env` (which it does for backward compatibility). For Cloudflare auth, wrangler natively reads `CLOUDFLARE_API_KEY`/`CLOUDFLARE_EMAIL` from the process environment, so the deploy handler injects these from the registry. On first deploy, `deploy-cloudflare.js` already: (1) calls `deployConnect()` via alchemy, (2) writes Connect URLs to `.env`, (3) auto-reassembles `index.html` if `app.jsx` exists. This means **no re-assembly logic is needed in the editor's deploy handler**.

**Already done on main (do NOT duplicate):** WebSocket cleanup (ws-dispatch.js has no deploy-studio), SessionStart hook update (session-start.sh checks registry), CLAUDE.md workflow sequence update (no CO node, auto-connect language).

**Important note on line references:** This plan never references specific line numbers because tasks edit the same files sequentially, causing line shifts. Instead, all edit locations are identified by function names, HTML element IDs, or search patterns. Use your editor's search to find each target.

---

### Task 1: Add `0o600` Permissions to `lib/registry.js` and Extend Schema

The registry file will now store a Cloudflare Global API Key, which grants full account access. The file MUST be written with `0o600` permissions (owner read/write only). Also add `apiKey` and `email` to the Cloudflare config schema documentation.

**Files:**
- Modify: `scripts/lib/registry.js`
- Test: `scripts/__tests__/unit/registry-permissions.test.js`

**Step 1: Write test for file permissions**

```javascript
// scripts/__tests__/unit/registry-permissions.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `vibes-reg-perms-${Date.now()}`);

describe('registry file permissions', () => {
  let registry;

  beforeEach(async () => {
    vi.resetModules();
    mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    registry = await import('../../lib/registry.js');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  it('writes registry file with 0o600 permissions', () => {
    registry.saveRegistry({ version: 1, cloudflare: {}, apps: {} });
    const regPath = join(TEST_DIR, '.vibes', 'deployments.json');
    const stat = statSync(regPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('preserves 0o600 when updating existing registry', () => {
    registry.saveRegistry({ version: 1, cloudflare: {}, apps: {} });
    registry.setCloudflareConfig({ apiKey: 'test', email: 'test@test.com' });
    const regPath = join(TEST_DIR, '.vibes', 'deployments.json');
    const stat = statSync(regPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('stores apiKey and email in cloudflare config', () => {
    registry.setCloudflareConfig({ apiKey: 'key123', email: 'user@test.com' });
    const config = registry.getCloudflareConfig();
    expect(config.apiKey).toBe('key123');
    expect(config.email).toBe('user@test.com');
  });

  it('preserves existing cloudflare fields when adding new ones', () => {
    registry.setCloudflareConfig({ accountId: 'acct-123' });
    registry.setCloudflareConfig({ apiKey: 'key123', email: 'user@test.com' });
    const config = registry.getCloudflareConfig();
    expect(config.accountId).toBe('acct-123');
    expect(config.apiKey).toBe('key123');
    expect(config.email).toBe('user@test.com');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run __tests__/unit/registry-permissions.test.js`
Expected: FAIL -- permissions test fails (currently writes with default 0o644)

**Step 3: Add `0o600` to `saveRegistry` and update schema docs**

In `scripts/lib/registry.js`:

1. Add `chmodSync` to the import. Change:
   ```javascript
   import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
   ```
   to:
   ```javascript
   import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
   ```

2. In `saveRegistry()`, add `{ mode: 0o600 }` to the `writeFileSync` call and a `chmodSync` fallback. Replace the entire function:
   ```javascript
   export function saveRegistry(reg) {
     const dir = join(getVibesHome(), '.vibes');
     mkdirSync(dir, { recursive: true });
     const path = getRegistryPath();
     writeFileSync(path, JSON.stringify(reg, null, 2), { mode: 0o600 });
     // Also chmod in case the file already existed with broader permissions
     try { chmodSync(path, 0o600); } catch { /* best effort */ }
   }
   ```

3. Update the schema JSDoc comment at the top of the file. Change:
   ```
    *   "cloudflare": { "accountId": "...", "workersSubdomain": "..." },
   ```
   to:
   ```
    *   "cloudflare": {
    *     "accountId": "...", "workersSubdomain": "...",
    *     "apiKey": "...", "email": "..."
    *   },
   ```

**Step 4: Run test to verify it passes**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run __tests__/unit/registry-permissions.test.js`
Expected: PASS

**Step 5: Run full test suite to check for regressions**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/lib/registry.js scripts/__tests__/unit/registry-permissions.test.js && git commit -m "Add 0o600 permissions to registry and extend cloudflare schema

Registry now stores Cloudflare Global API Key (full account access),
so file must be owner-readable only. Also documents apiKey/email
fields in cloudflare config (used by wizard, non-breaking via spread)."
```

---

### Task 2: Add Cloudflare Validation Endpoint to Editor API

Add a `POST /editor/credentials/validate-cloudflare` endpoint that validates Cloudflare Global API Key + email by calling the Cloudflare HTTP API directly (`GET /client/v4/accounts` with `X-Auth-Key`/`X-Auth-Email` headers). Uses Node's built-in `fetch()` (Node 18+). Does NOT shell out to `wrangler whoami` (modern wrangler may not authenticate with Global API Key env vars).

**Files:**
- Modify: `scripts/server/handlers/editor-api.js`
- Modify: `scripts/server/routes.js`
- Test: `scripts/__tests__/unit/editor-api-cloudflare.test.js`

**Step 1: Write failing test for Cloudflare validation**

```javascript
// scripts/__tests__/unit/editor-api-cloudflare.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('validateCloudflareCredentials', () => {
  let validateCloudflareCredentials;
  let originalFetch;

  beforeEach(async () => {
    vi.resetModules();
    originalFetch = globalThis.fetch;
    const mod = await import('../../server/handlers/editor-api.js');
    validateCloudflareCredentials = mod.validateCloudflareCredentials;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns valid with account ID when API responds with success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        result: [{ id: 'abc123def456789012345678abcdef00', name: 'My Account' }],
      }),
    });

    const result = await validateCloudflareCredentials('testkey', 'user@test.com');
    expect(result.valid).toBe(true);
    expect(result.accountId).toBe('abc123def456789012345678abcdef00');
  });

  it('returns invalid when API responds with auth error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({
        success: false,
        errors: [{ code: 9103, message: 'Unknown X-Auth-Key or X-Auth-Email' }],
      }),
    });

    const result = await validateCloudflareCredentials('badkey', 'bad@test.com');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('sends correct auth headers', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, result: [{ id: 'abc123' }] }),
    });

    await validateCloudflareCredentials('mykey', 'me@test.com');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Auth-Key': 'mykey',
          'X-Auth-Email': 'me@test.com',
        }),
      }),
    );
  });

  it('returns invalid when fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await validateCloudflareCredentials('key', 'email@test.com');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/network|failed/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run __tests__/unit/editor-api-cloudflare.test.js`
Expected: FAIL -- `validateCloudflareCredentials` is not exported

**Step 3: Add `validateCloudflareCredentials` to editor-api.js**

In `scripts/server/handlers/editor-api.js`, add this function after the `runCommand` function:

```javascript
/**
 * Validate Cloudflare Global API Key + email via the Cloudflare HTTP API.
 * Calls GET /client/v4/accounts with X-Auth-Key/X-Auth-Email headers.
 *
 * @param {string} apiKey - Cloudflare Global API Key
 * @param {string} email - Cloudflare account email
 * @returns {Promise<{valid: boolean, accountId?: string, error?: string}>}
 */
export async function validateCloudflareCredentials(apiKey, email) {
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
      headers: {
        'X-Auth-Key': apiKey,
        'X-Auth-Email': email,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();

    if (!data.success || !res.ok) {
      const errMsg = data.errors?.[0]?.message || 'Authentication failed';
      return { valid: false, error: errMsg + '. Check your Global API Key and email.' };
    }

    const accountId = data.result?.[0]?.id || null;
    if (!accountId) {
      return { valid: false, error: 'No accounts found for this API key.' };
    }

    return { valid: true, accountId };
  } catch (err) {
    return { valid: false, error: 'Failed to reach Cloudflare API: ' + err.message };
  }
}
```

**Step 4: Add the route handler for validation**

Also in `editor-api.js`, add this route handler after `validateCloudflareCredentials`:

```javascript
export async function validateCloudflare(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    const { apiKey, email } = body;
    if (!apiKey || !email) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ valid: false, error: 'API key and email are required.' }));
    }
    const result = await validateCloudflareCredentials(apiKey, email);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ valid: false, error: err.message }));
  }
}
```

**Step 5: Add route to routes.js**

In `scripts/server/routes.js`, add to the route table (after the `check-studio` line which will be removed in Task 3):
```javascript
  'POST /editor/credentials/validate-cloudflare': editorApi.validateCloudflare,
```

**Step 6: Run test to verify it passes**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run __tests__/unit/editor-api-cloudflare.test.js`
Expected: PASS

**Step 7: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/server/handlers/editor-api.js scripts/server/routes.js scripts/__tests__/unit/editor-api-cloudflare.test.js && git commit -m "Add Cloudflare credential validation via HTTP API

New validateCloudflareCredentials() calls GET /client/v4/accounts
with X-Auth-Key/X-Auth-Email headers. More reliable than wrangler
whoami which may not support Global API Key env vars."
```

---

### Task 3: Update `/editor/status` and `/editor/credentials` Endpoints

Replace the current `.env`-based status check with registry-based checks. Replace the save-to-`.env` logic with save-to-registry logic. The save handler also writes Clerk keys to `.env` for backward compatibility (required by `deploy-cloudflare.js` which reads via `loadEnvFile()`). Remove the Connect Studio check route.

**Files:**
- Modify: `scripts/server/handlers/editor-api.js` (functions `checkEditorDeps`, `saveCredentials`, remove `checkStudio`)
- Modify: `scripts/server/routes.js` (remove check-studio route)

**Step 1: Update imports in editor-api.js**

The file currently has:
```javascript
import { loadRegistry } from '../../lib/registry.js';
```

Expand this to include the functions we need:
```javascript
import { loadRegistry, getCloudflareConfig, setCloudflareConfig, getApp, setApp } from '../../lib/registry.js';
```

**Step 2: Replace `checkEditorDeps` function**

Search for `async function checkEditorDeps(ctx)` and replace the entire function (through its closing `}` -- it ends just before `// --- Route handlers ---`) with:

```javascript
async function checkEditorDeps(ctx) {
  // Check Clerk from registry (most recent app entry)
  const reg = loadRegistry();
  const apps = Object.values(reg.apps);
  let clerkOk = false;
  let clerkDetail = 'No Clerk keys configured';
  if (apps.length > 0) {
    apps.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const latest = apps[0];
    const pk = latest.clerk?.publishableKey || '';
    clerkOk = pk.startsWith('pk_test_') || pk.startsWith('pk_live_');
    if (clerkOk) clerkDetail = `${pk.slice(0, 12)}...`;
  }

  // Also check .env for backward compat (deploy-cloudflare.js reads from .env)
  if (!clerkOk) {
    const env = loadEnvFile(ctx.projectRoot);
    const envKey = env.VITE_CLERK_PUBLISHABLE_KEY || '';
    if (validateClerkKey(envKey)) {
      clerkOk = true;
      clerkDetail = `${envKey.slice(0, 12)}... (from .env)`;
    }
  }

  // Check Cloudflare from registry
  const cfConfig = getCloudflareConfig();
  const cfOk = !!(cfConfig.apiKey && cfConfig.email);
  const cfDetail = cfOk ? cfConfig.email : 'No Cloudflare credentials configured';

  // OpenRouter from .env (unchanged -- per-project, not global)
  const orKey = loadOpenRouterKey(ctx.projectRoot);
  const openrouterOk = !!orKey;

  return {
    clerk: { ok: clerkOk, detail: clerkDetail },
    cloudflare: { ok: cfOk, detail: cfDetail },
    openrouter: {
      ok: openrouterOk,
      detail: openrouterOk ? `sk-or-...${orKey.slice(-6)}` : 'No OPENROUTER_API_KEY in .env',
    },
  };
}
```

**Step 3: Replace `saveCredentials` function**

Search for `export async function saveCredentials` and replace the entire function with:

```javascript
export async function saveCredentials(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    const errors = {};

    // --- Clerk credentials ---
    if (body.clerkPublishableKey || body.clerkSecretKey) {
      const pk = body.clerkPublishableKey || '';
      const sk = body.clerkSecretKey || '';

      if (pk && !validateClerkKey(pk)) {
        errors.clerkPublishableKey = 'Invalid Clerk publishable key (must start with pk_test_ or pk_live_)';
      }
      if (sk && !validateClerkSecretKey(sk)) {
        errors.clerkSecretKey = 'Invalid Clerk secret key (must start with sk_test_ or sk_live_)';
      }

      if (!errors.clerkPublishableKey && !errors.clerkSecretKey && (pk || sk)) {
        // Save to registry
        setApp('_default', {
          name: '_default',
          clerk: { publishableKey: pk, secretKey: sk },
        });

        // Also write to .env for backward compatibility
        // deploy-cloudflare.js reads Clerk keys from .env via loadEnvFile()
        const envVars = {};
        if (pk) envVars.VITE_CLERK_PUBLISHABLE_KEY = pk;
        if (sk) envVars.CLERK_SECRET_KEY = sk;
        writeEnvFile(ctx.projectRoot, envVars);
      }
    }

    // --- Cloudflare credentials ---
    if (body.cloudflareApiKey || body.cloudflareEmail) {
      const apiKey = body.cloudflareApiKey || '';
      const email = body.cloudflareEmail || '';

      if (apiKey && apiKey.length < 20) {
        errors.cloudflareApiKey = 'Cloudflare Global API Key appears too short';
      }
      if (email && (!email.includes('@') || !email.includes('.'))) {
        errors.cloudflareEmail = 'Invalid email address';
      }

      if (!errors.cloudflareApiKey && !errors.cloudflareEmail && (apiKey || email)) {
        const cfUpdate = {};
        if (apiKey) cfUpdate.apiKey = apiKey;
        if (email) cfUpdate.email = email;
        if (body.cloudflareAccountId) cfUpdate.accountId = body.cloudflareAccountId;
        setCloudflareConfig(cfUpdate);
      }
    }

    // --- OpenRouter key (per-project, saved to .env not registry) ---
    if (body.openRouterKey) {
      if (body.openRouterKey.startsWith('sk-or-')) {
        writeEnvFile(ctx.projectRoot, { OPENROUTER_API_KEY: body.openRouterKey });
        ctx.openRouterKey = body.openRouterKey;
        console.log('OpenRouter API key updated from wizard');
      } else {
        errors.openRouterKey = 'Invalid OpenRouter key (must start with sk-or-)';
      }
    }

    if (Object.keys(errors).length > 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, errors }));
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

**Step 4: Delete `checkStudio` function**

Search for `export async function checkStudio` and delete the entire function (from `export async function checkStudio` through its final closing `}`).

**Step 5: Remove check-studio route from routes.js**

In `scripts/server/routes.js`, delete this line from the route table:
```javascript
  'POST /editor/credentials/check-studio': editorApi.checkStudio,
```

**Step 6: Clean up unused imports in editor-api.js**

After removing `checkStudio`, the `deriveConnectUrls` import from `env-utils.js` and `execFile` from `child_process` are no longer needed by any remaining function in this file. Check if any other function uses them -- if not, remove them from the import statements:

- `deriveConnectUrls` -- only used by `checkStudio` (deleted). Remove from import.
- `validateConnectUrl` -- only used by old `saveCredentials` VITE_API_URL/VITE_CLOUD_URL handling (deleted). Remove from import.
- `execFile` from `child_process` -- used by `runCommand()`. Keep it ONLY if `runCommand` is still used by another function. Check: `runCommand` was called by the old `checkEditorDeps` for `wrangler whoami` and SSH checks. The new `checkEditorDeps` doesn't call it. If no other function calls `runCommand`, delete both `runCommand` and the `execFile` import.

**Step 7: Verify no import errors**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && node -e "import('./server/handlers/editor-api.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`
Expected: "OK"

**Step 8: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/server/handlers/editor-api.js scripts/server/routes.js && git commit -m "Update editor status/credentials to use registry

checkEditorDeps reads Clerk from registry (fallback to .env).
Cloudflare status from registry apiKey/email fields.
saveCredentials writes to registry AND .env (backward compat for
deploy-cloudflare.js which reads via loadEnvFile).
Remove checkStudio endpoint, route, and unused imports."
```

---

### Task 4: Relax Assembly Connect URL Gate

`assemble.js` currently hard-gates on both a Clerk key AND `VITE_API_URL` in `.env`. With the new architecture, Connect URLs are not available until `deploy-cloudflare.js` provisions them via alchemy on first deploy. The first-deploy flow already writes Connect URLs to `.env` and auto-reassembles. But the editor's `handleDeploy` calls `assemble.js` BEFORE `deploy-cloudflare.js`, so assembly must succeed without Connect URLs.

**Files:**
- Modify: `scripts/assemble.js`
- Modify: `scripts/assemble-sell.js` (same gate pattern)

**Step 1: Modify the Connect validation block in assemble.js**

Search for `// Validate Connect credentials` in `scripts/assemble.js`. The current code is:
```javascript
  const hasValidConnect = validateClerkKey(envVars.VITE_CLERK_PUBLISHABLE_KEY) &&
                          envVars.VITE_API_URL;
```

Replace the validation block (from that comment through the `console.log('Connect mode:` line) with:

```javascript
  // Validate Clerk key — required for all apps
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
  // by deploy-cloudflare.js on first deploy (alchemy + auto-reassembly).
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

Some tests may expect the old error message. Update any test that asserts the exact error text to match the new message.

**Step 4: Run structural fixture tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npm run test:fixtures`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/assemble.js scripts/assemble-sell.js && git commit -m "Relax assembly to not require Connect URLs

Assembly now only requires a Clerk publishable key. Connect URLs
(VITE_API_URL, VITE_CLOUD_URL) are optional at assembly time.
deploy-cloudflare.js handles first-deploy provisioning via alchemy,
writes URLs to .env, and auto-reassembles."
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

**Step 2: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add skills/vibes/templates/editor.html && git commit -m "Replace wizard HTML with new 4-step onboarding flow

Steps: Welcome -> Clerk -> Cloudflare -> Verification
Removes Connect Studio and separate OpenRouter steps."
```

---

### Task 6: Rewrite Wizard JavaScript -- State, Navigation, and Validation

Replace the wizard JS functions in editor.html. This task handles wizard state, navigation, validation functions, the save/verify flow, AND all deploy button state management that depended on the old status schema.

**Scope of exe.dev/SSH/Studio cleanup:** Beyond the targeted blocks replaced in the steps below, there are ~15 scattered references throughout editor.html. After completing all steps, run the verification grep in Step 10 to catch any survivors. Common locations for stale references:
- `renderChecklist` may contain exe.dev checklist items
- Old `saveCredentials` success callback may set `deployTargets`
- Status fetch callbacks may read `status.ssh` or `status.wrangler`
- Any `deployExe`, `deploy-exe`, or `exe.dev` string literals

**Files:**
- Modify: `skills/vibes/templates/editor.html` (JS section -- state variables, wizard functions, deploy functions, init block)

**Step 1: Update wizard state variables**

Search for `let deployTargets` in the JS section. Delete these **4 specific variable declarations** (each is a `let` statement on its own line). Search for each one individually:

1. `let deployTargets = { cloudflare: false };` -- delete this line
2. `let studioCheckTimer = null;` -- delete this line
3. `let studioMode = 'existing';` -- delete this line
4. The OLD `wizardData` declaration: `let wizardData = { clerkKey: '', clerkSecret: '', studioName: '', apiUrl: '', cloudUrl: '', openRouterKey: '' };` -- delete this line

**Keep ALL other variables unchanged**, including: `wizardStep`, `currentPhase`, `isThinking`, `ws`, `hasOpenRouterKey`, `deployMenuOpenTime`, and any others not listed above.

In place of the deleted lines, add these new declarations (insert them where `deployTargets` was):

```javascript
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

**Step 2: Replace all wizard functions**

First, search for `async function checkSetup()` -- this function references DOM elements (`setupActions`, `setupSkipBtn`) that no longer exist. Delete the entire `checkSetup` function.

Then, search for `function renderChecklist(status)` -- this is the start of the main wizard function block. Delete everything from that function through the end of `function prefillFromStatus(status) { ... }` (inclusive). The block to delete ends just before the comment `// === Phase 2: Generate ===`.

Replace the entire deleted block with the new wizard functions. (These are the same functions from the previous plan revision -- `renderChecklist`, `skipSetup`, `goToGenerate`, `setWizardStep`, `validateWizardClerkInputs`, `saveClerkAndAdvance`, `validateWizardCfInputs`, `validateAndAdvanceCf`, `renderWizardSummary`, `validateOpenRouterKey`, `saveOpenRouterKey`, `wizardFinish`, `prefillFromStatus`.) The full replacement code is identical to what was specified in previous plan rounds -- see Task 5's HTML for the DOM elements these functions reference.

Key implementation notes for the replacement functions:
- `saveClerkAndAdvance()` POSTs to `/editor/credentials` with `{ clerkPublishableKey, clerkSecretKey }` (new field names, not `VITE_CLERK_PUBLISHABLE_KEY`)
- `validateAndAdvanceCf()` POSTs to `/editor/credentials/validate-cloudflare` with `{ apiKey, email }`, then on success POSTs to `/editor/credentials` with `{ cloudflareApiKey, cloudflareEmail, cloudflareAccountId }`
- `saveOpenRouterKey()` POSTs to `/editor/credentials` with `{ openRouterKey }` and sets `hasOpenRouterKey = true` on success
- `renderChecklist(status)` checks `status.clerk?.ok` and `status.cloudflare?.ok` (not `status.wrangler` or `status.ssh`)
- `prefillFromStatus(status)` skips to step 3 if Clerk is OK but Cloudflare is not

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
      const btn = document.querySelector('#deployDropdown button');
      const rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 6) + 'px';
      menu.style.right = (window.innerWidth - rect.right + 4) + 'px';
      fetch('/editor/status').then(r => r.json()).then(status => {
        cloudflareReady = status.cloudflare?.ok || false;
        updateDeployButtons();
      }).catch(() => {});
    }
  }
```

**Step 5: Replace deploy menu HTML in `setPhase` function**

Search for `function setPhase(phase)`. Inside this function, find the template literal that contains `id="deployCf"` and `deployDropdown`. Replace the entire deploy menu HTML to remove the exe.dev button -- keep only the Cloudflare button. The deploy menu should contain a single `<button class="deploy-option" id="deployCf">` for Cloudflare Workers.

**Step 6: Replace `startDeploy` function**

Search for `function startDeploy(target)` and replace the entire function. The new version should only support `target: 'cloudflare'` and send `ws.send(JSON.stringify({ type: 'deploy', target: 'cloudflare', name }))`.

**Step 7: Update the initialization block**

Search for the status fetch in the init block (find `fetch('/editor/status').then` near the bottom of the file). Replace the `.then` callback to:
- Set `cloudflareReady = status.cloudflare?.ok || false`
- Check `status.clerk?.ok && status.cloudflare?.ok` to decide between generate phase and wizard
- Remove all references to `status.wrangler`, `status.ssh`, `deployTargets`

**Step 8: Remove studio WS message handlers**

Search for `msg.type === 'studio-progress'`. Delete the three consecutive `else if` blocks for `studio-progress`, `studio-complete`, and `studio-error`.

**Step 9: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add skills/vibes/templates/editor.html && git commit -m "Rewrite wizard JavaScript for new 4-step onboarding flow

New state management with per-credential validation tracking.
Clerk keys saved on step 2 advance. Cloudflare validated server-side.
All Connect Studio and exe.dev JS removed.
Deploy buttons simplified to Cloudflare-only with cloudflareReady flag."
```

**Step 10: Verify complete exe.dev/SSH/Studio removal**

Run these greps against editor.html. ALL must return zero matches:

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard
grep -n 'deployTargets' skills/vibes/templates/editor.html
grep -n 'status\.ssh\|status\.wrangler' skills/vibes/templates/editor.html
grep -n 'sshAvailable' skills/vibes/templates/editor.html
grep -n 'deployExe\|deploy-exe\|deploy_exe' skills/vibes/templates/editor.html
grep -n 'exe\.dev\|exe\.xyz' skills/vibes/templates/editor.html
grep -n 'studioMode\|studioCheckTimer\|checkStudio\|checkSetup' skills/vibes/templates/editor.html
grep -n 'studio-progress\|studio-complete\|studio-error' skills/vibes/templates/editor.html
grep -n 'wizardStep5' skills/vibes/templates/editor.html
```

If any matches are found, delete or replace them, then amend the commit:

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add skills/vibes/templates/editor.html && git commit --amend --no-edit
```

---

### Task 7: Inject Registry Credentials into Deploy Subprocess

The wizard stores Cloudflare credentials in the registry, but the deploy subprocess needs them in the environment. `deploy-cloudflare.js` reads Clerk keys from `.env` via `loadEnvFile()` -- the wizard already writes Clerk keys to `.env` (Task 3), so no change needed for Clerk. For Cloudflare auth, wrangler natively reads `CLOUDFLARE_API_KEY`/`CLOUDFLARE_EMAIL` from the process environment, so the deploy handler reads from the registry and injects them.

On first deploy, `deploy-cloudflare.js` already handles everything: calls `deployConnect()` via alchemy, writes Connect URLs to `.env`, auto-reassembles index.html. No re-assembly logic is needed in the editor's deploy handler.

**Files:**
- Modify: `scripts/server/handlers/deploy.js`

**Step 1: Add registry import to deploy.js**

At the top of `scripts/server/handlers/deploy.js`, after the existing imports, add:

```javascript
import { getCloudflareConfig } from '../../lib/registry.js';
```

(Relative path: `scripts/server/handlers/deploy.js` is at `scripts/server/handlers/`, registry is at `scripts/lib/` = `../../lib/registry.js`)

**Step 2: Inject Cloudflare credentials into both subprocess environments**

Search for the assembly child process spawn (the one that runs `assemble.js`). Find:
```javascript
      env: { ...process.env },
```
Replace with:
```javascript
      env: (() => {
        const env = { ...process.env };
        const cf = getCloudflareConfig();
        if (cf.apiKey && !env.CLOUDFLARE_API_KEY) env.CLOUDFLARE_API_KEY = cf.apiKey;
        if (cf.email && !env.CLOUDFLARE_EMAIL) env.CLOUDFLARE_EMAIL = cf.email;
        return env;
      })(),
```

Then find the deploy child process spawn (the one that runs `deploy-cloudflare.js`). Replace its `env: { ...process.env },` with the same IIFE block.

**Step 3: Verify no syntax errors**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && node -e "import('./server/handlers/deploy.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`
Expected: "OK"

**Step 4: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/server/handlers/deploy.js && git commit -m "Inject registry Cloudflare credentials into deploy subprocess

Read CLOUDFLARE_API_KEY/CLOUDFLARE_EMAIL from registry and inject
into both assembly and deploy subprocess environments. Clerk keys
already handled via .env (written by wizard in saveCredentials)."
```

---

### Task 8: Add CSS for Wizard Validation Spinner

Small CSS additions to support the new wizard layout.

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
    .wizard-summary-table {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin: 1rem 0;
    }
    .wizard-summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 0.75rem;
      background: rgba(0,0,0,0.03);
      border-radius: 6px;
      font-size: 0.8125rem;
    }
    .wizard-summary-key {
      font-weight: 700;
    }
    .wizard-summary-value {
      color: #666;
      font-family: monospace;
      font-size: 0.75rem;
    }
```

**Step 2: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add skills/vibes/templates/editor.html && git commit -m "Add CSS for wizard validation spinner and summary table"
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
import { mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `vibes-wizard-flow-${Date.now()}`);

describe('wizard credential flow', () => {
  let registry;

  beforeEach(async () => {
    vi.resetModules();
    mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    registry = await import('../../lib/registry.js');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  it('full lifecycle: empty -> save clerk -> save cloudflare -> verify', () => {
    // Start empty
    const initialConfig = registry.getCloudflareConfig();
    expect(initialConfig.apiKey).toBeFalsy();

    // Save Clerk credentials
    registry.setApp('_default', {
      name: '_default',
      clerk: { publishableKey: 'pk_test_abc123', secretKey: 'sk_test_xyz789' },
    });

    const app = registry.getApp('_default');
    expect(app.clerk.publishableKey).toBe('pk_test_abc123');
    expect(app.clerk.secretKey).toBe('sk_test_xyz789');

    // Save Cloudflare credentials
    registry.setCloudflareConfig({
      apiKey: 'cf-global-api-key-123',
      email: 'user@example.com',
      accountId: 'acct-456',
    });

    const cfConfig = registry.getCloudflareConfig();
    expect(cfConfig.apiKey).toBe('cf-global-api-key-123');
    expect(cfConfig.email).toBe('user@example.com');
    expect(cfConfig.accountId).toBe('acct-456');

    // Verify file permissions
    const regPath = join(TEST_DIR, '.vibes', 'deployments.json');
    const stat = statSync(regPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('preserves existing app data when adding cloudflare config', () => {
    registry.setApp('my-app', {
      name: 'my-app',
      clerk: { publishableKey: 'pk_test_abc', secretKey: 'sk_test_xyz' },
    });

    registry.setCloudflareConfig({ apiKey: 'key123', email: 'test@test.com' });

    const app = registry.getApp('my-app');
    expect(app.clerk.publishableKey).toBe('pk_test_abc');

    const cf = registry.getCloudflareConfig();
    expect(cf.apiKey).toBe('key123');
  });

  it('isFirstDeploy returns true for apps without connect URLs', () => {
    registry.setApp('new-app', {
      name: 'new-app',
      clerk: { publishableKey: 'pk_test_abc' },
    });

    expect(registry.isFirstDeploy('new-app')).toBe(true);
    expect(registry.isFirstDeploy('nonexistent')).toBe(true);
  });
});
```

**Step 2: Run the test**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run __tests__/integration/wizard-flow.test.js`
Expected: PASS

**Step 3: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add scripts/__tests__/integration/wizard-flow.test.js && git commit -m "Add integration test for wizard credential flow

Tests complete lifecycle: empty -> save Clerk -> save Cloudflare ->
verify status. Validates 0o600 file permissions on registry."
```

---

### Task 10: Run Full Test Suite and Fix Regressions

**Step 1: Run all tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npx vitest run`

**Step 2: Fix any failures**

Common issues to watch for:
- Tests that import from `editor-api.js` and expect the old `saveCredentials` payload format (old keys: `VITE_CLERK_PUBLISHABLE_KEY`, new keys: `clerkPublishableKey`)
- Tests that reference `deployTargets` or Connect Studio
- Tests that check for status response fields like `connect`, `ssh`, or `wrangler` (now replaced by `cloudflare`)
- Tests that check for the old assembly error message about `VITE_API_URL`
- Tests that import `checkStudio` from `editor-api.js`

Fix each failing test to match the new API contract.

**Step 3: Run structural fixture tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard/scripts && npm run test:fixtures`
Expected: PASS

**Step 4: Commit any test fixes**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.claude/worktrees/onboarding-wizard && git add -A && git commit -m "Fix test regressions from onboarding wizard changes"
```

---

### Task 11: Verification Checklist

**Before claiming complete, verify all of these:**

- [ ] `cd scripts && npx vitest run` -- all tests pass
- [ ] `cd scripts && npm run test:fixtures` -- structural tests pass
- [ ] No references to `checkSetup` function in editor.html JS
- [ ] No references to `studioMode` or `studioCheckTimer` in editor.html JS
- [ ] No references to `wizardStep5` in editor.html HTML
- [ ] No references to `deployTargets` in editor.html JS (replaced by `cloudflareReady`)
- [ ] No references to `checkStudio` in routes.js or editor-api.js
- [ ] No `studio-progress`, `studio-complete`, or `studio-error` handlers in editor.html
- [ ] Wizard shows exactly 4 progress dots (not 5)
- [ ] `/editor/status` returns `clerk` and `cloudflare` fields (not `connect`, `ssh`, `wrangler`)
- [ ] `/editor/credentials` saves Clerk to registry via `setApp()` AND to `.env` via `writeEnvFile()`
- [ ] `/editor/credentials` saves Cloudflare to registry via `setCloudflareConfig()`
- [ ] `~/.vibes/deployments.json` written with `0o600` permissions
- [ ] `lib/registry.js` `saveRegistry()` uses `{ mode: 0o600 }` and `chmodSync` fallback
- [ ] `/editor/credentials/validate-cloudflare` uses Cloudflare HTTP API, NOT wrangler
- [ ] `/editor/credentials/validate-cloudflare` sends `X-Auth-Key` and `X-Auth-Email` headers
- [ ] `deploy.js` injects `CLOUDFLARE_API_KEY`/`CLOUDFLARE_EMAIL` from `getCloudflareConfig()`
- [ ] Deploy menu in editor only shows Cloudflare option (no exe.dev button)
- [ ] `updateDeployButtons` reads `cloudflareReady` (not `deployTargets.cloudflare`)
- [ ] `toggleDeployMenu` reads `status.cloudflare?.ok` (not `status.wrangler?.ok`)
- [ ] Zero matches for: `grep -n 'deployTargets\|status\.ssh\|sshAvailable\|deployExe\|deploy-exe\|exe\.dev\|exe\.xyz\|studioMode\|studioCheckTimer\|checkSetup\|wizardStep5' skills/vibes/templates/editor.html`
- [ ] No `execFile`/`child_process` used for CF validation (HTTP API instead)
- [ ] Registry `cloudflare` config stores `apiKey`, `email` (compatible with existing `accountId`, `workersSubdomain`)
- [ ] Assembly succeeds with Clerk key only (no `VITE_API_URL` required)
- [ ] `deploy-cloudflare.js` first-deploy flow unchanged (handles alchemy + auto-reassembly)
- [ ] `saveCredentials` uses `clerkPublishableKey`/`clerkSecretKey` field names
- [ ] OpenRouter key saved to `.env` via `writeEnvFile()` (per-project, not to registry)
- [ ] No registry-adapter.js file created (imports directly from `lib/registry.js`)
- [ ] `editor-api.js` imports `getCloudflareConfig`, `setCloudflareConfig`, `getApp`, `setApp` from `../../lib/registry.js`
