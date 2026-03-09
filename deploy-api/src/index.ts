/**
 * Vibes Deploy API Worker
 *
 * Accepts assembled HTML + OIDC token and deploys to Cloudflare Workers.
 * JWT verification uses RS256 with dynamic JWKS fetching from Pocket ID.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, DeployRequest, DeployResponse, JWTPayload, SubdomainRecord, ConnectInfo } from "./types";
import { provisionConnect } from "./connect";
import CLOUD_BACKEND_BUNDLE from "../bundles/cloud-backend.txt";
import DASHBOARD_BUNDLE from "../bundles/dashboard.txt";
import {
  createApp,
  getApp,
  updateApp,
  findAppByName,
  createUserGroup,
  findUserGroupByName,
  addUsersToGroup,
  setAllowedGroups,
  findOrCreateUser,
  createOneTimeAccessToken,
} from "./pocket-id";

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

    // Audience validation: Pocket ID sets aud to the OIDC client ID, not the
    // issuer URL. Since we already verify issuer + signature, accept any aud
    // issued by our trusted Pocket ID instance.

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

// Cache the account's workers.dev subdomain (never changes for an account)
let cachedWorkersSubdomain: string | null = null;

async function getWorkersSubdomain(accountId: string, apiToken: string): Promise<string | null> {
  if (cachedWorkersSubdomain) return cachedWorkersSubdomain;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: { subdomain?: string } };
    if (data.result?.subdomain) {
      cachedWorkersSubdomain = data.result.subdomain;
      return cachedWorkersSubdomain;
    }
  } catch {
    // Fall through to null
  }
  return null;
}

/**
 * Assign a custom domain to a deployed worker via the CF Workers Domains API.
 * Idempotent — re-calling with the same hostname updates the existing mapping.
 */
async function assignCustomDomain(
  accountId: string,
  apiToken: string,
  zoneId: string,
  appName: string,
  hostname: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hostname,
          service: appName,
          zone_id: zoneId,
          environment: "production",
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`Custom domain assignment failed (${res.status}): ${body}`);
      return { ok: false, error: `Custom domain failed (${res.status})` };
    }

    console.log(`Custom domain assigned: ${hostname} → ${appName}`);
    return { ok: true };
  } catch (err) {
    console.error("Custom domain assignment error:", err);
    return { ok: false, error: "Custom domain assignment error" };
  }
}

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
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function getMime(path) {
  const ext = path.substring(path.lastIndexOf('.'));
  return MIME_TYPES[ext] || 'text/plain';
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
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
      const content = FILES[key];
      // base64-encoded binary files (prefixed with "base64:")
      if (typeof content === 'string' && content.startsWith('base64:')) {
        return new Response(base64ToArrayBuffer(content.slice(7)), {
          headers: { 'Content-Type': getMime(key) },
        });
      }
      return new Response(content, {
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
    console.error(`Upload failed (${uploadRes.status}): ${body}`);
    return { ok: false, url: "", error: `Deploy failed (${uploadRes.status}). Please try again.` };
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

  // Get the account's workers.dev subdomain for the correct URL
  const subdomain = await getWorkersSubdomain(accountId, apiToken);
  const url = subdomain
    ? `https://${appName}.${subdomain}.workers.dev`
    : `https://${appName}.workers.dev`;

  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// Per-App Pocket ID Registration
// ---------------------------------------------------------------------------

/**
 * Register a per-app OIDC client and user group in Pocket ID.
 * Idempotent: skips if the SubdomainRecord already has oidcClientId.
 * Returns the oidcClientId (existing or newly created).
 */
async function registerAppInPocketId(
  fetcher: Fetcher,
  apiKey: string,
  appName: string,
  deployUrl: string,
  userId: string,
  existing: SubdomainRecord | null
): Promise<{ oidcClientId: string; userGroupId: string } | null> {
  // Already registered — verify client still exists in Pocket ID before trusting KV
  if (existing?.oidcClientId && existing?.userGroupId) {
    const verified = await getApp(fetcher, apiKey, existing.oidcClientId);
    if (verified) {
      // Ensure isGroupRestricted is set (may be missing on clients created by older code)
      await updateApp(fetcher, apiKey, existing.oidcClientId, { isGroupRestricted: true });
      console.log(`[pocket-id] Verified existing client=${existing.oidcClientId} (group restriction ensured)`);
      return { oidcClientId: existing.oidcClientId, userGroupId: existing.userGroupId };
    }
    console.warn(`[pocket-id] Stale client=${existing.oidcClientId} not found in Pocket ID, re-registering...`);
  }

  try {
    // 1. Register app in Pocket ID (or find existing)
    const appNamePocketId = `vibes-${appName}`;
    console.log(`[pocket-id] Step 1: Looking for existing app ${appNamePocketId}...`);
    const existingApp = await findAppByName(fetcher, apiKey, appNamePocketId);
    let oidcClientId: string;

    if (existingApp) {
      oidcClientId = existingApp.id;
      console.log(`[pocket-id] Step 1: found existing client=${oidcClientId}, ensuring isGroupRestricted...`);
      await updateApp(fetcher, apiKey, oidcClientId, { isGroupRestricted: true });
      console.log(`[pocket-id] Step 1 done: client=${oidcClientId} (group restriction ensured)`);
    } else {
      console.log(`[pocket-id] Step 1: Creating app ${appNamePocketId}...`);
      const appResult = await createApp(fetcher, apiKey, {
        name: appNamePocketId,
        callbackURLs: [`${deployUrl}/**`],
        isPublic: true,
      });
      oidcClientId = appResult.id;
      console.log(`[pocket-id] Step 1 done: created client=${oidcClientId}`);
    }

    // 2. Create user group for this app (or find existing)
    const groupName = `vibes-${appName}-users`;
    console.log(`[pocket-id] Step 2: Looking for existing group ${groupName}...`);
    const existingGroup = await findUserGroupByName(fetcher, apiKey, groupName);
    let userGroupId: string;

    if (existingGroup) {
      userGroupId = existingGroup.id;
      console.log(`[pocket-id] Step 2 done: found existing group=${userGroupId}`);
    } else {
      console.log(`[pocket-id] Step 2: Creating user group ${groupName}...`);
      const group = await createUserGroup(fetcher, apiKey, {
        name: groupName,
      });
      userGroupId = group.id;
      console.log(`[pocket-id] Step 2 done: created group=${userGroupId}`);
    }

    // 3. Add deployer as first member
    console.log(`[pocket-id] Step 3: Adding deployer ${userId} to group...`);
    await addUsersToGroup(fetcher, apiKey, userGroupId, [userId]);
    console.log(`[pocket-id] Step 3 done`);

    // 4. Restrict app to this group
    console.log(`[pocket-id] Step 4: Setting allowed groups on client...`);
    await setAllowedGroups(fetcher, apiKey, oidcClientId, [userGroupId]);
    console.log(`[pocket-id] Step 4 done`);

    console.log(`[pocket-id] Registered app vibes-${appName}, client=${oidcClientId}, group=${userGroupId}`);
    return { oidcClientId, userGroupId };
  } catch (err) {
    console.error(`[pocket-id] Failed to register app vibes-${appName}:`, err);
    return null;
  }
}

/**
 * Inject per-app oidcClientId into assembled HTML.
 * Replaces the placeholder or shared client ID in window.__VIBES_CONFIG__.
 */
function injectClientId(html: string, clientId: string): string {
  return html.replace(
    /oidcClientId:\s*"[^"]*"/,
    `oidcClientId: "${clientId}"`
  );
}

// ---------------------------------------------------------------------------
// Hono App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// CORS middleware — scoped to known origins (CLI doesn't need CORS; editor does)
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return origin; // non-browser (CLI) requests
      if (origin === "http://localhost:3333") return origin; // editor preview
      if (origin.endsWith(".workers.dev")) return origin; // deployed apps (legacy)
      if (origin.endsWith(".vibesos.com")) return origin; // deployed apps (custom domain)
      return null; // reject unknown origins
    },
  })
);

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

  // Per-app Pocket ID registration (on first deploy only)
  let oidcClientId = existing?.oidcClientId;
  let userGroupId = existing?.userGroupId;

  if (c.env.POCKET_ID_API_KEY) {
    // Build the canonical deploy URL for OIDC callback registration
    const deployUrl = c.env.CF_ZONE_ID
      ? `https://${name}.vibesos.com`
      : (() => {
          const subdomain = cachedWorkersSubdomain;
          return subdomain
            ? `https://${name}.${subdomain}.workers.dev`
            : `https://${name}.workers.dev`;
        })();

    const registration = await registerAppInPocketId(
      c.env.POCKET_ID,
      c.env.POCKET_ID_API_KEY,
      name,
      deployUrl,
      userId,
      existing
    );

    if (registration) {
      oidcClientId = registration.oidcClientId;
      userGroupId = registration.userGroupId;

      // Inject per-app client ID into HTML before deploy
      if (files["index.html"]) {
        files["index.html"] = injectClientId(files["index.html"], oidcClientId);
      }
    }
  }

  // --- Connect provisioning (first deploy only) ---
  let connectInfo: ConnectInfo | undefined;
  const isFirstDeploy = !existing?.connectProvisioned || !existing?.connect?.apiUrl;

  if (isFirstDeploy) {
    try {
      connectInfo = await provisionConnect({
        accountId: c.env.CF_ACCOUNT_ID,
        apiToken: c.env.CF_API_TOKEN,
        stage: name,
        oidcAuthority: c.env.OIDC_ISSUER,
        oidcServiceWorkerName: "pocket-id",
        cloudBackendBundle: CLOUD_BACKEND_BUNDLE,
        dashboardBundle: DASHBOARD_BUNDLE,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connect provisioning failed";
      console.error(`[connect] Provisioning failed for ${name}:`, err);
      return c.json({ ok: false, error: `Connect provisioning failed: ${msg}` }, 502);
    }
  } else {
    connectInfo = existing?.connect;
  }

  // Inject Connect URLs into HTML
  if (connectInfo?.apiUrl && connectInfo?.cloudUrl && files["index.html"]) {
    files["index.html"] = files["index.html"]
      .replace(/tokenApiUri:\s*"[^"]*"/, `tokenApiUri: "${connectInfo.apiUrl}"`)
      .replace(/cloudBackendUrl:\s*"[^"]*"/, `cloudBackendUrl: "${connectInfo.cloudUrl}"`);
  }

  // Deploy via CF API
  const result = await deployCFWorker(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN, name, files);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, 502);
  }

  // Assign custom domain: {name}.vibesos.com
  const customHostname = `${name}.vibesos.com`;
  if (c.env.CF_ZONE_ID) {
    const domainResult = await assignCustomDomain(
      c.env.CF_ACCOUNT_ID,
      c.env.CF_API_TOKEN,
      c.env.CF_ZONE_ID,
      name,
      customHostname
    );
    if (!domainResult.ok) {
      // Non-fatal: worker is deployed, custom domain just didn't attach
      console.error(`Custom domain assignment failed for ${customHostname}: ${domainResult.error}`);
    }
  }

  // Canonical URL uses vibesos.com; fall back to workers.dev if zone ID not configured
  const deployedUrl = c.env.CF_ZONE_ID
    ? `https://${customHostname}`
    : result.url;

  // Update registry KV
  const now = new Date().toISOString();
  const record: SubdomainRecord = existing
    ? {
        ...existing,
        oidcClientId,
        userGroupId,
        connectProvisioned: true,
        connect: connectInfo || existing.connect,
        updatedAt: now,
      }
    : {
        owner: userId,
        collaborators: [],
        connectProvisioned: !!connectInfo,
        connect: connectInfo,
        oidcClientId,
        userGroupId,
        createdAt: now,
        updatedAt: now,
      };
  await setSubdomain(c.env.REGISTRY_KV, name, record);

  // Update user mapping (append if new)
  const userKey = `user:${userId}`;
  const userRaw = await c.env.REGISTRY_KV.get(userKey);
  const userApps: string[] = userRaw ? JSON.parse(userRaw) : [];
  if (!userApps.includes(name)) {
    userApps.push(name);
    await c.env.REGISTRY_KV.put(userKey, JSON.stringify(userApps));
  }

  const response: DeployResponse = {
    ok: true,
    url: deployedUrl,
    name,
    connect: connectInfo ? { apiUrl: connectInfo.apiUrl, cloudUrl: connectInfo.cloudUrl } : undefined,
  };
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
    connect: record.connect ? { apiUrl: record.connect.apiUrl, cloudUrl: record.connect.cloudUrl } : undefined,
    updatedAt: record.updatedAt,
  });
});

// Invite endpoint — add user to app's Pocket ID group
app.post("/apps/:name/invite", async (c) => {
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

  const ownerUserId = payload.sub;
  const name = c.req.param("name");

  // Look up SubdomainRecord — verify caller is owner
  const record = await getSubdomain(c.env.REGISTRY_KV, name);
  if (!record) {
    return c.json({ ok: false, error: "App not found" }, 404);
  }
  if (record.owner !== ownerUserId) {
    return c.json({ ok: false, error: "Only the app owner can invite users" }, 403);
  }

  if (!record.userGroupId) {
    return c.json({ ok: false, error: "App has no Pocket ID user group" }, 400);
  }

  if (!c.env.POCKET_ID_API_KEY) {
    return c.json({ ok: false, error: "Pocket ID API key not configured" }, 500);
  }

  // Parse request body
  let body: { email: string };
  try {
    body = await c.req.json<{ email: string }>();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!body.email || typeof body.email !== "string") {
    return c.json({ ok: false, error: "Missing 'email' field" }, 400);
  }

  try {
    // Find or create invitee in Pocket ID
    const invitee = await findOrCreateUser(c.env.POCKET_ID, c.env.POCKET_ID_API_KEY, {
      email: body.email,
    });

    // Add invitee to app's user group
    await addUsersToGroup(
      c.env.POCKET_ID,
      c.env.POCKET_ID_API_KEY,
      record.userGroupId,
      [invitee.id]
    );

    // Generate one-time-access-token for passwordless login
    const ota = await createOneTimeAccessToken(
      c.env.POCKET_ID,
      c.env.POCKET_ID_API_KEY,
      invitee.id
    );

    // Build the app URL
    const appUrl = c.env.CF_ZONE_ID
      ? `https://${name}.vibesos.com`
      : await (async () => {
          const subdomain = await getWorkersSubdomain(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN);
          return subdomain
            ? `https://${name}.${subdomain}.workers.dev`
            : `https://${name}.workers.dev`;
        })();

    const inviteUrl = `${appUrl}?ota=${encodeURIComponent(ota.token)}`;

    // Add invitee to collaborators in registry
    const collaborators = record.collaborators || [];
    if (!collaborators.some((col) => col.userId === invitee.id)) {
      collaborators.push({ userId: invitee.id, email: body.email, role: "member" });
      await setSubdomain(c.env.REGISTRY_KV, name, {
        ...record,
        collaborators,
        updatedAt: new Date().toISOString(),
      });
    }

    return c.json({ ok: true, inviteUrl, userId: invitee.id });
  } catch (err) {
    console.error(`[invite] Failed to invite ${body.email} to ${name}:`, err);
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : "Invite failed" },
      500
    );
  }
});

export default app;
