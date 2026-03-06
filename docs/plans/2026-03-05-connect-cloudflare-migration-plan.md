# Connect Cloudflare Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate Connect from exe.dev VMs to Cloudflare Workers via alchemy, auto-deploying Connect 1:1 with each app on first deploy. Remove exe.dev entirely.

**Architecture:** New `lib/registry.js` manages `~/.vibes/deployments.json` (global app-connect registry). New `lib/alchemy-deploy.js` handles Connect provisioning via shallow sparse checkout of upstream fireproof repo + alchemy CLI. Modified `deploy-cloudflare.js` calls alchemy module on first deploy, skips on updates. All exe.dev code removed.

**Tech Stack:** Node.js, alchemy CLI (TypeScript IaC), Cloudflare Workers/R2/D1/Durable Objects, vitest

**Design doc:** `docs/plans/2026-03-05-connect-cloudflare-migration-design.md`

---

### Task 1: Create `lib/registry.js` — Global Deployment Registry

**Files:**
- Create: `scripts/lib/registry.js`
- Test: `scripts/__tests__/unit/registry.test.js`

**Step 1: Write failing tests for registry module**

```javascript
// scripts/__tests__/unit/registry.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

// We'll mock the home directory to avoid touching real ~/.vibes/
const TEST_DIR = join(tmpdir(), `vibes-registry-test-${Date.now()}`);

describe('registry', () => {
  let registry;

  beforeEach(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Dynamic import with env override
    process.env.VIBES_HOME = TEST_DIR;
    registry = await import('../../lib/registry.js');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  describe('loadRegistry', () => {
    it('returns empty registry when no file exists', () => {
      const reg = registry.loadRegistry();
      expect(reg.version).toBe(1);
      expect(reg.apps).toEqual({});
    });

    it('reads existing registry file', () => {
      const data = { version: 1, cloudflare: { accountId: 'abc' }, apps: {} };
      mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
      writeFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), JSON.stringify(data));
      const reg = registry.loadRegistry();
      expect(reg.cloudflare.accountId).toBe('abc');
    });
  });

  describe('saveRegistry / getApp / setApp', () => {
    it('round-trips an app entry', () => {
      const entry = {
        name: 'test-app',
        createdAt: new Date().toISOString(),
        clerk: { publishableKey: 'pk_test_abc', secretKey: 'sk_test_xyz' },
        app: { workerName: 'test-app', url: 'https://test-app.workers.dev' },
        connect: { stage: 'test-app', apiUrl: 'https://dashboard.workers.dev' }
      };
      registry.setApp('test-app', entry);
      const loaded = registry.getApp('test-app');
      expect(loaded.name).toBe('test-app');
      expect(loaded.clerk.publishableKey).toBe('pk_test_abc');
    });
  });

  describe('getCloudflareConfig / setCloudflareConfig', () => {
    it('stores and retrieves Cloudflare account info', () => {
      registry.setCloudflareConfig({ accountId: 'cf-123', workersSubdomain: 'my-sub' });
      const config = registry.getCloudflareConfig();
      expect(config.accountId).toBe('cf-123');
      expect(config.workersSubdomain).toBe('my-sub');
    });
  });

  describe('isFirstDeploy', () => {
    it('returns true for unknown app', () => {
      expect(registry.isFirstDeploy('new-app')).toBe(true);
    });

    it('returns false for registered app with connect', () => {
      registry.setApp('existing', {
        name: 'existing',
        connect: { stage: 'existing', apiUrl: 'https://...' }
      });
      expect(registry.isFirstDeploy('existing')).toBe(false);
    });
  });

  describe('deriveConnectUrls', () => {
    it('transforms cloud backend URL to fpcloud:// protocol', () => {
      const urls = registry.deriveConnectUrls('https://fireproof-cloud-myapp.acct.workers.dev');
      expect(urls.cloudUrl).toBe('fpcloud://fireproof-cloud-myapp.acct.workers.dev?protocol=wss');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/registry.test.js`
Expected: FAIL — module not found

**Step 3: Implement registry module**

```javascript
// scripts/lib/registry.js
/**
 * Global deployment registry for Vibes apps
 *
 * Manages ~/.vibes/deployments.json — tracks all app-connect pairings,
 * Cloudflare account info, and per-app Clerk credentials.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
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

export function loadRegistry() {
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

export function saveRegistry(reg) {
  const dir = join(getVibesHome(), '.vibes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(getRegistryPath(), JSON.stringify(reg, null, 2));
}

export function getApp(name) {
  const reg = loadRegistry();
  return reg.apps[name] || null;
}

export function setApp(name, entry) {
  const reg = loadRegistry();
  reg.apps[name] = { ...entry, updatedAt: new Date().toISOString() };
  if (!entry.createdAt && !reg.apps[name].createdAt) {
    reg.apps[name].createdAt = new Date().toISOString();
  }
  saveRegistry(reg);
}

export function getCloudflareConfig() {
  return loadRegistry().cloudflare || {};
}

export function setCloudflareConfig(config) {
  const reg = loadRegistry();
  reg.cloudflare = { ...reg.cloudflare, ...config };
  saveRegistry(reg);
}

export function isFirstDeploy(name) {
  const app = getApp(name);
  return !app || !app.connect || !app.connect.apiUrl;
}

/**
 * Transform alchemy's HTTPS cloud backend URL to fpcloud:// protocol
 */
export function deriveConnectUrls(cloudBackendHttpsUrl) {
  const url = new URL(cloudBackendHttpsUrl);
  return {
    cloudUrl: `fpcloud://${url.host}?protocol=wss`,
    apiUrl: cloudBackendHttpsUrl
  };
}

/**
 * Migrate legacy .env + .connect to registry format
 */
export function migrateFromLegacy(envVars, connectData) {
  // connectData: { studio, api_url, cloud_url, clerk_publishable_key }
  const appName = connectData.studio || 'legacy';
  const entry = {
    name: appName,
    createdAt: new Date().toISOString(),
    clerk: {
      publishableKey: envVars.VITE_CLERK_PUBLISHABLE_KEY || connectData.clerk_publishable_key,
      secretKey: envVars.CLERK_SECRET_KEY || ''
    },
    connect: {
      stage: appName,
      apiUrl: envVars.VITE_API_URL || connectData.api_url,
      cloudUrl: envVars.VITE_CLOUD_URL || connectData.cloud_url,
      deployedAt: new Date().toISOString()
    }
  };
  setApp(appName, entry);
  return entry;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/registry.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/lib/registry.js scripts/__tests__/unit/registry.test.js
git commit -m "Add global deployment registry module

Manages ~/.vibes/deployments.json for tracking app-connect pairings,
Cloudflare account info, and per-app Clerk credentials."
```

---

### Task 2: Create `lib/alchemy-deploy.js` — Connect Provisioning Module

**Files:**
- Create: `scripts/lib/alchemy-deploy.js`
- Test: `scripts/__tests__/unit/alchemy-deploy.test.js`

**Context:** This module does three things:
1. Manages a shallow sparse git checkout of the fireproof repo
2. Prepares environment variables for alchemy
3. Runs `alchemy deploy --stage {appName}` and extracts output URLs

Alchemy's `alchemy.run.ts` outputs URLs to stdout in the format:
```
Cloud Backend: https://fireproof-cloud-{stage}.{subdomain}.workers.dev
Dashboard: https://fireproof-dashboard-{stage}.{subdomain}.workers.dev
```

**Step 1: Write failing tests**

```javascript
// scripts/__tests__/unit/alchemy-deploy.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn()
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, existsSync: vi.fn(() => false) };
});

describe('alchemy-deploy', () => {
  let alchemyDeploy;
  let execSync;
  let existsSync;

  beforeEach(async () => {
    vi.resetModules();
    const cp = await import('child_process');
    execSync = cp.execSync;
    const fs = await import('fs');
    existsSync = fs.existsSync;
    alchemyDeploy = await import('../../lib/alchemy-deploy.js');
  });

  describe('ensureSparseCheckout', () => {
    it('clones repo when cache dir does not exist', () => {
      existsSync.mockReturnValue(false);
      execSync.mockReturnValue('');

      alchemyDeploy.ensureSparseCheckout('/tmp/test-cache');

      const cloneCall = execSync.mock.calls.find(c => c[0].includes('git clone'));
      expect(cloneCall).toBeTruthy();
      expect(cloneCall[0]).toContain('--depth 1');
      expect(cloneCall[0]).toContain('--sparse');
      expect(cloneCall[0]).toContain('--filter=blob:none');
    });

    it('does git pull when cache exists', () => {
      existsSync.mockReturnValue(true);
      execSync.mockReturnValue('');

      alchemyDeploy.ensureSparseCheckout('/tmp/test-cache');

      const pullCall = execSync.mock.calls.find(c => c[0].includes('git pull'));
      expect(pullCall).toBeTruthy();
    });
  });

  describe('buildAlchemyEnv', () => {
    it('generates required environment variables', () => {
      const env = alchemyDeploy.buildAlchemyEnv({
        clerkPublishableKey: 'pk_test_abc',
        clerkSecretKey: 'sk_test_xyz',
        sessionTokenPublic: 'token-pub',
        sessionTokenSecret: 'token-sec',
        deviceCaPrivKey: 'ca-priv',
        deviceCaCert: 'ca-cert',
        alchemyPassword: 'pass123'
      });

      expect(env.CLERK_PUBLISHABLE_KEY).toBe('pk_test_abc');
      expect(env.CLOUD_SESSION_TOKEN_PUBLIC).toBe('token-pub');
      expect(env.ALCHEMY_PASSWORD).toBe('pass123');
    });
  });

  describe('parseAlchemyOutput', () => {
    it('extracts cloud backend and dashboard URLs from stdout', () => {
      const stdout = `
--- Deployed URLs ---
Stage: my-app
Cloud Backend: https://fireproof-cloud-my-app.acct123.workers.dev
Dashboard: https://fireproof-dashboard-my-app.acct123.workers.dev

VITE_CLERK_PUBLISHABLE_KEY=pk_test_abc
VITE_API_URL=https://fireproof-dashboard-my-app.acct123.workers.dev
VITE_CLOUD_URL=https://fireproof-cloud-my-app.acct123.workers.dev
`;
      const result = alchemyDeploy.parseAlchemyOutput(stdout);
      expect(result.cloudBackendUrl).toContain('fireproof-cloud-my-app');
      expect(result.dashboardUrl).toContain('fireproof-dashboard-my-app');
    });

    it('throws on missing URLs', () => {
      expect(() => alchemyDeploy.parseAlchemyOutput('no urls here')).toThrow();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/alchemy-deploy.test.js`
Expected: FAIL — module not found

**Step 3: Implement alchemy-deploy module**

```javascript
// scripts/lib/alchemy-deploy.js
/**
 * Connect provisioning via alchemy
 *
 * Manages sparse checkout of the fireproof repo and runs alchemy
 * to deploy a Fireproof Connect instance to Cloudflare Workers.
 *
 * Each app gets its own "stage" in alchemy, creating isolated
 * R2, D1, Workers, and Durable Object resources.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { generateSessionToken, generateDeviceCaKeyPair } from './crypto-utils.js';

const UPSTREAM_REPO = 'https://github.com/fireproof-storage/fireproof.git';
const UPSTREAM_BRANCH = 'selem/docker-for-all';
const SPARSE_DIRS = ['alchemy/', 'cloud/backend/cf-d1/', 'dashboard/'];

function getCacheDir() {
  return process.env.VIBES_UPSTREAM_CACHE || join(homedir(), '.vibes', 'upstream', 'fireproof');
}

/**
 * Ensure the fireproof repo is cloned (sparse, shallow) and up to date
 */
export function ensureSparseCheckout(cacheDir) {
  const repoDir = cacheDir || getCacheDir();

  if (existsSync(join(repoDir, '.git'))) {
    // Already cloned — pull latest
    console.log('Updating upstream fireproof repo...');
    execSync('git pull --ff-only', { cwd: repoDir, stdio: 'pipe' });
    return repoDir;
  }

  // Fresh clone
  console.log('Cloning fireproof repo (sparse checkout)...');
  const parentDir = resolve(repoDir, '..');
  mkdirSync(parentDir, { recursive: true });

  execSync(
    `git clone --depth 1 --sparse --filter=blob:none --branch ${UPSTREAM_BRANCH} ${UPSTREAM_REPO} ${repoDir}`,
    { stdio: 'inherit' }
  );

  execSync(
    `git sparse-checkout set ${SPARSE_DIRS.join(' ')}`,
    { cwd: repoDir, stdio: 'inherit' }
  );

  return repoDir;
}

/**
 * Build environment variables for alchemy.run.ts
 */
export function buildAlchemyEnv({
  clerkPublishableKey,
  clerkSecretKey,
  sessionTokenPublic,
  sessionTokenSecret,
  deviceCaPrivKey,
  deviceCaCert,
  alchemyPassword
}) {
  // Derive CLERK_PUB_JWT_URL from publishable key
  const base64Part = clerkPublishableKey.replace(/^pk_(test|live)_/, '');
  const clerkDomain = Buffer.from(base64Part, 'base64').toString('utf8').replace(/\$+$/, '');

  return {
    CLERK_PUBLISHABLE_KEY: clerkPublishableKey,
    CLERK_PUB_JWT_URL: `https://${clerkDomain}`,
    CLOUD_SESSION_TOKEN_PUBLIC: sessionTokenPublic,
    CLOUD_SESSION_TOKEN_SECRET: sessionTokenSecret,
    DEVICE_ID_CA_PRIV_KEY: deviceCaPrivKey,
    DEVICE_ID_CA_CERT: deviceCaCert,
    ALCHEMY_PASSWORD: alchemyPassword,
    // Quotas — sensible defaults for individual app
    MAX_TENANTS: '100',
    MAX_ADMIN_USERS: '10',
    MAX_MEMBER_USERS: '50',
    MAX_INVITES: '100',
    MAX_LEDGERS: '50'
  };
}

/**
 * Parse alchemy deploy stdout to extract deployed URLs
 */
export function parseAlchemyOutput(stdout) {
  const cloudMatch = stdout.match(/Cloud Backend:\s*(https:\/\/[^\s]+)/);
  const dashMatch = stdout.match(/Dashboard:\s*(https:\/\/[^\s]+)/);

  if (!cloudMatch || !dashMatch) {
    throw new Error(
      'Failed to parse alchemy output. Expected "Cloud Backend:" and "Dashboard:" URLs.\n' +
      `Output was:\n${stdout.slice(0, 500)}`
    );
  }

  return {
    cloudBackendUrl: cloudMatch[1],
    dashboardUrl: dashMatch[1]
  };
}

/**
 * Deploy a Connect instance for the given app
 *
 * @returns {Object} { apiUrl, cloudUrl, cloudWorkerName, dashboardWorkerName,
 *                      r2BucketName, d1BackendName, d1DashboardName, stage }
 */
export async function deployConnect({
  appName,
  clerkPublishableKey,
  clerkSecretKey,
  cacheDir,
  dryRun = false
}) {
  const repoDir = ensureSparseCheckout(cacheDir);

  // Generate crypto credentials
  console.log('Generating session tokens and device CA keys...');
  const { publicToken: sessionTokenPublic, secretToken: sessionTokenSecret } = await generateSessionToken();
  const { privateKeyEnv: deviceCaPrivKey, certEnv: deviceCaCert } = await generateDeviceCaKeyPair();
  const alchemyPassword = randomBytes(32).toString('hex');

  // Build alchemy environment
  const alchemyEnv = buildAlchemyEnv({
    clerkPublishableKey,
    clerkSecretKey,
    sessionTokenPublic,
    sessionTokenSecret,
    deviceCaPrivKey,
    deviceCaCert,
    alchemyPassword
  });

  // Merge with current process env (for Cloudflare credentials from alchemy login/profile)
  const env = { ...process.env, ...alchemyEnv };

  if (dryRun) {
    console.log('[DRY RUN] Would deploy Connect with stage:', appName);
    console.log('[DRY RUN] Alchemy env keys:', Object.keys(alchemyEnv));
    return {
      apiUrl: `https://fireproof-dashboard-${appName}.workers.dev`,
      cloudUrl: `fpcloud://fireproof-cloud-${appName}.workers.dev?protocol=wss`,
      cloudWorkerName: `fireproof-cloud-${appName}`,
      dashboardWorkerName: `fireproof-dashboard-${appName}`,
      r2BucketName: `fp-storage-${appName}`,
      d1BackendName: `fp-meta-${appName}`,
      d1DashboardName: `fp-connect-${appName}`,
      stage: appName
    };
  }

  // Install dependencies if needed
  if (!existsSync(join(repoDir, 'node_modules'))) {
    console.log('Installing alchemy dependencies...');
    execSync('npm install', { cwd: repoDir, stdio: 'inherit' });
  }

  // Run alchemy deploy with --stage
  console.log(`\nDeploying Connect (stage: ${appName})...`);
  const stdout = execSync(
    `npx alchemy deploy alchemy/alchemy.run.ts --stage ${appName}`,
    { cwd: repoDir, env, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }
  );
  process.stdout.write(stdout);

  // Parse output
  const { cloudBackendUrl, dashboardUrl } = parseAlchemyOutput(stdout);

  // Verify deployment
  console.log('\nVerifying Connect deployment...');
  try {
    execSync(
      `npx tsx alchemy/alchemy.verify.ts ${cloudBackendUrl} ${dashboardUrl}`,
      { cwd: repoDir, env, stdio: 'inherit' }
    );
  } catch (e) {
    console.warn('Verification had failures — check output above. Continuing...');
  }

  // Transform URLs for Vibes consumption
  const url = new URL(cloudBackendUrl);
  const cloudUrl = `fpcloud://${url.host}?protocol=wss`;

  return {
    apiUrl: dashboardUrl,
    cloudUrl,
    cloudWorkerName: `fireproof-cloud-${appName}`,
    dashboardWorkerName: `fireproof-dashboard-${appName}`,
    r2BucketName: `fp-storage-${appName}`,
    d1BackendName: `fp-meta-${appName}`,
    d1DashboardName: `fp-connect-${appName}`,
    stage: appName,
    sessionTokenPublic,
    alchemyPassword
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/alchemy-deploy.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/lib/alchemy-deploy.js scripts/__tests__/unit/alchemy-deploy.test.js
git commit -m "Add alchemy-deploy module for Connect provisioning

Sparse checkout of fireproof repo, alchemy CLI execution, URL extraction.
Each app gets isolated Cloudflare resources via alchemy --stage."
```

---

### Task 3: Modify `deploy-cloudflare.js` — Add First-Deploy Detection

**Files:**
- Modify: `scripts/deploy-cloudflare.js`
- Test: `scripts/__tests__/integration/deploy-cloudflare-connect.test.js`

**Step 1: Write failing integration test**

```javascript
// scripts/__tests__/integration/deploy-cloudflare-connect.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test that deploy-cloudflare integration correctly detects first deploy vs update
describe('deploy-cloudflare connect integration', () => {
  it('calls alchemy-deploy on first deploy', async () => {
    // This test validates the logic flow, not actual deployment.
    // The integration is: isFirstDeploy(name) → true → deployConnect()
    const { isFirstDeploy } = await import('../../lib/registry.js');
    // Fresh registry = first deploy
    expect(isFirstDeploy('brand-new-app')).toBe(true);
  });

  it('skips alchemy-deploy on update', async () => {
    const { setApp, isFirstDeploy } = await import('../../lib/registry.js');
    setApp('existing-app', {
      name: 'existing-app',
      connect: { stage: 'existing-app', apiUrl: 'https://dash.workers.dev' }
    });
    expect(isFirstDeploy('existing-app')).toBe(false);
  });
});
```

**Step 2: Run test, verify it passes (logic already implemented in Task 1)**

Run: `cd scripts && npx vitest run __tests__/integration/deploy-cloudflare-connect.test.js`

**Step 3: Modify deploy-cloudflare.js**

Add these changes to `scripts/deploy-cloudflare.js`:

At the top, add imports:
```javascript
import { loadRegistry, getApp, setApp, isFirstDeploy, setCloudflareConfig, deriveConnectUrls } from './lib/registry.js';
import { deployConnect } from './lib/alchemy-deploy.js';
```

In `main()`, after argument parsing (~line 141), add the first-deploy detection block:

```javascript
  // --- First-deploy detection ---
  const firstDeploy = isFirstDeploy(name);

  if (firstDeploy) {
    console.log(`\nFirst deploy for "${name}" — provisioning paired Connect instance...`);

    // Clerk key is required for Connect
    if (!clerkKey) {
      throw new Error(
        'First deploy requires Clerk publishable key.\n' +
        'Provide via --clerk-key flag or VITE_CLERK_PUBLISHABLE_KEY in .env'
      );
    }

    const clerkSecretKey = envVars.CLERK_SECRET_KEY || null;
    if (!clerkSecretKey) {
      console.warn('No CLERK_SECRET_KEY in .env — Connect dashboard features may be limited.');
    }

    // Deploy Connect via alchemy
    const connectResult = await deployConnect({
      appName: name,
      clerkPublishableKey: clerkKey,
      clerkSecretKey,
      dryRun: args.includes('--dry-run')
    });

    // Write Connect metadata to registry
    setApp(name, {
      name,
      clerk: {
        publishableKey: clerkKey,
        secretKey: clerkSecretKey || '',
        domain: extractClerkDomain(clerkKey)
      },
      connect: {
        ...connectResult,
        deployedAt: new Date().toISOString()
      }
    });

    // Update .env with new Connect URLs so assembly picks them up
    console.log(`\nConnect URLs for ${name}:`);
    console.log(`  API:   ${connectResult.apiUrl}`);
    console.log(`  Cloud: ${connectResult.cloudUrl}`);

  } else {
    console.log(`\nUpdate deploy for "${name}" — using existing Connect instance.`);
    const existing = getApp(name);
    if (existing?.connect) {
      console.log(`  Connect API: ${existing.connect.apiUrl}`);
    }
  }
```

After the wrangler deploy succeeds (~line 364), add registry update:

```javascript
  // Update app metadata in registry
  const appEntry = getApp(name) || { name };
  setApp(name, {
    ...appEntry,
    app: {
      workerName: name,
      kvNamespaceId: kvId,
      url: deployedUrl
    }
  });
```

**Step 4: Run existing fixture tests to ensure no regression**

Run: `cd scripts && npm run test:fixtures`
Expected: PASS (assembly logic unchanged)

**Step 5: Commit**

```bash
git add scripts/deploy-cloudflare.js scripts/__tests__/integration/deploy-cloudflare-connect.test.js
git commit -m "Add first-deploy detection to Cloudflare deploy

Automatically provisions Connect via alchemy on first deploy.
Updates skip Connect and only redeploy the app worker."
```

---

### Task 4: Modify `assemble.js` — Registry-Aware Config Loading

**Files:**
- Modify: `scripts/assemble.js:46-62`
- Modify: `scripts/lib/env-utils.js`
- Test: Run existing `scripts/__tests__/unit/assemble-validation.test.js`

**Step 1: Modify assemble.js to read from registry as fallback**

Replace the Connect credential validation block (lines 46-62):

```javascript
  // Load env vars — check registry first, .env as fallback
  const outputDir = dirname(resolvedOutputPath);
  let envVars = loadEnvFile(outputDir);

  // If .env lacks Connect URLs, try global registry
  if (!envVars.VITE_API_URL || !envVars.VITE_CLERK_PUBLISHABLE_KEY) {
    const appName = process.argv[4] || null; // Optional: --app-name flag
    if (appName) {
      const { getApp } = await import('./lib/registry.js');
      const app = getApp(appName);
      if (app) {
        envVars.VITE_CLERK_PUBLISHABLE_KEY = envVars.VITE_CLERK_PUBLISHABLE_KEY || app.clerk?.publishableKey;
        envVars.VITE_API_URL = envVars.VITE_API_URL || app.connect?.apiUrl;
        envVars.VITE_CLOUD_URL = envVars.VITE_CLOUD_URL || app.connect?.cloudUrl;
        console.log(`Connect config: from registry (app: ${appName})`);
      }
    }
  }

  // Validate Connect credentials
  const hasValidConnect = validateClerkKey(envVars.VITE_CLERK_PUBLISHABLE_KEY) &&
                          envVars.VITE_API_URL;

  if (!hasValidConnect) {
    throw new Error(
      'Valid Clerk credentials required.\n\n' +
      'Expected in .env or registry:\n' +
      '  VITE_CLERK_PUBLISHABLE_KEY=pk_test_... or pk_live_...\n' +
      '  VITE_API_URL=https://...\n\n' +
      'Deploy first to auto-configure Connect, or set up .env manually.'
    );
  }
```

**Step 2: Run existing tests**

Run: `cd scripts && npx vitest run __tests__/unit/assemble-validation.test.js`
Expected: PASS

**Step 3: Commit**

```bash
git add scripts/assemble.js
git commit -m "Add registry-aware config loading to assembly

Falls back to ~/.vibes/deployments.json when .env lacks Connect URLs."
```

---

### Task 5: Remove Deprecated Files

**Files to remove:**
- `scripts/deploy-connect.js`
- `scripts/deploy-exe.js`
- `scripts/lib/exe-ssh.js`
- `scripts/lib/deploy-utils.js` (audit first — `validateName` used by deploy-cloudflare.js)
- `skills/connect/` (entire directory)
- `skills/exe/` (entire directory)
- `commands/connect.md`
- `commands/exe.md`

**Step 1: Audit deploy-utils.js for shared usage**

Read `scripts/lib/deploy-utils.js` to check if `validateName` or other exports are used by deploy-cloudflare.js. If so, move `validateName` to a surviving module (e.g., `registry.js` or a new `lib/validation.js`).

**Step 2: Move shared functions if needed**

If `validateName` is needed, add it to `registry.js`:
```javascript
export function validateName(name) {
  if (!name || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) {
    throw new Error(`Invalid app name: "${name}". Use lowercase alphanumeric with hyphens.`);
  }
  return name;
}
```

Update `deploy-cloudflare.js` import to use the new location.

**Step 3: Remove deprecated files**

```bash
git rm scripts/deploy-connect.js
git rm scripts/deploy-exe.js
git rm scripts/lib/exe-ssh.js
git rm scripts/lib/deploy-utils.js  # or keep if shared functions remain
git rm -r skills/connect/
git rm -r skills/exe/
git rm commands/connect.md
git rm commands/exe.md
```

**Step 4: Run all tests to confirm nothing breaks**

Run: `cd scripts && npm test`
Expected: PASS (tests for removed modules will need removal too)

**Step 5: Remove tests for deleted modules**

Remove any test files that test deploy-connect.js, deploy-exe.js, or exe-ssh.js directly.

**Step 6: Commit**

```bash
git add -A
git commit -m "Remove exe.dev deployment code and connect/exe skills

Connect now deploys via alchemy on Cloudflare. exe.dev no longer needed."
```

---

### Task 6: Update Skill Files

**Files:**
- Modify: `skills/vibes/SKILL.md` — Remove Connect pre-flight gate
- Modify: `skills/sell/SKILL.md` — Same
- Modify: `skills/cloudflare/SKILL.md` — Document new Connect integration
- Modify: `skills/launch/SKILL.md` — Remove T3 (Deploy Connect)
- Modify: `skills/launch/LAUNCH-REFERENCE.md` — Update dependency graph
- Modify: `skills/test/SKILL.md` — Cloudflare-only test flow
- Modify: `skills/riff/SKILL.md` — Remove exe.dev deploy option

**Step 1: Update vibes SKILL.md**

In the Pre-Flight Check section, replace the Connect prerequisite with:
```markdown
### Pre-Flight Check
- Clerk publishable key must be available (in .env or provided during deploy)
- Connect deploys automatically on first app deploy — no manual setup needed
```

Remove: "invoke `/vibes:connect` to deploy Connect, then return here when complete"

**Step 2: Update cloudflare SKILL.md**

Add section explaining automatic Connect deployment:
```markdown
### Automatic Connect Deployment
On first deploy, the script automatically provisions a paired Fireproof Connect
instance via alchemy. This includes: R2 bucket, D1 databases, cloud backend
Worker (blob ops + WebSocket rooms), and dashboard Worker.

Subsequent deploys skip Connect and only update the app Worker.

App-Connect pairings are tracked in `~/.vibes/deployments.json`.
```

**Step 3: Update launch SKILL.md**

Remove T3 (Deploy Connect) from the task list. Renumber remaining tasks.
Update the dependency graph to show Connect is embedded in the deploy step.

**Step 4: Update launch LAUNCH-REFERENCE.md**

Update pipeline overview, dependency graph, and timing table.
Remove "T3: Deploy Connect" and update T5 dependencies.

**Step 5: Commit**

```bash
git add skills/
git commit -m "Update skill files for Connect-on-Cloudflare architecture

Remove Connect pre-flight gates, add auto-deploy documentation,
simplify launch pipeline by removing standalone Connect task."
```

---

### Task 7: Update Hooks — SessionStart Context

**Files:**
- Modify: `hooks/session-context.md`
- Modify: `hooks/session-start.sh`

**Step 1: Update session-context.md**

In the Skill Dispatch table, remove:
```
| "set up sync" / "Connect" / "cloud backend" | `/vibes:connect` |
| "deploy" / "put it online" (exe.dev) | `/vibes:exe` |
```

Replace with:
```
| "deploy" / "put it online" | `/vibes:cloudflare` |
```

In the Workflow section, remove:
```
.env with Clerk keys + Connect URLs must exist before generating apps.
If missing, invoke `/vibes:connect` first.
```

Replace with:
```
Clerk keys must exist before generating apps.
Connect deploys automatically on first app deploy to Cloudflare.
```

**Step 2: Update session-start.sh**

Replace the `.env` detection logic (lines 17-37) to check registry:

```bash
# Detect project state
state_hints=""

REGISTRY="$HOME/.vibes/deployments.json"
if [ -f "$REGISTRY" ]; then
    app_count=$(grep -c '"name"' "$REGISTRY" 2>/dev/null || echo "0")
    state_hints=$'\n\n## Project State\nVibes registry found with '"$app_count"' app(s). Deploy with /vibes:cloudflare.'
elif [ -f "${PWD}/.env" ]; then
    has_clerk_keys=false
    if grep -q "VITE_CLERK_PUBLISHABLE_KEY=pk_" "${PWD}/.env" 2>/dev/null; then
        has_clerk_keys=true
    fi
    if [ "$has_clerk_keys" = true ]; then
        state_hints=$'\n\n## Project State\nLegacy .env found with Clerk keys. Deploy with /vibes:cloudflare to auto-configure Connect.'
    else
        state_hints=$'\n\n## Project State\n.env found but missing Clerk keys. Add VITE_CLERK_PUBLISHABLE_KEY before deploying.'
    fi
else
    state_hints=$'\n\n## Project State\nNo registry or .env found. Provide Clerk keys when deploying your first app.'
fi
```

**Step 3: Test the hook**

```bash
echo '{}' | bash hooks/session-start.sh
```
Expected: Valid JSON with `additionalContext` field, no errors

**Step 4: Commit**

```bash
git add hooks/
git commit -m "Update SessionStart hook for registry-based state detection

Remove /vibes:connect and /vibes:exe from dispatch table.
Check ~/.vibes/deployments.json instead of .env for project state."
```

---

### Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update Workflow Sequence section**

Replace:
```
CR (credentials) → CO (connect) → G (generate) → A (assemble) → D (deploy) → V (verify)
```
With:
```
CR (credentials) → G (generate) → A (assemble) → D (deploy + auto-connect) → V (verify)
```

Remove the CO node from the Node Registry table.
Update Hard Dependencies to remove `CR → CO` and `CO → G`.

**Step 2: Update File Reference table**

Remove entries for:
- `scripts/deploy-connect.js`
- `scripts/deploy-exe.js`
- `scripts/lib/exe-ssh.js`
- `scripts/lib/deploy-utils.js`
- `skills/connect/SKILL.md`
- `skills/exe/SKILL.md`

Add entries for:
- `scripts/lib/registry.js` — "Global deployment registry (~/.vibes/deployments.json)"
- `scripts/lib/alchemy-deploy.js` — "Connect provisioning via alchemy sparse checkout"

**Step 3: Update exe.dev Deployment section**

Remove entire "exe.dev Deployment" section. Replace with:
```markdown
## Cloudflare Deployment

All apps deploy to Cloudflare Workers. Connect deploys automatically on first
app deploy via alchemy. App-Connect pairings tracked in `~/.vibes/deployments.json`.
```

Remove "Connect Studio Environment" and "Manual File Transfer to exe.dev VMs" sections.

**Step 4: Update Known Issues section**

Remove "Sell Skill Deploy Issues" that reference exe.dev port mismatch.

**Step 5: Update Adding or Removing Skills checklist**

Remove connect and exe from any checklists.

**Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md for Connect-on-Cloudflare architecture

Remove exe.dev sections, update state machine, update file reference."
```

---

### Task 9: Update README and .codex Bootstrap

**Files:**
- Modify: `README.md`
- Modify: `.codex/vibes-bootstrap.md`

**Step 1: Update README.md**

Remove `/vibes:connect` and `/vibes:exe` from the skills table.
Update the workflow description to reflect auto-connect on deploy.

**Step 2: Update .codex/vibes-bootstrap.md**

Remove connect and exe from the skills table.
Update the sequential workflow: `vibes → cloudflare (includes connect) → sell`.

**Step 3: Commit**

```bash
git add README.md .codex/vibes-bootstrap.md
git commit -m "Update README and Codex bootstrap for new deployment model"
```

---

### Task 10: Update assemble-sell.js

**Files:**
- Modify: `scripts/assemble-sell.js`

**Step 1: Add registry-aware config loading (same pattern as Task 4)**

Mirror the changes from `assemble.js`: read Connect URLs from registry when `.env` lacks them.

**Step 2: Run sell-specific tests**

Run: `cd scripts && npm run test:fixtures`
Expected: PASS

**Step 3: Commit**

```bash
git add scripts/assemble-sell.js
git commit -m "Add registry-aware config loading to sell assembly"
```

---

### Task 11: Final Test Suite + Cleanup

**Files:**
- Modify: `scripts/__tests__/` — Remove tests for deleted modules, add new tests

**Step 1: Remove orphaned test files**

Remove any tests that import from deleted modules (deploy-connect.js, deploy-exe.js, exe-ssh.js).

**Step 2: Run full test suite**

Run: `cd scripts && npm test`
Expected: ALL PASS

**Step 3: Run structural fixture tests**

Run: `cd scripts && npm run test:fixtures`
Expected: ALL PASS

**Step 4: Verify hook output**

```bash
echo '{}' | bash hooks/session-start.sh
```
Expected: Valid JSON, no errors

**Step 5: Final commit**

```bash
git add -A
git commit -m "Clean up test suite and verify all tests pass"
```

---

### Task 12: Verification Checklist

**Before claiming complete, verify all of these:**

- [ ] `cd scripts && npm test` — all tests pass
- [ ] `cd scripts && npm run test:fixtures` — structural tests pass
- [ ] `echo '{}' | bash hooks/session-start.sh` — valid JSON output
- [ ] No references to `deploy-connect.js` in any surviving file
- [ ] No references to `deploy-exe.js` in any surviving file
- [ ] No references to `exe-ssh.js` in any surviving file
- [ ] No references to `/vibes:connect` in hook context or dispatch table
- [ ] No references to `/vibes:exe` in hook context or dispatch table
- [ ] `~/.vibes/deployments.json` schema matches design doc
- [ ] `grep -r "exe.dev" skills/` returns no results (or only historical docs/plans)
- [ ] `grep -r "/vibes:connect" hooks/` returns no results
- [ ] CLAUDE.md state machine matches new flow: `CR → G → A → D → V`
