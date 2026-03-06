/**
 * Editor API handlers — credentials, app CRUD, screenshots, status.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { loadEnvFile, validateOIDCAuthority, validateOIDCClientId, validateConnectUrl, deriveConnectUrls, writeEnvFile } from '../../lib/env-utils.js';
import { loadOpenRouterKey } from '../config.js';
import { loadRegistry } from '../../lib/registry.js';

/**
 * Parse JSON body from an HTTP request.
 */
export function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function runCommand(cmd, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, env: { ...process.env } }, (err, stdout, stderr) => {
        const output = ((stdout || '') + (stderr || '')).trim();
        resolve({ ok: !err, output });
      });
    } catch {
      resolve({ ok: false, output: '' });
    }
  });
}

async function checkEditorDeps(ctx) {
  const env = loadEnvFile(ctx.projectRoot);

  const oidcAuthority = env.VITE_OIDC_AUTHORITY || '';
  const oidcOk = validateOIDCAuthority(oidcAuthority);

  const apiUrl = env.VITE_API_URL || '';
  const cloudUrl = env.VITE_CLOUD_URL || '';
  const connectOk = !!(apiUrl && cloudUrl);

  let wranglerResult = await runCommand('npx', ['wrangler', 'whoami'], 15000);
  if (!wranglerResult.ok) wranglerResult = await runCommand('wrangler', ['whoami']);
  const wranglerOk = wranglerResult.ok && !wranglerResult.output.includes('not authenticated');

  const sshResult = await runCommand('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', 'exe.dev', 'help'], 8000);
  const sshOk = sshResult.output.length > 0;

  const orKey = loadOpenRouterKey(ctx.projectRoot);
  const openrouterOk = !!orKey;

  return {
    oidc: {
      ok: oidcOk,
      detail: oidcOk ? oidcAuthority : 'No valid OIDC authority in .env',
    },
    connect: {
      ok: connectOk,
      detail: connectOk ? apiUrl : 'No VITE_API_URL / VITE_CLOUD_URL in .env',
    },
    openrouter: {
      ok: openrouterOk,
      detail: openrouterOk ? `sk-or-...${orKey.slice(-6)}` : 'No OPENROUTER_API_KEY in .env',
    },
    wrangler: {
      ok: wranglerOk,
      detail: wranglerOk ? 'Authenticated' : 'Not configured or not authenticated',
    },
    ssh: {
      ok: sshOk,
      detail: sshOk ? 'Connected' : 'Cannot reach exe.dev',
    },
  };
}

// --- Route handlers ---

export async function status(ctx, req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const result = await checkEditorDeps(ctx);
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

export async function saveCredentials(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    const errors = {};
    const validatedVars = {};

    if (body.VITE_OIDC_AUTHORITY) {
      if (validateOIDCAuthority(body.VITE_OIDC_AUTHORITY)) {
        validatedVars.VITE_OIDC_AUTHORITY = body.VITE_OIDC_AUTHORITY;
      } else {
        errors.VITE_OIDC_AUTHORITY = 'Invalid OIDC authority (must be an HTTPS URL)';
      }
    }

    if (body.VITE_OIDC_CLIENT_ID) {
      if (validateOIDCClientId(body.VITE_OIDC_CLIENT_ID)) {
        validatedVars.VITE_OIDC_CLIENT_ID = body.VITE_OIDC_CLIENT_ID;
      } else {
        errors.VITE_OIDC_CLIENT_ID = 'Invalid OIDC client ID (must be a non-empty string)';
      }
    }

    if (body.VITE_API_URL) {
      if (validateConnectUrl(body.VITE_API_URL, 'api')) {
        validatedVars.VITE_API_URL = body.VITE_API_URL;
      } else {
        errors.VITE_API_URL = 'Invalid API URL (must start with https://)';
      }
    }

    if (body.VITE_CLOUD_URL) {
      if (validateConnectUrl(body.VITE_CLOUD_URL, 'cloud')) {
        validatedVars.VITE_CLOUD_URL = body.VITE_CLOUD_URL;
      } else {
        errors.VITE_CLOUD_URL = 'Invalid Cloud URL (must start with fpcloud://)';
      }
    }

    if (body.OPENROUTER_API_KEY) {
      if (body.OPENROUTER_API_KEY.startsWith('sk-or-')) {
        validatedVars.OPENROUTER_API_KEY = body.OPENROUTER_API_KEY;
      } else {
        errors.OPENROUTER_API_KEY = 'Invalid OpenRouter key (must start with sk-or-)';
      }
    }

    if (Object.keys(errors).length > 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, errors }));
    }

    if (Object.keys(validatedVars).length > 0) {
      writeEnvFile(ctx.projectRoot, validatedVars);
    }

    // Update in-memory OpenRouter key if saved
    if (validatedVars.OPENROUTER_API_KEY) {
      ctx.openRouterKey = validatedVars.OPENROUTER_API_KEY;
      console.log('OpenRouter API key updated from wizard');
    }

    const statusResult = await checkEditorDeps(ctx);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, status: statusResult }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, errors: { _: err.message } }));
  }
}

export async function checkStudio(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    const studioName = body.studio;
    if (!studioName || typeof studioName !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ reachable: false, error: 'Studio name is required' }));
    }

    const { apiUrl, cloudUrl } = deriveConnectUrls(studioName);

    let reachable = false;
    let error;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(apiUrl, { signal: controller.signal });
      clearTimeout(timeout);
      reachable = true;  // Any HTTP response means studio is up (dashboard returns 503 for GET)
    } catch (fetchErr) {
      error = fetchErr.name === 'AbortError' ? 'Connection timed out' : fetchErr.message;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    const result = { reachable, apiUrl, cloudUrl };
    if (error) result.error = error;
    return res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ reachable: false, error: err.message }));
  }
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

export function loadApp(ctx, req, res, url) {
  const params = url.searchParams;
  const name = params.get('name');
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const src = join(ctx.appsDir, name, 'app.jsx');
  if (!existsSync(src)) { res.writeHead(404); return res.end('App not found'); }
  copyFileSync(src, join(ctx.projectRoot, 'app.jsx'));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true }));
}

export function saveApp(ctx, req, res, url) {
  const params = url.searchParams;
  const name = (params.get('name') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
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
  const name = params.get('name');
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const imgPath = join(ctx.appsDir, name, 'screenshot.png');
  if (!existsSync(imgPath)) { res.writeHead(404); return res.end('No screenshot'); }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
  return res.end(readFileSync(imgPath));
}

export function saveScreenshot(ctx, req, res, url) {
  const params = url.searchParams;
  const name = params.get('name');
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const dest = join(ctx.appsDir, name);
  if (!existsSync(dest)) { mkdirSync(dest, { recursive: true }); }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
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
