/**
 * HTTP route table — replaces the 320-line if/else chain.
 *
 * Handler signature: (ctx, req, res, url)
 * Static file fallback handles bundles, assets, and 404.
 */

import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import * as editorApi from './handlers/editor-api.js';
import { getRecommendedThemeIds } from './config.js';
import { assembleAppFrame } from './handlers/generate.js';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// --- Static route handlers ---

function serveHtml(ctx, req, res) {
  const htmlFile = ctx.mode === 'editor' ? 'editor.html' : 'preview.html';
  const htmlPath = join(ctx.projectRoot, 'skills/vibes/templates', htmlFile);
  if (!existsSync(htmlPath)) {
    res.writeHead(404);
    return res.end(`${htmlFile} not found`);
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  return res.end(readFileSync(htmlPath, 'utf-8'));
}

function serveAppJsx(ctx, req, res) {
  const appPath = join(ctx.projectRoot, 'app.jsx');
  if (!existsSync(appPath)) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end('// app.jsx not yet generated\n');
  }
  res.writeHead(200, { 'Content-Type': 'text/javascript' });
  return res.end(readFileSync(appPath, 'utf-8'));
}

function serveThemes(ctx, req, res) {
  const recommended = getRecommendedThemeIds(ctx);
  const result = ctx.themes.map(t => ({ ...t, recommended: recommended.has(t.id), colors: ctx.themeColors[t.id] || null }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(result));
}

function serveHasKey(ctx, req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ hasKey: !!ctx.openRouterKey }));
}

function serveAnimations(ctx, req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(ctx.animations));
}

function serveAppFrame(ctx, req, res) {
  const appPath = join(ctx.projectRoot, 'app.jsx');
  if (!existsSync(appPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!DOCTYPE html>
<html><head><style>
  body { margin: 0; display: flex; align-items: center; justify-content: center;
         height: 100vh; font-family: system-ui; color: #888; }
</style></head>
<body><p>Waiting for app to be generated...</p></body></html>`);
  }
  const assembled = assembleAppFrame(ctx);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  return res.end(assembled);
}

// --- Route table ---

const routeTable = {
  'GET /':                                serveHtml,
  'GET /index.html':                      serveHtml,
  'GET /app.jsx':                         serveAppJsx,
  'GET /themes':                          serveThemes,
  'GET /themes/has-key':                  serveHasKey,
  'GET /animations':                      serveAnimations,
  'GET /app-frame':                       serveAppFrame,
  'GET /editor/status':                   editorApi.status,
  'GET /editor/initial-prompt':           editorApi.initialPrompt,
  'GET /editor/app-exists':               editorApi.appExists,
  'GET /editor/apps':                     editorApi.listApps,
  'GET /editor/apps/screenshot':          editorApi.getScreenshot,
  'POST /editor/credentials':             editorApi.saveCredentials,
  'POST /editor/credentials/validate-cloudflare': editorApi.validateCloudflare,
  'POST /editor/apps/load':              editorApi.loadApp,
  'POST /editor/apps/save':              editorApi.saveApp,
  'POST /editor/apps/screenshot':         editorApi.saveScreenshot,
  'POST /editor/apps/write':             editorApi.writeApp,
  'GET /editor/deployments':             editorApi.listDeployments,
};

/**
 * Handle an HTTP request using the route table.
 */
export async function handleRequest(ctx, req, res) {
  const url = new URL(req.url, `http://localhost:${ctx.port}`);
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const key = `${req.method} ${url.pathname}`;
  const handler = routeTable[key];
  if (handler) return handler(ctx, req, res, url);

  // Bundle files: import map references these at root paths
  if (url.pathname === '/fireproof-vibes-bridge.js' || url.pathname === '/fireproof-clerk-bundle.js') {
    const bundlePath = join(ctx.projectRoot, 'bundles', url.pathname.slice(1));
    if (existsSync(bundlePath)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(readFileSync(bundlePath));
    }
  }

  // Static file fallback (bundles, assets)
  const filePath = join(ctx.projectRoot, url.pathname.slice(1));
  if (existsSync(filePath)) {
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    return res.end(readFileSync(filePath));
  }

  res.writeHead(404);
  res.end('Not found');
}
