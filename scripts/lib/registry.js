/**
 * Global deployment registry for Vibes apps
 *
 * Manages ~/.vibes/deployments.json — tracks all app-connect pairings,
 * Cloudflare account info, per-app OIDC credentials, and recent projects.
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
 *
 * Schema (v2 additions):
 * {
 *   "version": 2,
 *   "recentProjects": [
 *     { "path": "/abs/path/to/project", "name": "project-name", "displayName": "...", "lastOpened": "ISO8601" }
 *   ]
 * }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const MAX_RECENT_PROJECTS = 20;

function getVibesHome() {
  return process.env.VIBES_HOME || homedir();
}

function getRegistryPath() {
  return join(getVibesHome(), '.vibes', 'deployments.json');
}

function emptyRegistry() {
  return { version: 2, cloudflare: {}, apps: {}, recentProjects: [] };
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
    // v1→v2 migration: add recentProjects and bump version
    if (!data.recentProjects) {
      data.recentProjects = [];
    }
    if (!data.version || data.version < 2) {
      data.version = 2;
    }
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

/**
 * Add or update a project in the recent projects list.
 * Deduplicates by path, moves to front, caps at MAX_RECENT_PROJECTS.
 *
 * @param {{ path: string, name: string, displayName?: string }} project
 */
export function addRecentProject(project) {
  const reg = loadRegistry();
  // Remove existing entry with the same path
  reg.recentProjects = reg.recentProjects.filter(p => p.path !== project.path);
  // Add to front with current timestamp
  reg.recentProjects.unshift({
    path: project.path,
    name: project.name,
    ...(project.displayName !== undefined ? { displayName: project.displayName } : {}),
    lastOpened: new Date().toISOString(),
  });
  // Cap at MAX_RECENT_PROJECTS
  if (reg.recentProjects.length > MAX_RECENT_PROJECTS) {
    reg.recentProjects = reg.recentProjects.slice(0, MAX_RECENT_PROJECTS);
  }
  saveRegistry(reg);
}

/**
 * Get recent projects list, most-recent-first.
 * Prunes entries whose paths no longer exist on disk.
 *
 * @returns {Array<{ path: string, name: string, displayName?: string, lastOpened: string }>}
 */
export function getRecentProjects() {
  const reg = loadRegistry();
  const before = reg.recentProjects.length;
  reg.recentProjects = reg.recentProjects.filter(p => existsSync(p.path));
  if (reg.recentProjects.length !== before) {
    saveRegistry(reg);
  }
  return reg.recentProjects;
}

/**
 * Remove a project from the recent projects list by path.
 *
 * @param {string} path - Absolute path of the project to remove
 */
export function removeRecentProject(path) {
  const reg = loadRegistry();
  reg.recentProjects = reg.recentProjects.filter(p => p.path !== path);
  saveRegistry(reg);
}

/**
 * Scan a legacy apps directory and populate recentProjects with found apps.
 * Looks for subdirectories containing app.jsx. Takes the 20 most recently
 * modified (by app.jsx mtime), sorted newest first. Skips entries already
 * in recents.
 *
 * @param {string} appsDir - Directory to scan (e.g. ~/.vibes/apps/)
 */
export function populateLegacyApps(appsDir) {
  if (!existsSync(appsDir)) return;

  const reg = loadRegistry();
  const existingPaths = new Set((reg.recentProjects || []).map(p => p.path));

  const entries = [];
  for (const name of readdirSync(appsDir)) {
    const appDir = join(appsDir, name);
    const appJsx = join(appDir, 'app.jsx');
    try {
      const dirStat = statSync(appDir);
      if (!dirStat.isDirectory()) continue;
      if (!existsSync(appJsx)) continue;
      if (existingPaths.has(appDir)) continue;
      const jsxStat = statSync(appJsx);
      entries.push({ name, path: appDir, mtime: jsxStat.mtimeMs });
    } catch {
      continue;
    }
  }

  // Sort newest first, take up to 20
  entries.sort((a, b) => b.mtime - a.mtime);
  const toAdd = entries.slice(0, 20);

  // Add in reverse order so that addRecentProject's unshift leaves newest at index 0
  for (let i = toAdd.length - 1; i >= 0; i--) {
    addRecentProject({ path: toAdd[i].path, name: toAdd[i].name });
  }
}
