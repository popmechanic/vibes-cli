/**
 * Editor API handlers — credentials, app CRUD, screenshots, status.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join } from 'path';
import { loadEnvFile, validateClerkKey, validateClerkSecretKey, writeEnvFile } from '../../lib/env-utils.js';
import { loadOpenRouterKey } from '../config.js';
import { loadRegistry, getCloudflareConfig, setCloudflareConfig, getApp, setApp } from '../../lib/registry.js';

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

/**
 * Parse JSON body from an HTTP request.
 * Rejects with 413 if body exceeds MAX_BODY_SIZE.
 */
export function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        return;
      }
      body += chunk;
    });
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

  // Check Cloudflare from registry — supports both API Token and Global API Key
  const cfConfig = getCloudflareConfig();
  const cfOk = !!(cfConfig.apiToken || (cfConfig.apiKey && cfConfig.email));
  const cfDetail = cfOk
    ? (cfConfig.apiToken ? 'API Token configured' : cfConfig.email)
    : 'No Cloudflare credentials configured';

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
        // _default is a sentinel app entry used by the wizard for credential status
        // checks. It stores Clerk keys in the registry so checkEditorDeps() can
        // verify them without reading .env. Deploy reads from .env (written below).
        // Merge with existing _default entry so partial saves don't clobber the
        // other key (e.g., saving pk alone shouldn't erase sk).
        const existing = getApp('_default');
        const existingClerk = existing?.clerk || {};
        setApp('_default', {
          name: '_default',
          clerk: {
            publishableKey: pk || existingClerk.publishableKey || '',
            secretKey: sk || existingClerk.secretKey || '',
          },
        });

        // Also write to .env for backward compatibility
        // deploy-cloudflare.js reads Clerk keys from .env via loadEnvFile()
        const envVars = {};
        if (pk) envVars.VITE_CLERK_PUBLISHABLE_KEY = pk;
        if (sk) envVars.CLERK_SECRET_KEY = sk;
        writeEnvFile(ctx.projectRoot, envVars);
      }
    }

    // --- Cloudflare credentials (API Token or Global API Key + email) ---
    if (body.cloudflareApiToken || body.cloudflareApiKey || body.cloudflareEmail) {
      const apiToken = body.cloudflareApiToken || '';
      const apiKey = body.cloudflareApiKey || '';
      const email = body.cloudflareEmail || '';

      if (apiKey && apiKey.length < 20) {
        errors.cloudflareApiKey = 'Cloudflare Global API Key appears too short';
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.cloudflareEmail = 'Invalid email address';
      }

      if (!errors.cloudflareApiKey && !errors.cloudflareEmail) {
        const cfUpdate = {};
        if (apiToken) cfUpdate.apiToken = apiToken;
        if (apiKey) cfUpdate.apiKey = apiKey;
        if (email) cfUpdate.email = email;
        if (body.cloudflareAccountId) cfUpdate.accountId = body.cloudflareAccountId;
        if (Object.keys(cfUpdate).length > 0) setCloudflareConfig(cfUpdate);
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
 * Validate Cloudflare credentials via the Cloudflare HTTP API.
 * Supports two auth modes:
 *   - API Token (preferred, scoped): GET /client/v4/user/tokens/verify
 *     with Authorization: Bearer <token>
 *   - Global API Key (legacy): GET /client/v4/accounts
 *     with X-Auth-Key/X-Auth-Email headers
 *
 * @param {object} opts
 * @param {string} [opts.apiToken] - Cloudflare API Token (scoped)
 * @param {string} [opts.apiKey] - Cloudflare Global API Key
 * @param {string} [opts.email] - Cloudflare account email (required with apiKey)
 * @returns {Promise<{valid: boolean, accountId?: string, authMode?: string, error?: string}>}
 */
export async function validateCloudflareCredentials({ apiToken, apiKey, email } = {}) {
  try {
    if (apiToken) {
      // Scoped API Token — verify via token verify endpoint
      const verifyRes = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      });
      const verifyData = await verifyRes.json();
      if (!verifyData.success || !verifyRes.ok) {
        const errMsg = verifyData.errors?.[0]?.message || 'Token verification failed';
        return { valid: false, error: errMsg + '. Check your API Token.' };
      }

      // Token is valid — fetch account ID via accounts endpoint
      const acctRes = await fetch('https://api.cloudflare.com/client/v4/accounts', {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      });
      const acctData = await acctRes.json();
      const accountId = acctData.result?.[0]?.id || null;

      return { valid: true, accountId, authMode: 'api-token' };
    }

    if (apiKey && email) {
      // Global API Key — verify via accounts endpoint with legacy headers
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

      return { valid: true, accountId, authMode: 'global-api-key' };
    }

    return { valid: false, error: 'Provide either an API Token or a Global API Key + email.' };
  } catch (err) {
    return { valid: false, error: 'Failed to reach Cloudflare API: ' + err.message };
  }
}

export async function validateCloudflare(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    const { apiToken, apiKey, email } = body;
    if (!apiToken && (!apiKey || !email)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ valid: false, error: 'Provide an API Token, or a Global API Key + email.' }));
    }
    const result = await validateCloudflareCredentials({ apiToken, apiKey, email });
    const statusCode = result.valid ? 200 : 400;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  } catch (err) {
    const statusCode = err.statusCode || 400;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
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

/**
 * Sanitize an app name to prevent path traversal.
 * Strips everything except alphanumeric chars and hyphens.
 */
function sanitizeAppName(name) {
  if (!name) return '';
  return name.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 63);
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
  const name = sanitizeAppName(params.get('name'));
  if (!name) { res.writeHead(400); return res.end('Missing name'); }
  const imgPath = join(ctx.appsDir, name, 'screenshot.png');
  if (!existsSync(imgPath)) { res.writeHead(404); return res.end('No screenshot'); }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
  return res.end(readFileSync(imgPath));
}

export function saveScreenshot(ctx, req, res, url) {
  const params = url.searchParams;
  const name = sanitizeAppName(params.get('name'));
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
