/**
 * Editor API handlers — credentials, app CRUD, screenshots, status.
 *
 * NOTE: This file is the original Node.js version retained for integration tests
 * (editor-api-cloudflare.test.js, wizard-flow.test.js). Production serving uses
 * router.ts which has these functions ported inline with the Bun Response API.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join } from 'path';
import { loadEnvFile, validateClerkKey, validateClerkSecretKey, writeEnvFile } from '../../lib/env-utils.js';
// .ts extension works under vitest (esbuild transform) — this file is test-only
import { loadOpenRouterKey } from '../config.ts';
import { loadRegistry, getCloudflareConfig, setCloudflareConfig, getApp, setApp } from '../../lib/registry.js';
// Shared validation — single source of truth for SSRF guards + credential validators
import { validateClerkCredentials, validateCloudflareCredentials } from '../validation.ts';

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

// Re-export validateClerkCredentials from shared validation module for test backward compat
export { validateClerkCredentials } from '../validation.ts';

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

// Re-export validateCloudflareCredentials from shared validation module for test backward compat
export { validateCloudflareCredentials } from '../validation.ts';

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
