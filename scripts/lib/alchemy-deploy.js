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
import { existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { generateSessionTokens, generateDeviceCAKeys } from './crypto-utils.js';

const UPSTREAM_REPO = 'https://github.com/fireproof-storage/fireproof.git';
const UPSTREAM_BRANCH = 'selem/docker-for-all';
const SPARSE_DIRS = ['alchemy/', 'cloud/backend/cf-d1/', 'dashboard/'];

function getCacheDir() {
  return process.env.VIBES_UPSTREAM_CACHE || join(homedir(), '.vibes', 'upstream', 'fireproof');
}

/**
 * Ensure the fireproof repo is cloned (sparse, shallow) and up to date.
 *
 * @param {string} [cacheDir] - Override default cache directory
 * @returns {string} Path to the repo directory
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
 *
 * @param {Object} params
 * @param {string} params.clerkPublishableKey - Clerk publishable key
 * @param {string} params.clerkSecretKey - Clerk secret key
 * @param {string} params.sessionTokenPublic - Session token (public, base58-encoded JWK)
 * @param {string} params.sessionTokenSecret - Session token (secret, base58-encoded JWK)
 * @param {string} params.deviceCaPrivKey - Device CA private key (base58-encoded JWK)
 * @param {string} params.deviceCaCert - Device CA certificate (JWT)
 * @param {string} params.alchemyPassword - Password for alchemy state encryption
 * @returns {Object} Environment variable key-value pairs
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
  // pk_test_<base64(domain$)> or pk_live_<base64(domain$)>
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
 * Parse alchemy deploy stdout to extract deployed URLs.
 *
 * Expected format:
 *   Cloud Backend: https://fireproof-cloud-{stage}.{subdomain}.workers.dev
 *   Dashboard: https://fireproof-dashboard-{stage}.{subdomain}.workers.dev
 *
 * @param {string} stdout - Raw stdout from alchemy deploy
 * @returns {{ cloudBackendUrl: string, dashboardUrl: string }}
 * @throws {Error} If expected URL patterns are not found
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
 * Deploy a Connect instance for the given app.
 *
 * Orchestrates the full flow: sparse checkout, crypto generation,
 * alchemy deploy, output parsing, and verification.
 *
 * @param {Object} params
 * @param {string} params.appName - App name (used as alchemy --stage)
 * @param {string} params.clerkPublishableKey - Clerk publishable key
 * @param {string} params.clerkSecretKey - Clerk secret key
 * @param {string} [params.cacheDir] - Override cache directory for upstream repo
 * @param {boolean} [params.dryRun=false] - Skip actual deployment
 * @returns {Promise<Object>} Deployment result with URLs and resource names
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
  const { publicEnv: sessionTokenPublic, privateEnv: sessionTokenSecret } = await generateSessionTokens();
  const { privKey: deviceCaPrivKey, cert: deviceCaCert } = await generateDeviceCAKeys();
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
