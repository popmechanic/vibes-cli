/**
 * Global deployment registry for Vibes apps
 *
 * Manages ~/.vibes/deployments.json — tracks all app-connect pairings,
 * Cloudflare account info, and per-app Clerk credentials.
 *
 * Schema (v1):
 * {
 *   "version": 1,
 *   "cloudflare": {
 *     "accountId": "...", "workersSubdomain": "...",
 *     "apiToken": "...",
 *     "apiKey": "...", "email": "..."
 *   },
 *   "apps": {
 *     "my-app": {
 *       "name": "my-app",
 *       "createdAt": "...",
 *       "updatedAt": "...",
 *       "clerk": { "publishableKey": "pk_test_...", "secretKey": "sk_test_..." },
 *       "app": { "workerName": "my-app", "kvNamespaceId": "...", "url": "..." },
 *       "connect": { "stage": "my-app", "apiUrl": "...", "cloudUrl": "fpcloud://..." }
 *     }
 *   }
 * }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
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

/**
 * Load the deployment registry from disk.
 * Returns an empty registry if file doesn't exist or is invalid.
 */
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

/**
 * Save the deployment registry to disk.
 * Creates ~/.vibes/ directory if it doesn't exist.
 */
export function saveRegistry(reg) {
  const dir = join(getVibesHome(), '.vibes');
  mkdirSync(dir, { recursive: true });
  const path = getRegistryPath();
  writeFileSync(path, JSON.stringify(reg, null, 2), { mode: 0o600 });
  // Also chmod in case the file already existed with broader permissions
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
}

/**
 * Get a single app entry by name, or null if not found.
 */
export function getApp(name) {
  const reg = loadRegistry();
  return reg.apps[name] || null;
}

/**
 * Set (create or update) an app entry.
 * Adds updatedAt timestamp, and createdAt if not already present.
 */
export function setApp(name, entry) {
  const reg = loadRegistry();
  const existing = reg.apps[name] || {};
  reg.apps[name] = { ...existing, ...entry, updatedAt: new Date().toISOString() };
  if (!reg.apps[name].createdAt) {
    reg.apps[name].createdAt = reg.apps[name].updatedAt;
  }
  saveRegistry(reg);
}

/**
 * Get Cloudflare account configuration.
 */
export function getCloudflareConfig() {
  return loadRegistry().cloudflare || {};
}

/**
 * Set (merge) Cloudflare account configuration.
 * New keys are merged with existing config.
 */
export function setCloudflareConfig(config) {
  const reg = loadRegistry();
  // Merge non-null values, delete keys explicitly set to null
  const merged = { ...reg.cloudflare };
  for (const [key, value] of Object.entries(config)) {
    if (value === null) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  reg.cloudflare = merged;
  saveRegistry(reg);
}

/**
 * Check if this is the first deploy for a given app name.
 * Returns true if the app doesn't exist or has no connect.apiUrl configured.
 */
export function isFirstDeploy(name) {
  const app = getApp(name);
  return !app || !app.connect || !app.connect.apiUrl;
}

/**
 * Validate a deployment name to prevent shell injection.
 * Names must be lowercase alphanumeric with optional hyphens (not at start/end).
 *
 * @param {string} name - Name to validate
 * @returns {string} The validated name
 * @throws {Error} If name is invalid
 */
export function validateName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Name is required and must be a non-empty string');
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error(
      `Invalid name "${name}". Names must be lowercase alphanumeric with optional hyphens (not at start/end). Example: "my-app-123"`
    );
  }
  return name;
}

/**
 * Transform an HTTPS cloud backend URL to fpcloud:// protocol URL.
 * Used for Cloudflare Workers-based Connect backends.
 *
 * Input:  'https://fireproof-cloud-myapp.acct.workers.dev'
 * Output: { cloudUrl: 'fpcloud://fireproof-cloud-myapp.acct.workers.dev?protocol=wss',
 *           apiUrl: 'https://fireproof-cloud-myapp.acct.workers.dev' }
 */
export function deriveConnectUrls(cloudBackendHttpsUrl) {
  const url = new URL(cloudBackendHttpsUrl);
  return {
    cloudUrl: `fpcloud://${url.host}?protocol=wss`,
    apiUrl: cloudBackendHttpsUrl
  };
}

/**
 * Migrate legacy .env + .connect data to registry format.
 * Creates an app entry from old-style environment variables and connect config.
 */
export function migrateFromLegacy(envVars, connectData) {
  const appName = connectData.studio || 'legacy';
  const entry = {
    name: appName,
    createdAt: new Date().toISOString(),
    clerk: {
      publishableKey: envVars.VITE_CLERK_PUBLISHABLE_KEY || connectData.clerk_publishable_key || '',
      secretKey: envVars.CLERK_SECRET_KEY || ''
    },
    connect: {
      stage: appName,
      apiUrl: envVars.VITE_API_URL || connectData.api_url || '',
      cloudUrl: envVars.VITE_CLOUD_URL || connectData.cloud_url || '',
      deployedAt: new Date().toISOString()
    }
  };
  setApp(appName, entry);
  return entry;
}
