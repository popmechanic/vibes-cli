/**
 * Shared environment/config utilities
 *
 * Used by assemble.js and assemble-sell.js for .env loading,
 * Clerk key validation, and Connect config population.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Connect config placeholders (required - apps need Clerk auth)
export const CONFIG_PLACEHOLDERS = {
  '__VITE_API_URL__': 'VITE_API_URL',
  '__VITE_CLOUD_URL__': 'VITE_CLOUD_URL',
  '__VITE_CLERK_PUBLISHABLE_KEY__': 'VITE_CLERK_PUBLISHABLE_KEY'
};

/**
 * Parse .env file if it exists
 * Returns object with env var values
 */
export function loadEnvFile(dir) {
  const envPath = resolve(dir, '.env');
  if (!existsSync(envPath)) {
    return {};
  }

  const content = readFileSync(envPath, 'utf8');
  const env = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    env[key] = value.replace(/^["']|["']$/g, '');
  }

  return env;
}

/**
 * Validate that a Clerk publishable key has the correct format
 */
export function validateClerkKey(key) {
  return key && (key.startsWith('pk_test_') || key.startsWith('pk_live_'));
}

/**
 * Validate that an OpenRouter API key has the correct format
 */
export function validateOpenRouterKey(key) {
  return typeof key === 'string' && key.startsWith('sk-or-');
}

/**
 * Validate that a Clerk user ID has the correct format
 */
export function validateClerkUserId(id) {
  return typeof id === 'string' && id.startsWith('user_');
}

/**
 * Replace Connect config placeholders with values from .env
 * @param {string} html - Template HTML
 * @param {object} envVars - Environment variables
 * @param {boolean} [globalReplace=false] - Use global regex replacement (for sell templates with multiple occurrences)
 */
/**
 * Validate a Clerk secret key format
 */
export function validateClerkSecretKey(key) {
  return key && (key.startsWith('sk_test_') || key.startsWith('sk_live_'));
}

/**
 * Validate Connect URL format
 * @param {string} url - URL to validate
 * @param {'api'|'cloud'} type - URL type
 */
export function validateConnectUrl(url, type) {
  if (!url || typeof url !== 'string') return false;
  if (type === 'api') return url.startsWith('https://');
  if (type === 'cloud') return url.startsWith('fpcloud://');
  return false;
}

/**
 * Derive Connect URLs from a studio name
 * @param {string} studioName - Studio name or full hostname
 * @returns {{ apiUrl: string, cloudUrl: string }}
 */
export function deriveConnectUrls(studioName) {
  if (!studioName || typeof studioName !== 'string') {
    throw new Error('Studio name is required');
  }
  const name = studioName.trim();
  // If it already contains dots, treat as full hostname
  const host = name.includes('.') ? name : `${name}.exe.xyz`;
  return {
    apiUrl: `https://${host}/api/`,
    cloudUrl: `fpcloud://${host}?protocol=wss`,
  };
}

/**
 * Merge-write environment variables to .env file.
 * Preserves comments, blank lines, and keys not in newVars.
 * Overwrites matching keys, appends new ones.
 * @param {string} dir - Directory containing .env
 * @param {object} newVars - Key-value pairs to write
 */
export function writeEnvFile(dir, newVars) {
  const envPath = resolve(dir, '.env');
  const lines = [];
  const written = new Set();

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        lines.push(line);
        continue;
      }
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) {
        lines.push(line);
        continue;
      }
      const key = trimmed.slice(0, eqIndex).trim();
      if (key in newVars) {
        lines.push(`${key}=${newVars[key]}`);
        written.add(key);
      } else {
        lines.push(line);
      }
    }
  }

  // Append new keys not yet written
  for (const [key, value] of Object.entries(newVars)) {
    if (!written.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  writeFileSync(envPath, lines.join('\n') + '\n');
}

export function populateConnectConfig(html, envVars, globalReplace = false) {
  let result = html;

  for (const [placeholder, envKey] of Object.entries(CONFIG_PLACEHOLDERS)) {
    const value = envVars[envKey] || '';
    if (globalReplace) {
      result = result.replace(new RegExp(placeholder, 'g'), value);
    } else {
      result = result.replace(placeholder, value);
    }
  }

  return result;
}
