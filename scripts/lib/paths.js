/**
 * Centralized Path Resolution
 *
 * All plugin paths defined in one place to avoid hardcoded paths scattered
 * throughout the codebase. Makes the plugin portable and easier to maintain.
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Plugin root is two levels up from scripts/lib/
export const PLUGIN_ROOT = join(__dirname, '..', '..');
export const BUILD_DIR = join(PLUGIN_ROOT, 'build');

/**
 * Template file paths
 */
export const TEMPLATES = {
  vibesBasic: join(PLUGIN_ROOT, 'skills/vibes/templates/index.html'),
  sellUnified: join(PLUGIN_ROOT, 'skills/sell/templates/unified.html'),
  adminComponent: join(PLUGIN_ROOT, 'skills/sell/components/admin-exe.jsx'),
};

/**
 * Build output file paths
 */
export const BUILD_FILES = {
  vibesMenu: join(BUILD_DIR, 'vibes-menu.js'),
};

/**
 * Default file paths (shipped with plugin)
 */
export const DEFAULT_FILES = {
  stylePrompt: join(PLUGIN_ROOT, 'skills/vibes/defaults/style-prompt.txt'),
};

/**
 * Skill file paths
 */
export const SKILL_FILES = {
  vibesSkill: join(PLUGIN_ROOT, 'skills/vibes/SKILL.md'),
};

/**
 * Convert absolute path to plugin-relative path for display
 * Works cross-platform (handles both / and \ separators)
 *
 * @param {string} absolutePath - Absolute file path
 * @returns {string} - Path relative to plugin root
 */
export function relativeToPlugin(absolutePath) {
  if (!absolutePath) return '';
  return absolutePath
    .replace(PLUGIN_ROOT, '')
    .replace(/^[/\\]/, '');
}
