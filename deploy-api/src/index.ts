/**
 * Vibes Deploy API Worker
 *
 * Accepts assembled HTML + OIDC token and deploys to Cloudflare Workers.
 * JWT verification uses RS256 with dynamic JWKS fetching from Pocket ID.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, DeployRequest, DeployResponse, JWTPayload, SubdomainRecord } from "./types";

// ---------------------------------------------------------------------------
// JWT Verification — Dynamic JWKS
// ---------------------------------------------------------------------------

let cachedJwks: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchJwks(fetcher: Fetcher): Promise<JsonWebKey[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cachedJwks.keys;
  }
  // Use Service Binding to avoid Worker-to-Worker .workers.dev routing issue
  const res = await fetcher.fetch("https://pocket-id/.well-known/jwks.json");
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = (await res.json()) as { keys: JsonWebKey[] };
  cachedJwks = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

async function importJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

/**
 * Decode base64url (JWT encoding) to string
 */
function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

/**
 * Parse JWT without verification (extract header, payload, signature, signed data)
 */
function parseJwt(token: string): {
  header: { alg: string; typ?: string; kid?: string };
  payload: JWTPayload;
  signature: Uint8Array;
  signedData: Uint8Array;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));

    // Decode signature from base64url
    const sigBase64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    const sigPadded = sigBase64 + "=".repeat((4 - (sigBase64.length % 4)) % 4);
    const sigBinary = atob(sigPadded);
    const signature = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      signature[i] = sigBinary.charCodeAt(i);
    }

    // The signed data is "header.payload" (the first two segments)
    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

    return { header, payload, signature, signedData };
  } catch {
    return null;
  }
}

/**
 * Find the matching JWK from the JWKS endpoint, with cache-bust retry on miss.
 */
async function findKey(kid: string | undefined, fetcher: Fetcher): Promise<JsonWebKey | null> {
  let keys = await fetchJwks(fetcher);

  // Match by kid if present, otherwise use first RS256 key
  let match = kid
    ? keys.find((k) => (k as Record<string, unknown>).kid === kid)
    : keys.find((k) => (k as Record<string, unknown>).kty === "RSA");

  if (!match) {
    // Cache bust and retry once (handles key rotation mid-cache)
    cachedJwks = null;
    keys = await fetchJwks(fetcher);
    match = kid
      ? keys.find((k) => (k as Record<string, unknown>).kid === kid)
      : keys.find((k) => (k as Record<string, unknown>).kty === "RSA");
  }

  return match ?? null;
}

/**
 * Verify an RS256 JWT by fetching JWKS from the issuer's discovery endpoint.
 * Validates signature, expiry, iat, and issuer claims.
 */
async function verifyJWT(
  token: string,
  issuer: string,
  fetcher: Fetcher
): Promise<JWTPayload | null> {
  const parsed = parseJwt(token);
  if (!parsed) return null;

  if (parsed.header.alg !== "RS256") return null;

  try {
    const jwk = await findKey(parsed.header.kid, fetcher);
    if (!jwk) return null;

    const cryptoKey = await importJwk(jwk);

    const isValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      parsed.signature,
      parsed.signedData
    );

    if (!isValid) return null;

    const now = Math.floor(Date.now() / 1000);

    // Check expiry
    if (typeof parsed.payload.exp !== "number" || parsed.payload.exp < now) {
      return null;
    }

    // Check iat is not in the future (with 60s clock skew tolerance)
    if (typeof parsed.payload.iat !== "number" || parsed.payload.iat > now + 60) {
      return null;
    }

    // Validate issuer
    if (parsed.payload.iss !== issuer) {
      return null;
    }

    // Must have a subject
    if (!parsed.payload.sub) {
      return null;
    }

    return parsed.payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Registry Helpers (per-subdomain KV keys)
// ---------------------------------------------------------------------------

async function getSubdomain(kv: KVNamespace, name: string): Promise<SubdomainRecord | null> {
  const raw = await kv.get(`subdomain:${name}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SubdomainRecord;
  } catch {
    return null;
  }
}

async function setSubdomain(kv: KVNamespace, name: string, record: SubdomainRecord): Promise<void> {
  await kv.put(`subdomain:${name}`, JSON.stringify(record));
}

/**
 * Check if user owns the subdomain or if it is unclaimed.
 */
function userOwnsOrCanCreate(record: SubdomainRecord | null, userId: string): boolean {
  // Unclaimed — anyone can create
  if (!record) return true;
  // Owner match
  if (record.owner === userId) return true;
  // Collaborator match
  if (record.collaborators?.some((c) => c.userId === userId)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Cloudflare Workers API Deploy
// ---------------------------------------------------------------------------

/**
 * Deploy a multi-file app as a CF Worker that serves static files.
 */
async function deployCFWorker(
  accountId: string,
  apiToken: string,
  appName: string,
  files: Record<string, string>
): Promise<{ ok: boolean; url: string; error?: string }> {
  // Worker script that serves files from an embedded map
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
    // Health check
    if (url.pathname === "/__health") {
      return new Response("ok", { status: 200 });
    }
    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    const key = path.startsWith('/') ? path.slice(1) : path;
    if (key in FILES) {
      return new Response(FILES[key], {
        headers: { 'Content-Type': getMime(key) },
      });
    }
    // SPA fallback
    if ('index.html' in FILES) {
      return new Response(FILES['index.html'], {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('Not Found', { status: 404 });
  },
};
`.trim();

  // Upload worker script via CF API using ES module format
  const metadata = {
    main_module: "index.js",
    compatibility_date: "2025-01-01",
  };

  const formData = new FormData();
  formData.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  formData.append(
    "index.js",
    new Blob([workerScript], { type: "application/javascript+module" }),
    "index.js"
  );

  // Upload the worker
  const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${appName}`;
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${apiToken}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    return { ok: false, url: "", error: `Upload failed (${uploadRes.status}): ${body}` };
  }

  // Enable workers.dev subdomain
  const subdomainUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${appName}/subdomain`;
  const subdomainRes = await fetch(subdomainUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled: true }),
  });

  if (!subdomainRes.ok) {
    // Non-fatal: the worker is deployed, subdomain routing just might not be enabled
    console.error(`Subdomain enable failed (${subdomainRes.status}): ${await subdomainRes.text()}`);
  }

  // Get the account's workers.dev subdomain for the URL
  // Convention: <script-name>.<account-subdomain>.workers.dev
  // We don't know the account subdomain here, so return a pattern
  const url = `https://${appName}.workers.dev`;

  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// Hono App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use("*", cors());

// Health check
app.get("/health", (c) => {
  return c.json({ ok: true });
});

// Deploy endpoint
app.post("/deploy", async (c) => {
  // Extract Bearer token
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ ok: false, error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, c.env.OIDC_ISSUER, c.env.POCKET_ID);
  if (!payload) {
    return c.json({ ok: false, error: "Invalid or expired token" }, 401);
  }

  const userId = payload.sub;

  // Parse request body
  let body: DeployRequest;
  try {
    body = await c.req.json<DeployRequest>();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { name } = body;

  // Validate name
  if (!name || typeof name !== "string") {
    return c.json({ ok: false, error: "Missing 'name' field" }, 400);
  }

  const nameRegex = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/;
  if (!nameRegex.test(name)) {
    return c.json(
      { ok: false, error: "Invalid name: must be lowercase alphanumeric with hyphens, 1-63 chars" },
      400
    );
  }

  // Build files map — accept `files` (new) or `html` (legacy)
  let files: Record<string, string>;
  if (body.files && typeof body.files === "object") {
    files = body.files;
  } else if (body.html && typeof body.html === "string") {
    // Legacy single-file format
    files = { "index.html": body.html };
  } else {
    return c.json({ ok: false, error: "Missing 'files' or 'html' field" }, 400);
  }

  // Must contain index.html
  if (!files["index.html"]) {
    return c.json({ ok: false, error: "files must contain 'index.html'" }, 400);
  }

  // Check registry ownership
  const existing = await getSubdomain(c.env.REGISTRY_KV, name);
  if (!userOwnsOrCanCreate(existing, userId)) {
    return c.json({ ok: false, error: "Subdomain is owned by another user" }, 403);
  }

  // Deploy via CF API
  const result = await deployCFWorker(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN, name, files);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, 502);
  }

  // Update registry KV
  const now = new Date().toISOString();
  const record: SubdomainRecord = existing
    ? { ...existing, updatedAt: now }
    : { owner: userId, collaborators: [], connectProvisioned: false, createdAt: now, updatedAt: now };
  await setSubdomain(c.env.REGISTRY_KV, name, record);

  // Update user mapping (append if new)
  const userKey = `user:${userId}`;
  const userRaw = await c.env.REGISTRY_KV.get(userKey);
  const userApps: string[] = userRaw ? JSON.parse(userRaw) : [];
  if (!userApps.includes(name)) {
    userApps.push(name);
    await c.env.REGISTRY_KV.put(userKey, JSON.stringify(userApps));
  }

  const response: DeployResponse = { ok: true, url: result.url, name };
  return c.json(response);
});

// Status endpoint — returns deploy + Connect provisioning status
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

export default app;
