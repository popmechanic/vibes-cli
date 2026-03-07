/**
 * HTTP route table — Bun.serve Response API.
 *
 * Handler signature: (ctx, req, url) => Response | Promise<Response>
 * Static file fallback uses Bun.file() for zero-copy serving.
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync, writeFileSync } from 'fs';
import { join, extname, resolve } from 'path';
import type { ServerContext } from './config.ts';
import { getRecommendedThemeIds, loadOpenRouterKey } from './config.ts';
import { assembleAppFrame } from './handlers/generate.ts';
import { loadEnvFile, validateClerkKey, validateClerkSecretKey, extractClerkDomain, writeEnvFile } from '../lib/env-utils.js';
import { loadRegistry, getCloudflareConfig, setCloudflareConfig, getApp, setApp } from '../lib/registry.js';

// --- Body parsing helpers ---

const MAX_BODY_SIZE = 1024 * 1024; // 1MB
const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024; // 5MB

export async function parseJsonBody(req: Request, maxSize = MAX_BODY_SIZE): Promise<any> {
  const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
  if (contentLength > maxSize) {
    throw Object.assign(new Error('Request body too large'), { status: 413 });
  }

  const reader = req.body?.getReader();
  if (!reader) throw new Error('No request body');

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxSize) {
        reader.cancel();
        throw Object.assign(new Error('Request body too large'), { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new TextDecoder().decode(Buffer.concat(chunks));
  return JSON.parse(body);
}

export async function readBodyWithLimit(req: Request, maxSize: number): Promise<Buffer> {
  const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
  if (contentLength > maxSize) {
    throw Object.assign(new Error('Body too large'), { status: 413 });
  }

  const reader = req.body?.getReader();
  if (!reader) throw new Error('No request body');

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxSize) {
        reader.cancel();
        throw Object.assign(new Error('Body too large'), { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

// --- CORS helper ---

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data: any, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders },
  });
}

// --- SSRF guard patterns ---

const PRIVATE_PATTERNS = /^(localhost|127\.|10\.|169\.254\.|192\.168\.|0\.)/;
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./;
const IS_IP = /^\d+\.\d+\.\d+\.\d+$/;

// --- Sanitize helpers ---

function sanitizeAppName(name: string): string {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 63);
}

// --- Editor API helpers ---

async function checkEditorDeps(ctx: ServerContext) {
  const reg = loadRegistry();
  let clerkOk = false;
  let clerkDetail = 'No Clerk keys configured';
  let validatedPk = '';
  let validatedSk = '';

  const defaultApp = reg.apps._default;
  const defaultPk = defaultApp?.clerk?.publishableKey || '';
  if (defaultPk.startsWith('pk_test_') || defaultPk.startsWith('pk_live_')) {
    clerkOk = true;
    clerkDetail = `${defaultPk.slice(0, 12)}...`;
    validatedPk = defaultPk;
    const sk = defaultApp?.clerk?.secretKey || '';
    if (sk.startsWith('sk_test_') || sk.startsWith('sk_live_')) validatedSk = sk;
  }

  if (!clerkOk) {
    const apps = Object.entries(reg.apps).filter(([key]: [string, any]) => key !== '_default').map(([, v]: [string, any]) => v);
    if (apps.length > 0) {
      apps.sort((a: any, b: any) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
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

  const cfConfig = getCloudflareConfig();
  const cfOk = !!(cfConfig.apiToken || (cfConfig.apiKey && cfConfig.email));
  const cfDetail = cfOk
    ? (cfConfig.apiToken ? 'API Token configured' : cfConfig.email)
    : 'No Cloudflare credentials configured';

  const orKey = loadOpenRouterKey(ctx.projectRoot);
  const openrouterOk = !!orKey;

  const maskKey = (value: string, prefixLen: number, suffixLen = 4) =>
    value.length <= prefixLen + suffixLen
      ? value.slice(0, prefixLen) + '...'
      : value.slice(0, prefixLen) + '...' + value.slice(-suffixLen);

  const maskedKeys: Record<string, string> = {};
  if (clerkOk && validatedPk) {
    maskedKeys.clerkPublishableKey = maskKey(validatedPk, 12);
    if (validatedSk) maskedKeys.clerkSecretKey = maskKey(validatedSk, 12);
  }
  if (cfOk) {
    if (cfConfig.apiToken) maskedKeys.cloudflareApiToken = maskKey(cfConfig.apiToken, 6);
    if (cfConfig.email) {
      if (!cfConfig.email.includes('@')) {
        maskedKeys.cloudflareEmail = '***';
      } else {
        const [local, domain] = cfConfig.email.split('@');
        maskedKeys.cloudflareEmail = local.charAt(0) + '***@' + (domain || '');
      }
    }
  }
  if (openrouterOk) maskedKeys.openRouterKey = 'sk-or-...' + orKey!.slice(-6);

  return {
    clerk: { ok: clerkOk, detail: clerkDetail },
    cloudflare: { ok: cfOk, detail: cfDetail },
    openrouter: {
      ok: openrouterOk,
      detail: openrouterOk ? `sk-or-...${orKey!.slice(-6)}` : 'No OPENROUTER_API_KEY in .env',
    },
    maskedKeys,
  };
}

async function validateClerkCredentials({ publishableKey }: { publishableKey?: string } = {}) {
  const CLERK_TIMEOUT_MS = 10_000;
  if (!publishableKey) return { valid: false, error: 'No publishable key provided.' };

  const domain = extractClerkDomain(publishableKey);
  if (!domain) return { valid: false, error: 'Could not decode domain from publishable key. Make sure you copied the full key.' };
  if (domain.includes('@')) return { valid: false, error: 'Invalid Clerk domain. The key encodes a userinfo bypass.' };

  let fapiUrl: URL;
  try { fapiUrl = new URL('https://' + domain + '/v1/environment'); } catch { return { valid: false, error: 'Invalid Clerk domain. The key encodes a malformed URL.' }; }

  const hostname = fapiUrl.hostname;
  if (IS_IP.test(hostname) || hostname.startsWith('[') || PRIVATE_PATTERNS.test(hostname) || PRIVATE_172.test(hostname)) {
    return { valid: false, error: 'Invalid Clerk domain. The key encodes an IP address or reserved hostname.' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLERK_TIMEOUT_MS);
  try {
    const res = await fetch(fapiUrl.href, { headers: { 'Authorization': `Bearer ${publishableKey}` }, signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return { valid: true };
    if (res.status === 401 || res.status === 403) return { valid: false, error: 'Key was rejected by Clerk.' };
    return { valid: false, error: `Clerk API returned status ${res.status}.` };
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return { valid: false, error: 'Clerk API request timed out (10s).' };
    if (err.cause?.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) return { valid: false, error: 'The domain encoded in this key does not exist.' };
    return { valid: false, error: 'Failed to reach Clerk API: ' + err.message };
  }
}

async function validateCloudflareCredentials({ apiToken, apiKey, email }: { apiToken?: string; apiKey?: string; email?: string } = {}) {
  const CF_TIMEOUT_MS = 10_000;
  try {
    if (apiToken) {
      const verifyCtrl = new AbortController();
      const verifyTimer = setTimeout(() => verifyCtrl.abort(), CF_TIMEOUT_MS);
      const verifyRes = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        signal: verifyCtrl.signal,
      });
      clearTimeout(verifyTimer);
      const verifyData = await verifyRes.json() as any;
      if (!verifyData.success || !verifyRes.ok) return { valid: false, error: (verifyData.errors?.[0]?.message || 'Token verification failed') + '. Check your API Token.' };

      const acctCtrl = new AbortController();
      const acctTimer = setTimeout(() => acctCtrl.abort(), CF_TIMEOUT_MS);
      const acctRes = await fetch('https://api.cloudflare.com/client/v4/accounts', {
        headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        signal: acctCtrl.signal,
      });
      clearTimeout(acctTimer);
      const acctData = await acctRes.json() as any;
      const accountId = acctData.result?.[0]?.id || null;
      if (!accountId) return { valid: false, error: 'Token valid but no accounts accessible.' };
      return { valid: true, accountId, authMode: 'api-token' };
    }

    if (apiKey && email) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CF_TIMEOUT_MS);
      const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
        headers: { 'X-Auth-Key': apiKey, 'X-Auth-Email': email, 'Content-Type': 'application/json' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json() as any;
      if (!data.success || !res.ok) return { valid: false, error: (data.errors?.[0]?.message || 'Authentication failed') + '. Check your Global API Key and email.' };
      const accountId = data.result?.[0]?.id || null;
      if (!accountId) return { valid: false, error: 'No accounts found for this API key.' };
      return { valid: true, accountId, authMode: 'global-api-key' };
    }

    return { valid: false, error: 'Provide either an API Token or a Global API Key + email.' };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'Cloudflare API request timed out (10s).' : 'Failed to reach Cloudflare API: ' + err.message;
    return { valid: false, error: msg };
  }
}

// --- Route table ---

type RouteHandler = (ctx: ServerContext, req: Request, url: URL) => Response | Promise<Response>;

function serveHtml(ctx: ServerContext): Response {
  const htmlFile = ctx.mode === 'editor' ? 'editor.html' : 'preview.html';
  const htmlPath = join(ctx.projectRoot, 'skills/vibes/templates', htmlFile);
  if (!existsSync(htmlPath)) return new Response(`${htmlFile} not found`, { status: 404, headers: corsHeaders() });
  return new Response(readFileSync(htmlPath, 'utf-8'), { headers: { 'Content-Type': 'text/html', ...corsHeaders() } });
}

function serveAppJsx(ctx: ServerContext): Response {
  const appPath = join(ctx.projectRoot, 'app.jsx');
  if (!existsSync(appPath)) return new Response('// app.jsx not yet generated\n', { headers: { 'Content-Type': 'text/javascript', ...corsHeaders() } });
  return new Response(readFileSync(appPath, 'utf-8'), { headers: { 'Content-Type': 'text/javascript', ...corsHeaders() } });
}

function serveThemes(ctx: ServerContext): Response {
  const recommended = getRecommendedThemeIds(ctx);
  const result = ctx.themes.map((t: any) => ({ ...t, recommended: recommended.has(t.id), colors: ctx.themeColors[t.id] || null }));
  return json(result);
}

function serveHasKey(ctx: ServerContext): Response {
  return json({ hasKey: !!ctx.openRouterKey });
}

function serveAnimations(ctx: ServerContext): Response {
  return json(ctx.animations);
}

function serveAppFrame(ctx: ServerContext): Response {
  const appPath = join(ctx.projectRoot, 'app.jsx');
  if (!existsSync(appPath)) {
    return new Response(`<!DOCTYPE html>
<html><head><style>
  body { margin: 0; display: flex; align-items: center; justify-content: center;
         height: 100vh; font-family: system-ui; color: #888; background: inherit; }
</style></head>
<body><p>Waiting for app to be generated...</p></body></html>`, {
      headers: { 'Content-Type': 'text/html', ...corsHeaders() },
    });
  }
  const assembled = assembleAppFrame(ctx);
  return new Response(assembled, { headers: { 'Content-Type': 'text/html', ...corsHeaders() } });
}

// --- Editor API route handlers ---

async function editorStatus(ctx: ServerContext): Promise<Response> {
  const result = await checkEditorDeps(ctx);
  return json(result);
}

function editorInitialPrompt(ctx: ServerContext): Response {
  return json({ prompt: ctx.initialPrompt });
}

function editorAppExists(ctx: ServerContext): Response {
  return json({ exists: existsSync(join(ctx.projectRoot, 'app.jsx')) });
}

async function editorSaveCredentials(ctx: ServerContext, req: Request): Promise<Response> {
  try {
    const body = await parseJsonBody(req);
    const errors: Record<string, string> = {};

    const pk = body.clerkPublishableKey || '';
    const sk = body.clerkSecretKey || '';
    const hasClerk = !!(pk || sk);

    if (pk && !validateClerkKey(pk)) {
      if (validateClerkSecretKey(pk)) errors.clerkPublishableKey = 'This looks like a secret key.';
      else errors.clerkPublishableKey = 'Publishable key must start with pk_test_ or pk_live_.';
    }
    if (sk && !validateClerkSecretKey(sk)) {
      if (validateClerkKey(sk)) errors.clerkSecretKey = 'This looks like a publishable key.';
      else errors.clerkSecretKey = 'Secret key must start with sk_test_ or sk_live_.';
    }

    const apiToken = body.cloudflareApiToken || '';
    const apiKey = body.cloudflareApiKey || '';
    const email = body.cloudflareEmail || '';
    const hasCf = !!(apiToken || apiKey || email);

    if (apiToken && apiToken.length < 40) errors.cloudflareApiToken = 'Cloudflare API Token appears too short';
    if (apiKey && apiKey.length < 20) errors.cloudflareApiKey = 'Cloudflare Global API Key appears too short';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.cloudflareEmail = 'Invalid email address';
    if (!apiToken && apiKey && !email) errors.cloudflareEmail = 'Email is required with Global API Key';
    if (!apiToken && email && !apiKey) errors.cloudflareApiKey = 'Global API Key is required with email';

    const hasOpenRouter = !!body.openRouterKey;
    if (hasOpenRouter && !body.openRouterKey.startsWith('sk-or-')) errors.openRouterKey = 'Invalid OpenRouter key (must start with sk-or-)';

    if (Object.keys(errors).length > 0) return json({ ok: false, errors }, 400);

    if (hasClerk) {
      const existing = getApp('_default');
      const existingClerk = existing?.clerk || {};
      setApp('_default', {
        name: '_default',
        clerk: { publishableKey: pk || existingClerk.publishableKey || '', secretKey: sk || existingClerk.secretKey || '' },
      });
      const envVars: Record<string, string> = {};
      if (pk) envVars.VITE_CLERK_PUBLISHABLE_KEY = pk;
      if (sk) { envVars.CLERK_SECRET_KEY = sk; envVars.VITE_CLERK_SECRET_KEY = sk; }
      writeEnvFile(ctx.projectRoot, envVars);
    }

    if (hasCf) {
      const cfUpdate: Record<string, any> = {};
      if (apiToken) { cfUpdate.apiToken = apiToken; cfUpdate.apiKey = null; cfUpdate.email = null; }
      else if (apiKey || email) { cfUpdate.apiToken = null; if (apiKey) cfUpdate.apiKey = apiKey; if (email) cfUpdate.email = email; }
      if (body.cloudflareAccountId) cfUpdate.accountId = body.cloudflareAccountId;
      if (Object.keys(cfUpdate).length > 0) setCloudflareConfig(cfUpdate);
    }

    if (hasOpenRouter) {
      writeEnvFile(ctx.projectRoot, { OPENROUTER_API_KEY: body.openRouterKey });
      ctx.openRouterKey = body.openRouterKey;
    }

    const statusResult = await checkEditorDeps(ctx);
    return json({ ok: true, status: statusResult });
  } catch (err: any) {
    return json({ ok: false, errors: { _: err.message } }, err.status || 400);
  }
}

async function editorValidateClerk(ctx: ServerContext, req: Request): Promise<Response> {
  try {
    const body = await parseJsonBody(req);
    if (!body.publishableKey) return json({ valid: false, error: 'Provide a publishable key.' }, 400);
    const result = await validateClerkCredentials({ publishableKey: body.publishableKey });
    return json(result, result.valid ? 200 : 400);
  } catch (err: any) {
    return json({ valid: false, error: err.message }, err.status || 400);
  }
}

async function editorValidateCloudflare(ctx: ServerContext, req: Request): Promise<Response> {
  try {
    const body = await parseJsonBody(req);
    if (!body.apiToken && (!body.apiKey || !body.email)) return json({ valid: false, error: 'Provide an API Token, or a Global API Key + email.' }, 400);
    const result = await validateCloudflareCredentials({ apiToken: body.apiToken, apiKey: body.apiKey, email: body.email });
    return json(result, result.valid ? 200 : 400);
  } catch (err: any) {
    return json({ valid: false, error: err.message }, err.status || 400);
  }
}

function editorListApps(ctx: ServerContext): Response {
  try {
    const apps: any[] = [];
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
    apps.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    return json(apps);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

function editorGetScreenshot(ctx: ServerContext, url: URL): Response {
  const name = sanitizeAppName(url.searchParams.get('name') || '');
  if (!name) return new Response('Missing name', { status: 400, headers: corsHeaders() });
  const imgPath = join(ctx.appsDir, name, 'screenshot.png');
  if (!existsSync(imgPath)) return new Response('No screenshot', { status: 404, headers: corsHeaders() });
  return new Response(readFileSync(imgPath), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', ...corsHeaders() } });
}

function editorLoadApp(ctx: ServerContext, url: URL): Response {
  const name = sanitizeAppName(url.searchParams.get('name') || '');
  if (!name) return new Response('Missing name', { status: 400, headers: corsHeaders() });
  const src = join(ctx.appsDir, name, 'app.jsx');
  if (!existsSync(src)) return new Response('App not found', { status: 404, headers: corsHeaders() });
  copyFileSync(src, join(ctx.projectRoot, 'app.jsx'));
  return json({ ok: true });
}

function editorSaveApp(ctx: ServerContext, url: URL): Response {
  const name = sanitizeAppName(url.searchParams.get('name') || '');
  if (!name) return new Response('Missing name', { status: 400, headers: corsHeaders() });
  const appSrc = join(ctx.projectRoot, 'app.jsx');
  if (!existsSync(appSrc)) return new Response('No app.jsx to save', { status: 404, headers: corsHeaders() });
  const dest = join(ctx.appsDir, name);
  mkdirSync(dest, { recursive: true });
  copyFileSync(appSrc, join(dest, 'app.jsx'));
  return json({ ok: true });
}

async function editorSaveScreenshot(ctx: ServerContext, req: Request, url: URL): Promise<Response> {
  const name = sanitizeAppName(url.searchParams.get('name') || '');
  if (!name) return new Response('Missing name', { status: 400, headers: corsHeaders() });
  const dest = join(ctx.appsDir, name);
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  try {
    const body = await readBodyWithLimit(req, MAX_SCREENSHOT_SIZE);
    writeFileSync(join(dest, 'screenshot.png'), body);
    return json({ ok: true });
  } catch (err: any) {
    if (err.status === 413) return json({ error: 'Screenshot too large (max 5MB)' }, 413);
    return json({ error: err.message }, 400);
  }
}

async function editorWriteApp(ctx: ServerContext, req: Request): Promise<Response> {
  try {
    const body = await readBodyWithLimit(req, MAX_BODY_SIZE);
    writeFileSync(join(ctx.projectRoot, 'app.jsx'), body.toString('utf-8'));
    return json({ ok: true });
  } catch (err: any) {
    return json({ error: err.message }, err.status || 400);
  }
}

function editorListDeployments(ctx: ServerContext): Response {
  try {
    const reg = loadRegistry();
    const deployments = Object.values(reg.apps || {})
      .filter((app: any) => app.app && app.app.url)
      .map((app: any) => ({ name: app.name, url: app.app.url, updatedAt: app.updatedAt || app.createdAt }))
      .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return json(deployments);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// --- Create Router ---

export function createRouter(ctx: ServerContext) {
  const MIME: Record<string, string> = {
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

  return async (req: Request, url: URL): Promise<Response> => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const key = `${req.method} ${url.pathname}`;

    // Route table
    switch (key) {
      case 'GET /':
      case 'GET /index.html':               return serveHtml(ctx);
      case 'GET /app.jsx':                   return serveAppJsx(ctx);
      case 'GET /themes':                    return serveThemes(ctx);
      case 'GET /themes/has-key':            return serveHasKey(ctx);
      case 'GET /animations':               return serveAnimations(ctx);
      case 'GET /app-frame':                return serveAppFrame(ctx);
      case 'GET /editor/status':            return editorStatus(ctx);
      case 'GET /editor/initial-prompt':    return editorInitialPrompt(ctx);
      case 'GET /editor/app-exists':        return editorAppExists(ctx);
      case 'GET /editor/apps':              return editorListApps(ctx);
      case 'GET /editor/apps/screenshot':   return editorGetScreenshot(ctx, url);
      case 'POST /editor/credentials':      return editorSaveCredentials(ctx, req);
      case 'POST /editor/credentials/validate-cloudflare': return editorValidateCloudflare(ctx, req);
      case 'POST /editor/credentials/validate-clerk': return editorValidateClerk(ctx, req);
      case 'POST /editor/apps/load':        return editorLoadApp(ctx, url);
      case 'POST /editor/apps/save':        return editorSaveApp(ctx, url);
      case 'POST /editor/apps/screenshot':  return editorSaveScreenshot(ctx, req, url);
      case 'POST /editor/apps/write':       return editorWriteApp(ctx, req);
      case 'GET /editor/deployments':       return editorListDeployments(ctx);
    }

    // Bundle files
    if (url.pathname === '/fireproof-vibes-bridge.js' || url.pathname === '/fireproof-clerk-bundle.js') {
      const bundlePath = join(ctx.projectRoot, 'bundles', url.pathname.slice(1));
      const file = Bun.file(bundlePath);
      if (await file.exists()) {
        return new Response(file, { headers: { 'Content-Type': 'text/javascript', ...corsHeaders() } });
      }
    }

    // Static file fallback — path containment check prevents directory traversal
    const filePath = resolve(ctx.projectRoot, url.pathname.slice(1));
    if (!filePath.startsWith(resolve(ctx.projectRoot))) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders() });
    }
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const ext = extname(filePath);
      return new Response(file, { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', ...corsHeaders() } });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders() });
  };
}
