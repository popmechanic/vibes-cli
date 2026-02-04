#!/usr/bin/env node
/**
 * find-plugin.js - Find the vibes plugin directory with validation
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

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Find the vibes plugin directory
 * Checks multiple sources in priority order:
 * 1. VIBES_PLUGIN_ROOT environment variable
 * 2. Claude Code plugin cache
 * 3. Standard git clone installation (~/.vibes)
 *
 * @param {object} options - Options
 * @param {boolean} options.quiet - Suppress error messages
 * @returns {string|null} - Plugin directory path (with trailing slash) or null
 */
export function findPluginDir(options = {}) {
  const { quiet = false } = options;
  const home = homedir();

  // Helper to validate a plugin directory
  const isValidPluginDir = (dir) => {
    return existsSync(join(dir, 'scripts', 'assemble.js'));
  };

  // 1. Check VIBES_PLUGIN_ROOT environment variable
  if (process.env.VIBES_PLUGIN_ROOT) {
    const envPath = process.env.VIBES_PLUGIN_ROOT;
    if (isValidPluginDir(envPath)) {
      return envPath.endsWith('/') ? envPath : envPath + '/';
    }
  }

  // 2. Check Claude Code plugin cache
  const cacheBase = join(home, '.claude', 'plugins', 'cache', 'vibes-cli', 'vibes');
  if (existsSync(cacheBase)) {
    try {
      const versions = readdirSync(cacheBase)
        .filter(name => !name.startsWith('.'))
        .sort((a, b) => {
          // Version sort: split by dots and compare numerically
          const partsA = a.split('.').map(n => parseInt(n, 10) || 0);
          const partsB = b.split('.').map(n => parseInt(n, 10) || 0);
          for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const diff = (partsA[i] || 0) - (partsB[i] || 0);
            if (diff !== 0) return diff;
          }
          return 0;
        });

      if (versions.length > 0) {
        const latestVersion = versions[versions.length - 1];
        const pluginDir = join(cacheBase, latestVersion) + '/';
        if (isValidPluginDir(pluginDir)) {
          return pluginDir;
        }
      }
    } catch (e) {
      // Continue to next check
    }
  }

  // 3. Check standard git clone installation (~/.vibes)
  const vibesPath = join(home, '.vibes');
  if (isValidPluginDir(vibesPath)) {
    return vibesPath + '/';
  }

  // Not found
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
