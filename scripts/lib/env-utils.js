/**
 * Shared environment/config utilities
 *
 * Used by assemble.js and assemble-sell.js for .env loading,
 * Clerk key validation, and Connect config population.
 */

import { readFileSync, existsSync } from 'fs';
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
    env[key] = value;
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
 * Replace Connect config placeholders with values from .env
 * @param {string} html - Template HTML
 * @param {object} envVars - Environment variables
 * @param {boolean} [globalReplace=false] - Use global regex replacement (for sell templates with multiple occurrences)
 */
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
