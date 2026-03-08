/**
 * CLI authentication module for terminal-mode deploys.
 *
 * Implements OIDC Authorization Code + PKCE flow with a localhost callback
 * server, plus token caching and automatic refresh.
 */

import { createServer } from 'http';
import { URL } from 'url';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { execSync } from 'child_process';

const DEFAULT_AUTH_FILE = join(homedir(), '.vibes', 'auth.json');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const EARLY_EXPIRY_BUFFER_S = 60; // refresh 60s before actual expiry

// ---------------------------------------------------------------------------
// Callback page renderer — matches AuthScreen visual language
// ---------------------------------------------------------------------------

function callbackPage(title, message, { ok = false, autoClose = false } = {}) {
  const color = ok ? '#22c55e' : '#ef4444';
  const icon = ok
    ? '<svg class="icon" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/><path d="M20 33l8 8 16-16"/></svg>'
    : '<svg class="icon" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/><path d="M22 22l20 20M42 22l-20 20"/></svg>';
  const safeMsg = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? 'Authenticated' : 'Error'}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;justify-content:center;align-items:center;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
.card{position:relative;width:90%;max-width:450px;background-color:#e8e4df;background-image:linear-gradient(to right,rgba(0,0,0,.1) 1px,transparent 1px),linear-gradient(to bottom,rgba(0,0,0,.1) 1px,transparent 1px);background-size:40px 40px;border:3px solid #1a1a1a;border-radius:12px;overflow:hidden;animation:fadeIn .4s ease}
.inner{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3rem 2rem;gap:1.5rem;min-height:280px}
.bg{position:absolute;top:1.5rem;left:1.5rem;right:1.5rem;bottom:1.5rem;background:${color};border:1px solid black;border-radius:8px;z-index:0;opacity:.35}
h1{font-size:1.75rem;font-weight:bold;color:#1a1a1a;position:relative;z-index:1}
p{font-size:1rem;color:#555;position:relative;z-index:1;max-width:360px;text-align:center;line-height:1.5;word-break:break-word}
.icon{width:64px;height:64px;position:relative;z-index:1}
.icon circle{fill:${color}}
.icon path{stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;fill:none;stroke-dasharray:30;stroke-dashoffset:30;animation:draw .5s .3s ease forwards}
@keyframes fadeIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
@keyframes draw{to{stroke-dashoffset:0}}
</style></head><body>
<div class="card"><div class="inner">
<div class="bg"></div>
${icon}
<h1>${title}</h1>
<p>${safeMsg}</p>
</div></div>
${autoClose ? '<script>setTimeout(()=>window.close(),1500)</script>' : ''}
</body></html>`;
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

export function generateCodeVerifier() {
  return randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ---------------------------------------------------------------------------
// Token cache helpers
// ---------------------------------------------------------------------------

export function readCachedTokens(authFile = DEFAULT_AUTH_FILE) {
  try {
    if (!existsSync(authFile)) return null;
    const raw = readFileSync(authFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeCachedTokens(authFile = DEFAULT_AUTH_FILE, tokens) {
  const dir = dirname(authFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(authFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  // Ensure permissions even if file already existed
  chmodSync(authFile, 0o600);
}

export function isTokenExpired(expiresAt) {
  const now = Math.floor(Date.now() / 1000);
  return now >= expiresAt - EARLY_EXPIRY_BUFFER_S;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async function refreshTokens({ authority, clientId, refreshToken }) {
  const tokenUrl = `${authority}/api/oidc/token`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    idToken: data.id_token || null,
    expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  };
}

// ---------------------------------------------------------------------------
// Browser open (platform-specific)
// ---------------------------------------------------------------------------

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      execSync(`open "${url}"`);
    } else if (platform === 'win32') {
      execSync(`start "" "${url}"`);
    } else {
      execSync(`xdg-open "${url}"`);
    }
  } catch {
    console.error(`Could not open browser automatically. Please visit:\n${url}`);
  }
}

// ---------------------------------------------------------------------------
// Full browser login (OIDC Authorization Code + PKCE)
// ---------------------------------------------------------------------------

export async function loginWithBrowser({ authority, clientId, authFile = DEFAULT_AUTH_FILE }) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    let settled = false;

    const server = createServer(async (req, res) => {
      if (settled) {
        res.writeHead(404);
        res.end();
        return;
      }

      try {
        const reqUrl = new URL(req.url, `http://localhost`);
        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const returnedState = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          const desc = reqUrl.searchParams.get('error_description') || error;
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(callbackPage('Authentication Failed', desc));
          settled = true;
          server.close();
          reject(new Error(`OIDC error: ${desc}`));
          return;
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(callbackPage('Invalid Callback', 'Missing code or state mismatch.'));
          settled = true;
          server.close();
          reject(new Error('Invalid callback: missing code or state mismatch'));
          return;
        }

        // Exchange authorization code for tokens
        const tokenUrl = `${authority}/api/oidc/token`;
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: `http://localhost:${server.address().port}/callback`,
          code_verifier: codeVerifier,
        });

        const tokenRes = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (!tokenRes.ok) {
          const text = await tokenRes.text();
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(callbackPage('Token Exchange Failed', text));
          settled = true;
          server.close();
          reject(new Error(`Token exchange failed (${tokenRes.status}): ${text}`));
          return;
        }

        const data = await tokenRes.json();
        const tokens = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || null,
          idToken: data.id_token || null,
          expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        };

        writeCachedTokens(authFile, tokens);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(callbackPage('Authenticated', 'This tab will close automatically\u2026', { ok: true, autoClose: true }));

        settled = true;
        server.close();
        resolve(tokens);
      } catch (err) {
        if (!settled) {
          settled = true;
          server.close();
          reject(err);
        }
      }
    });

    // Listen on a fixed port so the redirect URI matches what's registered in Pocket ID
    const CLI_AUTH_PORT = 18192;
    server.listen(CLI_AUTH_PORT, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://localhost:${port}/callback`;

      const authorizeUrl = new URL(`${authority}/authorize`);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('scope', 'openid profile email');

      console.log(`\nOpening browser for authentication...\n`);
      console.log(`If the browser doesn't open, visit:\n${authorizeUrl.toString()}\n`);
      openBrowser(authorizeUrl.toString());
    });

    // Timeout
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error('Login timed out after 5 minutes'));
      }
    }, LOGIN_TIMEOUT_MS);

    // Don't let the timer keep the process alive if resolved early
    timer.unref?.();
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function getAccessToken({ authority, clientId, authFile = DEFAULT_AUTH_FILE, silent = false }) {
  // 1. Check cache
  const cached = readCachedTokens(authFile);

  if (cached) {
    // Still valid?
    if (!isTokenExpired(cached.expiresAt)) {
      return cached;
    }

    // 2. Try refresh
    if (cached.refreshToken) {
      try {
        const refreshed = await refreshTokens({
          authority,
          clientId,
          refreshToken: cached.refreshToken,
        });
        writeCachedTokens(authFile, refreshed);
        return refreshed;
      } catch (err) {
        if (silent) return null;
        console.warn(`Token refresh failed, falling back to browser login: ${err.message}`);
      }
    }
  }

  // 3. Silent mode: no browser popup
  if (silent) return null;

  // 4. Full browser login
  return loginWithBrowser({ authority, clientId, authFile });
}
