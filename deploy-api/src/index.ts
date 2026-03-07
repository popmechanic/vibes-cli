/**
 * Vibes Deploy API Worker
 *
 * Accepts assembled HTML + OIDC token and deploys to Cloudflare Workers.
 * JWT verification uses RS256 with PEM public key from Pocket ID.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, DeployRequest, DeployResponse, JWTPayload, SubdomainRecord } from "./types";

// ---------------------------------------------------------------------------
// JWT Verification (adapted from skills/cloudflare/worker/src/lib/crypto-jwt.ts)
// ---------------------------------------------------------------------------

/**
 * Convert PEM-encoded public key to ArrayBuffer for Web Crypto API
 */
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
  header: { alg: string; typ?: string };
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
 * Verify an RS256 JWT against a PEM public key.
 * Validates signature, expiry, iat, and issuer claims.
 */
async function verifyJWT(
  token: string,
  pemKey: string,
  issuer: string
): Promise<JWTPayload | null> {
  const parsed = parseJwt(token);
  if (!parsed) return null;

  if (parsed.header.alg !== "RS256") return null;

  try {
    const keyData = pemToArrayBuffer(pemKey);
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      keyData,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

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
 * Deploy a single-file HTML app as a CF Worker that serves it.
 */
async function deployCFWorker(
  accountId: string,
  apiToken: string,
  appName: string,
  html: string
): Promise<{ ok: boolean; url: string; error?: string }> {
  // Worker script that serves the HTML
  const workerScript = `
const HTML = ${JSON.stringify(html)};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // Health check
    if (url.pathname === "/__health") {
      return new Response("ok", { status: 200 });
    }
    return new Response(HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
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
  const payload = await verifyJWT(token, c.env.OIDC_PEM_PUBLIC_KEY, c.env.OIDC_ISSUER);
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

  const { name, html } = body;

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

  // Validate html
  if (!html || typeof html !== "string") {
    return c.json({ ok: false, error: "Missing 'html' field" }, 400);
  }

  // Check registry ownership
  const existing = await getSubdomain(c.env.REGISTRY_KV, name);
  if (!userOwnsOrCanCreate(existing, userId)) {
    return c.json({ ok: false, error: "Subdomain is owned by another user" }, 403);
  }

  // Deploy via CF API
  const result = await deployCFWorker(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN, name, html);
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
