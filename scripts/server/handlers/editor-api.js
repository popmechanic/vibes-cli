/**
 * Editor API handlers — credentials, app CRUD, screenshots, status.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join } from 'path';
import { loadEnvFile, validateClerkKey, validateClerkSecretKey, writeEnvFile } from '../../lib/env-utils.js';
import { loadOpenRouterKey } from '../config.js';
import { loadRegistry, getCloudflareConfig, setCloudflareConfig, getApp, setApp } from '../../lib/registry.js';

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

async function checkEditorDeps(ctx) {
  // Check Clerk from registry (most recent app entry)
  const reg = loadRegistry();
  const apps = Object.values(reg.apps);
  let clerkOk = false;
  let clerkDetail = 'No Clerk keys configured';
  if (apps.length > 0) {
    apps.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const latest = apps[0];
    const pk = latest.clerk?.publishableKey || '';
    clerkOk = pk.startsWith('pk_test_') || pk.startsWith('pk_live_');
    if (clerkOk) clerkDetail = `${pk.slice(0, 12)}...`;
  }

  // Also check .env for backward compat (deploy-cloudflare.js reads from .env)
  if (!clerkOk) {
    const env = loadEnvFile(ctx.projectRoot);
    const envKey = env.VITE_CLERK_PUBLISHABLE_KEY || '';
    if (validateClerkKey(envKey)) {
      clerkOk = true;
      clerkDetail = `${envKey.slice(0, 12)}... (from .env)`;
    }
  }

  // Check Cloudflare from registry
  const cfConfig = getCloudflareConfig();
  const cfOk = !!(cfConfig.apiKey && cfConfig.email);
  const cfDetail = cfOk ? cfConfig.email : 'No Cloudflare credentials configured';

  // OpenRouter from .env (unchanged -- per-project, not global)
  const orKey = loadOpenRouterKey(ctx.projectRoot);
  const openrouterOk = !!orKey;

  return {
    clerk: { ok: clerkOk, detail: clerkDetail },
    cloudflare: { ok: cfOk, detail: cfDetail },
    openrouter: {
      ok: openrouterOk,
      detail: openrouterOk ? `sk-or-...${orKey.slice(-6)}` : 'No OPENROUTER_API_KEY in .env',
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

    // --- Clerk credentials ---
    if (body.clerkPublishableKey || body.clerkSecretKey) {
      const pk = body.clerkPublishableKey || '';
      const sk = body.clerkSecretKey || '';

      if (pk && !validateClerkKey(pk)) {
        errors.clerkPublishableKey = 'Invalid Clerk publishable key (must start with pk_test_ or pk_live_)';
      }
      if (sk && !validateClerkSecretKey(sk)) {
        errors.clerkSecretKey = 'Invalid Clerk secret key (must start with sk_test_ or sk_live_)';
      }

      if (!errors.clerkPublishableKey && !errors.clerkSecretKey && (pk || sk)) {
        // Save to registry
        setApp('_default', {
          name: '_default',
          clerk: { publishableKey: pk, secretKey: sk },
        });

        // Also write to .env for backward compatibility
        // deploy-cloudflare.js reads Clerk keys from .env via loadEnvFile()
        const envVars = {};
        if (pk) envVars.VITE_CLERK_PUBLISHABLE_KEY = pk;
        if (sk) envVars.CLERK_SECRET_KEY = sk;
        writeEnvFile(ctx.projectRoot, envVars);
      }
    }

    // --- Cloudflare credentials ---
    if (body.cloudflareApiKey || body.cloudflareEmail) {
      const apiKey = body.cloudflareApiKey || '';
      const email = body.cloudflareEmail || '';

      if (apiKey && apiKey.length < 20) {
        errors.cloudflareApiKey = 'Cloudflare Global API Key appears too short';
      }
      if (email && (!email.includes('@') || !email.includes('.'))) {
        errors.cloudflareEmail = 'Invalid email address';
      }

      if (!errors.cloudflareApiKey && !errors.cloudflareEmail && (apiKey || email)) {
        const cfUpdate = {};
        if (apiKey) cfUpdate.apiKey = apiKey;
        if (email) cfUpdate.email = email;
        if (body.cloudflareAccountId) cfUpdate.accountId = body.cloudflareAccountId;
        setCloudflareConfig(cfUpdate);
      }
    }

    // --- OpenRouter key (per-project, saved to .env not registry) ---
    if (body.openRouterKey) {
      if (body.openRouterKey.startsWith('sk-or-')) {
        writeEnvFile(ctx.projectRoot, { OPENROUTER_API_KEY: body.openRouterKey });
        ctx.openRouterKey = body.openRouterKey;
        console.log('OpenRouter API key updated from wizard');
      } else {
        errors.openRouterKey = 'Invalid OpenRouter key (must start with sk-or-)';
      }
    }

    if (Object.keys(errors).length > 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, errors }));
    }

    const statusResult = await checkEditorDeps(ctx);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, status: statusResult }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, errors: { _: err.message } }));
  }
}

/**
 * Validate Cloudflare Global API Key + email via the Cloudflare HTTP API.
 * Calls GET /client/v4/accounts with X-Auth-Key/X-Auth-Email headers.
 *
 * @param {string} apiKey - Cloudflare Global API Key
 * @param {string} email - Cloudflare account email
 * @returns {Promise<{valid: boolean, accountId?: string, error?: string}>}
 */
export async function validateCloudflareCredentials(apiKey, email) {
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
      headers: {
        'X-Auth-Key': apiKey,
        'X-Auth-Email': email,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();

    if (!data.success || !res.ok) {
      const errMsg = data.errors?.[0]?.message || 'Authentication failed';
      return { valid: false, error: errMsg + '. Check your Global API Key and email.' };
    }

    const accountId = data.result?.[0]?.id || null;
    if (!accountId) {
      return { valid: false, error: 'No accounts found for this API key.' };
    }

    return { valid: true, accountId };
  } catch (err) {
    return { valid: false, error: 'Failed to reach Cloudflare API: ' + err.message };
  }
}

export async function validateCloudflare(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    const { apiKey, email } = body;
    if (!apiKey || !email) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ valid: false, error: 'API key and email are required.' }));
    }
    const result = await validateCloudflareCredentials(apiKey, email);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ valid: false, error: err.message }));
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
