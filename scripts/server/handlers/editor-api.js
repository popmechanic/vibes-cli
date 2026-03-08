/**
 * Editor API handlers — credentials, app CRUD, screenshots, status.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync, renameSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { loadRegistry } from '../../lib/registry.js';
import { readCachedTokens, isTokenExpired, getAccessToken, loginWithBrowser, removeCachedTokens } from '../../lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '../../lib/auth-constants.js';
import { currentAppDir, throttledBackup } from '../app-context.js';

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

/**
 * Parse JSON body from an HTTP request.
 * Rejects with 413 if body exceeds MAX_BODY_SIZE.
 */
export function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        settled = true;
        req.destroy();
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', err => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/**
 * Parse user info from a JWT id_token without verification.
 * Returns { name, email, picture } or null.
 */
function parseUserFromIdToken(idToken) {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
    return {
      name: payload.name || payload.preferred_username || null,
      email: payload.email || null,
      picture: payload.picture || null,
    };
  } catch {
    return null;
  }
}

/**
 * Check auth state from cached tokens.
 * Returns { auth: { state: 'valid'|'expired'|'none', userName: string|null } }
 */
export async function checkAuthStatus() {
  const cached = readCachedTokens();

  if (!cached) {
    return { auth: { state: 'none', user: null } };
  }

  if (!isTokenExpired(cached.expiresAt)) {
    return { auth: { state: 'valid', user: parseUserFromIdToken(cached.idToken) } };
  }

  // Try silent refresh
  try {
    const refreshed = await getAccessToken({
      authority: OIDC_AUTHORITY,
      clientId: OIDC_CLIENT_ID,
      silent: true,
    });
    if (refreshed) {
      return { auth: { state: 'valid', user: parseUserFromIdToken(refreshed.idToken) } };
    }
  } catch {
    // refresh failed
  }

  return { auth: { state: 'expired', user: parseUserFromIdToken(cached.idToken) } };
}

/**
 * Trigger browser-based Pocket ID login.
 * On success, broadcasts auth_complete to all WebSocket clients.
 */
export async function handleAuthLogin(ctx, req, res) {
  try {
    const tokens = await loginWithBrowser({
      authority: OIDC_AUTHORITY,
      clientId: OIDC_CLIENT_ID,
    });

    const user = parseUserFromIdToken(tokens.idToken);

    // Broadcast to all connected WebSocket clients
    const message = JSON.stringify({ type: 'auth_complete', user });
    for (const client of ctx.wss.clients) {
      if (client.readyState === 1) {
        try { client.send(message); } catch { /* client may have disconnected */ }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, user }));
  } catch (err) {
    console.error('[Auth] Login failed:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

export function handleAuthLogout(ctx, req, res) {
  removeCachedTokens();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

// --- Route handlers ---

export async function status(ctx, req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const result = await checkAuthStatus();
  return res.end(JSON.stringify(result));
}

export function initialPrompt(ctx, req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ prompt: ctx.initialPrompt }));
}

export function appExists(ctx, req, res) {
  const appDir = currentAppDir(ctx);
  const exists = appDir ? existsSync(join(appDir, 'app.jsx')) : false;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ exists, currentApp: ctx.currentApp }));
}

export function listApps(ctx, req, res) {
  try {
    const apps = [];
    for (const name of readdirSync(ctx.appsDir)) {
      const dir = join(ctx.appsDir, name);
      const appFile = join(dir, 'app.jsx');
      if (!existsSync(appFile)) continue;
      const st = statSync(appFile);
      const firstLine = readFileSync(appFile, 'utf-8').split('\n')[0] || '';
      const themeMatch = firstLine.match(/id:\s*"([^"]+)".*?name:\s*"([^"]+)"/);
      apps.push({
        name,
        modified: st.mtime.toISOString(),
        themeId: themeMatch ? themeMatch[1] : null,
        themeName: themeMatch ? themeMatch[2] : null,
        size: st.size,
        hasScreenshot: existsSync(join(dir, 'screenshot.png')),
      });
    }
    apps.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(apps));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * Sanitize an app name to prevent path traversal.
 * Strips everything except alphanumeric chars and hyphens.
 */
function sanitizeAppName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 63);
}

export async function loadApp(ctx, req, res, url) {
  const params = url.searchParams;
  const name = sanitizeAppName(params.get('name'));
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const src = join(ctx.appsDir, name, 'app.jsx');
  if (!existsSync(src)) { res.writeHead(404); return res.end('App not found'); }

  // Auto-save current app before switching
  if (ctx.currentApp) {
    try {
      const { assembleAppFrame } = await import('./generate.js');
      const html = assembleAppFrame(ctx);
      writeFileSync(join(currentAppDir(ctx), 'index.html'), html);
    } catch (e) {
      console.warn(`[LoadApp] Auto-save failed for "${ctx.currentApp}": ${e.message}`);
    }
  }

  ctx.currentApp = name;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true, currentApp: name }));
}

export function saveApp(ctx, req, res, url) {
  const params = url.searchParams;
  const name = sanitizeAppName(params.get('name'));
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const appDir = currentAppDir(ctx);
  if (!appDir || !existsSync(join(appDir, 'app.jsx'))) {
    res.writeHead(404); return res.end('No active app to save');
  }
  if (name === ctx.currentApp) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  const dest = join(ctx.appsDir, name);
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(appDir, 'app.jsx'), join(dest, 'app.jsx'));
  if (existsSync(join(appDir, 'index.html'))) {
    copyFileSync(join(appDir, 'index.html'), join(dest, 'index.html'));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true }));
}

export function getScreenshot(ctx, req, res, url) {
  const params = url.searchParams;
  const name = sanitizeAppName(params.get('name'));
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const imgPath = join(ctx.appsDir, name, 'screenshot.png');
  if (!existsSync(imgPath)) { res.writeHead(404); return res.end('No screenshot'); }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
  return res.end(readFileSync(imgPath));
}

const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024; // 5MB

export function saveScreenshot(ctx, req, res, url) {
  const params = url.searchParams;
  const name = sanitizeAppName(params.get('name'));
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const dest = join(ctx.appsDir, name);
  if (!existsSync(dest)) { mkdirSync(dest, { recursive: true }); }
  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', c => {
    if (aborted) return;
    size += c.length;
    if (size > MAX_SCREENSHOT_SIZE) {
      aborted = true;
      req.destroy();
      if (!res.writableEnded) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Screenshot too large (max 5MB)' }));
      }
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    writeFileSync(join(dest, 'screenshot.png'), Buffer.concat(chunks));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

export function listDeployments(ctx, req, res) {
  try {
    const reg = loadRegistry();
    const deployments = Object.values(reg.apps || {})
      .filter(app => app.app && app.app.url)
      .map(app => ({
        name: app.name,
        url: app.app.url,
        updatedAt: app.updatedAt || app.createdAt,
      }))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(deployments));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message }));
  }
}

export function writeApp(ctx, req, res) {
  const appDir = currentAppDir(ctx);
  if (!appDir) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No active app' }));
  }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const appPath = join(appDir, 'app.jsx');
    throttledBackup(appPath, ctx.currentApp, ctx.backupTimestamps);
    writeFileSync(appPath, Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

export function renameApp(ctx, req, res, url) {
  const params = url.searchParams;
  const from = sanitizeAppName(params.get('from'));
  const to = sanitizeAppName(params.get('to'));
  if (!from || !to) { res.writeHead(400); return res.end('Missing from or to'); }
  const srcDir = resolve(ctx.appsDir, from);
  const destDir = resolve(ctx.appsDir, to);
  if (!srcDir.startsWith(ctx.appsDir) || !destDir.startsWith(ctx.appsDir)) { res.writeHead(400); return res.end('Invalid path'); }
  if (!existsSync(srcDir)) { res.writeHead(404); return res.end('Source app not found'); }
  if (existsSync(destDir)) { res.writeHead(409); return res.end('Destination name already exists'); }
  renameSync(srcDir, destDir);
  if (ctx.currentApp === from) ctx.currentApp = to;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true, name: to }));
}

export function deleteApp(ctx, req, res, url) {
  const params = url.searchParams;
  const name = sanitizeAppName(params.get('name'));
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const dir = resolve(ctx.appsDir, name);
  if (!dir.startsWith(ctx.appsDir)) { res.writeHead(400); return res.end('Invalid path'); }
  if (!existsSync(dir)) { res.writeHead(404); return res.end('App not found'); }
  rmSync(dir, { recursive: true, force: true });
  if (ctx.currentApp === name) ctx.currentApp = null;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true }));
}
