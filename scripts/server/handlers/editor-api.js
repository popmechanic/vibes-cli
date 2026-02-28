/**
 * Editor API handlers — credentials, app CRUD, screenshots, status.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { homedir } from 'os';
import { loadEnvFile, validateClerkKey, validateClerkSecretKey, validateConnectUrl, deriveConnectUrls, writeEnvFile } from '../../lib/env-utils.js';

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

function loadOpenRouterKeyFromEnv(projectRoot) {
  const candidates = [
    join(projectRoot, '.env'),
    join(homedir(), '.vibes', '.env'),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIdx = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIdx).trim();
      if (key === 'OPENROUTER_API_KEY') {
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (val) return val;
      }
    }
  }
  return null;
}

async function checkEditorDeps(ctx) {
  const env = loadEnvFile(ctx.projectRoot);

  const clerkKey = env.VITE_CLERK_PUBLISHABLE_KEY || '';
  const clerkOk = validateClerkKey(clerkKey);

  const apiUrl = env.VITE_API_URL || '';
  const cloudUrl = env.VITE_CLOUD_URL || '';
  const connectOk = !!(apiUrl && cloudUrl);

  let wranglerResult = await runCommand('npx', ['wrangler', 'whoami'], 15000);
  if (!wranglerResult.ok) wranglerResult = await runCommand('wrangler', ['whoami']);
  const wranglerOk = wranglerResult.ok && !wranglerResult.output.includes('not authenticated');

  const sshResult = await runCommand('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', 'exe.dev', 'help'], 8000);
  const sshOk = sshResult.output.length > 0;

  const orKey = loadOpenRouterKeyFromEnv(ctx.projectRoot);
  const openrouterOk = !!orKey;

  return {
    clerk: {
      ok: clerkOk,
      detail: clerkOk ? `${clerkKey.slice(0, 12)}...` : 'No valid Clerk key in .env',
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

    if (body.VITE_CLERK_PUBLISHABLE_KEY) {
      if (validateClerkKey(body.VITE_CLERK_PUBLISHABLE_KEY)) {
        validatedVars.VITE_CLERK_PUBLISHABLE_KEY = body.VITE_CLERK_PUBLISHABLE_KEY;
      } else {
        errors.VITE_CLERK_PUBLISHABLE_KEY = 'Invalid Clerk publishable key (must start with pk_test_ or pk_live_)';
      }
    }

    if (body.VITE_CLERK_SECRET_KEY) {
      if (validateClerkSecretKey(body.VITE_CLERK_SECRET_KEY)) {
        validatedVars.VITE_CLERK_SECRET_KEY = body.VITE_CLERK_SECRET_KEY;
      } else {
        errors.VITE_CLERK_SECRET_KEY = 'Invalid Clerk secret key (must start with sk_test_ or sk_live_)';
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
      reachable = resp.ok || resp.status < 500;
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

export function writeApp(ctx, req, res) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    writeFileSync(join(ctx.projectRoot, 'app.jsx'), Buffer.concat(chunks).toString('utf-8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}
