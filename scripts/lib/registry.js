/**
 * Global deployment registry for Vibes apps
 *
 * Manages ~/.vibes/deployments.json — tracks all app-connect pairings,
 * Cloudflare account info, and per-app OIDC credentials.
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
 *       "oidc": { "authority": "https://...", "clientId": "..." },
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
  try { chmodSync(path, 0o600); } catch (e) { console.warn('chmod registry failed:', e.message); }
}

/**
 * Get a single app entry by name, or null if not found.
 */
export function getApp(name) {
  const reg = loadRegistry();
  return reg.apps[name] || null;
}

/** Keys whose values are objects that should be deep-merged (not replaced) by setApp. */
const NESTED_KEYS = ['connect', 'app'];

/**
 * Set (create or update) an app entry.
 * Adds updatedAt timestamp, and createdAt if not already present.
 *
 * Known nested keys (connect, app) are deep-merged with existing
 * values so that partial updates don't clobber sibling fields.
 * All other top-level keys are shallow-merged (last write wins).
 */
export function setApp(name, entry) {
  const reg = loadRegistry();
  const existing = reg.apps[name] || {};
  const merged = { ...existing, ...entry, updatedAt: new Date().toISOString() };
  // Deep-merge known nested objects
  for (const key of NESTED_KEYS) {
    if (entry[key] && typeof entry[key] === 'object' && existing[key] && typeof existing[key] === 'object') {
      merged[key] = { ...existing[key], ...entry[key] };
    }
  }
  if (!merged.createdAt) {
    merged.createdAt = merged.updatedAt;
  }
  reg.apps[name] = merged;
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


