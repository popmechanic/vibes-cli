/**
 * Shared deploy file-map builder
 *
 * Builds the files map sent to the Deploy API — bundles, auth card SVGs,
 * and favicon assets. Used by both deploy-cloudflare.js (CLI) and
 * handlers/deploy.ts (editor server).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.avif']);
export const R2_THRESHOLD = 100 * 1024; // 100 KB — files larger than this go to R2

/**
 * Build the standard deploy files map (bundles + platform assets).
 * @param {string} projectRoot - Plugin root directory
 * @returns {Record<string, string>} files map
 */
export function buildPlatformFiles(projectRoot) {
  const files = {};

  // OIDC bridge bundle
  const bridgePath = join(projectRoot, 'bundles/oidc-bridge.js');
  if (existsSync(bridgePath)) {
    files['oidc-bridge.js'] = readFileSync(bridgePath, 'utf8');
  }

  // AI hook bundle
  const aiBundlePath = join(projectRoot, 'bundles/vibes-ai.js');
  if (existsSync(aiBundlePath)) {
    files['vibes-ai.js'] = readFileSync(aiBundlePath, 'utf8');
  }

  // Auth card SVGs
  const authCardsDir = join(projectRoot, 'assets/auth-cards');
  if (existsSync(authCardsDir)) {
    for (let i = 1; i <= 4; i++) {
      const p = join(authCardsDir, `card-${i}.svg`);
      if (existsSync(p)) files[`assets/auth-cards/card-${i}.svg`] = readFileSync(p, 'utf8');
    }
  }

  // Favicon assets
  const faviconDir = join(projectRoot, 'assets/vibes-favicon');
  if (existsSync(faviconDir)) {
    const textAssets = ['favicon.svg', 'site.webmanifest'];
    const binaryAssets = ['favicon-96x96.png', 'favicon.ico', 'apple-touch-icon.png',
                          'web-app-manifest-192x192.png', 'web-app-manifest-512x512.png'];
    for (const n of textAssets) {
      const p = join(faviconDir, n);
      if (existsSync(p)) files[`assets/vibes-favicon/${n}`] = readFileSync(p, 'utf8');
    }
    for (const n of binaryAssets) {
      const p = join(faviconDir, n);
      if (existsSync(p)) files[`assets/vibes-favicon/${n}`] = 'base64:' + readFileSync(p).toString('base64');
    }
  }

  return files;
}

/**
 * Walk a directory and add app-level assets to the files map.
 * @param {string} assetsDir - Path to app's assets/ directory
 * @param {Record<string, string>} files - Files map to add to (mutated)
 */
export function addAppAssets(assetsDir, files) {
  if (!existsSync(assetsDir) || !statSync(assetsDir).isDirectory()) return;

  function walk(dir, base) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = base ? `${base}/${entry}` : entry;
      if (statSync(full).isDirectory()) {
        walk(full, rel);
      } else {
        const key = `assets/${rel}`;
        if (!(key in files)) {
          if (BINARY_EXTS.has(extname(entry).toLowerCase())) {
            files[key] = 'base64:' + readFileSync(full).toString('base64');
          } else {
            files[key] = readFileSync(full, 'utf8');
          }
        }
      }
    }
  }
  walk(assetsDir, '');
}

/**
 * Separate files into embedded (small) and R2 (large) based on size threshold.
 * index.html is always embedded regardless of size.
 * @param {Record<string, string>} files - Files map
 * @param {number} threshold - Size threshold in bytes (default: R2_THRESHOLD)
 * @returns {{ embed: Record<string, string>, r2: Record<string, string> }}
 */
export function separateBySize(files, threshold = R2_THRESHOLD) {
  const embed = {};
  const r2 = {};
  for (const [path, content] of Object.entries(files)) {
    if (path === 'index.html') {
      embed[path] = content;
      continue;
    }
    const size = typeof content === 'string' && content.startsWith('base64:')
      ? Buffer.from(content.slice(7), 'base64').length
      : Buffer.byteLength(content, 'utf8');
    if (size >= threshold) {
      r2[path] = content;
    } else {
      embed[path] = content;
    }
  }
  return { embed, r2 };
}
