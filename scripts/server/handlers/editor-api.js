/**
 * Editor API handlers — credentials, app CRUD, screenshots, status.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join } from 'path';
import { loadRegistry } from '../../lib/registry.js';
import { readCachedTokens, isTokenExpired, getAccessToken, startLoginFlow, removeCachedTokens } from '../../lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '../../lib/auth-constants.js';

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
 * Start Pocket ID login — returns the authorize URL for the frontend to open
 * as a JS popup (so window.close() works on the callback page).
 * Waits for the callback in the background and broadcasts auth_complete via WS.
 */
export async function handleAuthLogin(ctx, req, res) {
  try {
    const { authorizeUrl, tokenPromise } = await startLoginFlow({
      authority: OIDC_AUTHORITY,
      clientId: OIDC_CLIENT_ID,
    });

    // Return the URL immediately so the frontend can window.open() it
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, authorizeUrl }));

    // Wait for the callback in the background, then broadcast
    tokenPromise.then((tokens) => {
      const user = parseUserFromIdToken(tokens.idToken);
      const message = JSON.stringify({ type: 'auth_complete', user });
      for (const client of ctx.wss.clients) {
        if (client.readyState === 1) {
          try { client.send(message); } catch { /* client may have disconnected */ }
        }
      }
    }).catch((err) => {
      console.error('[Auth] Login failed:', err.message);
      const message = JSON.stringify({ type: 'auth_error', error: err.message });
      for (const client of ctx.wss.clients) {
        if (client.readyState === 1) {
          try { client.send(message); } catch { /* ignore */ }
        }
      }
    });
  } catch (err) {
    console.error('[Auth] Could not start login flow:', err.message);
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
  const exists = existsSync(join(ctx.projectRoot, 'app.jsx'));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ exists }));
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

export function loadApp(ctx, req, res, url) {
  const params = url.searchParams;
  const name = sanitizeAppName(params.get('name'));
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const src = join(ctx.appsDir, name, 'app.jsx');
  if (!existsSync(src)) { res.writeHead(404); return res.end('App not found'); }
  copyFileSync(src, join(ctx.projectRoot, 'app.jsx'));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true }));
}

export function saveApp(ctx, req, res, url) {
  const params = url.searchParams;
  const name = sanitizeAppName(params.get('name'));
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const appSrc = join(ctx.projectRoot, 'app.jsx');
  if (!existsSync(appSrc)) { res.writeHead(404); return res.end('No app.jsx to save'); }
  const dest = join(ctx.appsDir, name);
  mkdirSync(dest, { recursive: true });
  copyFileSync(appSrc, join(dest, 'app.jsx'));
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
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    writeFileSync(join(ctx.projectRoot, 'app.jsx'), Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}
