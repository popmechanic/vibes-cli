# Server-Side Connect Provisioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Fireproof Connect provisioning from client-side alchemy into the Deploy API Worker so users never need Cloudflare API tokens.

**Architecture:** The Deploy API Worker gains a `provisionConnect()` function that creates per-app R2, D1, Workers, and AccountApiTokens via the Cloudflare REST API using the platform `CF_API_TOKEN`. Pre-built cloud-backend and dashboard Worker bundles are embedded at build time. Crypto generation uses Web Crypto API (native in CF Workers). The `/deploy` endpoint calls `provisionConnect()` on first deploy, stores Connect metadata in KV, and injects Connect URLs into the app HTML before deploying.

**Tech Stack:** Hono (CF Worker framework), Cloudflare REST API v4, Web Crypto API (EC P-256, ECDSA)

**Design doc:** `docs/plans/2026-03-09-server-side-connect-provisioning-design.md`

---

### Task 1: Build Cloud-Backend and Dashboard Worker Bundles

Build the upstream Fireproof Workers into self-contained JS bundles that the Deploy API can upload via the CF API.

**Files:**
- Create: `deploy-api/bundles/cloud-backend.js`
- Create: `deploy-api/bundles/dashboard.js`
- Create: `deploy-api/scripts/build-connect-bundles.sh`

**Step 1: Write the bundle build script**

```bash
#!/usr/bin/env bash
# Build Connect Worker bundles from upstream Fireproof source
# Run from vibes-skill root: bash deploy-api/scripts/build-connect-bundles.sh

set -euo pipefail

REPO_DIR="${HOME}/.vibes/upstream/fireproof"
OUT_DIR="$(dirname "$0")/../bundles"
mkdir -p "$OUT_DIR"

# Ensure upstream repo exists
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Error: upstream fireproof repo not found at $REPO_DIR"
  echo "Run a deploy first to trigger sparse checkout, or clone manually."
  exit 1
fi

# Cloud backend — single Worker with Durable Object
echo "Building cloud-backend bundle..."
cd "$REPO_DIR"
npx esbuild cloud/backend/cf-d1/server.ts \
  --bundle \
  --format=esm \
  --platform=browser \
  --conditions=workerd,worker,browser \
  --outfile="$OUT_DIR/cloud-backend.js" \
  --minify

# Dashboard backend — Worker with static assets
echo "Building dashboard bundle..."
npx esbuild dashboard/backend/cf-serve.ts \
  --bundle \
  --format=esm \
  --platform=browser \
  --conditions=workerd,worker,browser \
  --outfile="$OUT_DIR/dashboard.js" \
  --minify

echo "Bundles written to $OUT_DIR/"
ls -la "$OUT_DIR/cloud-backend.js" "$OUT_DIR/dashboard.js"
```

**Step 2: Run the build script**

Run: `bash deploy-api/scripts/build-connect-bundles.sh`
Expected: Two JS files created in `deploy-api/bundles/`. If esbuild flags missing deps or Worker-incompatible imports, fix the build flags (add `--external:` for CF runtime globals). This may take iteration — the upstream source uses Hono, Drizzle, and CF bindings.

**Step 3: Verify the bundles export a default fetch handler**

Run: `head -5 deploy-api/bundles/cloud-backend.js && echo "---" && tail -5 deploy-api/bundles/cloud-backend.js`
Expected: ESM bundle with `export default` or `export{...}` at the end.

**Step 4: Commit**

```bash
git add deploy-api/bundles/ deploy-api/scripts/build-connect-bundles.sh
git commit -m "build: add pre-built Connect Worker bundles for server-side provisioning"
```

**Note:** The build script may need iteration. The upstream Workers use `workspace:*` deps resolved by pnpm — esbuild needs to resolve these from `node_modules`. If the upstream `pnpm install` hasn't been run, the script should do it first. Adjust the script as needed during this step.

---

### Task 2: Add Crypto Module to Deploy API Worker

Port `crypto-utils.js` to TypeScript for use inside the CF Worker. The existing code uses `webcrypto` from Node's `crypto` module and `Buffer` — replace with CF Worker-native equivalents.

**Files:**
- Create: `deploy-api/src/crypto.ts`
- Test: `deploy-api/src/__tests__/crypto.test.ts`

**Step 1: Write the failing test**

```typescript
// deploy-api/src/__tests__/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { generateSessionTokens, generateDeviceCAKeys, base58Encode, jwkToEnv } from '../crypto';

describe('crypto', () => {
  describe('base58Encode', () => {
    it('encodes bytes to base58', () => {
      const bytes = new Uint8Array([0, 1, 2, 3]);
      const result = base58Encode(bytes);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // Leading zero byte becomes '1'
      expect(result[0]).toBe('1');
    });
  });

  describe('jwkToEnv', () => {
    it('encodes JWK as z-prefixed base58 string', () => {
      const jwk = { kty: 'EC', crv: 'P-256', x: 'test', y: 'test' };
      const result = jwkToEnv(jwk);
      expect(result[0]).toBe('z');
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('generateSessionTokens', () => {
    it('returns publicEnv and privateEnv as z-prefixed strings', async () => {
      const result = await generateSessionTokens();
      expect(result.publicEnv).toMatch(/^z/);
      expect(result.privateEnv).toMatch(/^z/);
      expect(result.publicEnv).not.toBe(result.privateEnv);
    });
  });

  describe('generateDeviceCAKeys', () => {
    it('returns privKey and cert', async () => {
      const result = await generateDeviceCAKeys();
      expect(result.privKey).toMatch(/^z/);
      // cert is a JWT (3 dot-separated base64url segments)
      expect(result.cert.split('.').length).toBe(3);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd deploy-api && npx vitest run src/__tests__/crypto.test.ts`
Expected: FAIL — `../crypto` module not found.

**Step 3: Write the crypto module**

```typescript
// deploy-api/src/crypto.ts
/**
 * Cryptographic utilities for Connect provisioning.
 * Uses Web Crypto API (native in CF Workers).
 * Ported from scripts/lib/crypto-utils.js — no Node.js deps.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = '';
  for (const byte of bytes) {
    if (byte === 0) result += '1';
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

export function jwkToEnv(jwk: JsonWebKey): string {
  const jsonStr = JSON.stringify(jwk);
  const bytes = new TextEncoder().encode(jsonStr);
  return 'z' + base58Encode(bytes);
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generateSessionTokens(): Promise<{ publicEnv: string; privateEnv: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  publicJwk.alg = 'ES256';
  privateJwk.alg = 'ES256';

  return { publicEnv: jwkToEnv(publicJwk), privateEnv: jwkToEnv(privateJwk) };
}

export async function generateDeviceCAKeys(): Promise<{ privKey: string; cert: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  privateJwk.alg = 'ES256';
  const privKey = jwkToEnv(privateJwk);

  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  const now = Math.floor(Date.now() / 1000);
  const oneYear = 365 * 24 * 60 * 60;

  const kidBytes = new Uint8Array(32);
  crypto.getRandomValues(kidBytes);
  const kid = base58Encode(kidBytes);

  const header = { alg: 'ES256', typ: 'CERT+JWT', kid, x5c: [] as string[] };

  const jtiBytes = new Uint8Array(32);
  crypto.getRandomValues(jtiBytes);
  const serialBytes = new Uint8Array(32);
  crypto.getRandomValues(serialBytes);

  const payload = {
    iss: 'Docker Dev CA',
    sub: 'Docker Dev CA',
    aud: 'certificate-users',
    iat: now,
    nbf: now,
    exp: now + oneYear,
    jti: base58Encode(jtiBytes),
    certificate: {
      version: '3',
      serialNumber: base58Encode(serialBytes),
      subject: {
        commonName: 'Docker Dev CA',
        organization: 'Vibes DIY Development',
        locality: 'Local',
        stateOrProvinceName: 'Development',
        countryName: 'WD',
      },
      issuer: {
        commonName: 'Docker Dev CA',
        organization: 'Vibes DIY Development',
        locality: 'Local',
        stateOrProvinceName: 'Development',
        countryName: 'WD',
      },
      validity: {
        notBefore: new Date(now * 1000).toISOString(),
        notAfter: new Date((now + oneYear) * 1000).toISOString(),
      },
      subjectPublicKeyInfo: {
        kty: publicJwk.kty,
        crv: publicJwk.crv,
        x: publicJwk.x,
        y: publicJwk.y,
      },
      signatureAlgorithm: 'ES256',
      keyUsage: ['digitalSignature', 'keyEncipherment'],
      extendedKeyUsage: ['serverAuth'],
    },
  };

  const headerB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));

  const dataToSign = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    dataToSign
  );
  const signatureB64 = toBase64Url(signature);

  const cert = `${headerB64}.${payloadB64}.${signatureB64}`;
  return { privKey, cert };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd deploy-api && npx vitest run src/__tests__/crypto.test.ts`
Expected: All 4 tests PASS.

**Step 5: Commit**

```bash
git add deploy-api/src/crypto.ts deploy-api/src/__tests__/crypto.test.ts
git commit -m "feat: add Web Crypto-based token generation for Deploy API Worker"
```

---

### Task 3: Add Connect Provisioning Module to Deploy API Worker

Create the `connect.ts` module that provisions Cloudflare resources via the REST API.

**Files:**
- Create: `deploy-api/src/connect.ts`
- Test: `deploy-api/src/__tests__/connect.test.ts`

**Step 1: Write the failing test**

```typescript
// deploy-api/src/__tests__/connect.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { provisionConnect, BACKEND_MIGRATION_SQL, DASHBOARD_MIGRATION_SQL } from '../connect';

// Mock global fetch for CF API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function cfResponse(result: unknown, success = true) {
  return new Response(JSON.stringify({ success, result }), {
    status: success ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('provisionConnect', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('creates all resources and returns Connect info', async () => {
    const accountId = 'test-account';
    const apiToken = 'test-token';
    const stage = 'my-app';

    // Mock responses in order: R2 bucket, API token, D1 backend, D1 backend query,
    // D1 dashboard, D1 dashboard query, cloud-backend Worker upload, cloud-backend subdomain,
    // dashboard Worker upload, dashboard subdomain, workers subdomain
    mockFetch
      // R2 bucket creation
      .mockResolvedValueOnce(cfResponse({ name: `fp-storage-${stage}` }))
      // AccountApiToken creation
      .mockResolvedValueOnce(cfResponse({
        id: 'token-id',
        value: 'secret-token-value',
      }))
      // D1 backend creation
      .mockResolvedValueOnce(cfResponse({ uuid: 'd1-backend-uuid' }))
      // D1 backend migration query
      .mockResolvedValueOnce(cfResponse([{ success: true }]))
      // D1 dashboard creation
      .mockResolvedValueOnce(cfResponse({ uuid: 'd1-dashboard-uuid' }))
      // D1 dashboard migration query
      .mockResolvedValueOnce(cfResponse([{ success: true }]))
      // Cloud-backend Worker upload
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      // Cloud-backend subdomain enable
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      // Dashboard Worker upload
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      // Dashboard subdomain enable
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      // Workers subdomain lookup
      .mockResolvedValueOnce(cfResponse({ subdomain: 'acct' }));

    const result = await provisionConnect({
      accountId,
      apiToken,
      stage,
      oidcAuthority: 'https://vibesos.com',
      oidcServiceWorkerName: 'pocket-id',
      cloudBackendBundle: 'export default { fetch() { return new Response("ok"); } }',
      dashboardBundle: 'export default { fetch() { return new Response("ok"); } }',
    });

    expect(result.cloudBackendUrl).toContain(`fireproof-cloud-${stage}`);
    expect(result.dashboardUrl).toContain(`fireproof-dashboard-${stage}`);
    expect(result.apiUrl).toContain('/api');
    expect(result.cloudUrl).toMatch(/^fpcloud:\/\//);
    expect(result.r2BucketName).toBe(`fp-storage-${stage}`);
    expect(result.d1BackendId).toBe('d1-backend-uuid');
    expect(result.d1DashboardId).toBe('d1-dashboard-uuid');
    expect(result.sessionTokenPublic).toMatch(/^z/);
  });

  it('migration SQL constants are non-empty', () => {
    expect(BACKEND_MIGRATION_SQL.length).toBeGreaterThan(100);
    expect(DASHBOARD_MIGRATION_SQL.length).toBeGreaterThan(100);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd deploy-api && npx vitest run src/__tests__/connect.test.ts`
Expected: FAIL — `../connect` module not found.

**Step 3: Write the Connect provisioning module**

Create `deploy-api/src/connect.ts`. This is the core of the feature. Key implementation notes:

- Each CF API call uses `Authorization: Bearer ${apiToken}` header
- R2 bucket: `POST /accounts/{id}/r2/buckets` with `{ name }`. 409 = already exists = OK.
- AccountApiToken: `POST /user/tokens` with `{ name, policies }`. Returns `value` (the secret).
- D1 database: `POST /accounts/{id}/d1/database` with `{ name }`. Returns `{ uuid }`.
- D1 query: `POST /accounts/{id}/d1/database/{uuid}/query` with `{ sql }`.
- Worker upload: `PUT /accounts/{id}/workers/scripts/{name}` with multipart form (metadata + JS module).
- Worker subdomain: `POST /accounts/{id}/workers/scripts/{name}/subdomain` with `{ enabled: true }`.

The dashboard migration SQL uses Drizzle's `--> statement-breakpoint` separator. Split on that and execute each statement separately.

Cloud-backend Worker bindings: `FP_STORAGE` (R2), `FP_BACKEND_D1` (D1), `FP_WS_ROOM` (Durable Object class `FPRoomDurableObject`), plus text bindings for VERSION, FP_DEBUG, MAX_IDLE_TIME, and secret bindings for CLOUD_SESSION_TOKEN_PUBLIC, STORAGE_URL, ACCESS_KEY_ID, SECRET_ACCESS_KEY, REGION.

Dashboard Worker bindings: `DB` (D1), `OIDC_SERVICE` (service binding to `pocket-id`), plus secret bindings for OIDC_AUTHORITY, CLERK_PUBLISHABLE_KEY, CLERK_PUB_JWT_URL, CLOUD_SESSION_TOKEN_PUBLIC, CLOUD_SESSION_TOKEN_SECRET, DEVICE_ID_CA_PRIV_KEY, DEVICE_ID_CA_CERT, and text bindings for ENVIRONMENT, MAX_TENANTS, MAX_ADMIN_USERS, MAX_MEMBER_USERS, MAX_INVITES, MAX_LEDGERS.

**Important:** Worker uploads with bindings use multipart form with a metadata blob that declares `bindings` array. Each binding type has a different shape:
- `{ type: "r2_bucket", name: "FP_STORAGE", bucket_name: "fp-storage-stage" }`
- `{ type: "d1", name: "FP_BACKEND_D1", id: "d1-uuid" }`
- `{ type: "durable_object_namespace", name: "FP_WS_ROOM", class_name: "FPRoomDurableObject" }`
- `{ type: "secret_text", name: "FOO", text: "value" }`
- `{ type: "plain_text", name: "BAR", text: "value" }`
- `{ type: "service", name: "OIDC_SERVICE", service: "pocket-id" }`

Inline the two migration SQL strings as exported constants. Copy from:
- `~/.vibes/upstream/fireproof/cloud/backend/cf-d1/migrations/0001_initial.sql`
- `~/.vibes/upstream/fireproof/dashboard/backend/dist/0000_hard_the_executioner.sql`

For the dashboard migration, split on `--> statement-breakpoint` and execute each statement via the D1 query API.

The module exports `provisionConnect(params)` which returns `ConnectInfo`.

**Docs to consult:**
- Cloudflare API docs for R2 buckets, D1, Workers upload (multipart metadata format)
- `alchemy.run.ts` for the exact bindings list
- `scripts/lib/crypto-utils.js` is now ported as `crypto.ts`

**Step 4: Run tests to verify they pass**

Run: `cd deploy-api && npx vitest run src/__tests__/connect.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add deploy-api/src/connect.ts deploy-api/src/__tests__/connect.test.ts
git commit -m "feat: add server-side Connect provisioning via CF REST API"
```

---

### Task 4: Update SubdomainRecord Type and KV Schema

Add Connect metadata fields to the SubdomainRecord type.

**Files:**
- Modify: `deploy-api/src/types.ts`

**Step 1: Update the SubdomainRecord interface**

Add `connect` field to `SubdomainRecord` in `deploy-api/src/types.ts`:

```typescript
export interface ConnectInfo {
  cloudBackendUrl: string;
  dashboardUrl: string;
  apiUrl: string;
  cloudUrl: string;
  r2BucketName: string;
  d1BackendId: string;
  d1DashboardId: string;
  sessionTokenPublic: string;
  deployedAt: string;
}

export interface SubdomainRecord {
  owner: string;
  collaborators?: Array<{ userId: string; email?: string; role?: string }>;
  connectProvisioned?: boolean;
  connect?: ConnectInfo;
  oidcClientId?: string;
  userGroupId?: string;
  createdAt?: string;
  updatedAt?: string;
}
```

Also update `DeployResponse` to include Connect URLs:

```typescript
export interface DeployResponse {
  ok: boolean;
  url: string;
  name: string;
  connect?: {
    apiUrl: string;
    cloudUrl: string;
  };
}
```

**Step 2: Commit**

```bash
git add deploy-api/src/types.ts
git commit -m "feat: add ConnectInfo type to SubdomainRecord"
```

---

### Task 5: Integrate Connect Provisioning into /deploy Endpoint

Wire `provisionConnect()` into the existing deploy flow. On first deploy, provision Connect, store metadata in KV, inject URLs into HTML.

**Files:**
- Modify: `deploy-api/src/index.ts`

**Step 1: Read the current deploy endpoint carefully**

Read `deploy-api/src/index.ts` lines 529-670. Understand the current flow: JWT verify → parse body → validate name → check registry → Pocket ID registration → deploy CF Worker → assign domain → update KV.

**Step 2: Add Connect provisioning between Pocket ID registration and app Worker deploy**

After the Pocket ID registration block (line ~623) and before the `deployCFWorker` call (line ~626), add:

```typescript
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
      oidcServiceWorkerName: 'pocket-id',
      cloudBackendBundle: CLOUD_BACKEND_BUNDLE,
      dashboardBundle: DASHBOARD_BUNDLE,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connect provisioning failed';
    console.error(`[connect] Provisioning failed for ${name}:`, err);
    return c.json({ ok: false, error: `Connect provisioning failed: ${msg}` }, 502);
  }
} else {
  connectInfo = existing?.connect;
}

// Inject Connect URLs into HTML
if (connectInfo?.apiUrl && connectInfo?.cloudUrl && files['index.html']) {
  files['index.html'] = files['index.html']
    .replace(/tokenApiUri:\s*"[^"]*"/, `tokenApiUri: "${connectInfo.apiUrl}"`)
    .replace(/cloudBackendUrl:\s*"[^"]*"/, `cloudBackendUrl: "${connectInfo.cloudUrl}"`);
}
```

Import at top of file:
```typescript
import { provisionConnect } from './connect';
import type { ConnectInfo } from './types';
```

The bundles are imported as string constants from the bundle files. Since they're pre-built JS, import them as text at the top of the module. Wrangler supports importing `.js` files as text modules if configured in `wrangler.toml`, or embed them as string constants in `connect.ts`.

**Step 3: Update KV record to include Connect info**

In the KV update section (line ~654), add Connect metadata:

```typescript
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
```

**Step 4: Update response to include Connect URLs**

```typescript
const response: DeployResponse = {
  ok: true,
  url: deployedUrl,
  name,
  connect: connectInfo ? { apiUrl: connectInfo.apiUrl, cloudUrl: connectInfo.cloudUrl } : undefined,
};
```

**Step 5: Run existing tests to check nothing broke**

Run: `cd deploy-api && npx vitest run`
Expected: Existing tests pass (may need mock updates for the new provisionConnect calls).

**Step 6: Commit**

```bash
git add deploy-api/src/index.ts
git commit -m "feat: integrate Connect provisioning into /deploy endpoint"
```

---

### Task 6: Embed Connect Worker Bundles in Deploy API

Configure wrangler to include the pre-built bundles so they're available at runtime.

**Files:**
- Modify: `deploy-api/wrangler.toml`
- Modify: `deploy-api/src/connect.ts` (import bundles)

**Step 1: Add bundle imports**

In `connect.ts`, the bundles need to be available as strings. Two approaches:

**Option A (recommended):** Read bundles as text modules in wrangler.toml:
```toml
[[rules]]
type = "Text"
globs = ["bundles/*.js"]
```

Then import in `connect.ts`:
```typescript
import CLOUD_BACKEND_BUNDLE from '../bundles/cloud-backend.js';
import DASHBOARD_BUNDLE from '../bundles/dashboard.js';
```

**Option B:** If wrangler text module import doesn't work cleanly, inline the bundles as const strings in a generated file during a build step.

Try Option A first. If wrangler doesn't support text imports of `.js` files (it may try to treat them as modules), rename to `.txt`:

```bash
# In build-connect-bundles.sh, change output names:
--outfile="$OUT_DIR/cloud-backend.txt"
--outfile="$OUT_DIR/dashboard.txt"
```

```toml
[[rules]]
type = "Text"
globs = ["bundles/*.txt"]
```

**Step 2: Verify wrangler dev works**

Run: `cd deploy-api && npx wrangler dev --local`
Expected: Worker starts without errors. The bundles are available as string imports.

**Step 3: Commit**

```bash
git add deploy-api/wrangler.toml deploy-api/src/connect.ts
git commit -m "feat: embed Connect Worker bundles in Deploy API"
```

---

### Task 7: Update Dashboard Static Assets Handling

The dashboard Worker serves a frontend SPA from `Assets`. In alchemy, this uses the `Assets()` construct which bundles the entire `dashboard/frontend/dist/static/client` directory. For our direct CF API upload, we need to either:

1. Embed the dashboard frontend files in the dashboard bundle, OR
2. Deploy the dashboard Worker with CF Workers Static Assets (the `assets` binding in metadata)

**Files:**
- Modify: `deploy-api/scripts/build-connect-bundles.sh`
- Modify: `deploy-api/src/connect.ts`

**Step 1: Assess dashboard frontend assets**

Check what files are in `~/.vibes/upstream/fireproof/dashboard/frontend/dist/static/client/`:

Run: `ls -la ~/.vibes/upstream/fireproof/dashboard/frontend/dist/static/client/`

The dashboard frontend is a built Vite app (index.html, JS chunks, CSS, images). These need to be served by the dashboard Worker.

**Step 2: Embed dashboard frontend in the bundle**

The simplest approach: modify the build script to create a combined dashboard bundle that includes a file map of the frontend assets (same pattern as `deployCFWorker` in index.ts). The dashboard Worker's `env.ASSETS.fetch()` calls get replaced with an embedded file server.

Alternatively, use CF Workers Static Assets by uploading an asset manifest alongside the Worker. This is more complex but matches the upstream architecture.

**Start with the simpler approach:** Build a wrapper Worker that embeds the frontend assets as a file map and delegates API routes to the real dashboard backend code. This mirrors how the app Worker already works in `deployCFWorker`.

**Step 3: Update build script to create combined dashboard bundle**

The build script should:
1. Build the dashboard backend as before
2. Read all files from `dashboard/frontend/dist/static/client/`
3. Create a wrapper that embeds the file map + delegates to backend for `/api/*`

**Step 4: Test locally**

Run: `bash deploy-api/scripts/build-connect-bundles.sh`
Expected: Both bundles built. Dashboard bundle includes embedded frontend assets.

**Step 5: Commit**

```bash
git add deploy-api/scripts/build-connect-bundles.sh deploy-api/bundles/
git commit -m "feat: embed dashboard frontend assets in Worker bundle"
```

---

### Task 8: Remove Client-Side Alchemy from Deploy Handler

Remove the alchemy-based Connect provisioning from the client-side deploy flow. The Deploy API now handles it.

**Files:**
- Modify: `scripts/server/handlers/deploy.ts`
- Modify: `scripts/deploy-cloudflare.js`

**Step 1: Update deploy.ts handler**

Remove:
- `import { deployConnect } from '../../lib/alchemy-deploy.js';`
- The entire Connect provisioning block (lines 126-168)
- Connect URL injection into HTML (lines 170-183) — Deploy API now does this

Replace with reading Connect URLs from the Deploy API response:

```typescript
// Deploy via the Deploy API
const result: any = await response.json();
deployUrl = result.url || '';

// Save Connect info from Deploy API response
if (result.connect) {
  const appEntry = getApp(appName) || { name: appName };
  setApp(appName, {
    ...appEntry,
    connect: {
      apiUrl: result.connect.apiUrl,
      cloudUrl: result.connect.cloudUrl,
      deployedAt: new Date().toISOString(),
    },
  });
}
```

**Step 2: Update deploy-cloudflare.js**

Remove:
- `import { deployConnect } from './lib/alchemy-deploy.js';`
- `import { isFirstDeploy } from './lib/registry.js';` (keep other registry imports)
- The Connect provisioning block (lines 93-135)
- Connect URL injection (lines 125-135)

The Deploy API now handles all of this. The CLI just sends files and reads back the result.

**Step 3: Run the editor server and verify deploy still works**

Run: `VIBES_ROOT=$(pwd) bun scripts/server.ts --mode=editor`
Expected: Server starts. Deploy flow sends to Deploy API without attempting local alchemy.

**Step 4: Commit**

```bash
git add scripts/server/handlers/deploy.ts scripts/deploy-cloudflare.js
git commit -m "refactor: remove client-side alchemy, Deploy API handles Connect"
```

---

### Task 9: Clean Up Deprecated Alchemy Files

Remove client-side alchemy code that's no longer used.

**Files:**
- Delete: `scripts/lib/alchemy-deploy.js`
- Modify: `scripts/__tests__/unit/alchemy-deploy.test.js` (delete)

**Step 1: Verify no other imports reference alchemy-deploy**

Run: `grep -r "alchemy-deploy" scripts/ --include="*.js" --include="*.ts" -l`
Expected: Only the test file and the now-updated deploy files. If anything else imports it, update those too.

**Step 2: Delete the files**

```bash
rm scripts/lib/alchemy-deploy.js
rm scripts/__tests__/unit/alchemy-deploy.test.js
```

**Step 3: Run existing test suite to verify nothing breaks**

Run: `cd scripts && npm test`
Expected: All tests pass (minus the deleted alchemy test file).

**Step 4: Commit**

```bash
git add -u scripts/lib/alchemy-deploy.js scripts/__tests__/unit/alchemy-deploy.test.js
git commit -m "chore: remove client-side alchemy-deploy (replaced by Deploy API)"
```

---

### Task 10: Deploy and Verify

Deploy the updated Deploy API Worker and test end-to-end.

**Files:**
- No new files — deployment and verification.

**Step 1: Deploy the updated Deploy API Worker**

Run: `cd deploy-api && npx wrangler deploy`
Expected: Worker deploys successfully. Check output for any errors.

**Step 2: Test first deploy (new app)**

Use the CLI to deploy a test app that doesn't exist in the registry:

Run: `bun scripts/deploy-cloudflare.js --name connect-test-$(date +%s) --app test-fixtures/minimal-app.jsx`

(Or use the editor: generate a simple app, hit deploy.)

Expected: Deploy succeeds. Response includes Connect URLs. No "Command failed: bunx alchemy" error. The app loads at its deployed URL with real-time sync working.

**Step 3: Test update deploy (existing app)**

Deploy the same app again.

Expected: Connect provisioning is skipped (reads from KV). Deploy is fast.

**Step 4: Verify Connect actually works**

Open the deployed app in a browser. Check that:
- Fireproof sync connects (no "connecting" stall)
- Data persists across page refreshes
- Two browser tabs sync data in real-time

**Step 5: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end Connect provisioning testing"
```

---

### Task 11: Update CLAUDE.md and Memory

Update documentation to reflect the new architecture.

**Files:**
- Modify: `CLAUDE.md` — update Deploy Workflow section, remove `~/.vibes/cloudflare-api-token` references
- Modify: memory files if needed

**Step 1: Update CLAUDE.md**

In the "Deploy Workflow" section, update to reflect that Connect provisioning is now server-side. Remove references to `~/.vibes/cloudflare-api-token` and `alchemy-deploy.js`. Mention that the Deploy API Worker handles everything.

In the "Non-Obvious Files" table, remove `scripts/lib/alchemy-deploy.js` and add `deploy-api/src/connect.ts`.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for server-side Connect provisioning"
```
