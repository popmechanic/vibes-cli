/**
 * Editor API handlers — credentials, app CRUD, screenshots, status.
 *
 * NOTE: This file is the original Node.js version retained for integration tests
 * (editor-api-cloudflare.test.js, wizard-flow.test.js). Production serving uses
 * router.ts which has these functions ported inline with the Bun Response API.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join } from 'path';
import { loadEnvFile, validateClerkKey, validateClerkSecretKey, extractClerkDomain, writeEnvFile } from '../../lib/env-utils.js';
// .ts extension works under vitest (esbuild transform) — this file is test-only
import { loadOpenRouterKey } from '../config.ts';
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
  // Check Clerk from registry — look for _default sentinel first, then most recent app
  const reg = loadRegistry();
  let clerkOk = false;
  let clerkDetail = 'No Clerk keys configured';
  let validatedPk = '';
  let validatedSk = '';

  // Prefer _default (wizard sentinel entry)
  const defaultApp = reg.apps._default;
  const defaultPk = defaultApp?.clerk?.publishableKey || '';
  if (defaultPk.startsWith('pk_test_') || defaultPk.startsWith('pk_live_')) {
    clerkOk = true;
    clerkDetail = `${defaultPk.slice(0, 12)}...`;
    validatedPk = defaultPk;
    const sk = defaultApp?.clerk?.secretKey || '';
    if (sk.startsWith('sk_test_') || sk.startsWith('sk_live_')) validatedSk = sk;
  }

  // Fall back to most recent real app entry (filter by key, not name property)
  if (!clerkOk) {
    const apps = Object.entries(reg.apps).filter(([key]) => key !== '_default').map(([, v]) => v);
    if (apps.length > 0) {
      apps.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      const pk = apps[0].clerk?.publishableKey || '';
      clerkOk = pk.startsWith('pk_test_') || pk.startsWith('pk_live_');
      if (clerkOk) {
        clerkDetail = `${pk.slice(0, 12)}...`;
        validatedPk = pk;
        const sk = apps[0].clerk?.secretKey || '';
        if (sk.startsWith('sk_test_') || sk.startsWith('sk_live_')) validatedSk = sk;
      }
    }
  }

  // Also check .env for backward compat (deploy-cloudflare.js reads from .env)
  if (!clerkOk) {
    const env = loadEnvFile(ctx.projectRoot);
    const envKey = env.VITE_CLERK_PUBLISHABLE_KEY || '';
    if (validateClerkKey(envKey)) {
      clerkOk = true;
      clerkDetail = `${envKey.slice(0, 12)}... (from .env)`;
      validatedPk = envKey;
      const envSk = env.CLERK_SECRET_KEY || '';
      if (envSk.startsWith('sk_test_') || envSk.startsWith('sk_live_')) validatedSk = envSk;
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

  // Build masked key previews for pre-population
  // maskKey: show prefix + '...' + suffix, but omit suffix if key is too short
  const maskKey = (value, prefixLen, suffixLen = 4) =>
    value.length <= prefixLen + suffixLen
      ? value.slice(0, prefixLen) + '...'
      : value.slice(0, prefixLen) + '...' + value.slice(-suffixLen);

  const maskedKeys = {};
  if (clerkOk && validatedPk) {
    maskedKeys.clerkPublishableKey = maskKey(validatedPk, 12);
    if (validatedSk) {
      maskedKeys.clerkSecretKey = maskKey(validatedSk, 12);
    }
  }
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
    clerk: { ok: clerkOk, detail: clerkDetail },
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

    // --- Phase 1: Validate all inputs before writing anything ---

    const pk = body.clerkPublishableKey || '';
    const sk = body.clerkSecretKey || '';
    const hasClerk = !!(pk || sk);

    if (pk && !validateClerkKey(pk)) {
      if (validateClerkSecretKey(pk)) {
        errors.clerkPublishableKey = 'This looks like a secret key. The publishable key starts with pk_test_ or pk_live_.';
      } else {
        errors.clerkPublishableKey = 'Publishable key must start with pk_test_ or pk_live_. Copy it from Clerk Dashboard > Configure > API Keys.';
      }
    }
    if (sk && !validateClerkSecretKey(sk)) {
      if (validateClerkKey(sk)) {
        errors.clerkSecretKey = 'This looks like a publishable key. The secret key starts with sk_test_ or sk_live_.';
      } else {
        errors.clerkSecretKey = 'Secret key must start with sk_test_ or sk_live_. Click "Show" next to the secret key in the Clerk Dashboard.';
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

    // --- Phase 2: All valid — write to registry + .env ---

    if (hasClerk) {
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
      // deploy-cloudflare.js reads CLERK_SECRET_KEY from .env via loadEnvFile()
      // VITE_CLERK_SECRET_KEY written for legacy compat (some older .env files use it)
      const envVars = {};
      if (pk) envVars.VITE_CLERK_PUBLISHABLE_KEY = pk;
      if (sk) {
        envVars.CLERK_SECRET_KEY = sk;
        envVars.VITE_CLERK_SECRET_KEY = sk;
      }
      writeEnvFile(ctx.projectRoot, envVars);
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
 * Validate Clerk credentials by probing the Frontend API.
 * The publishable key encodes a domain (base64). We hit that domain's
 * well-known endpoint to verify the key is real.
 *
 * @param {object} opts
 * @param {string} opts.publishableKey - Clerk publishable key (pk_test_... or pk_live_...)
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function validateClerkCredentials({ publishableKey } = {}) {
  const CLERK_TIMEOUT_MS = 10_000;

  if (!publishableKey) {
    return { valid: false, error: 'No publishable key provided.' };
  }

  // Extract the FAPI domain from the key (uses static import from top of file)
  const domain = extractClerkDomain(publishableKey);
  if (!domain) {
    return { valid: false, error: 'Could not decode domain from publishable key. Make sure you copied the full key.' };
  }

  // SSRF guard: parse the domain through URL constructor to canonicalize,
  // then validate the resolved hostname. This handles all bypass vectors:
  // userinfo (@), Unicode dots, hex/octal IPs, etc.
  if (domain.includes('@')) {
    return { valid: false, error: 'Invalid Clerk domain. The key encodes a userinfo bypass.' };
  }

  let fapiUrl;
  try {
    fapiUrl = new URL('https://' + domain + '/v1/environment');
  } catch {
    return { valid: false, error: 'Invalid Clerk domain. The key encodes a malformed URL.' };
  }

  const hostname = fapiUrl.hostname;
  if (IS_IP.test(hostname) || hostname.startsWith('[') ||
      PRIVATE_PATTERNS.test(hostname) || PRIVATE_172.test(hostname)) {
    return { valid: false, error: 'Invalid Clerk domain. The key encodes an IP address or reserved hostname.' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLERK_TIMEOUT_MS);
  try {
    const res = await fetch(fapiUrl.href, {
      headers: { 'Authorization': `Bearer ${publishableKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      return { valid: true };
    }

    // 401/403 means the key format decoded but isn't valid
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: 'Key was rejected by Clerk. Make sure you copied the correct publishable key from the API Keys page.' };
    }

    return { valid: false, error: `Clerk API returned status ${res.status}. The key may be invalid or the application may be paused.` };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return { valid: false, error: 'Clerk API request timed out (10s). Check your network connection.' };
    }
    // DNS resolution failure means the domain encoded in the key doesn't exist
    if (err.cause?.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
      return { valid: false, error: 'The domain encoded in this key does not exist. Make sure you copied the correct publishable key.' };
    }
    return { valid: false, error: 'Failed to reach Clerk API: ' + err.message };
  }
}

export async function validateClerk(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    const { publishableKey } = body;
    if (!publishableKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ valid: false, error: 'Provide a publishable key.' }));
    }
    const result = await validateClerkCredentials({ publishableKey });
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
