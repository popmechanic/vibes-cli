/**
 * Editor API handlers — credentials, app CRUD, screenshots, status.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { loadEnvFile, validateOIDCAuthority, validateOIDCClientId, validateConnectUrl, deriveStudioUrls, writeEnvFile } from '../../lib/env-utils.js';
import { loadOpenRouterKey } from '../config.js';
import { loadRegistry, getCloudflareConfig, setCloudflareConfig, getApp, setApp } from '../../lib/registry.js';

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

// SSRF guard patterns — module-level for reuse and testability
const PRIVATE_PATTERNS = /^(localhost|127\.|10\.|169\.254\.|192\.168\.|0\.)/;
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./;
const IS_IP = /^\d+\.\d+\.\d+\.\d+$/;

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

async function checkEditorDeps(ctx) {
  const env = loadEnvFile(ctx.projectRoot);

  const oidcAuthority = env.VITE_OIDC_AUTHORITY || '';
  const oidcOk = validateOIDCAuthority(oidcAuthority);

  const apiUrl = env.VITE_API_URL || '';
  const cloudUrl = env.VITE_CLOUD_URL || '';
  const connectOk = !!(apiUrl && cloudUrl);

  // Check Cloudflare from registry — supports both API Token and Global API Key
  const cfConfig = getCloudflareConfig();
  const cfOk = !!(cfConfig.apiToken || (cfConfig.apiKey && cfConfig.email));
  const cfDetail = cfOk
    ? (cfConfig.apiToken ? 'API Token configured' : cfConfig.email)
    : 'No Cloudflare credentials configured';

  // OpenRouter from .env (unchanged -- per-project, not global)
  const orKey = loadOpenRouterKey(ctx.projectRoot);
  const openrouterOk = !!orKey;

  // Build masked key previews for pre-population
  // maskKey: show prefix + '...' + suffix, but omit suffix if key is too short
  const maskKey = (value, prefixLen, suffixLen = 4) =>
    value.length <= prefixLen + suffixLen
      ? value.slice(0, prefixLen) + '...'
      : value.slice(0, prefixLen) + '...' + value.slice(-suffixLen);

  const maskedKeys = {};
  if (cfOk) {
    if (cfConfig.apiToken) {
      maskedKeys.cloudflareApiToken = maskKey(cfConfig.apiToken, 6);
    }
    if (cfConfig.email) {
      if (!cfConfig.email.includes('@')) {
        maskedKeys.cloudflareEmail = '***';
      } else {
        const [local, domain] = cfConfig.email.split('@');
        maskedKeys.cloudflareEmail = local.charAt(0) + '***@' + (domain || '');
      }
    }
  }
  if (openrouterOk) {
    maskedKeys.openRouterKey = 'sk-or-...' + orKey.slice(-6);
  }

  return {
    oidc: {
      ok: oidcOk,
      detail: oidcOk ? oidcAuthority : 'No valid OIDC authority in .env',
    },
    connect: {
      ok: connectOk,
      detail: connectOk ? apiUrl : 'No VITE_API_URL / VITE_CLOUD_URL in .env',
    },
    cloudflare: { ok: cfOk, detail: cfDetail },
    openrouter: {
      ok: openrouterOk,
      detail: openrouterOk ? `sk-or-...${orKey.slice(-6)}` : 'No OPENROUTER_API_KEY in .env',
    },
    maskedKeys,
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

    const apiToken = body.cloudflareApiToken || '';
    const apiKey = body.cloudflareApiKey || '';
    const email = body.cloudflareEmail || '';
    const hasCf = !!(apiToken || apiKey || email);

    if (apiToken && apiToken.length < 40) {
      errors.cloudflareApiToken = 'Cloudflare API Token appears too short';
    }
    if (apiKey && apiKey.length < 20) {
      errors.cloudflareApiKey = 'Cloudflare Global API Key appears too short';
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.cloudflareEmail = 'Invalid email address';
    }
    // Global API Key requires both apiKey and email together
    if (!apiToken && apiKey && !email) {
      errors.cloudflareEmail = 'Email is required with Global API Key';
    }
    if (!apiToken && email && !apiKey) {
      errors.cloudflareApiKey = 'Global API Key is required with email';
    }

    const hasOpenRouter = !!body.openRouterKey;
    if (hasOpenRouter && !body.openRouterKey.startsWith('sk-or-')) {
      errors.openRouterKey = 'Invalid OpenRouter key (must start with sk-or-)';
    }

    // --- Bail on any validation error before writing ---
    if (Object.keys(errors).length > 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, errors }));
    }

    // --- Phase 2: All valid — write to .env and registry ---

    if (Object.keys(validatedVars).length > 0) {
      writeEnvFile(ctx.projectRoot, validatedVars);
    }

    if (hasCf) {
      const cfUpdate = {};
      if (apiToken) {
        // API Token mode — clear legacy Global API Key credentials
        cfUpdate.apiToken = apiToken;
        cfUpdate.apiKey = null;
        cfUpdate.email = null;
      } else if (apiKey || email) {
        // Global API Key mode — clear scoped API Token
        cfUpdate.apiToken = null;
        if (apiKey) cfUpdate.apiKey = apiKey;
        if (email) cfUpdate.email = email;
      }
      if (body.cloudflareAccountId) cfUpdate.accountId = body.cloudflareAccountId;
      if (Object.keys(cfUpdate).length > 0) setCloudflareConfig(cfUpdate);
    }

    if (hasOpenRouter) {
      writeEnvFile(ctx.projectRoot, { OPENROUTER_API_KEY: body.openRouterKey });
      ctx.openRouterKey = body.openRouterKey;
      console.log('OpenRouter API key updated from wizard');
    }

    const statusResult = await checkEditorDeps(ctx);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, status: statusResult }));
  } catch (err) {
    const statusCode = err.statusCode || 400;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, errors: { _: err.message } }));
  }
}

/**
 * Validate OIDC authority by probing the discovery endpoint.
 *
 * @param {object} opts
 * @param {string} opts.authority - OIDC authority URL (e.g., https://pocket-id.example.com)
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function validateOIDCCredentials({ authority } = {}) {
  const OIDC_TIMEOUT_MS = 10_000;

  if (!authority) {
    return { valid: false, error: 'No OIDC authority URL provided.' };
  }

  let discoveryUrl;
  try {
    discoveryUrl = new URL('/.well-known/openid-configuration', authority);
  } catch {
    return { valid: false, error: 'Invalid OIDC authority URL.' };
  }

  const hostname = discoveryUrl.hostname;
  if (IS_IP.test(hostname) || hostname.startsWith('[') ||
      PRIVATE_PATTERNS.test(hostname) || PRIVATE_172.test(hostname)) {
    return { valid: false, error: 'Invalid OIDC authority. The URL resolves to a private or reserved address.' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OIDC_TIMEOUT_MS);
  try {
    const res = await fetch(discoveryUrl.href, { signal: ctrl.signal });
    clearTimeout(timer);

    if (res.ok) {
      return { valid: true };
    }

    return { valid: false, error: `OIDC discovery returned status ${res.status}. Check your authority URL.` };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return { valid: false, error: 'OIDC discovery request timed out (10s). Check your network connection.' };
    }
    if (err.cause?.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
      return { valid: false, error: 'The OIDC authority domain does not exist. Check your URL.' };
    }
    return { valid: false, error: 'Failed to reach OIDC discovery endpoint: ' + err.message };
  }
}

export async function validateOidc(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    const { authority } = body;
    if (!authority) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ valid: false, error: 'Provide an OIDC authority URL.' }));
    }
    const result = await validateOIDCCredentials({ authority });
    const statusCode = result.valid ? 200 : 400;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  } catch (err) {
    const statusCode = err.statusCode || 400;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ valid: false, error: err.message }));
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
  const CF_TIMEOUT_MS = 10_000;

  try {
    if (apiToken) {
      // Scoped API Token — verify via token verify endpoint
      const verifyCtrl = new AbortController();
      const verifyTimer = setTimeout(() => verifyCtrl.abort(), CF_TIMEOUT_MS);
      const verifyRes = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        signal: verifyCtrl.signal,
      });
      clearTimeout(verifyTimer);
      const verifyData = await verifyRes.json();
      if (!verifyData.success || !verifyRes.ok) {
        const errMsg = verifyData.errors?.[0]?.message || 'Token verification failed';
        return { valid: false, error: errMsg + '. Check your API Token.' };
      }

      // Token is valid — fetch account ID via accounts endpoint
      const acctCtrl = new AbortController();
      const acctTimer = setTimeout(() => acctCtrl.abort(), CF_TIMEOUT_MS);
      const acctRes = await fetch('https://api.cloudflare.com/client/v4/accounts', {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        signal: acctCtrl.signal,
      });
      clearTimeout(acctTimer);
      const acctData = await acctRes.json();
      const accountId = acctData.result?.[0]?.id || null;

      if (!accountId) {
        return { valid: false, error: 'Token valid but no accounts accessible. Check token permissions.' };
      }

      return { valid: true, accountId, authMode: 'api-token' };
    }

    if (apiKey && email) {
      // Global API Key — verify via accounts endpoint with legacy headers
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CF_TIMEOUT_MS);
      const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
        headers: {
          'X-Auth-Key': apiKey,
          'X-Auth-Email': email,
          'Content-Type': 'application/json',
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);

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
    const msg = err.name === 'AbortError'
      ? 'Cloudflare API request timed out (10s). Check your network connection.'
      : 'Failed to reach Cloudflare API: ' + err.message;
    return { valid: false, error: msg };
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

export async function checkStudio(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    const { studio } = body;
    if (!studio || typeof studio !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ reachable: false, error: 'Provide a studio name.' }));
    }

    const { apiUrl, cloudUrl } = deriveStudioUrls(studio);

    // SSRF guard on derived URL
    let parsedUrl;
    try {
      parsedUrl = new URL(apiUrl);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ reachable: false, error: 'Invalid studio URL.' }));
    }

    const hostname = parsedUrl.hostname;
    if (IS_IP.test(hostname) || hostname.startsWith('[') ||
        PRIVATE_PATTERNS.test(hostname) || PRIVATE_172.test(hostname)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ reachable: false, error: 'Studio URL resolves to a private address.' }));
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const probe = await fetch(parsedUrl.href, { signal: ctrl.signal });
      clearTimeout(timer);
      // Any HTTP response means the studio is reachable (dashboard API returns 503 for GET)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ reachable: true, apiUrl, cloudUrl }));
    } catch (err) {
      clearTimeout(timer);
      const msg = err.name === 'AbortError'
        ? 'Studio not reachable (timed out after 5s).'
        : 'Studio not reachable: ' + err.message;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ reachable: false, error: msg }));
    }
  } catch (err) {
    const statusCode = err.statusCode || 400;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
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
