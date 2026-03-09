#!/usr/bin/env node
/**
 * Embed dashboard frontend assets into the dashboard Worker bundle.
 *
 * Creates a wrapper Worker that:
 * - Provides a mock ASSETS fetcher backed by an embedded file map
 * - Delegates all requests to the real dashboard backend
 *
 * Usage: node embed-dashboard-assets.js <dashboard-core.js> <assets-dir> <output.txt>
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const [coreBundle, assetsDir, outputFile] = process.argv.slice(2);

if (!coreBundle || !assetsDir || !outputFile) {
  console.error('Usage: node embed-dashboard-assets.js <core.js> <assets-dir> <output.txt>');
  process.exit(1);
}

// Files to exclude from the embedded bundle (source maps, large images)
const EXCLUDE_PATTERNS = [
  /\.map$/,            // Source maps — not needed at runtime, saves ~5.2MB
  /login-bg-.*\.png$/, // Login background images — ~1.7MB raw, ~2.2MB base64
];

function isExcluded(relativePath) {
  return EXCLUDE_PATTERNS.some((p) => p.test(relativePath));
}

// Recursively read all files from assets directory
function walkDir(dir, prefix = '') {
  const entries = {};
  let skipped = 0;
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      const sub = walkDir(fullPath, relativePath);
      Object.assign(entries, sub.entries);
      skipped += sub.skipped;
    } else if (name.startsWith('.') || isExcluded(relativePath)) {
      skipped++;
    } else {
      const ext = extname(name).toLowerCase();
      const textExts = ['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml', '.webmanifest'];
      if (textExts.includes(ext)) {
        entries[relativePath] = readFileSync(fullPath, 'utf-8');
      } else {
        entries[relativePath] = 'base64:' + readFileSync(fullPath, 'base64');
      }
    }
  }
  return { entries, skipped };
}

console.log(`Reading assets from ${assetsDir}...`);
const { entries: assets, skipped } = walkDir(assetsDir);
const assetCount = Object.keys(assets).length;
console.log(`Embedded ${assetCount} assets (skipped ${skipped} excluded files)`);

const coreCode = readFileSync(coreBundle, 'utf-8');

// Rename the core bundle's `export default` to a known variable
const wrappedCore = coreCode.replace(/export\s+default\s+/, 'const __dashboard_core__ = ');

const output = `// Auto-generated: dashboard Worker with embedded frontend assets
// === Embedded Dashboard Frontend Assets ===
const __ASSETS__ = ${JSON.stringify(assets)};

const __MIME_TYPES__ = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

function __getMime__(path) {
  const ext = path.substring(path.lastIndexOf('.'));
  return __MIME_TYPES__[ext] || 'application/octet-stream';
}

function __base64ToArrayBuffer__(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// Mock ASSETS fetcher that serves from embedded file map
const __assetsFetcher__ = {
  fetch(request) {
    const url = new URL(typeof request === 'string' ? request : request.url);
    let path = url.pathname;
    if (path.endsWith('/')) path += 'index.html';
    if (path.startsWith('/')) path = path.slice(1);

    if (path in __ASSETS__) {
      const content = __ASSETS__[path];
      if (typeof content === 'string' && content.startsWith('base64:')) {
        return new Response(__base64ToArrayBuffer__(content.slice(7)), {
          headers: { 'Content-Type': __getMime__(path), 'Cache-Control': 'public, max-age=31536000, immutable' },
        });
      }
      return new Response(content, {
        headers: { 'Content-Type': __getMime__(path) },
      });
    }

    // SPA fallback
    if ('index.html' in __ASSETS__) {
      return new Response(__ASSETS__['index.html'], {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }
};

// === Dashboard Backend Core ===
${wrappedCore}

// === Wrapper: inject ASSETS mock into env ===
export default {
  async fetch(request, env, ctx) {
    env.ASSETS = __assetsFetcher__;
    return __dashboard_core__.fetch(request, env, ctx);
  }
};
`;

writeFileSync(outputFile, output);
const sizeMB = (Buffer.byteLength(output) / (1024 * 1024)).toFixed(2);
console.log(`Combined dashboard bundle written: ${outputFile} (${sizeMB} MB)`);
