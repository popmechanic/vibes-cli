/**
 * CLI authentication module for terminal-mode deploys.
 *
 * Implements OIDC Authorization Code + PKCE flow with a localhost callback
 * server, plus token caching and automatic refresh.
 */

import { createServer } from 'http';
import { URL } from 'url';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { execFileSync } from 'child_process';

const DEFAULT_AUTH_FILE = join(homedir(), '.vibes', 'auth.json');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const EARLY_EXPIRY_BUFFER_S = 60; // refresh 60s before actual expiry

// Track active callback server so re-login can close the previous one
let _callbackServer = null;
let _callbackConnections = new Set();

// ---------------------------------------------------------------------------
// Callback page renderer — matches AuthScreen visual language
// ---------------------------------------------------------------------------

function callbackPage(title, message, { ok = false, autoClose = false } = {}) {
  const safeMsg = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const icon = ok ? '✓' : '✗';
  const iconColor = ok ? '#73D077' : '#FF7B72';
  const statusColor = ok ? '#73D077' : '#FF7B72';
  const statusLabel = ok ? 'Complete' : 'Error';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? 'Authenticated' : 'Error'}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;justify-content:center;align-items:center;background-color:#CCCDC8;background-image:linear-gradient(rgba(255,255,255,.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.5) 1px,transparent 1px);background-size:32px 32px;font-family:'SF Mono','JetBrains Mono','Fira Code','Menlo','Consolas',monospace}
.terminal-wrapper{width:90%;max-width:520px;animation:float 6s ease-in-out infinite}
.terminal{background:linear-gradient(145deg,#141211,#0C0B0A);border-radius:24px;border:1px solid #2E2927;box-shadow:inset 0 1px 1px rgba(255,255,255,.06),inset 0 0 0 1px rgba(255,255,255,.02),0 30px 60px rgba(0,0,0,.8),0 0 100px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden;animation:fadeIn .4s ease}
.term-header{display:flex;align-items:center;padding:16px 20px;background:rgba(255,255,255,.02);border-bottom:1px solid rgba(0,0,0,.5);box-shadow:0 1px 0 rgba(255,255,255,.02)}
.term-dots{display:flex;gap:8px;align-items:center}
.term-dot{width:12px;height:12px;border-radius:50%}
.term-dot--close{background:#FF7B72}
.term-dot--min{background:#F2CC60}
.term-dot--max{background:#73D077}
.term-title{flex-grow:1;text-align:center;font-size:11px;font-weight:600;letter-spacing:.05em;color:#8A7E79}
.term-body{padding:24px;font-size:13px;line-height:1.7;display:flex;flex-direction:column;gap:6px;min-height:180px}
.term-line{display:flex;gap:10px;align-items:flex-start;opacity:0;animation:lineIn .3s ease forwards}
.line-prefix{font-size:11px;min-width:16px;flex-shrink:0;margin-top:1px}
.line-content{flex:1}
.banner{color:#DDBFBF;font-weight:500}
.divider{opacity:.5;font-size:11px;color:#8A7E79}
.step{margin-top:8px}
.step .line-prefix{color:${iconColor}}
.step .line-content{color:${iconColor}}
.message{color:#8A7E79;font-size:12px;padding-left:26px;margin-top:4px;opacity:0;animation:lineIn .3s .4s ease forwards}
.prompt{display:flex;gap:10px;align-items:flex-start;margin-top:12px;opacity:0;animation:lineIn .3s .6s ease forwards}
.prompt-arrow{color:#5EEAD4;font-weight:700;text-shadow:0 0 8px rgba(94,234,212,.4)}
.prompt-text{color:#EAE3E0}
.cursor{display:inline-block;width:8px;height:14px;background:#5EEAD4;margin-left:2px;box-shadow:0 0 8px rgba(94,234,212,.4);animation:blink 1s step-end infinite;vertical-align:text-bottom}
.cmd{color:#5EEAD4}
.status-bar{display:flex;justify-content:space-between;align-items:center;padding:12px 24px;background:#1E1B1A;border-top:1px solid #2E2927;font-size:11px;color:#8A7E79;border-bottom-left-radius:23px;border-bottom-right-radius:23px}
.status-item{display:flex;align-items:center;gap:6px}
.status-dot{width:6px;height:6px;border-radius:50%;background:${statusColor};box-shadow:0 0 6px ${statusColor}}
@keyframes fadeIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
@keyframes lineIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
</style></head><body>
<div class="terminal-wrapper"><div class="terminal">
<div class="term-header">
<div class="term-dots"><div class="term-dot term-dot--close"></div><div class="term-dot term-dot--min"></div><div class="term-dot term-dot--max"></div></div>
<div class="term-title">vibes — auth</div>
<div style="width:52px"></div>
</div>
<div class="term-body">
<div class="term-line" style="animation-delay:0s"><span class="line-content banner">VibesOS — authentication</span></div>
<div class="term-line" style="animation-delay:.1s"><span class="line-content divider">─────────────────────────────────────</span></div>
<div class="term-line step" style="animation-delay:.2s"><span class="line-prefix">${icon}</span><span class="line-content">${title}</span></div>
<div class="message">${safeMsg}</div>
<div class="prompt"><span class="prompt-arrow">❯</span><span class="prompt-text"><span class="cmd">vibes</span> ready</span><span class="cursor"></span></div>
</div>
<div class="status-bar"><div class="status-item"><div class="status-dot"></div><span>${statusLabel}</span></div><div class="status-item" style="opacity:.5">vibes.diy</div></div>
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

export function removeCachedTokens(authFile = DEFAULT_AUTH_FILE) {
  try {
    if (existsSync(authFile)) unlinkSync(authFile);
  } catch { /* ignore */ }
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
      execFileSync('/usr/bin/open', [url]);
    } else if (platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', url]);
    } else {
      execFileSync('xdg-open', [url]);
    }
  } catch {
    console.error(`Could not open browser automatically. Please visit:\n${url}`);
  }
}

// ---------------------------------------------------------------------------
// Full browser login (OIDC Authorization Code + PKCE)
// ---------------------------------------------------------------------------

/**
 * Start the OIDC callback server and return the authorize URL + a promise
 * that resolves with tokens once the callback completes.
 *
 * This is the low-level helper used by both `loginWithBrowser` (CLI mode,
 * opens the browser itself) and `startLoginFlow` (editor mode, returns the
 * URL so the frontend can open it as a JS popup for reliable auto-close).
 */
function _startCallbackServer({ authority, clientId, authFile = DEFAULT_AUTH_FILE }) {
  // Close any stale callback server from a previous login attempt
  if (_callbackServer) {
    try {
      for (const conn of _callbackConnections) conn.destroy();
      _callbackConnections.clear();
      _callbackServer.close();
    } catch { /* already closed */ }
    _callbackServer = null;
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString('hex');

  let resolveTokens, rejectTokens;
  const tokenPromise = new Promise((resolve, reject) => {
    resolveTokens = resolve;
    rejectTokens = reject;
  });

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
        rejectTokens(new Error(`OIDC error: ${desc}`));
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(callbackPage('Invalid Callback', 'Missing code or state mismatch.'));
        settled = true;
        server.close();
        rejectTokens(new Error('Invalid callback: missing code or state mismatch'));
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
        rejectTokens(new Error(`Token exchange failed (${tokenRes.status}): ${text}`));
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
      res.end(callbackPage('Authenticated', 'You can close this tab.', { ok: true }));

      settled = true;
      for (const conn of _callbackConnections) conn.destroy();
      _callbackConnections.clear();
      server.close();
      _callbackServer = null;
      resolveTokens(tokens);
    } catch (err) {
      if (!settled) {
        settled = true;
        for (const conn of _callbackConnections) conn.destroy();
        _callbackConnections.clear();
        server.close();
        _callbackServer = null;
        rejectTokens(err);
      }
    }
  });

  // Track server and connections for cleanup on re-login
  _callbackServer = server;
  server.on('connection', (conn) => {
    _callbackConnections.add(conn);
    conn.on('close', () => _callbackConnections.delete(conn));
  });

  // Timeout
  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      for (const conn of _callbackConnections) conn.destroy();
      _callbackConnections.clear();
      server.close();
      _callbackServer = null;
      rejectTokens(new Error('Login timed out after 5 minutes'));
    }
  }, LOGIN_TIMEOUT_MS);
  timer.unref?.();

  const CLI_AUTH_PORT = 18192;

  // Return a promise that resolves with { authorizeUrl, tokenPromise }
  // once the server is listening.
  const ready = new Promise((resolveReady, rejectReady) => {
    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        _callbackServer = null;
        rejectTokens(err);
      }
      rejectReady(err);
    });

    server.listen(CLI_AUTH_PORT, 'localhost', () => {
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

      resolveReady({ authorizeUrl: authorizeUrl.toString(), tokenPromise });
    });
  });

  return ready;
}

/**
 * Start the login flow and return the authorize URL without opening a browser.
 * The caller (e.g. editor frontend) is responsible for opening the URL.
 * Returns { authorizeUrl: string, tokenPromise: Promise<tokens> }.
 */
export async function startLoginFlow({ authority, clientId, authFile = DEFAULT_AUTH_FILE }) {
  return _startCallbackServer({ authority, clientId, authFile });
}

/**
 * Full browser login — starts callback server, opens browser, waits for tokens.
 * Used by CLI deploys where there's no frontend to open the popup.
 */
export async function loginWithBrowser({ authority, clientId, authFile = DEFAULT_AUTH_FILE }) {
  const { authorizeUrl, tokenPromise } = await _startCallbackServer({ authority, clientId, authFile });

  console.log(`\nOpening browser for authentication...\n`);
  console.log(`If the browser doesn't open, visit:\n${authorizeUrl}\n`);
  openBrowser(authorizeUrl);

  return tokenPromise;
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
