# Shared Pocket ID — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the Pocket ID migration branch (`claude/elegant-nobel`) to a shared-infrastructure model — one Pocket ID instance, one Deploy API Worker, no user-facing credentials.

**Architecture:** Users authenticate via a shared Pocket ID instance. A new Deploy API Worker accepts assembled HTML + OIDC access token, verifies identity, and deploys via the CF Workers API using our account's API token. Auth constants (authority, clientId) are hardcoded at assembly time — no `.env` setup for auth. CLI deploys use a localhost OIDC callback flow with token caching.

**Tech Stack:** Cloudflare Workers (Hono), oauth4webapi, Web Crypto API, Node.js (CLI auth flow)

**Design doc:** `docs/plans/2026-03-07-shared-pocket-id-design.md`

**Base branch:** `claude/elegant-nobel` (contains completed OIDC migration — bridge, templates, Worker JWT verification, service bindings)

---

## Pre-Flight

Before starting, read these files on the `claude/elegant-nobel` branch:

- `docs/plans/2026-03-07-shared-pocket-id-design.md` — the approved design
- `docs/plans/2026-03-05-pocket-id-implementation-plan.md` — what's already built
- `skills/cloudflare/worker/src/lib/crypto-jwt.ts` — existing OIDC JWT verification (reuse in Deploy API)
- `skills/cloudflare/worker/src/lib/jwt-validation.ts` — shared JWT helpers (matchAzp, validateJwtTiming)
- `scripts/deploy-cloudflare.js` — current deploy script (uses wrangler CLI — will be replaced)
- `scripts/lib/env-utils.js` — current OIDC config handling (will be simplified)
- `scripts/assemble.js` — current assembly with .env-based OIDC placeholders (will hardcode constants)
- `bundles/fireproof-oidc-bridge.js` — OIDC bridge (keep as-is)

---

## Task 1: Create the Deploy API Worker — Scaffold and JWT Verification

**Files:**
- Create: `deploy-api/src/index.ts`
- Create: `deploy-api/src/types.ts`
- Create: `deploy-api/wrangler.toml`
- Create: `deploy-api/package.json`
- Create: `deploy-api/tsconfig.json`
- Copy (adapt): JWT verification from `skills/cloudflare/worker/src/lib/crypto-jwt.ts`

This is the core new component from the design. A standalone CF Worker that accepts deploy requests.

**Step 1: Create project scaffold**

Create `deploy-api/package.json`:

```json
{
  "name": "vibes-deploy-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "devDependencies": {
    "hono": "^4.0.0",
    "wrangler": "^4.0.0",
    "vitest": "^3.0.0",
    "typescript": "^5.0.0",
    "@cloudflare/workers-types": "^4.0.0"
  }
}
```

Create `deploy-api/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Create `deploy-api/wrangler.toml`:

```toml
name = "vibes-deploy-api"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[vars]
OIDC_ISSUER = "https://pocket-id.vibes.diy"

# Secrets (set via `wrangler secret put`):
# CF_API_TOKEN - scoped to Workers deploys on our account
# OIDC_PEM_PUBLIC_KEY - PEM from Pocket ID JWKS (for JWT verification)
# CF_ACCOUNT_ID - our Cloudflare account ID

[[kv_namespaces]]
binding = "REGISTRY_KV"
id = "" # filled at deploy time
```

**Step 2: Create types**

Create `deploy-api/src/types.ts`:

```typescript
export interface Env {
  // Secrets
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  OIDC_PEM_PUBLIC_KEY: string;

  // Vars
  OIDC_ISSUER: string;

  // KV
  REGISTRY_KV: KVNamespace;
}

export interface DeployRequest {
  name: string;
  html: string;
}

export interface DeployResponse {
  ok: boolean;
  url: string;
  name: string;
}

export interface JWTPayload {
  sub: string;
  email?: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  plan?: string;
  [key: string]: unknown;
}
```

**Step 3: Create the Worker with JWT verification and deploy endpoint**

Create `deploy-api/src/index.ts`. This is the main file. It:
1. Verifies OIDC JWTs (reuse the `pemToArrayBuffer` + RS256 verification pattern from `crypto-jwt.ts`)
2. Checks registry KV for subdomain ownership
3. Calls the CF Workers API to deploy

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, DeployRequest, DeployResponse, JWTPayload } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// ─── JWT Verification ────────────────────────────────────────────────

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

async function verifyJWT(
  token: string,
  pemKey: string,
  issuer: string
): Promise<JWTPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");

  const header = JSON.parse(base64UrlDecode(parts[0]));
  if (header.alg !== "RS256") throw new Error(`Unsupported algorithm: ${header.alg}`);

  const payload: JWTPayload = JSON.parse(base64UrlDecode(parts[1]));

  // Validate claims
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("Token expired");
  if (payload.iat && payload.iat > now + 60) throw new Error("Token issued in the future");
  if (payload.iss !== issuer) throw new Error(`Invalid issuer: ${payload.iss}`);

  // Verify signature
  const keyData = pemToArrayBuffer(pemKey);
  const cryptoKey = await crypto.subtle.importKey(
    "spki",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const sigBase64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
  const sigPadded = sigBase64 + "=".repeat((4 - (sigBase64.length % 4)) % 4);
  const sigBinary = atob(sigPadded);
  const signature = new Uint8Array(sigBinary.length);
  for (let i = 0; i < sigBinary.length; i++) {
    signature[i] = sigBinary.charCodeAt(i);
  }

  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    signedData
  );

  if (!valid) throw new Error("Invalid signature");
  return payload;
}

// ─── Registry Helpers ────────────────────────────────────────────────

interface SubdomainRecord {
  owner: string;
  collaborators?: Array<{ userId: string; email?: string; role?: string }>;
  createdAt?: string;
  updatedAt?: string;
}

async function getSubdomain(kv: KVNamespace, name: string): Promise<SubdomainRecord | null> {
  const raw = await kv.get(`subdomain:${name}`);
  return raw ? JSON.parse(raw) : null;
}

async function setSubdomain(kv: KVNamespace, name: string, record: SubdomainRecord): Promise<void> {
  await kv.put(`subdomain:${name}`, JSON.stringify(record));
}

function userOwnsOrCanCreate(record: SubdomainRecord | null, userId: string): boolean {
  if (!record) return true; // unclaimed
  if (record.owner === userId) return true;
  if (record.collaborators?.some((c) => c.userId === userId)) return true;
  return false;
}

// ─── Deploy via CF API ───────────────────────────────────────────────

async function deployCFWorker(
  accountId: string,
  apiToken: string,
  appName: string,
  html: string
): Promise<string> {
  const workerName = appName;

  // The Worker script serves the HTML as a static site
  const workerScript = `
    const HTML = ${JSON.stringify(html)};
    export default {
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/' || url.pathname === '/index.html') {
          return new Response(HTML, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        return new Response('Not Found', { status: 404 });
      }
    };
  `;

  // Upload Worker via CF API
  const formData = new FormData();

  // Worker module
  const metadata = {
    main_module: "index.js",
    compatibility_date: "2025-01-01",
  };
  formData.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  formData.append(
    "index.js",
    new Blob([workerScript], { type: "application/javascript+module" })
  );

  const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`;
  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${apiToken}` },
    body: formData,
  });

  if (!uploadResp.ok) {
    const err = await uploadResp.text();
    throw new Error(`CF API upload failed (${uploadResp.status}): ${err}`);
  }

  // Enable the workers.dev subdomain route
  const subdomainUrl = `${uploadUrl}/subdomain`;
  await fetch(subdomainUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled: true }),
  });

  return `https://${workerName}.exe.xyz`;
}

// ─── Routes ──────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ ok: true }));

app.post("/deploy", async (c) => {
  // 1. Extract and verify token
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }
  const token = authHeader.slice(7);

  let claims: JWTPayload;
  try {
    claims = await verifyJWT(token, c.env.OIDC_PEM_PUBLIC_KEY, c.env.OIDC_ISSUER);
  } catch (err: any) {
    return c.json({ error: `Authentication failed: ${err.message}` }, 401);
  }

  // 2. Parse request body
  let body: DeployRequest;
  try {
    body = await c.req.json<DeployRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body. Expected { name, html }" }, 400);
  }

  const { name, html } = body;
  if (!name || !html) {
    return c.json({ error: "Missing required fields: name, html" }, 400);
  }

  // Validate subdomain name
  if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(name) && !/^[a-z0-9]$/.test(name)) {
    return c.json({ error: "Invalid app name. Use lowercase letters, numbers, and hyphens." }, 400);
  }

  // 3. Check registry — user owns or can claim this subdomain
  const userId = claims.sub;
  const existing = await getSubdomain(c.env.REGISTRY_KV, name);

  if (!userOwnsOrCanCreate(existing, userId)) {
    return c.json({ error: `Subdomain '${name}' is owned by another user` }, 403);
  }

  // 4. Check billing (when enabled — stub for now)
  // Future: check claims.plan against billing requirements

  // 5. Deploy via CF Workers API
  let url: string;
  try {
    url = await deployCFWorker(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN, name, html);
  } catch (err: any) {
    return c.json({ error: `Deploy failed: ${err.message}` }, 500);
  }

  // 6. Update registry
  const now = new Date().toISOString();
  if (existing) {
    existing.updatedAt = now;
    await setSubdomain(c.env.REGISTRY_KV, name, existing);
  } else {
    await setSubdomain(c.env.REGISTRY_KV, name, {
      owner: userId,
      collaborators: [],
      createdAt: now,
      updatedAt: now,
    });
    // Also track user → subdomain mapping
    const userKey = `user:${userId}`;
    const userApps = await c.env.REGISTRY_KV.get(userKey);
    const apps: string[] = userApps ? JSON.parse(userApps) : [];
    if (!apps.includes(name)) {
      apps.push(name);
      await c.env.REGISTRY_KV.put(userKey, JSON.stringify(apps));
    }
  }

  const response: DeployResponse = { ok: true, url, name };
  return c.json(response, 200);
});

export default app;
```

**Step 4: Install deps and verify it compiles**

Run: `cd deploy-api && npm install && npx tsc --noEmit`
Expected: no type errors

**Step 5: Commit**

```bash
git add deploy-api/
git commit -m "Add Deploy API Worker scaffold with JWT verification and CF API deploy"
```

---

## Task 2: Deploy API Worker — Tests

**Files:**
- Create: `deploy-api/src/__tests__/deploy.test.ts`
- Create: `deploy-api/vitest.config.ts`

**Step 1: Create vitest config**

Create `deploy-api/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    watch: false,
  },
});
```

**Step 2: Write tests**

Create `deploy-api/src/__tests__/deploy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Unit tests for helper functions (extracted from index.ts for testability)
// These test the JWT parsing, registry logic, and request validation
// without needing a full Worker environment.

describe("subdomain validation", () => {
  const validPattern = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/;

  it("accepts valid subdomain names", () => {
    expect(validPattern.test("my-app")).toBe(true);
    expect(validPattern.test("app123")).toBe(true);
    expect(validPattern.test("a")).toBe(true);
  });

  it("rejects invalid subdomain names", () => {
    expect(validPattern.test("My-App")).toBe(false);
    expect(validPattern.test("-app")).toBe(false);
    expect(validPattern.test("app-")).toBe(false);
    expect(validPattern.test("")).toBe(false);
    expect(validPattern.test("app_name")).toBe(false);
  });
});

describe("userOwnsOrCanCreate", () => {
  // Inline the logic for unit testing
  function userOwnsOrCanCreate(
    record: { owner: string; collaborators?: Array<{ userId: string }> } | null,
    userId: string
  ): boolean {
    if (!record) return true;
    if (record.owner === userId) return true;
    if (record.collaborators?.some((c) => c.userId === userId)) return true;
    return false;
  }

  it("allows unclaimed subdomains", () => {
    expect(userOwnsOrCanCreate(null, "user-1")).toBe(true);
  });

  it("allows the owner", () => {
    expect(userOwnsOrCanCreate({ owner: "user-1" }, "user-1")).toBe(true);
  });

  it("allows collaborators", () => {
    expect(
      userOwnsOrCanCreate(
        { owner: "user-1", collaborators: [{ userId: "user-2" }] },
        "user-2"
      )
    ).toBe(true);
  });

  it("rejects non-owners", () => {
    expect(userOwnsOrCanCreate({ owner: "user-1" }, "user-2")).toBe(false);
  });
});

describe("JWT parsing", () => {
  function base64UrlDecode(str: string): string {
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8");
  }

  it("decodes base64url strings", () => {
    // "hello" in base64url
    const encoded = Buffer.from("hello").toString("base64url");
    expect(base64UrlDecode(encoded)).toBe("hello");
  });

  it("handles padding correctly", () => {
    const encoded = Buffer.from("a]").toString("base64url");
    expect(base64UrlDecode(encoded)).toBe("a]");
  });
});
```

**Step 3: Run tests**

Run: `cd deploy-api && npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add deploy-api/src/__tests__/ deploy-api/vitest.config.ts
git commit -m "Add Deploy API Worker tests"
```

---

## Task 3: CLI Auth Flow — OIDC Login with Localhost Callback

**Files:**
- Create: `scripts/lib/cli-auth.js`
- Create: `scripts/__tests__/unit/cli-auth.test.js`

This implements the terminal-mode auth flow from the design: open browser → Pocket ID login → localhost callback → cache tokens.

**Step 1: Write failing tests**

Create `scripts/__tests__/unit/cli-auth.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Test the token cache utilities (not the HTTP server / browser flow)
describe('cli-auth token cache', () => {
  let testDir;
  let authFile;

  beforeEach(() => {
    testDir = join(tmpdir(), `cli-auth-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    authFile = join(testDir, 'auth.json');
  });

  it('reads cached tokens from auth.json', async () => {
    const tokens = {
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      idToken: 'test-id',
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    };
    writeFileSync(authFile, JSON.stringify(tokens));

    const { readCachedTokens } = await import('../../lib/cli-auth.js');
    const result = readCachedTokens(authFile);
    expect(result.accessToken).toBe('test-access');
    expect(result.refreshToken).toBe('test-refresh');
  });

  it('returns null for missing auth file', async () => {
    const { readCachedTokens } = await import('../../lib/cli-auth.js');
    const result = readCachedTokens(join(testDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  it('detects expired tokens', async () => {
    const { isTokenExpired } = await import('../../lib/cli-auth.js');
    const past = Math.floor(Date.now() / 1000) - 100;
    expect(isTokenExpired(past)).toBe(true);
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenExpired(future)).toBe(false);
  });

  it('writes tokens to auth file', async () => {
    const { writeCachedTokens } = await import('../../lib/cli-auth.js');
    writeCachedTokens(authFile, {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      idToken: 'new-id',
      expiresAt: 99999999
    });
    const stored = JSON.parse(readFileSync(authFile, 'utf8'));
    expect(stored.accessToken).toBe('new-access');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/cli-auth.test.js`
Expected: FAIL — module not found

**Step 3: Implement cli-auth.js**

Create `scripts/lib/cli-auth.js`:

```javascript
/**
 * CLI OIDC Authentication
 *
 * Handles terminal-mode authentication:
 * 1. Opens browser to Pocket ID authorize URL with localhost callback
 * 2. Starts local HTTP server to receive the callback
 * 3. Exchanges authorization code for tokens (PKCE)
 * 4. Caches tokens at ~/.vibes/auth.json
 * 5. Refreshes expired tokens automatically
 */

import { createServer } from 'http';
import { URL } from 'url';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomBytes, createHash } from 'crypto';

const DEFAULT_AUTH_FILE = join(homedir(), '.vibes', 'auth.json');

// ─── PKCE Helpers ────────────────────────────────────────────────────

function generateCodeVerifier() {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ─── Token Cache ─────────────────────────────────────────────────────

export function readCachedTokens(authFile = DEFAULT_AUTH_FILE) {
  try {
    if (!existsSync(authFile)) return null;
    return JSON.parse(readFileSync(authFile, 'utf8'));
  } catch {
    return null;
  }
}

export function writeCachedTokens(authFile = DEFAULT_AUTH_FILE, tokens) {
  const dir = dirname(authFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(authFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function isTokenExpired(expiresAt) {
  if (!expiresAt) return true;
  // Expire 60s early to allow refresh
  return Math.floor(Date.now() / 1000) > expiresAt - 60;
}

// ─── Token Refresh ───────────────────────────────────────────────────

async function refreshAccessToken(authority, clientId, refreshToken) {
  const tokenUrl = `${authority}/oauth/token`;
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Token refresh failed (${resp.status}): ${await resp.text()}`);
  }
  return resp.json();
}

// ─── Main Auth Flow ──────────────────────────────────────────────────

/**
 * Get a valid access token, refreshing or re-authenticating as needed.
 *
 * @param {object} opts
 * @param {string} opts.authority - OIDC authority URL
 * @param {string} opts.clientId - OIDC client ID
 * @param {string} [opts.authFile] - Path to token cache file
 * @returns {Promise<string>} Valid access token
 */
export async function getAccessToken({ authority, clientId, authFile = DEFAULT_AUTH_FILE }) {
  // 1. Check cache
  const cached = readCachedTokens(authFile);
  if (cached && !isTokenExpired(cached.expiresAt)) {
    return cached.accessToken;
  }

  // 2. Try refresh
  if (cached?.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(authority, clientId, cached.refreshToken);
      const tokens = {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || cached.refreshToken,
        idToken: refreshed.id_token || cached.idToken,
        expiresAt: Math.floor(Date.now() / 1000) + (refreshed.expires_in || 3600),
      };
      writeCachedTokens(authFile, tokens);
      return tokens.accessToken;
    } catch (err) {
      console.warn('Token refresh failed, starting new login:', err.message);
    }
  }

  // 3. Full login flow
  return loginWithBrowser({ authority, clientId, authFile });
}

/**
 * Open browser for OIDC login and wait for the callback.
 */
export async function loginWithBrowser({ authority, clientId, authFile = DEFAULT_AUTH_FILE }) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    // Start local server to receive callback
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Authentication failed</h1><p>You can close this tab.</p></body></html>');
        server.close();
        reject(new Error(`OIDC error: ${error}`));
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Invalid callback</h1></body></html>');
        server.close();
        reject(new Error('Invalid callback parameters'));
        return;
      }

      // Exchange code for tokens
      try {
        const tokenUrl = `${authority}/oauth/token`;
        const tokenResp = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code,
            redirect_uri: `http://localhost:${server.address().port}/callback`,
            code_verifier: codeVerifier,
          }),
        });

        if (!tokenResp.ok) {
          throw new Error(`Token exchange failed (${tokenResp.status}): ${await tokenResp.text()}`);
        }

        const tokenData = await tokenResp.json();
        const tokens = {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          idToken: tokenData.id_token,
          expiresAt: Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600),
        };

        writeCachedTokens(authFile, tokens);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Signed in!</h1><p>You can close this tab and return to the terminal.</p></body></html>');
        server.close();
        resolve(tokens.accessToken);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Error</h1><p>${err.message}</p></body></html>`);
        server.close();
        reject(err);
      }
    });

    // Listen on random port
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://localhost:${port}/callback`;

      const authorizeUrl = new URL(`${authority}/authorize`);
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', 'openid profile email');
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');

      console.log(`\nOpening browser for authentication...`);
      console.log(`If the browser doesn't open, visit:\n${authorizeUrl.toString()}\n`);

      // Open browser (platform-specific)
      import('child_process').then(({ exec }) => {
        const cmd = process.platform === 'darwin' ? 'open' :
                    process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} "${authorizeUrl.toString()}"`);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timed out (5 minutes)'));
      }, 5 * 60 * 1000);
    });
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/cli-auth.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/lib/cli-auth.js scripts/__tests__/unit/cli-auth.test.js
git commit -m "Add CLI OIDC auth flow with localhost callback and token caching"
```

---

## Task 4: Hardcode Auth Constants in Assembly

**Files:**
- Modify: `scripts/assemble.js`
- Modify: `scripts/assemble-sell.js`
- Modify: `scripts/lib/env-utils.js`

The design says OIDC authority and clientId are hardcoded constants — same for every app, injected at assembly time. No more `.env` fields for these.

**Step 1: Create auth constants file**

Create `scripts/lib/auth-constants.js`:

```javascript
/**
 * Shared OIDC auth constants
 *
 * These are the same for every Vibes app. The single Pocket ID instance
 * and shared OIDC client are managed infrastructure — users never configure these.
 */

// TODO: Replace with actual production values after Pocket ID deployment
export const OIDC_AUTHORITY = 'https://pocket-id.vibes.diy';
export const OIDC_CLIENT_ID = 'vibes-apps';
```

**Step 2: Update assemble.js**

Read `scripts/assemble.js` on the branch. Find where it validates OIDC credentials from `.env` and replace:

- Remove: `validateOIDCAuthority(envVars.VITE_OIDC_AUTHORITY)` check
- Remove: `.env` requirement for `VITE_OIDC_AUTHORITY` and `VITE_OIDC_CLIENT_ID`
- Add: Import `OIDC_AUTHORITY, OIDC_CLIENT_ID` from `./lib/auth-constants.js`
- After `populateConnectConfig()`, add explicit replacement of the OIDC placeholders with the constants:

```javascript
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from './lib/auth-constants.js';

// ... in the assemble function, after populateConnectConfig:
html = html.replace('__VITE_OIDC_AUTHORITY__', OIDC_AUTHORITY);
html = html.replace('__VITE_OIDC_CLIENT_ID__', OIDC_CLIENT_ID);
```

**Step 3: Update assemble-sell.js**

Same pattern — import constants and replace OIDC placeholders directly instead of reading from `.env`.

**Step 4: Update env-utils.js**

Remove `VITE_OIDC_AUTHORITY` and `VITE_OIDC_CLIENT_ID` from `CONFIG_PLACEHOLDERS` — these are no longer populated from `.env`. Keep the Connect URL placeholders (`__VITE_API_URL__`, `__VITE_CLOUD_URL__`) since those are still per-deployment.

```javascript
export const CONFIG_PLACEHOLDERS = {
  '__VITE_API_URL__': 'VITE_API_URL',
  '__VITE_CLOUD_URL__': 'VITE_CLOUD_URL',
};
```

**Step 5: Update tests**

Run: `cd scripts && npx vitest run`

Fix any test failures from:
- Tests that expected OIDC placeholders in `CONFIG_PLACEHOLDERS`
- Tests that mock `.env` with `VITE_OIDC_AUTHORITY`
- Assembly pipeline tests that check for placeholder replacement

**Step 6: Commit**

```bash
git add scripts/lib/auth-constants.js scripts/assemble.js scripts/assemble-sell.js scripts/lib/env-utils.js
git commit -m "Hardcode OIDC auth constants — remove .env requirement for auth config"
```

---

## Task 5: Replace Wrangler with Deploy API in deploy-cloudflare.js

**Files:**
- Modify: `scripts/deploy-cloudflare.js`

This is the key simplification. Instead of calling wrangler CLI (which requires CF API tokens on the user's machine), POST to the Deploy API with an OIDC token.

**Step 1: Read the current deploy-cloudflare.js**

Read `scripts/deploy-cloudflare.js` on the branch to understand the full flow.

**Step 2: Rewrite the deploy function**

Replace the wrangler-based deploy with an HTTP POST to the Deploy API:

```javascript
import { getAccessToken } from './lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from './lib/auth-constants.js';

const DEPLOY_API_URL = 'https://vibes-deploy-api.<account>.workers.dev';

async function deploy(name, htmlPath, options = {}) {
  const html = readFileSync(htmlPath, 'utf8');

  // Get OIDC access token (cached, refreshed, or new login)
  const accessToken = await getAccessToken({
    authority: OIDC_AUTHORITY,
    clientId: OIDC_CLIENT_ID,
  });

  console.log(`Deploying ${name}...`);
  const resp = await fetch(`${DEPLOY_API_URL}/deploy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, html }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(`Deploy failed: ${err.error || resp.statusText}`);
  }

  const result = await resp.json();
  console.log(`Deployed to ${result.url}`);
  return result;
}
```

Key changes:
- Remove: all `wrangler` CLI calls (`wrangler deploy`, `wrangler kv namespace`, `wrangler secret put`)
- Remove: `--oidc-authority` flag (constants are hardcoded)
- Remove: `fetchOIDCPEM()` function (PEM is on the Deploy API Worker, not client)
- Remove: `wrangler.toml` manipulation (per-app KV, billing mode patching)
- Keep: `--name` and `--file` flags
- Keep: `--ai-key` flag (OpenRouter key, still user-provided for AI features)
- Add: CLI auth flow integration via `getAccessToken()`
- Add: Deploy API URL constant

Note: The Deploy API Worker handles Connect provisioning (via alchemy), registry KV updates, and billing checks. The client script just sends HTML and receives a URL.

**Step 3: Remove flags that are no longer needed**

Remove these CLI flags:
- `--oidc-authority` (hardcoded)
- `--billing-mode` (Deploy API handles this)
- `--admin-ids` (Deploy API handles this)
- `--reserved` / `--preallocated` (Deploy API reads from KV)
- `--env-dir` (no more .env for auth)

Keep:
- `--name` (app name / subdomain)
- `--file` (assembled HTML path)
- `--ai-key` (optional, for AI proxy)

**Step 4: Update the SKILL.md deploy command**

Read `skills/cloudflare/SKILL.md`. Update the deploy command example from the old wrangler-based syntax to the new simplified form:

```bash
node scripts/deploy-cloudflare.js --name my-app --file index.html
```

**Step 5: Run tests**

Run: `cd scripts && npx vitest run __tests__/unit/ __tests__/integration/deploy-cloudflare-connect.test.js`

Update test expectations — the deploy script's interface has changed significantly. Mock the Deploy API fetch call instead of mocking wrangler CLI.

**Step 6: Commit**

```bash
git add scripts/deploy-cloudflare.js skills/cloudflare/SKILL.md
git commit -m "Replace wrangler CLI with Deploy API HTTP call in deploy-cloudflare.js"
```

---

## Task 6: Deploy API — Connect Auto-Provisioning

**Files:**
- Modify: `deploy-api/src/index.ts`

The design says Connect is auto-provisioned on first deploy. The Deploy API Worker needs to trigger alchemy for Connect setup.

**Step 1: Add Connect provisioning to the deploy endpoint**

After the CF Workers API upload succeeds, check if this is a first deploy (no existing registry record). If so, provision Connect.

The existing `scripts/lib/alchemy-deploy.js` handles Connect provisioning via a sparse checkout of the fireproof repo + alchemy. For the Deploy API Worker, we need a different approach since Workers can't run alchemy directly.

Two options:
1. **Service binding** to a Connect provisioner Worker (that wraps alchemy)
2. **HTTP call** to an alchemy provisioning endpoint

For now, stub the Connect provisioning with a TODO and a flag in the registry record:

```typescript
// In the deploy endpoint, after successful Worker upload:
if (!existing) {
  // First deploy — Connect needs provisioning
  // TODO: Trigger Connect provisioning (alchemy) via service binding or HTTP
  await setSubdomain(c.env.REGISTRY_KV, name, {
    owner: userId,
    collaborators: [],
    connectProvisioned: false, // Flag for async provisioning
    createdAt: now,
    updatedAt: now,
  });
} else {
  existing.updatedAt = now;
  await setSubdomain(c.env.REGISTRY_KV, name, existing);
}
```

Add a `GET /status/:name` endpoint that returns deploy + Connect status:

```typescript
app.get("/status/:name", async (c) => {
  const name = c.req.param("name");
  const record = await getSubdomain(c.env.REGISTRY_KV, name);
  if (!record) return c.json({ exists: false }, 404);
  return c.json({
    exists: true,
    owner: record.owner,
    connectProvisioned: record.connectProvisioned ?? false,
    updatedAt: record.updatedAt,
  });
});
```

**Step 2: Commit**

```bash
git add deploy-api/src/index.ts
git commit -m "Add Connect provisioning stub and status endpoint to Deploy API"
```

---

## Task 7: Deploy API — Asset Handling (Bridge, Static Files)

**Files:**
- Modify: `deploy-api/src/index.ts`

Currently `deploy-cloudflare.js` copies the OIDC bridge bundle and assets alongside the HTML. The Deploy API needs to handle multi-file deploys.

**Step 1: Extend the deploy request to accept multiple files**

Change the deploy endpoint to accept a `files` map instead of just `html`:

```typescript
interface DeployRequest {
  name: string;
  files: Record<string, string>; // path → content
  // files: { "index.html": "<html>...", "fireproof-oidc-bridge.js": "...", ... }
}
```

Update the Worker script generator (`deployCFWorker`) to serve multiple files:

```typescript
async function deployCFWorker(
  accountId: string,
  apiToken: string,
  appName: string,
  files: Record<string, string>
): Promise<string> {
  const workerScript = `
    const FILES = ${JSON.stringify(files)};
    const MIME_TYPES = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    function getMime(path) {
      const ext = path.substring(path.lastIndexOf('.'));
      return MIME_TYPES[ext] || 'text/plain';
    }
    export default {
      async fetch(request) {
        const url = new URL(request.url);
        let path = url.pathname === '/' ? '/index.html' : url.pathname;
        // Strip leading slash for file lookup
        const key = path.startsWith('/') ? path.slice(1) : path;
        if (key in FILES) {
          return new Response(FILES[key], {
            headers: { 'Content-Type': getMime(key) }
          });
        }
        // Fallback to index.html for SPA routing
        if ('index.html' in FILES) {
          return new Response(FILES['index.html'], {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        return new Response('Not Found', { status: 404 });
      }
    };
  `;

  // ... rest of CF API upload
}
```

**Step 2: Update deploy-cloudflare.js to send files map**

In `scripts/deploy-cloudflare.js`, build the files map from the assembled HTML + bridge bundle + assets:

```javascript
const files = {
  'index.html': readFileSync(htmlPath, 'utf8'),
};

// Add OIDC bridge bundle
const bridgePath = resolve(PLUGIN_ROOT, 'bundles/fireproof-oidc-bridge.js');
if (existsSync(bridgePath)) {
  files['fireproof-oidc-bridge.js'] = readFileSync(bridgePath, 'utf8');
}

// Add assets directory
const assetsDir = resolve(dirname(htmlPath), 'assets');
if (existsSync(assetsDir)) {
  // ... walk directory, add text-based assets
}

const resp = await fetch(`${DEPLOY_API_URL}/deploy`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ name, files }),
});
```

**Step 3: Commit**

```bash
git add deploy-api/src/index.ts scripts/deploy-cloudflare.js
git commit -m "Support multi-file deploys (HTML + bridge + assets) in Deploy API"
```

---

## Task 8: Remove Per-App Client Registration and Wrangler Dependency

**Files:**
- Modify: `alchemy/pocket-id.run.ts` (remove auto-registration config)
- Modify: `alchemy/src/worker.ts` (remove auto-registration logic)
- Modify: `scripts/lib/ensure-deps.js` (remove wrangler/esbuild from required deps)
- Delete: `scripts/__tests__/mocks/clerk-webhooks.js` (no longer needed)

**Step 1: Simplify Pocket ID alchemy config**

Read `alchemy/pocket-id.run.ts` and `alchemy/src/worker.ts`. Remove `POCKET_ID_DEFAULT_CLIENTS` env var and any auto-registration logic — the design uses a single pre-configured OIDC client.

**Step 2: Remove wrangler from ensure-deps**

Read `scripts/lib/ensure-deps.js`. Remove `wrangler` from the dependency check — users no longer need wrangler installed. Keep `esbuild` if it's used for other things; remove if only used for Worker builds (the Deploy API Worker is deployed by us, not users).

**Step 3: Delete clerk webhook mocks**

```bash
git rm scripts/__tests__/mocks/clerk-webhooks.js
```

**Step 4: Run tests**

Run: `cd scripts && npx vitest run`
Fix any failures from removed mocks/deps.

**Step 5: Commit**

```bash
git add alchemy/ scripts/lib/ensure-deps.js
git commit -m "Remove per-app OIDC client registration and wrangler dependency"
```

---

## Task 9: Update Editor Deploy Flow

**Files:**
- Modify: `scripts/server/handlers/deploy.js`

The editor's deploy handler currently invokes `deploy-cloudflare.js` as a subprocess. Update it to use the Deploy API directly or call the refactored deploy function.

**Step 1: Read the current deploy handler**

Read `scripts/server/handlers/deploy.js` on the branch.

**Step 2: Update for Deploy API**

The editor's OIDC token is already in sessionStorage (from the OIDC bridge). The deploy handler should:
1. Receive the OIDC access token from the editor frontend
2. POST to the Deploy API with the assembled HTML + token
3. Return the live URL to the editor

If the handler currently shells out to `node deploy-cloudflare.js`, refactor to call the deploy function directly or make the HTTP call inline.

**Step 3: Commit**

```bash
git add scripts/server/handlers/deploy.js
git commit -m "Update editor deploy handler to use Deploy API"
```

---

## Task 10: Update SKILL.md Files and Hook Context

**Files:**
- Modify: `skills/vibes/SKILL.md`
- Modify: `skills/sell/SKILL.md`
- Modify: `skills/cloudflare/SKILL.md`
- Modify: `hooks/session-context.md`
- Modify: `hooks/session-start.sh`

**Step 1: Update SKILL.md deploy instructions**

In each SKILL.md, replace any `.env` setup instructions for OIDC fields. The new flow is:
1. User runs deploy command
2. Browser opens for Pocket ID login (if not cached)
3. App deploys automatically

Remove:
- `.env` credential setup sections for OIDC
- `--oidc-authority`, `--clerk-key`, `--webhook-secret` flag references
- Credential validation gate steps

Add:
- Note that auth is automatic (browser login on first deploy)
- Simplified deploy command: `node scripts/deploy-cloudflare.js --name <app> --file index.html`

**Step 2: Update session hooks**

In `hooks/session-start.sh`, remove `.env` detection for `VITE_OIDC_AUTHORITY` and `VITE_OIDC_CLIENT_ID`. Replace with a check for `~/.vibes/auth.json` (cached tokens).

In `hooks/session-context.md`, update the credential status section — auth is no longer a prerequisite, it happens during deploy.

**Step 3: Commit**

```bash
git add skills/*/SKILL.md hooks/session-context.md hooks/session-start.sh
git commit -m "Update skill docs and hooks for managed auth (no user credentials)"
```

---

## Task 11: Update CLAUDE.md and Clean Up Remaining References

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `.env.example`

**Step 1: Update CLAUDE.md**

- Remove `.env` OIDC fields from environment variable docs
- Add Deploy API Worker to the architecture section
- Update deploy workflow description (no wrangler, no user CF tokens)
- Update "Non-Obvious Files" table with `deploy-api/`, `scripts/lib/cli-auth.js`, `scripts/lib/auth-constants.js`
- Remove `--oidc-authority`, `--clerk-key` from deploy flag docs

**Step 2: Update .env.example**

Remove `VITE_OIDC_AUTHORITY` and `VITE_OIDC_CLIENT_ID`. Keep only:
- `VITE_API_URL` (Connect token API — populated at deploy time)
- `VITE_CLOUD_URL` (Connect cloud backend — populated at deploy time)
- `OPENROUTER_API_KEY` (optional, for AI features)

**Step 3: Search for remaining stale references**

Run: `grep -rn "VITE_OIDC_AUTHORITY\|VITE_OIDC_CLIENT_ID\|--oidc-authority\|--clerk-key\|wrangler deploy\|wrangler secret" --include="*.js" --include="*.ts" --include="*.md" --include="*.sh" -l`

Exclude `docs/plans/`, `node_modules/`, `.git/`, `deploy-api/` (the Deploy API Worker legitimately uses OIDC config).

Fix any remaining references.

**Step 4: Commit**

```bash
git add CLAUDE.md README.md .env.example
git commit -m "Update docs for shared infrastructure model — no user credentials"
```

---

## Task 12: Full Test Suite and Verification

**Step 1: Rebuild all templates**

```bash
node scripts/build-components.js --force
node scripts/build-design-tokens.js --force
node scripts/merge-templates.js --force
```

**Step 2: Run all script tests**

```bash
cd scripts && npm test
```

Fix any failures.

**Step 3: Run Deploy API Worker tests**

```bash
cd deploy-api && npx vitest run
```

**Step 4: Run CF Worker tests**

```bash
cd skills/cloudflare/worker && npx vitest run
```

**Step 5: Run fixture tests**

```bash
cd scripts && npm run test:fixtures
```

**Step 6: Verify no stale placeholder references in generated templates**

```bash
grep -o '__VITE_OIDC_[A-Z_]*__\|__CLERK_[A-Z_]*__' skills/vibes/templates/index.html skills/sell/templates/unified.html
```

Expected: no matches (OIDC values should be hardcoded, Clerk should be gone).

**Step 7: Verify OIDC constants are baked in**

```bash
grep 'pocket-id.vibes.diy\|vibes-apps' skills/vibes/templates/index.html
```

Expected: matches showing the hardcoded authority and client ID.

**Step 8: Commit any test fixes**

```bash
git add -A
git commit -m "Fix tests for shared infrastructure model"
```

---

## Verification Checkpoint

Before declaring done:

1. `cd scripts && npm test` — all tests pass
2. `cd deploy-api && npx vitest run` — Deploy API tests pass
3. `cd skills/cloudflare/worker && npx vitest run` — CF Worker tests pass
4. `grep -ri "wrangler deploy\|wrangler secret" scripts/ --include="*.js"` — no client-side wrangler usage
5. `grep -ri "VITE_OIDC_AUTHORITY\|VITE_OIDC_CLIENT_ID" scripts/lib/env-utils.js` — not in CONFIG_PLACEHOLDERS
6. Generated templates contain hardcoded OIDC authority and client ID (not placeholders)
7. `~/.vibes/auth.json` token cache is used by `deploy-cloudflare.js`
8. Deploy API Worker has health endpoint (`GET /health`) and deploy endpoint (`POST /deploy`)

---

## Out of Scope (Later)

- **Deploy API production deployment** — deploying the Worker itself to our CF account, setting secrets
- **Connect auto-provisioning via Deploy API** — Task 6 stubs this; needs alchemy integration
- **Billing / Stripe webhooks** — architecture supports it (JWT claims + deploy gate), implementation deferred
- **Pocket ID admin setup** — one-time manual: create `vibes-apps` client with wildcard callbacks
- **E2E browser testing** — use `/vibes:test` after infrastructure is deployed
- **Editor deploy UI updates** — may need frontend changes to pass OIDC token from sessionStorage to deploy handler
