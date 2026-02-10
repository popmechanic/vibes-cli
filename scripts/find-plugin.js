#!/usr/bin/env node
/**
 * find-plugin.js - Find the vibes plugin directory with validation
 *
 * Thin ESM wrapper around lib/resolve-paths.js (the canonical implementation).
 *
 * Usage:
 *   node scripts/find-plugin.js          # Prints plugin path or exits with error
 *   node scripts/find-plugin.js --quiet  # Only prints path, no error messages
 *
 * In bash:
 *   VIBES_DIR=$(node path/to/find-plugin.js)
 *
 * In other Node scripts:
 *   import { findPluginDir } from './find-plugin.js';
 *   const pluginDir = findPluginDir();
 */

import { createRequire } from 'node:module';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);

// Delegate to canonical implementation
const { resolvePluginRoot } = require('../lib/resolve-paths.js');

/**
 * Find the vibes plugin directory
 * Delegates to lib/resolve-paths.js for path resolution.
 *
 * @param {object} options - Options
 * @param {boolean} options.quiet - Suppress error messages
 * @returns {string|null} - Plugin directory path (with trailing slash) or null
 */
export function findPluginDir(options = {}) {
  const { quiet = false } = options;
  const root = resolvePluginRoot();

  if (root) {
    return root.endsWith('/') ? root : root + '/';
  }

  if (!quiet) {
    console.error('Error: Vibes plugin not found.');
    console.error('Install options:');
    console.error('  Claude Code: /plugin install vibes@vibes-cli');
    console.error('  Other agents: git clone https://github.com/popmechanic/vibes-cli.git ~/.vibes');
  }
  return null;
}

/**
 * Validate that a specific script exists in the plugin
 * @param {string} pluginDir - Plugin directory
 * @param {string} scriptName - Script name (e.g., 'assemble.js', 'generate-riff.js')
 * @returns {boolean} - True if script exists
 */
export function validateScript(pluginDir, scriptName) {
  const scriptPath = join(pluginDir, 'scripts', scriptName);
  return existsSync(scriptPath);
}

// CLI mode: print the path
if (process.argv[1] && process.argv[1].endsWith('find-plugin.js')) {
  const quiet = process.argv.includes('--quiet');
  const pluginDir = findPluginDir({ quiet });

  if (pluginDir) {
    console.log(pluginDir);
    process.exit(0);
  } else {
    process.exit(1);
  }
}
