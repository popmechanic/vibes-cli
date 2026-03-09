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
import { currentAppDir, resolveAppJsxPath } from './app-context.js';
import { assembleAppFrame } from './handlers/generate.ts';
import { loadRegistry, getCloudflareConfig, setCloudflareConfig, getApp, setApp } from '../lib/registry.js';
import { readCachedTokens, isTokenExpired, getAccessToken, startLoginFlow, removeCachedTokens } from '../lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '../lib/auth-constants.js';
import { validateClerkKey, validateClerkSecretKey, validateClerkCredentials, validateCloudflareCredentials } from './validation.ts';
import { broadcast } from './ws.ts';

// --- Body parsing helpers ---

const MAX_BODY_SIZE = 1024 * 1024; // 1MB for JSON API payloads
const MAX_APP_WRITE_SIZE = 5 * 1024 * 1024; // 5MB for app.jsx writes (inline SVGs/base64 can be large)
const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024; // 5MB

export async function parseJsonBody(req: Request, maxSize = MAX_BODY_SIZE): Promise<any> {
  // Fast-path optimization: reject obviously oversized bodies before reading.
  // Not a security boundary — the streaming accumulator below is the actual enforcement.
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
  // Fast-path optimization: reject obviously oversized bodies before reading.
  // Not a security boundary — the streaming accumulator below is the actual enforcement.
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
// Restrict to localhost origins to prevent drive-by attacks from external websites.
// _corsPort is set once when createRouter() is called.

let _corsPort = 3333;

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': `http://localhost:${_corsPort}`,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(data: any, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders },
  });
}

// --- Sanitize helpers ---

function sanitizeAppName(name: string): string {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
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

// --- Route table ---

type RouteHandler = (ctx: ServerContext, req: Request, url: URL) => Response | Promise<Response>;

async function serveHtml(ctx: ServerContext): Promise<Response> {
  const htmlFile = ctx.mode === 'editor' ? 'editor.html' : 'preview.html';
  const htmlPath = join(ctx.projectRoot, 'skills/vibes/templates', htmlFile);
  const file = Bun.file(htmlPath);
  if (!(await file.exists())) return new Response(`${htmlFile} not found`, { status: 404, headers: corsHeaders() });
  if (ctx.managed) {
    let html = await file.text();
    html = html.replace('<head>', '<head><script>window.__VIBES_DESKTOP__=true</script>');
    return new Response(html, { headers: { 'Content-Type': 'text/html', ...corsHeaders() } });
  }
  return new Response(file, { headers: { 'Content-Type': 'text/html', ...corsHeaders() } });
}

async function serveAppJsx(ctx: ServerContext): Promise<Response> {
  const appPath = resolveAppJsxPath(ctx);
  const file = Bun.file(appPath);
  if (!(await file.exists())) return new Response('// app.jsx not yet generated\n', { headers: { 'Content-Type': 'text/javascript', ...corsHeaders() } });
  return new Response(file, { headers: { 'Content-Type': 'text/javascript', ...corsHeaders() } });
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

function serveSkills(ctx: ServerContext): Response {
  const catalog = ((ctx as any).pluginSkills || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    pluginName: s.pluginName,
    marketplace: s.marketplace,
  }));
  return json(catalog);
}

function serveAppFrame(ctx: ServerContext): Response {
  const appDir = currentAppDir(ctx);
  const appPath = appDir ? join(appDir, 'app.jsx') : null;
  if (!appPath || !existsSync(appPath)) {
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

// --- Auth helpers ---

function parseUserFromIdToken(idToken: string | undefined): any {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return {
      name: decoded.name || decoded.preferred_username || null,
      email: decoded.email || null,
      picture: decoded.picture || null,
    };
  } catch {
    return null;
  }
}

async function checkAuthStatus(): Promise<any> {
  const cached = readCachedTokens();
  if (!cached) return { auth: { state: 'none', user: null } };
  if (!isTokenExpired(cached.expiresAt)) {
    return { auth: { state: 'valid', user: parseUserFromIdToken(cached.idToken) } };
  }
  try {
    const refreshed = await getAccessToken({ authority: OIDC_AUTHORITY, clientId: OIDC_CLIENT_ID, silent: true });
    if (refreshed) return { auth: { state: 'valid', user: parseUserFromIdToken(refreshed.idToken) } };
  } catch {}
  return { auth: { state: 'expired', user: parseUserFromIdToken(cached.idToken) } };
}

// --- Editor API route handlers ---

async function editorStatus(ctx: ServerContext): Promise<Response> {
  const result = await checkAuthStatus();
  return json(result);
}

async function editorAuthLogin(ctx: ServerContext): Promise<Response> {
  try {
    const { authorizeUrl, tokenPromise } = await startLoginFlow({
      authority: OIDC_AUTHORITY,
      clientId: OIDC_CLIENT_ID,
    });

    // Wait for callback in the background, then broadcast via WebSocket
    tokenPromise.then((tokens: any) => {
      const user = parseUserFromIdToken(tokens.idToken);
      broadcast({ type: 'auth_complete', user });
    }).catch((err: any) => {
      console.error('[Auth] Login failed:', err.message);
      broadcast({ type: 'auth_error', error: err.message });
    });

    // Return the authorize URL immediately so frontend can window.open() it
    return json({ ok: true, authorizeUrl });
  } catch (err: any) {
    console.error('[Auth] Could not start login flow:', err.message);
    return json({ ok: false, error: err.message }, 500);
  }
}

function editorAuthLogout(): Response {
  removeCachedTokens();
  return json({ ok: true });
}

function editorInitialPrompt(ctx: ServerContext): Response {
  return json({ prompt: ctx.initialPrompt });
}

function editorAppExists(ctx: ServerContext): Response {
  return json({ exists: existsSync(resolveAppJsxPath(ctx)) });
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
    }

    if (hasCf) {
      const cfUpdate: Record<string, any> = {};
      if (apiToken) { cfUpdate.apiToken = apiToken; cfUpdate.apiKey = null; cfUpdate.email = null; }
      else if (apiKey || email) { cfUpdate.apiToken = null; if (apiKey) cfUpdate.apiKey = apiKey; if (email) cfUpdate.email = email; }
      if (body.cloudflareAccountId) cfUpdate.accountId = body.cloudflareAccountId;
      if (Object.keys(cfUpdate).length > 0) setCloudflareConfig(cfUpdate);
    }

    if (hasOpenRouter) {
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
    const userAppNames = new Set<string>();
    for (const name of readdirSync(ctx.appsDir)) {
      const dir = join(ctx.appsDir, name);
      const appFile = join(dir, 'app.jsx');
      if (!existsSync(appFile)) continue;
      const st = statSync(appFile);
      const firstLine = readFileSync(appFile, 'utf-8').split('\n')[0] || '';
      const themeMatch = firstLine.match(/id:\s*"([^"]+)".*?name:\s*"([^"]+)"/);
      userAppNames.add(name);
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

    // Append bundled examples (skip if user already has an app with the same name)
    if (existsSync(ctx.examplesDir)) {
      for (const name of readdirSync(ctx.examplesDir)) {
        if (userAppNames.has(name)) continue;
        const dir = join(ctx.examplesDir, name);
        const appFile = join(dir, 'app.jsx');
        if (!existsSync(appFile)) continue;
        const firstLine = readFileSync(appFile, 'utf-8').split('\n')[0] || '';
        const themeMatch = firstLine.match(/id:\s*"([^"]+)".*?name:\s*"([^"]+)"/);
        apps.push({
          name,
          example: true,
          modified: new Date(0).toISOString(),
          themeId: themeMatch ? themeMatch[1] : null,
          themeName: themeMatch ? themeMatch[2] : null,
          size: statSync(appFile).size,
          hasScreenshot: existsSync(join(dir, 'screenshot.png')),
        });
      }
    }

    return json(apps);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function editorGetScreenshot(ctx: ServerContext, url: URL): Promise<Response> {
  const name = sanitizeAppName(url.searchParams.get('name') || '');
  if (!name) return new Response('Missing name', { status: 400, headers: corsHeaders() });
  // Check user apps first, then examples
  let imgPath = join(ctx.appsDir, name, 'screenshot.png');
  let file = Bun.file(imgPath);
  if (!(await file.exists())) {
    imgPath = join(ctx.examplesDir, name, 'screenshot.png');
    file = Bun.file(imgPath);
  }
  if (!(await file.exists())) return new Response('No screenshot', { status: 404, headers: corsHeaders() });
  return new Response(file, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', ...corsHeaders() } });
}

function serveScreenSaver(ctx: ServerContext): Response {
  const file = Bun.file(join(ctx.projectRoot, 'assets', 'screen-saver.png'));
  return new Response(file, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600', ...corsHeaders() } });
}

function editorLoadApp(ctx: ServerContext, url: URL): Response {
  const name = sanitizeAppName(url.searchParams.get('name') || '');
  if (!name) return new Response('Missing name', { status: 400, headers: corsHeaders() });
  const src = join(ctx.appsDir, name, 'app.jsx');
  if (!existsSync(src)) {
    // Copy-on-write: if it's a bundled example, copy to user's appsDir
    const exampleSrc = join(ctx.examplesDir, name, 'app.jsx');
    if (!existsSync(exampleSrc)) return new Response('App not found', { status: 404, headers: corsHeaders() });
    const dest = join(ctx.appsDir, name);
    mkdirSync(dest, { recursive: true });
    copyFileSync(exampleSrc, join(dest, 'app.jsx'));
    // Also copy screenshot if available
    const exampleScreenshot = join(ctx.examplesDir, name, 'screenshot.png');
    if (existsSync(exampleScreenshot)) {
      copyFileSync(exampleScreenshot, join(dest, 'screenshot.png'));
    }
  }
  ctx.currentApp = name;
  return json({ ok: true, currentApp: name });
}

function editorSaveApp(ctx: ServerContext, url: URL): Response {
  const name = sanitizeAppName(url.searchParams.get('name') || '');
  if (!name) return new Response('Missing name', { status: 400, headers: corsHeaders() });
  const appSrc = resolveAppJsxPath(ctx);
  if (!existsSync(appSrc)) return new Response('No app.jsx to save', { status: 404, headers: corsHeaders() });
  const dest = join(ctx.appsDir, name);
  mkdirSync(dest, { recursive: true });
  if (resolve(appSrc) !== resolve(join(dest, 'app.jsx'))) {
    copyFileSync(appSrc, join(dest, 'app.jsx'));
  }
  ctx.currentApp = name;
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
    const appPath = resolveAppJsxPath(ctx);
    const body = await readBodyWithLimit(req, MAX_APP_WRITE_SIZE);
    writeFileSync(appPath, body.toString('utf-8'));
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
  _corsPort = ctx.port;
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
      case 'GET /skills':                    return serveSkills(ctx);
      case 'GET /app-frame':                return serveAppFrame(ctx);
      case 'GET /editor/status':            return editorStatus(ctx);
      case 'POST /editor/auth/login':       return editorAuthLogin(ctx);
      case 'POST /editor/auth/logout':      return editorAuthLogout();
      case 'GET /editor/initial-prompt':    return editorInitialPrompt(ctx);
      case 'GET /editor/app-exists':        return editorAppExists(ctx);
      case 'GET /editor/apps':              return editorListApps(ctx);
      case 'GET /editor/apps/screenshot':   return editorGetScreenshot(ctx, url);
      case 'GET /editor/assets/screen-saver.png': return serveScreenSaver(ctx);
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
    if (url.pathname === '/fireproof-oidc-bridge.js' || url.pathname === '/fireproof-vibes-bridge.js' || url.pathname === '/fireproof-clerk-bundle.js') {
      const bundlePath = join(ctx.projectRoot, 'bundles', url.pathname.slice(1));
      const file = Bun.file(bundlePath);
      if (await file.exists()) {
        return new Response(file, { headers: { 'Content-Type': 'text/javascript', ...corsHeaders() } });
      }
    }

    // Static file fallback — path containment check prevents directory traversal
    const filePath = resolve(ctx.projectRoot, url.pathname.slice(1));
    if (!filePath.startsWith(resolve(ctx.projectRoot) + '/')) {
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
