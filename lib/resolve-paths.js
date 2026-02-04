#!/usr/bin/env node
/**
 * resolve-paths.js - Find the vibes plugin directory for any harness
 *
 * Supports:
 * - Environment variable override (VIBES_PLUGIN_ROOT)
 * - Claude Code plugin cache
 * - Standard git clone installation (~/.vibes)
 * - Development mode (relative to this file)
 *
 * Usage:
 *   node lib/resolve-paths.js          # CLI: prints plugin path
 *   const { resolvePluginRoot } = require('./lib/resolve-paths.js')  # Module
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function resolvePluginRoot() {
  const homeDir = os.homedir();

  // 1. Explicit override via environment variable
  if (process.env.VIBES_PLUGIN_ROOT) {
    const envPath = process.env.VIBES_PLUGIN_ROOT;
    if (fs.existsSync(path.join(envPath, 'skills', 'vibes', 'SKILL.md'))) {
      return envPath;
    }
  }

  // 2. Claude Code plugin cache
  const claudeCache = path.join(homeDir, '.claude', 'plugins', 'cache', 'vibes-cli', 'vibes');
  if (fs.existsSync(claudeCache)) {
    try {
      const versions = fs.readdirSync(claudeCache)
        .filter(n => !n.startsWith('.'))
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
        return path.join(claudeCache, versions[versions.length - 1]);
      }
    } catch (e) {
      // Continue to next check
    }
  }

  // 3. Standard git clone installation (~/.vibes)
  const vibesPath = path.join(homeDir, '.vibes');
  if (fs.existsSync(path.join(vibesPath, 'skills', 'vibes', 'SKILL.md'))) {
    return vibesPath;
  }

  // 4. Development mode - relative to this file
  const devPath = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(devPath, 'skills', 'vibes', 'SKILL.md'))) {
    return devPath;
  }

  return null;
}

module.exports = { resolvePluginRoot };

// CLI mode
if (require.main === module) {
  const root = resolvePluginRoot();
  if (root) {
    console.log(root);
  } else {
    console.error('Could not find Vibes plugin directory');
    process.exit(1);
  }
}
