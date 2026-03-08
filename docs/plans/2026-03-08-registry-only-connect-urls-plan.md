# Registry-Only Connect URLs — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate `.env` as a Connect URL store; make the registry (`~/.vibes/deployments.json`) the single source of truth, with injection happening at deploy time only.

**Architecture:** `deploy-cloudflare.js` becomes the unified entry point that accepts `--app app.jsx`, assembles internally, looks up Connect URLs from the registry, injects them, and uploads. `assemble.js` becomes a pure template assembler with no `.env` or Connect awareness. `.env` file reading/writing is removed entirely.

**Tech Stack:** Bun, vitest, Cloudflare Workers Deploy API

**Design doc:** `docs/plans/2026-03-08-registry-only-connect-urls-design.md`

---

### Task 1: Strip .env reading from `assemble.js`

**Files:**
- Modify: `scripts/assemble.js:18,47-65,74`

**Step 1: Remove env-utils imports and .env reading**

In `scripts/assemble.js`, remove the `loadEnvFile` and `populateConnectConfig` imports (line 18), the entire `.env` loading block (lines 47-65), and the `populateConnectConfig` call (line 74).

Replace the import line:
```javascript
// Before:
import { loadEnvFile, populateConnectConfig } from './lib/env-utils.js';

// After: (delete the line entirely)
```

Remove the `.env` loading block (lines 47-65):
```javascript
  // DELETE these lines:
  const outputDir = dirname(resolvedOutputPath);
  let envVars = loadEnvFile(outputDir);
  if (resolve(outputDir) !== resolve(process.cwd())) {
    const cwdEnv = loadEnvFile(process.cwd());
    envVars = { ...cwdEnv, ...envVars };
  }

  if (envVars.VITE_API_URL) {
    console.log('Connect mode: OIDC auth + cloud sync enabled');
  } else {
    console.log('Connect mode: OIDC auth enabled (Connect URLs will be set at deploy time)');
  }
```

Replace with a single log line:
```javascript
  console.log('Assembling (Connect URLs will be injected at deploy time)');
```

Remove the `populateConnectConfig` call (line 74):
```javascript
  // DELETE this line:
  output = populateConnectConfig(output, envVars);
```

The `dirname` import is still needed for other logic — check before removing.

**Step 2: Run existing tests to see what breaks**

Run: `cd scripts && npm test 2>&1 | tail -30`

Expected: `assembly-pipeline.test.js` tests may fail because they create a `.env` with `VITE_API_URL`/`VITE_CLOUD_URL` and expect those to be substituted. The "no unreplaced config placeholders" test for sell templates should still pass (sell assembler is separate). The vibes assembly tests check for structure, not Connect URL values.

**Step 3: Update assembly-pipeline test**

In `scripts/__tests__/integration/assembly-pipeline.test.js`, the `createWorkDir()` function (lines 20-33) writes a `.env` with `VITE_API_URL` and `VITE_CLOUD_URL`. Since assembly no longer reads these:

1. Remove `VITE_API_URL` and `VITE_CLOUD_URL` from the `.env` creation (lines 28-29)
2. Add `__VITE_API_URL__` and `__VITE_CLOUD_URL__` to the `SAFE_PLACEHOLDERS` array (line 18) — these will remain as unsubstituted placeholders in assembly output, which is correct behavior

```javascript
// Updated createWorkDir:
function createWorkDir() {
  const dir = join(tmpdir(), `vibes-assembly-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Updated SAFE_PLACEHOLDERS — add Connect placeholders:
const SAFE_PLACEHOLDERS = ['__PURE__', '__esModule', '__VIBES_CONFIG__', '__OIDC_LOAD_ERROR__', '__VIBES_OIDC_TOKEN__', '__VIBES_SYNC_STATUS__', '__VIBES_SYNC_ERROR__', '__VIBES_SHARED_LEDGER__', '__VIBES_LEDGER_MAP__', '__VIBES_INVITE_ID__', '__VIBES_REGISTRY_URL__', '__VIBES_THEMES__', '__VIBES_THEME_PRESETS__', '__VITE_API_URL__', '__VITE_CLOUD_URL__'];
```

**Step 4: Run tests to verify**

Run: `cd scripts && npm test 2>&1 | tail -30`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add scripts/assemble.js scripts/__tests__/integration/assembly-pipeline.test.js
git commit -m "Remove .env reading from assemble.js — Connect URLs injected at deploy time"
```

---

### Task 2: Add registry lookup + URL injection to `deploy-cloudflare.js`

**Files:**
- Modify: `scripts/deploy-cloudflare.js`

**Step 1: Add registry + injection imports and --app flag**

Add imports for registry and assembly at the top of `deploy-cloudflare.js`:

```javascript
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { validateName, getApp, setApp, isFirstDeploy } from './lib/registry.js';
import { getAccessToken } from './lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from './lib/auth-constants.js';
import { PLUGIN_ROOT, TEMPLATES } from './lib/paths.js';
import { populateConnectConfig } from './lib/env-utils.js';
import { deployConnect } from './lib/alchemy-deploy.js';
```

**Step 2: Add --app flag parsing and assembly logic**

In `main()`, add `--app` flag parsing alongside existing `--file`:

```javascript
  const appIdx = args.indexOf("--app");

  if (nameIdx === -1) {
    throw new Error("Usage: deploy-cloudflare.js --name <app-name> (--app <app.jsx> | --file <index.html>) [--ai-key <key>]");
  }

  const name = validateName(args[nameIdx + 1]);
  const aiKey = aiKeyIdx !== -1 ? args[aiKeyIdx + 1] : (process.env.OPENROUTER_API_KEY || null);
```

Add assembly branch — when `--app` is provided, assemble first:

```javascript
  let htmlContent;

  if (appIdx !== -1) {
    // Assemble from app.jsx
    const appFile = resolve(process.cwd(), args[appIdx + 1]);
    if (!existsSync(appFile)) throw new Error(`App file not found: ${appFile}`);

    const { execSync } = await import('child_process');
    const tmpOutput = resolve(process.cwd(), `.vibes-tmp-${name}.html`);
    try {
      execSync(`bun ${join(PLUGIN_ROOT, 'scripts/assemble.js')} "${appFile}" "${tmpOutput}"`, {
        stdio: 'pipe',
        cwd: process.cwd(),
      });
      htmlContent = readFileSync(tmpOutput, 'utf8');
    } finally {
      // Clean up temp file
      try { const { unlinkSync } = await import('fs'); unlinkSync(tmpOutput); } catch {}
    }
    console.log('Assembled app.jsx into template');
  } else {
    // Use pre-assembled HTML file
    const file = fileIdx !== -1 ? args[fileIdx + 1] : "index.html";
    const srcFile = resolve(process.cwd(), file);
    if (!existsSync(srcFile)) throw new Error(`File not found: ${srcFile}`);
    htmlContent = readFileSync(srcFile, 'utf8');
  }
```

**Step 3: Add registry lookup + Connect URL injection**

After assembly, before building the files map, add the registry-based injection (same pattern as `deploy.ts:120-177`):

```javascript
  // --- Connect provisioning (registry is source of truth) ---
  let connectInfo = null;
  const existingApp = getApp(name);

  if (isFirstDeploy(name)) {
    console.log('\nProvisioning real-time sync (first deploy)...');
    const { randomBytes } = await import('crypto');
    let alchemyPassword = existingApp?.connect?.alchemyPassword || randomBytes(32).toString('hex');

    // Pre-save password so it survives crashes
    setApp(name, { name, connect: { alchemyPassword } });

    connectInfo = await deployConnect({
      appName: name,
      oidcAuthority: OIDC_AUTHORITY,
      oidcServiceWorkerName: 'pocket-id',
      alchemyPassword,
    });

    setApp(name, {
      name,
      connect: { ...connectInfo, deployedAt: new Date().toISOString() },
    });
    console.log(`Connect provisioned: ${connectInfo.apiUrl}`);
  } else {
    connectInfo = existingApp.connect;
    console.log(`Reusing existing Connect: ${connectInfo.apiUrl}`);
  }

  // Inject Connect URLs into HTML
  if (connectInfo?.apiUrl && connectInfo?.cloudUrl) {
    htmlContent = htmlContent.replace(
      /tokenApiUri:\s*"[^"]*"/,
      `tokenApiUri: "${connectInfo.apiUrl}"`
    );
    htmlContent = htmlContent.replace(
      /cloudBackendUrl:\s*"[^"]*"/,
      `cloudBackendUrl: "${connectInfo.cloudUrl}"`
    );
    console.log('Injected Connect URLs');
  }
```

**Step 4: Update files map to use htmlContent**

Replace the existing files-building logic to use `htmlContent` instead of reading from disk:

```javascript
  const files = {
    'index.html': htmlContent,
  };
```

Keep the existing bridge, auth cards, and favicon asset inclusion unchanged.

**Step 5: Add app metadata save after successful deploy**

After the deploy API call, save app metadata to registry (matching deploy.ts pattern):

```javascript
  const deployedUrl = result.url || `https://${name}.vibes.diy`;

  // Save app metadata to registry
  setApp(name, {
    name,
    app: { workerName: name, url: deployedUrl },
  });

  console.log(`\nDeployed to ${deployedUrl}`);
```

**Step 6: Test manually**

Run: `bun scripts/deploy-cloudflare.js --name seq --app app.jsx 2>&1`
Expected: Assembles, reads registry for Connect URLs, injects, deploys successfully.

Run: `bun scripts/deploy-cloudflare.js --name seq --file index.html 2>&1`
Expected: Reads pre-assembled HTML, injects Connect URLs from registry, deploys.

**Step 7: Commit**

```bash
git add scripts/deploy-cloudflare.js
git commit -m "Unify deploy-cloudflare.js: --app flag, registry lookup, Connect injection"
```

---

### Task 3: Strip .env reading from `assemble-sell.js` and `assemble-all.js`

**Files:**
- Modify: `scripts/assemble-sell.js:39,155-175,234`
- Modify: `scripts/assemble-all.js:16,29,52`

**Step 1: Strip from assemble-sell.js**

Remove `loadEnvFile` from the import (line 39). Keep `populateConnectConfig` — it's still called but will receive an empty env object (or be removed if the sell deploy path also handles injection).

Actually, `assemble-sell.js` already has a registry fallback (lines 158-169). Remove the `.env` reading entirely and make the registry the only source:

```javascript
// Replace lines 153-175 with:
// Connect URLs from registry (if available) — injected at deploy time
let envVars = {};
const registryAppName = options.appName || null;
if (registryAppName) {
  const { getApp } = await import('./lib/registry.js');
  const app = getApp(registryAppName);
  if (app?.connect) {
    envVars.VITE_API_URL = app.connect.apiUrl;
    envVars.VITE_CLOUD_URL = app.connect.cloudUrl;
    console.log(`Connect config: from registry (app: ${registryAppName})`);
  }
}
if (!envVars.VITE_API_URL) {
  console.log('Note: No Connect URLs — will be set at deploy time');
}
```

Remove the `loadEnvFile` import. Keep `populateConnectConfig` import since it's still used at line 234.

**Step 2: Strip from assemble-all.js**

In `scripts/assemble-all.js`, remove the `loadEnvFile` call (line 29) and pass empty object to `populateConnectConfig` (line 52):

```javascript
// Line 29 — remove:
const envVars = loadEnvFile(process.cwd());
// Replace with:
const envVars = {};

// Line 52 stays the same but now receives empty envVars
```

Remove `loadEnvFile` from the import (line 16).

**Step 3: Run tests**

Run: `cd scripts && npm test 2>&1 | tail -30`
Expected: All tests pass. The sell assembly test creates its own `.env` in the work dir — confirm it still passes since sell assembler now reads registry (which won't exist in test).

**Step 4: Commit**

```bash
git add scripts/assemble-sell.js scripts/assemble-all.js
git commit -m "Remove .env reading from sell and all assemblers"
```

---

### Task 4: Remove `editorSaveCredentials` .env writes and `loadEnvFile` usage from router

**Files:**
- Modify: `scripts/server/router.ts:13,155,344-409,568`

**Step 1: Remove writeEnvFile calls from editorSaveCredentials**

In `editorSaveCredentials` (lines 344-409):
- Lines 385-388: Remove the `writeEnvFile` call for Clerk keys (Clerk is legacy, registry already stores them)
- Lines 399-401: Remove the `writeEnvFile` call for OpenRouter. Instead, set `ctx.openRouterKey` directly (line 402 already does this). The key is only needed at runtime, not persisted.

```javascript
    // Lines 378-389 — remove writeEnvFile:
    if (hasClerk) {
      const existing = getApp('_default');
      const existingClerk = existing?.clerk || {};
      setApp('_default', {
        name: '_default',
        clerk: { publishableKey: pk || existingClerk.publishableKey || '', secretKey: sk || existingClerk.secretKey || '' },
      });
      // DELETE: const envVars ... writeEnvFile lines
    }

    // Lines 399-402 — remove writeEnvFile, keep ctx assignment:
    if (hasOpenRouter) {
      ctx.openRouterKey = body.openRouterKey;
    }
```

**Step 2: Remove loadEnvFile usage for Clerk key check**

At line 155, `loadEnvFile` reads `.env` to check for Clerk publishable key. Since Clerk is legacy and the registry already stores it, this fallback is dead code with Pocket ID. Remove the `.env` fallback block (lines 154-164).

**Step 3: Remove env-utils imports**

Remove the `loadEnvFile, writeEnvFile` import from line 13. If nothing else from `env-utils.js` is imported, remove the import line entirely.

**Step 4: Run tests**

Run: `cd scripts && npm test 2>&1 | tail -30`
Expected: All pass.

**Step 5: Commit**

```bash
git add scripts/server/router.ts
git commit -m "Remove .env reads/writes from editor router — registry is source of truth"
```

---

### Task 5: Clean up `env-utils.js` — remove `loadEnvFile` and `writeEnvFile`

**Files:**
- Modify: `scripts/lib/env-utils.js`
- Modify: `scripts/__tests__/unit/env-utils.test.js`

**Step 1: Remove loadEnvFile and writeEnvFile from env-utils.js**

Delete the `loadEnvFile` function (lines 21-43) and `writeEnvFile` function (lines 115-151). Also remove the `readFileSync, writeFileSync` from the fs import if no longer needed (check: `populateConnectConfig` doesn't use them, `validateConnectUrl` doesn't, `deriveStudioUrls` doesn't). Keep `existsSync` if used, otherwise clean up the import.

Keep: `CONFIG_PLACEHOLDERS`, `populateConnectConfig`, `validateOIDCAuthority`, `validateOIDCClientId`, `validateOpenRouterKey`, `validateConnectUrl`, `deriveStudioUrls`.

**Step 2: Remove corresponding tests**

In `scripts/__tests__/unit/env-utils.test.js`:
- Remove the `loadEnvFile` describe block (lines 31-103)
- Remove the `writeEnvFile` describe block (lines 149-207)
- Remove their imports from line 9
- Remove the `writeFileSync, readFileSync, mkdirSync, rmSync` imports if no longer needed by remaining tests
- Remove the `tmpdir` import if no longer needed

**Step 3: Verify no remaining imports of removed functions**

Run: `cd scripts && grep -r 'loadEnvFile\|writeEnvFile' --include='*.js' --include='*.ts' lib/ server/ 2>&1`
Expected: No matches (all call sites removed in previous tasks).

**Step 4: Run tests**

Run: `cd scripts && npm test 2>&1 | tail -30`
Expected: All pass.

**Step 5: Commit**

```bash
git add scripts/lib/env-utils.js scripts/__tests__/unit/env-utils.test.js
git commit -m "Remove loadEnvFile and writeEnvFile — .env no longer used"
```

---

### Task 6: Update generate.ts env-utils import

**Files:**
- Modify: `scripts/server/handlers/generate.ts:14,428`

**Step 1: Check current usage**

Line 14 imports `loadEnvFile, populateConnectConfig` from env-utils. Line 428 calls `populateConnectConfig(template, {})` — passing empty env vars (correct for preview, which runs local-only).

**Step 2: Remove loadEnvFile import**

Since `loadEnvFile` is gone from env-utils, remove it from the import. Keep `populateConnectConfig`:

```javascript
// Before:
import { loadEnvFile, populateConnectConfig } from '../../lib/env-utils.js';
// After:
import { populateConnectConfig } from '../../lib/env-utils.js';
```

Check if `loadEnvFile` is called elsewhere in generate.ts. If not, this is the only change.

**Step 3: Run tests**

Run: `cd scripts && npm test 2>&1 | tail -30`
Expected: All pass.

**Step 4: Commit**

```bash
git add scripts/server/handlers/generate.ts
git commit -m "Remove unused loadEnvFile import from generate handler"
```

---

### Task 7: Verify end-to-end — deploy with --app flag

**Step 1: Assemble + deploy via unified command**

Run: `bun scripts/deploy-cloudflare.js --name seq --app app.jsx 2>&1`

Expected output:
```
Assembled app.jsx into template
Reusing existing Connect: https://fireproof-dashboard-seq.marcus-e.workers.dev/api
Injected Connect URLs
Deploying seq to Cloudflare Workers via Deploy API...
Authenticating...
Deploying seq (13 file(s))...
Deployed to https://seq.marcus-e.workers.dev
```

**Step 2: Verify in browser**

Open `https://seq.marcus-e.workers.dev` in Chrome. Sign in. Check console for:
- `[vibes-oidc] Starting cloud attach`
- `[vibes-oidc] dashApi → reqEnsureUser` with correct `seq` URLs
- `[vibes-oidc] Cloud attached, ledger:`
- Zero errors

**Step 3: Verify no .env dependency remains**

Run: `cd scripts && grep -rn 'loadEnvFile\|writeEnvFile\|\.env' --include='*.js' --include='*.ts' lib/ server/ 2>&1 | grep -v node_modules | grep -v '.env.example' | grep -v 'test'`

Expected: No matches for `loadEnvFile` or `writeEnvFile`. Any remaining `.env` references should be comments or the OpenRouter `process.env` pattern.

**Step 4: Run full test suite**

Run: `cd scripts && npm test 2>&1`
Expected: All tests pass.

**Step 5: Final commit**

If any cleanup needed from verification, commit. Otherwise, done.
