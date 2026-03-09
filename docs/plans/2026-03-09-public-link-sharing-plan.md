# Public Link Sharing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let app owners generate a public link so anyone can join their app with shared data sync.

**Architecture:** Two-phase delivery. Phase 1: upstream PR to the Fireproof Connect dashboard (tenant membership fix + service auth). Phase 2: Deploy API join flow, VibesPanel UI, and SharingBridge event handler. The OIDC bridge requires zero changes — existing auto-redeem handles Connect provisioning.

**Tech Stack:** TypeScript, Hono (Deploy API Worker), CF Workers KV, Pocket ID OIDC, oauth4webapi (PKCE), Vitest

**Design doc:** `docs/plans/2026-03-09-public-link-sharing-design.md`

---

## Phase 1: Upstream Dashboard PR

Work in a local clone of `fireproof-storage/fireproof` on the `selem/docker-for-all` branch:

```bash
git clone --depth 50 https://github.com/fireproof-storage/fireproof.git --branch selem/docker-for-all /tmp/fp-public-link-pr
cd /tmp/fp-public-link-pr
git checkout -b fix/redeem-invite-tenant-and-service-auth
```

---

### Task 1: Write failing test for tenant membership on ledger invite redemption

**Files:**
- Modify: `dashboard/backend/tests/db-api.test.ts`

**Step 1: Write the test**

Add a new test after the existing invite redemption tests (around line 758). The test creates a ledger invite, redeems it, and asserts the user was added to BOTH `LedgerUsers` AND `TenantUsers`:

```typescript
it("redeemInvite for ledger invite also adds user to the ledger's tenant", async () => {
  // User A (admin) creates a ledger in their default tenant
  const adminData = datas[0];
  const adminApi = adminData.api;

  // Get admin's tenants to find the default tenant
  const rAdminTenants = await adminApi.listTenantsByUser({});
  expect(rAdminTenants.isOk()).toBe(true);
  const adminTenant = rAdminTenants.Ok().tenants.find((t) => t.role === "admin" && t.default);
  expect(adminTenant).toBeDefined();

  // Create a ledger under the admin's tenant
  const rLedger = await adminApi.createLedger({
    ledger: { tenantId: adminTenant!.tenantId, name: "shared-ledger-tenant-test" },
  });
  expect(rLedger.isOk()).toBe(true);
  const ledgerId = rLedger.Ok().ledger.ledgerId;

  // User A invites User B (by email) to the ledger
  const inviteeData = datas[5]; // a different test user
  const inviteeEmail = inviteeData.email;

  const rInvite = await adminApi.inviteUser({
    ticket: {
      query: { byString: inviteeEmail },
      invitedParams: {
        ledger: { id: ledgerId, role: "member", right: "write" },
      },
    },
  });
  expect(rInvite.isOk()).toBe(true);
  expect(rInvite.Ok().invite.status).toBe("pending");

  // User B signs in (ensureUser auto-redeems invites)
  const inviteeApi = inviteeData.api;
  const rEnsure = await inviteeApi.ensureUser({});
  expect(rEnsure.isOk()).toBe(true);

  // Verify: User B should now be in the ledger's tenant
  const rInviteeTenants = await inviteeApi.listTenantsByUser({});
  expect(rInviteeTenants.isOk()).toBe(true);
  const memberTenant = rInviteeTenants.Ok().tenants.find(
    (t) => t.tenantId === adminTenant!.tenantId
  );
  expect(memberTenant).toBeDefined();
  expect(memberTenant!.role).toBe("member");

  // Verify: ensureCloudToken should succeed with the shared ledger
  const rToken = await inviteeApi.ensureCloudToken({
    appId: "test-tenant-fix",
    ledger: ledgerId,
  });
  expect(rToken.isOk()).toBe(true);
  expect(rToken.Ok().tenant).toBe(adminTenant!.tenantId);
  expect(rToken.Ok().ledger).toBe(ledgerId);

  // Verify: the cloud token's tenants array includes the admin's tenant
  const claims = rToken.Ok().claims;
  const hasTenant = claims.tenants.some((t) => t.id === adminTenant!.tenantId);
  expect(hasTenant).toBe(true);
});
```

**Note:** Adapt the test data access pattern (`datas[N]`, `.api`, `.email`) to match the existing test setup at lines 25-112 of `db-api.test.ts`. Read the setup code first to confirm field names.

**Step 2: Run test to verify it fails**

Run: `cd dashboard && pnpm test -- --run -t "redeemInvite for ledger invite also adds user to the ledger's tenant"`

Expected: FAIL — the user will be in `LedgerUsers` but NOT in `TenantUsers` for the admin's tenant. `ensureCloudToken` will fail with "no tenant found" or produce a token where `selected.tenant` is missing from `tenants[]`.

**Step 3: Commit failing test**

```bash
git add dashboard/backend/tests/db-api.test.ts
git commit -m "test: failing test for ledger invite tenant membership"
```

---

### Task 2: Fix `redeemInvite` to add users to the ledger's tenant

**Files:**
- Modify: `dashboard/backend/public/redeem-invite.ts:50-67`

**Step 1: Add `addUserToTenant` call**

In `redeem-invite.ts`, the block starting at line 50 handles `invite.invitedParams.ledger`. After the ledger lookup but before `addUserToLedger`, add the tenant membership:

```typescript
// EXISTING: if (invite.invitedParams.ledger) { ... ledger lookup ... }
// ADD after ledger lookup, before addUserToLedger:

            if (invite.invitedParams.ledger) {
              const ledger = await ctx.db
                .select()
                .from(sqlLedgers)
                .where(and(eq(sqlLedgers.ledgerId, invite.invitedParams.ledger.id), eq(sqlLedgers.status, "active")))
                .get();
              if (!ledger) {
                throw new Error("ledger not found");
              }
              // Add user to the ledger's parent tenant (required for cloud token validation)
              await addUserToTenant(ctx, {
                userName: `invited-${ledger.name}`,
                tenantId: ledger.tenantId,
                userId: req.auth.user.userId,
                role: invite.invitedParams.ledger.role ?? "member",
              });
              await addUserToLedger(ctx, {
                userName: `invited-${ledger.name}`,
                ledgerId: ledger.ledgerId,
                tenantId: ledger.tenantId,
                userId: req.auth.user.userId,
                role: invite.invitedParams.ledger.role,
                right: invite.invitedParams.ledger.right,
              });
            }
```

Also add the import at top of file if not already present:
```typescript
import { addUserToTenant } from "../internal/add-user-to-tenant.js";
```

**Step 2: Run tests**

Run: `cd dashboard && pnpm test -- --run`

Expected: ALL PASS, including the new test from Task 1.

**Step 3: Commit**

```bash
git add dashboard/backend/public/redeem-invite.ts
git commit -m "fix: add tenant membership when redeeming ledger invites

redeemInvite called addUserToLedger but not addUserToTenant for
ledger invites. The cloud backend's ensureTendantLedger validation
requires selected.tenant to be in the token's tenants array, which
only includes tenants with a TenantUsers row."
```

---

### Task 3: Write failing test for service auth

**Files:**
- Modify: `dashboard/backend/tests/db-api.test.ts`

**Step 1: Write the tests**

Add tests for service auth. Three cases: valid key, wrong key, no key configured.

```typescript
describe("service auth", () => {
  it("accepts inviteUser with valid service auth", async () => {
    // Use User A (admin) as the service identity
    const adminData = datas[0];
    const adminTenants = await adminData.api.listTenantsByUser({});
    const adminTenant = adminTenants.Ok().tenants.find((t) => t.role === "admin" && t.default);

    const rLedger = await adminData.api.createLedger({
      ledger: { tenantId: adminTenant!.tenantId, name: "service-auth-test-ledger" },
    });
    expect(rLedger.isOk()).toBe(true);
    const ledgerId = rLedger.Ok().ledger.ledgerId;

    // Call inviteUser with service auth (compound token: key|userId|email)
    const serviceToken = `test-service-key|${adminData.userId}|${adminData.email}`;
    const targetEmail = "newuser-service@example.com";

    // Direct API call with service auth
    const res = await svc(
      new Request("https://test/api", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "reqInviteUser",
          auth: { type: "service", token: serviceToken },
          ticket: {
            query: { byString: targetEmail },
            invitedParams: {
              ledger: { id: ledgerId, role: "member", right: "write" },
            },
          },
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("resInviteUser");
    expect(body.invite.status).toBe("pending");
  });

  it("rejects service auth with wrong key", async () => {
    const res = await svc(
      new Request("https://test/api", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "reqInviteUser",
          auth: { type: "service", token: "wrong-key|user|email" },
          ticket: {
            query: { byString: "x@x.com" },
            invitedParams: { tenant: { id: "x", role: "member" } },
          },
        }),
      })
    );
    expect(res.status).toBe(500); // Evento returns 500 for auth errors
    const body = await res.json();
    expect(body.type).toBe("error");
  });
});
```

**Note:** The test setup must pass `SERVICE_API_KEY: "test-service-key"` in the env vars to `createHandler`. Check the `beforeAll` at line 55 of `db-api.test.ts` and add it to the env object.

**Step 2: Run tests to verify failure**

Run: `cd dashboard && pnpm test -- --run -t "service auth"`

Expected: FAIL — `"service"` auth type not recognized.

**Step 3: Commit**

```bash
git add dashboard/backend/tests/db-api.test.ts
git commit -m "test: failing tests for service auth"
```

---

### Task 4: Implement `ServiceApiToken` class

**Files:**
- Modify: `core/protocols/dashboard/token.ts:205-216`

**Step 1: Add ServiceApiToken class**

Add the class before the `tokenApi` export (before line 205):

```typescript
export class ServiceApiToken implements FPApiToken {
  readonly sthis: SuperThis;

  constructor(sthis: SuperThis) {
    this.sthis = sthis;
  }

  async decode(token: string): Promise<Result<VerifiedClaimsResult>> {
    return this.verify(token);
  }

  async verify(token: string): Promise<Result<VerifiedClaimsResult>> {
    const rEnv = this.sthis.env.gets({
      SERVICE_API_KEY: param.OPTIONAL,
    });
    if (rEnv.isErr()) {
      return Result.Err("Service auth configuration error");
    }
    const configuredKey = rEnv.Ok().SERVICE_API_KEY;
    if (!configuredKey) {
      return Result.Err("Service auth not configured");
    }

    // Compound token format: <key>|<userId>|<email>
    const parts = token.split("|");
    if (parts.length < 3) {
      return Result.Err("Invalid service token format");
    }
    const [key, userId, email] = parts;

    if (key !== configuredKey) {
      return Result.Err("Invalid service key");
    }

    // Return ClerkClaim-shaped claims
    return Result.Ok({
      type: "service",
      token,
      claims: {
        userId,
        params: {
          email: email,
        },
      } as ClerkClaim,
    });
  }
}
```

**Note:** You may need to import `ClerkClaim` from `@fireproof/core-types-base` — check existing imports at the top of the file.

**Step 2: Register in tokenApi**

Modify the `tokenApi` export at line 205:

```typescript
export const tokenApi = Lazy(async (sthis: SuperThis, opts: VerifyWithCertificateOptions) => {
  return {
    "device-id": new DeviceIdApiToken(sthis, opts),
    clerk: new ClerkApiToken(sthis),
    service: new ServiceApiToken(sthis),
  };
});
```

**Step 3: Handle "service" type in auth coercion**

In `dashboard/backend/utils/auth.ts`, modify `coercedVerifiedAuthUser` at line 35:

```typescript
    case "device-id":
    case "clerk":
    case "service": {
```

**Step 4: Pass SERVICE_API_KEY in test setup**

In `dashboard/backend/tests/db-api.test.ts`, in the `beforeAll` env object (around line 62), add:

```typescript
SERVICE_API_KEY: "test-service-key",
```

**Step 5: Run tests**

Run: `cd dashboard && pnpm test -- --run`

Expected: ALL PASS.

**Step 6: Commit**

```bash
git add core/protocols/dashboard/token.ts dashboard/backend/utils/auth.ts dashboard/backend/tests/db-api.test.ts
git commit -m "feat: add service auth for machine-to-machine API calls

Adds ServiceApiToken with compound token format (key|userId|email).
Opt-in via SERVICE_API_KEY env var. Enables external services like
the Deploy API to call inviteUser without an OIDC token."
```

---

### Task 5: Create the upstream PR

**Step 1: Push branch**

```bash
git push origin fix/redeem-invite-tenant-and-service-auth
```

**Step 2: Create PR**

```bash
gh pr create \
  --repo fireproof-storage/fireproof \
  --base selem/docker-for-all \
  --title "fix: tenant membership on ledger invite + service auth" \
  --body "$(cat <<'EOF'
## Summary

- **redeemInvite tenant fix:** When redeeming a ledger invite, also add the user to the ledger's parent tenant via `addUserToTenant`. Without this, `ensureCloudToken` produces a cloud token where `selected.tenant` isn't in `tenants[]`, and the Cloud Backend rejects all data operations.

- **Service auth:** Add `ServiceApiToken` class for machine-to-machine API calls. Uses compound token format (`key|userId|email`). Opt-in via `SERVICE_API_KEY` env var. Needed by the VibesOS Deploy API to create Connect invites for public link sharing.

## Test plan

- [ ] Existing tests pass unchanged
- [ ] New test: ledger invite redemption creates both LedgerUsers and TenantUsers rows
- [ ] New test: ensureCloudToken succeeds after ledger invite redemption (selected.tenant in tenants[])
- [ ] New test: service auth accepted with valid key
- [ ] New test: service auth rejected with wrong key
EOF
)"
```

---

## Phase 2: Deploy API + Client-Side

Work in the vibes-skill repo. Phase 2 can begin before the upstream PR merges — the Deploy API changes are independent until E2E testing.

---

### Task 6: Add `publicInvite` to SubdomainRecord type

**Files:**
- Modify: `deploy-api/src/types.ts`

**Step 1: Update the type**

```typescript
export interface SubdomainRecord {
  owner: string;
  collaborators?: Array<{ userId: string; email?: string; role?: string }>;
  connectProvisioned?: boolean;
  oidcClientId?: string;
  userGroupId?: string;
  publicInvite?: { token: string; right: string; createdAt: string };
  connect?: { apiUrl?: string; cloudBackendUrl?: string; dashboardUrl?: string };
  createdAt?: string;
  updatedAt?: string;
}
```

**Step 2: Commit**

```bash
git add deploy-api/src/types.ts
git commit -m "feat: add publicInvite and connect fields to SubdomainRecord type"
```

---

### Task 7: Write tests for public link generation endpoint

**Files:**
- Create: `deploy-api/src/__tests__/public-link.test.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect } from "vitest";

// Extract the logic we need to test (same pattern as deploy.test.ts)
interface SubdomainRecord {
  owner: string;
  collaborators?: Array<{ userId: string; email?: string; role?: string }>;
  publicInvite?: { token: string; right: string; createdAt: string };
}

describe("public link generation", () => {
  it("only the owner can generate a public link", () => {
    const record: SubdomainRecord = { owner: "user-1" };
    expect(record.owner === "user-1").toBe(true);
    expect(record.owner === "user-2").toBe(false);
  });

  it("stores publicInvite on the subdomain record", () => {
    const record: SubdomainRecord = { owner: "user-1" };
    const token = "test-uuid-token";
    const updated: SubdomainRecord = {
      ...record,
      publicInvite: { token, right: "write", createdAt: new Date().toISOString() },
    };
    expect(updated.publicInvite?.token).toBe(token);
    expect(updated.publicInvite?.right).toBe("write");
  });

  it("regenerating replaces the old token", () => {
    const record: SubdomainRecord = {
      owner: "user-1",
      publicInvite: { token: "old-token", right: "write", createdAt: "2026-01-01" },
    };
    const newToken = "new-token";
    const updated: SubdomainRecord = {
      ...record,
      publicInvite: { token: newToken, right: "write", createdAt: new Date().toISOString() },
    };
    expect(updated.publicInvite?.token).toBe(newToken);
    expect(updated.publicInvite?.token).not.toBe("old-token");
  });
});

describe("join token validation", () => {
  it("accepts matching token", () => {
    const record: SubdomainRecord = {
      owner: "user-1",
      publicInvite: { token: "abc123", right: "write", createdAt: "2026-01-01" },
    };
    expect(record.publicInvite?.token === "abc123").toBe(true);
  });

  it("rejects wrong token", () => {
    const record: SubdomainRecord = {
      owner: "user-1",
      publicInvite: { token: "abc123", right: "write", createdAt: "2026-01-01" },
    };
    expect(record.publicInvite?.token === "wrong").toBe(false);
  });

  it("rejects when no public link exists", () => {
    const record: SubdomainRecord = { owner: "user-1" };
    expect(record.publicInvite).toBeUndefined();
  });
});
```

**Step 2: Run tests**

Run: `cd deploy-api && npx vitest run src/__tests__/public-link.test.ts`

Expected: ALL PASS (these test extracted logic, not the endpoint itself).

**Step 3: Commit**

```bash
git add deploy-api/src/__tests__/public-link.test.ts
git commit -m "test: public link generation and token validation logic"
```

---

### Task 8: Implement PKCE helpers for CF Workers

**Files:**
- Create: `deploy-api/src/pkce.ts`
- Create: `deploy-api/src/__tests__/pkce.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { generateCodeVerifier, generateCodeChallenge } from "../pkce";

describe("PKCE", () => {
  it("generates a code verifier of appropriate length", async () => {
    const verifier = await generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    // Must be URL-safe base64
    expect(/^[A-Za-z0-9_-]+$/.test(verifier)).toBe(true);
  });

  it("generates a valid S256 code challenge", async () => {
    const verifier = await generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    // Must be URL-safe base64 without padding
    expect(/^[A-Za-z0-9_-]+$/.test(challenge)).toBe(true);
    expect(challenge).not.toContain("=");
  });

  it("same verifier produces same challenge", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const c1 = await generateCodeChallenge(verifier);
    const c2 = await generateCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });

  it("different verifiers produce different challenges", async () => {
    const v1 = await generateCodeVerifier();
    const v2 = await generateCodeVerifier();
    const c1 = await generateCodeChallenge(v1);
    const c2 = await generateCodeChallenge(v2);
    expect(c1).not.toBe(c2);
  });
});
```

**Step 2: Run test to verify failure**

Run: `cd deploy-api && npx vitest run src/__tests__/pkce.test.ts`

Expected: FAIL — module not found.

**Step 3: Implement**

```typescript
// deploy-api/src/pkce.ts
// PKCE helpers using Web Crypto API (CF Workers compatible)

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generateCodeVerifier(): Promise<string> {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer.buffer);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}
```

**Step 4: Run tests**

Run: `cd deploy-api && npx vitest run src/__tests__/pkce.test.ts`

Expected: ALL PASS.

**Step 5: Commit**

```bash
git add deploy-api/src/pkce.ts deploy-api/src/__tests__/pkce.test.ts
git commit -m "feat: PKCE helpers using Web Crypto API for join flow"
```

---

### Task 9: Implement `POST /apps/:name/public-link` endpoint

**Files:**
- Modify: `deploy-api/src/index.ts`

**Step 1: Add the endpoint**

Add after the existing `POST /apps/:name/invite` endpoint (after line 783):

```typescript
// Public link endpoint — generate a reusable join URL
app.post("/apps/:name/public-link", async (c) => {
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
  const name = c.req.param("name");

  const record = await getSubdomain(c.env.REGISTRY_KV, name);
  if (!record) {
    return c.json({ ok: false, error: "App not found" }, 404);
  }
  if (record.owner !== userId) {
    return c.json({ ok: false, error: "Only the app owner can generate a public link" }, 403);
  }

  let body: { right?: string };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const inviteToken = crypto.randomUUID();
  const now = new Date().toISOString();
  await setSubdomain(c.env.REGISTRY_KV, name, {
    ...record,
    publicInvite: {
      token: inviteToken,
      right: body.right || "write",
      createdAt: now,
    },
    updatedAt: now,
  });

  // Build the join URL using the Deploy API's own domain
  const deployHost = new URL(c.req.url).origin;
  const joinUrl = `${deployHost}/join/${name}/${inviteToken}`;

  return c.json({ ok: true, joinUrl });
});
```

**Step 2: Commit**

```bash
git add deploy-api/src/index.ts
git commit -m "feat: POST /apps/:name/public-link endpoint"
```

---

### Task 10: Implement join flow — `GET /join/:app/:token` and `GET /join/callback`

**Files:**
- Modify: `deploy-api/src/index.ts`

**Step 1: Add the join-client helper**

Add after the existing helper functions (around line 210):

```typescript
// ---------------------------------------------------------------------------
// Join Flow — OIDC Authorization Code + PKCE for public link joining
// ---------------------------------------------------------------------------

let cachedJoinClientId: string | null = null;

/**
 * Ensure the "vibes-join" OIDC client exists in Pocket ID.
 * Non-group-restricted so any Pocket ID user can authenticate through it.
 */
async function ensureJoinClient(
  fetcher: Fetcher,
  apiKey: string,
  deployOrigin: string
): Promise<string> {
  if (cachedJoinClientId) return cachedJoinClientId;

  const existing = await findAppByName(fetcher, apiKey, "vibes-join");
  if (existing) {
    cachedJoinClientId = existing.id;
    return existing.id;
  }

  const result = await createApp(fetcher, apiKey, {
    name: "vibes-join",
    callbackURLs: [`${deployOrigin}/join/callback`],
    isPublic: true,
  });

  // Remove group restriction — vibes-join must be open to all
  await updateApp(fetcher, apiKey, result.id, { isGroupRestricted: false });

  cachedJoinClientId = result.id;
  return result.id;
}
```

**Step 2: Add the join start endpoint**

```typescript
import { generateCodeVerifier, generateCodeChallenge } from "./pkce";

// Join start — validates token, redirects to Pocket ID for auth
app.get("/join/:app/:token", async (c) => {
  const appName = c.req.param("app");
  const joinToken = c.req.param("token");

  const record = await getSubdomain(c.env.REGISTRY_KV, appName);
  if (!record?.publicInvite || record.publicInvite.token !== joinToken) {
    return c.html("<h1>Invalid or expired invite link</h1>", 404);
  }

  if (!c.env.POCKET_ID_API_KEY) {
    return c.html("<h1>Join flow not configured</h1>", 500);
  }

  const deployOrigin = new URL(c.req.url).origin;
  const joinClientId = await ensureJoinClient(
    c.env.POCKET_ID,
    c.env.POCKET_ID_API_KEY,
    deployOrigin
  );

  // PKCE
  const codeVerifier = await generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store state in KV (5 min TTL)
  const stateKey = `join-state:${crypto.randomUUID()}`;
  await c.env.REGISTRY_KV.put(
    stateKey,
    JSON.stringify({ app: appName, joinToken, codeVerifier }),
    { expirationTtl: 300 }
  );

  // Build Pocket ID authorize URL
  const authorizeUrl = new URL(`${c.env.OIDC_ISSUER}/authorize`);
  authorizeUrl.searchParams.set("client_id", joinClientId);
  authorizeUrl.searchParams.set("redirect_uri", `${deployOrigin}/join/callback`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "openid profile email");
  authorizeUrl.searchParams.set("state", stateKey);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  return c.redirect(authorizeUrl.toString(), 302);
});
```

**Step 3: Add the callback endpoint**

```typescript
// Join callback — exchanges code, provisions access, redirects to app
app.get("/join/callback", async (c) => {
  const code = c.req.query("code");
  const stateKey = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.html(`<h1>Authentication failed: ${error}</h1>`, 400);
  }

  if (!code || !stateKey) {
    return c.html("<h1>Missing code or state</h1>", 400);
  }

  // Retrieve and delete state (single-use)
  const stateRaw = await c.env.REGISTRY_KV.get(stateKey);
  if (!stateRaw) {
    return c.html("<h1>Invalid or expired state</h1>", 400);
  }
  await c.env.REGISTRY_KV.delete(stateKey);

  const state = JSON.parse(stateRaw) as {
    app: string;
    joinToken: string;
    codeVerifier: string;
  };

  // Exchange code for tokens
  const deployOrigin = new URL(c.req.url).origin;
  const joinClientId = await ensureJoinClient(
    c.env.POCKET_ID,
    c.env.POCKET_ID_API_KEY,
    deployOrigin
  );

  const tokenRes = await c.env.POCKET_ID.fetch("https://pocket-id/api/oidc/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${deployOrigin}/join/callback`,
      client_id: joinClientId,
      code_verifier: state.codeVerifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error(`[join] Token exchange failed: ${tokenRes.status} ${text}`);
    return c.html("<h1>Authentication failed</h1>", 500);
  }

  const tokens = (await tokenRes.json()) as { id_token: string; access_token: string };
  const idPayload = parseJwt(tokens.id_token);
  if (!idPayload) {
    return c.html("<h1>Invalid ID token</h1>", 500);
  }

  const userId = idPayload.payload.sub;
  const email = (idPayload.payload as Record<string, unknown>).email as string || "";

  // Look up the app record and validate join token still matches
  const record = await getSubdomain(c.env.REGISTRY_KV, state.app);
  if (!record?.publicInvite || record.publicInvite.token !== state.joinToken) {
    return c.html("<h1>Invite link has been revoked</h1>", 410);
  }

  try {
    // 1. Add user to Pocket ID group
    if (record.userGroupId) {
      await addUsersToGroup(
        c.env.POCKET_ID,
        c.env.POCKET_ID_API_KEY,
        record.userGroupId,
        [userId]
      );
    }

    // 2. Create Connect invite via dashboard API (service auth)
    if (record.connect?.apiUrl) {
      const serviceToken = `${c.env.SERVICE_API_KEY || ""}|${record.owner}|`;
      await fetch(record.connect.apiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "reqInviteUser",
          auth: { type: "service", token: serviceToken },
          ticket: {
            query: { byString: email },
            invitedParams: {
              ledger: {
                id: record.connect.ledgerId,
                role: "member",
                right: record.publicInvite.right || "write",
              },
            },
          },
        }),
      });
    }

    // 3. Add collaborator to KV
    const collaborators = record.collaborators || [];
    if (!collaborators.some((col) => col.userId === userId)) {
      collaborators.push({ userId, email, role: "member" });
      await setSubdomain(c.env.REGISTRY_KV, state.app, {
        ...record,
        collaborators,
        updatedAt: new Date().toISOString(),
      });
    }

    // 4. Generate OTA for seamless sign-in to the per-app client
    const ota = await createOneTimeAccessToken(
      c.env.POCKET_ID,
      c.env.POCKET_ID_API_KEY,
      userId
    );

    // 5. Redirect to the app
    const appUrl = c.env.CF_ZONE_ID
      ? `https://${state.app}.vibesos.com`
      : `https://${state.app}.workers.dev`;

    return c.redirect(`${appUrl}?ota=${encodeURIComponent(ota.token)}`, 302);
  } catch (err) {
    console.error(`[join] Failed to complete join for ${email} to ${state.app}:`, err);
    return c.html("<h1>Join failed — please try again</h1>", 500);
  }
});
```

**Step 4: Add SERVICE_API_KEY to Env type**

In `deploy-api/src/types.ts`, add to the `Env` interface:

```typescript
SERVICE_API_KEY?: string;
```

Also add `connect` fields and `publicInvite` to `SubdomainRecord` if not already done in Task 6.

**Step 5: Commit**

```bash
git add deploy-api/src/index.ts deploy-api/src/types.ts
git commit -m "feat: join flow endpoints for public link sharing

GET /join/:app/:token starts OIDC flow via vibes-join client.
GET /join/callback exchanges code, adds user to Pocket ID group,
creates Connect invite via service auth, and redirects to app with OTA."
```

---

### Task 11: Add public link UI to VibesPanel

**Files:**
- Modify: `components/VibesPanel/VibesPanel.tsx`

**Step 1: Read the current VibesPanel code**

Read `components/VibesPanel/VibesPanel.tsx` in full to understand the mode-switching pattern, event dispatch, and BrutalistCard feedback. Then add a "public-link" mode alongside the existing "invite" mode.

Key additions:
- A "Generate public link" button alongside "Invite by email" in the share mode selection
- `setMode("public-link")` handler
- DOM event dispatch: `vibes-public-link-request` with `{ right: "write" }`
- Listeners for `vibes-public-link-success` and `vibes-public-link-error`
- BrutalistCard showing the link with a Copy button on success

**Step 2: Rebuild components**

```bash
bun scripts/build-components.js --force
```

**Step 3: Commit**

```bash
git add components/VibesPanel/VibesPanel.tsx build/vibes-menu.js
git commit -m "feat: add 'Generate public link' option to VibesPanel share UI"
```

---

### Task 12: Add public link event handler to SharingBridge

**Files:**
- Modify: `source-templates/base/template.html` (SharingBridge section)

**Step 1: Read the SharingBridge code**

Read lines 333-515 of `source-templates/base/template.html` to understand the existing `vibes-share-request` handler pattern. Then add a parallel handler for `vibes-public-link-request`.

Add the event listener inside the existing SharingBridge component (after the `vibes-share-request` listener):

```javascript
document.addEventListener("vibes-public-link-request", function (e) {
  var detail = e.detail || {};
  var appName = window.location.hostname.split(".")[0];
  var deployApiUrl = (window.__VIBES_CONFIG__ || {}).deployApiUrl;
  var token = sessionStorage.getItem("vibes_oidc_access_token");

  if (!deployApiUrl || !token) {
    document.dispatchEvent(new CustomEvent("vibes-public-link-error", {
      detail: { error: "Not authenticated or deploy API not configured" }
    }));
    return;
  }

  fetch(deployApiUrl.replace(/\/$/, "") + "/apps/" + appName + "/public-link", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ right: detail.right || "write" })
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    if (data.ok) {
      document.dispatchEvent(new CustomEvent("vibes-public-link-success", {
        detail: { link: data.joinUrl }
      }));
    } else {
      document.dispatchEvent(new CustomEvent("vibes-public-link-error", {
        detail: { error: data.error || "Failed to generate link" }
      }));
    }
  })
  .catch(function (err) {
    document.dispatchEvent(new CustomEvent("vibes-public-link-error", {
      detail: { error: err.message }
    }));
  });
});
```

**Step 2: Rebuild templates**

```bash
bun scripts/merge-templates.js --force
```

**Step 3: Commit**

```bash
git add source-templates/base/template.html
git commit -m "feat: SharingBridge handler for public link generation"
```

---

### Task 13: E2E verification

**Step 1: Deploy a test app**

Use the vibes skill or manual deploy to deploy an app with the updated templates.

**Step 2: Generate a public link**

Open the deployed app, sign in as owner, open VibesPanel → "Generate public link". Copy the link.

**Step 3: Test the join flow**

Open the link in a different browser or incognito window. Verify:
- Redirect to Pocket ID login
- After auth, redirect to the app with `?ota=`
- User is signed in
- Data syncs (verify by creating a document on one side, seeing it on the other)

**Step 4: Commit any fixes**

```bash
git commit -m "fix: address issues found during E2E testing"
```

---

## Dependency Graph

```
Phase 1 (upstream):
  Task 1 (test) → Task 2 (fix) → Task 3 (test) → Task 4 (impl) → Task 5 (PR)

Phase 2 (vibes-skill, can start in parallel with Phase 1):
  Task 6 (types) → Task 7 (tests) → Task 8 (PKCE) → Task 9 (public-link endpoint)
                                                    → Task 10 (join flow)
                                                    → Task 11 (VibesPanel UI)
                                                    → Task 12 (SharingBridge)
                                                    → Task 13 (E2E)
```

Tasks 9, 10, 11, 12 can be worked in parallel within Phase 2 since they touch different files. Task 13 requires all prior tasks.
