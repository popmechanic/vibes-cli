# Public Link Sharing — Wiring & Polish Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bridge the gap between deployed Connect info and the join callback so public link sharing enables real data sync between users.

**Architecture:** Three code fixes (duplicate type, missing binding, lazy ledger discovery), one hardening pass (error page, debug removal), and one UX improvement (double sign-in fallback). Operational steps (setting secrets) are called out separately.

**Tech Stack:** TypeScript, Hono (CF Worker), CF Workers KV, Pocket ID OIDC, Vitest

**Supersedes:** `docs/plans/2026-03-09-public-link-remaining-work.md` (that doc diagnosed the problems; this plan fixes them)

---

## Task 1: Fix duplicate `connect` field on `SubdomainRecord`

**Problem:** `SubdomainRecord` in `types.ts` declares `connect` twice — line 65 as `ConnectInfo` and line 69 as `{ apiUrl?, cloudBackendUrl?, dashboardUrl?, ledgerId? }`. The second shadows the first. TypeScript strict mode would reject this, and the type system can't catch shape mismatches.

**Files:**
- Modify: `deploy-api/src/types.ts`

**Step 1: Merge the types**

Add `ledgerId` to `ConnectInfo` and remove the duplicate `connect` field from `SubdomainRecord`:

In `ConnectInfo` (line 38), add `ledgerId` as an optional field:

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
  ledgerId?: string;
}
```

In `SubdomainRecord` (line 61), remove the duplicate `connect` on line 69:

```typescript
export interface SubdomainRecord {
  owner: string;
  collaborators?: Array<{ userId: string; email?: string; role?: string }>;
  connectProvisioned?: boolean;
  connect?: ConnectInfo;
  oidcClientId?: string;
  userGroupId?: string;
  publicInvite?: { token: string; right: string; createdAt: string };
  createdAt?: string;
  updatedAt?: string;
}
```

**Step 2: Run tests to verify nothing breaks**

Run: `cd deploy-api && npx vitest run`

Expected: ALL PASS. The runtime objects already have the `ConnectInfo` shape from `provisionConnect()` — we're just fixing the type declaration.

**Step 3: Commit**

```bash
git add deploy-api/src/types.ts
git commit -m "fix: remove duplicate connect field from SubdomainRecord

The interface declared connect twice — as ConnectInfo and as a slimmer
inline type with ledgerId. Merged ledgerId into ConnectInfo and removed
the duplicate declaration."
```

---

## Task 2: Add `SERVICE_API_KEY` binding to dashboard Worker provisioning

**Problem:** The join callback sends service auth tokens to the Connect dashboard Worker, but the dashboard Worker has no `SERVICE_API_KEY` binding — it can't validate the tokens. The binding list is in `deploy-api/src/connect.ts` lines 448-468.

**Files:**
- Modify: `deploy-api/src/connect.ts`

**Step 1: Read `connect.ts` to find the `provisionConnect` signature and dashboard bindings**

Read `deploy-api/src/connect.ts` in full. Find:
1. The `provisionConnect` function signature (what params it takes)
2. The dashboard Worker bindings array (step 6, around line 445-468)

**Step 2: Add `serviceApiKey` parameter to `provisionConnect`**

Add `serviceApiKey?: string` to the function's parameter object. Then add a conditional binding in the dashboard Worker's bindings array:

After line 466 (`MAX_LEDGERS`), add:

```typescript
      // Service auth for machine-to-machine API calls (public link join flow)
      ...(serviceApiKey ? [{ type: 'secret_text' as const, name: 'SERVICE_API_KEY', text: serviceApiKey }] : []),
```

**Step 3: Pass `SERVICE_API_KEY` from the deploy endpoint caller**

In `deploy-api/src/index.ts`, find where `provisionConnect()` is called (search for `provisionConnect(`). Pass `serviceApiKey: c.env.SERVICE_API_KEY` in the options object.

**Step 4: Run tests**

Run: `cd deploy-api && npx vitest run`

Expected: ALL PASS. The `serviceApiKey` param is optional, so existing calls (including tests) don't need changes.

**Step 5: Commit**

```bash
git add deploy-api/src/connect.ts deploy-api/src/index.ts
git commit -m "feat: pass SERVICE_API_KEY to dashboard Worker on provision

The join callback sends service auth tokens to the Connect dashboard,
but the dashboard had no SERVICE_API_KEY binding to validate them.
Now passed through from the Deploy API's env during provisioning."
```

---

## Task 3: Implement lazy ledger discovery in join callback

**Problem:** The join callback needs a `ledgerId` to create a Connect invite (line 1077 of `index.ts`), but ledgers are created lazily — they don't exist at deploy time. The `record.connect.ledgerId` is always undefined.

**Solution:** At join time, query the Connect dashboard's `listLedgersByUser` endpoint (via service auth as the app owner) to discover the ledger. Match by app name in the ledger name (the OIDC bridge names ledgers after the hostname).

**Files:**
- Create: `deploy-api/src/ledger-discovery.ts`
- Create: `deploy-api/src/__tests__/ledger-discovery.test.ts`
- Modify: `deploy-api/src/index.ts`

**Step 1: Write the failing test**

Create `deploy-api/src/__tests__/ledger-discovery.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { discoverLedgerId } from "../ledger-discovery";

function mockFetch(response: object) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

describe("discoverLedgerId", () => {
  it("finds ledger by app name in ledger name", async () => {
    const fetchFn = mockFetch({
      type: "resListLedgersByUser",
      ledgers: [
        { ledgerId: "led-1", name: "other-app.vibesos.com", role: "admin" },
        { ledgerId: "led-2", name: "my-app.vibesos.com", role: "admin" },
      ],
    });

    const result = await discoverLedgerId({
      apiUrl: "https://dashboard.workers.dev/api",
      serviceToken: "key|owner-1|owner@test.com",
      appName: "my-app",
      fetchFn,
    });

    expect(result).toBe("led-2");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("returns first ledger when no name match", async () => {
    const fetchFn = mockFetch({
      type: "resListLedgersByUser",
      ledgers: [
        { ledgerId: "led-1", name: "something-else", role: "admin" },
      ],
    });

    const result = await discoverLedgerId({
      apiUrl: "https://dashboard.workers.dev/api",
      serviceToken: "key|owner-1|",
      appName: "my-app",
      fetchFn,
    });

    expect(result).toBe("led-1");
  });

  it("returns null when no ledgers exist", async () => {
    const fetchFn = mockFetch({
      type: "resListLedgersByUser",
      ledgers: [],
    });

    const result = await discoverLedgerId({
      apiUrl: "https://dashboard.workers.dev/api",
      serviceToken: "key|owner-1|",
      appName: "my-app",
      fetchFn,
    });

    expect(result).toBeNull();
  });

  it("returns null on fetch error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network fail"));

    const result = await discoverLedgerId({
      apiUrl: "https://dashboard.workers.dev/api",
      serviceToken: "key|owner-1|",
      appName: "my-app",
      fetchFn,
    });

    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd deploy-api && npx vitest run src/__tests__/ledger-discovery.test.ts`

Expected: FAIL — module not found.

**Step 3: Implement `discoverLedgerId`**

Create `deploy-api/src/ledger-discovery.ts`:

```typescript
/**
 * Lazy ledger discovery — queries the Connect dashboard's listLedgersByUser
 * endpoint to find the ledger for a given app. Uses service auth as the
 * app owner.
 *
 * Ledgers are created lazily (when the first user opens the app and triggers
 * sync), so they don't exist at deploy time. This function is called at
 * join time instead.
 */

interface DiscoverOptions {
  apiUrl: string;
  serviceToken: string;
  appName: string;
  fetchFn?: typeof fetch;
}

interface LedgerEntry {
  ledgerId: string;
  name: string;
  role: string;
}

export async function discoverLedgerId(opts: DiscoverOptions): Promise<string | null> {
  const { apiUrl, serviceToken, appName, fetchFn = fetch } = opts;

  try {
    const res = await fetchFn(apiUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "reqListLedgersByUser",
        auth: { type: "service", token: serviceToken },
      }),
    });

    if (!res.ok) return null;

    const body = (await res.json()) as { ledgers?: LedgerEntry[] };
    const ledgers = body.ledgers || [];
    if (ledgers.length === 0) return null;

    // Match by app name in ledger name (OIDC bridge names ledgers after hostname)
    const match = ledgers.find((l) => l.name.includes(appName));
    return match ? match.ledgerId : ledgers[0].ledgerId;
  } catch {
    return null;
  }
}
```

**Step 4: Run tests**

Run: `cd deploy-api && npx vitest run src/__tests__/ledger-discovery.test.ts`

Expected: ALL PASS.

**Step 5: Wire into join callback**

In `deploy-api/src/index.ts`, add the import at the top (after the `pkce` import, around line 26):

```typescript
import { discoverLedgerId } from "./ledger-discovery";
```

Then modify the Connect invite block (lines 1063-1088). Replace:

```typescript
    // 2. Create Connect invite via dashboard API (service auth)
    if (record.connect?.apiUrl && c.env.SERVICE_API_KEY) {
      steps.push(`connect invite to ${record.connect.apiUrl}`);
      const serviceToken = `${c.env.SERVICE_API_KEY}|${record.owner}|`;
      const inviteRes = await fetch(record.connect.apiUrl, {
```

With:

```typescript
    // 2. Create Connect invite via dashboard API (service auth)
    if (record.connect?.apiUrl && c.env.SERVICE_API_KEY) {
      const serviceToken = `${c.env.SERVICE_API_KEY}|${record.owner}|`;

      // Discover ledgerId lazily (created on first app sync, not at deploy time)
      let ledgerId = record.connect.ledgerId;
      if (!ledgerId) {
        steps.push("discovering ledger");
        ledgerId = await discoverLedgerId({
          apiUrl: record.connect.apiUrl,
          serviceToken,
          appName: state.app,
        }) ?? undefined;
        if (ledgerId) {
          // Cache for future joins
          await setSubdomain(c.env.REGISTRY_KV, state.app, {
            ...record,
            connect: { ...record.connect, ledgerId },
            updatedAt: new Date().toISOString(),
          });
          steps.push(`ledger discovered: ${ledgerId}`);
        }
      }

      if (!ledgerId) {
        steps.push("no ledger found — skipping connect invite");
      } else {
        steps.push(`connect invite to ${record.connect.apiUrl}`);
        const inviteRes = await fetch(record.connect.apiUrl, {
```

And close the new `if/else` block after the existing `steps.push(\`connect invite ${inviteRes.status}\`)` line:

```typescript
        steps.push(`connect invite ${inviteRes.status}`);
      }
```

**Step 6: Run all deploy-api tests**

Run: `cd deploy-api && npx vitest run`

Expected: ALL PASS.

**Step 7: Commit**

```bash
git add deploy-api/src/ledger-discovery.ts deploy-api/src/__tests__/ledger-discovery.test.ts deploy-api/src/index.ts
git commit -m "feat: lazy ledger discovery for join callback Connect invites

Ledgers are created on first app sync, not at deploy time, so
ledgerId is never available in the KV record. The join callback
now queries listLedgersByUser via service auth to discover it,
then caches it on the record for future joins."
```

---

## Task 4: Harden error page and remove debug endpoint

**Problem:** The join callback exposes internal `steps[]` diagnostics to users in the error page (line 1128). The `/debug/pocket-id` endpoint (lines 1132-1145) should not ship in production.

**Files:**
- Modify: `deploy-api/src/index.ts`

**Step 1: Replace user-facing error with generic message**

At line 1128, change:

```typescript
    return c.html(`<h1>Join failed</h1><pre>Steps: ${steps.join(" → ")}\nError: ${errMsg}</pre>`, 500);
```

To:

```typescript
    return c.html(`<h1>Join failed</h1><p>Something went wrong. Please try the invite link again, or contact the app owner.</p>`, 500);
```

The `console.error` on line 1127 already logs the steps and error server-side — that stays.

**Step 2: Remove the debug endpoint**

Delete lines 1132-1145 (the entire `app.get("/debug/pocket-id", ...)` block).

**Step 3: Run tests**

Run: `cd deploy-api && npx vitest run`

Expected: ALL PASS.

**Step 4: Commit**

```bash
git add deploy-api/src/index.ts
git commit -m "fix: hide internal diagnostics from join error page

Replace steps/error pre block with generic message. Server-side
console.error still has full diagnostics. Remove /debug/pocket-id."
```

---

## Task 5: Document and set `SERVICE_API_KEY`

**Files:**
- Modify: `deploy-api/wrangler.toml`

**Step 1: Add `SERVICE_API_KEY` to the secrets comment**

In `wrangler.toml`, after line 15 (`R2_SECRET_ACCESS_KEY`), add:

```
# SERVICE_API_KEY - shared key for machine-to-machine auth with Connect dashboard (for public link join flow)
```

**Step 2: Commit**

```bash
git add deploy-api/wrangler.toml
git commit -m "docs: add SERVICE_API_KEY to wrangler.toml secrets list"
```

**Step 3: Set the secret (operational — requires manual execution)**

Generate a random key and set it on the Deploy API Worker:

```bash
cd deploy-api
# Generate a random 32-byte key
SERVICE_KEY=$(openssl rand -base64 32)
echo "Generated key: $SERVICE_KEY"
echo "Save this — you'll need it if you re-provision Connect Workers."
echo "$SERVICE_KEY" | npx wrangler secret put SERVICE_API_KEY
```

**Note:** Existing Connect dashboard Workers won't have this binding until they're re-provisioned. New deploys (or re-deploys that trigger `provisionConnect`) will pick it up via Task 2. For existing apps, you'd need to re-deploy them.

---

## Task 6: Add `?joined=true` welcome message

**Problem:** OTA (one-time-access-token) returns 500 from Pocket ID, so users who join via public link face a generic auth gate. A `?joined=true` param can show a friendlier message.

**Files:**
- Modify: `source-templates/base/template.html` (AuthPopUp section)

**Step 1: Read the auth gate code**

Read the AuthPopUp / sign-in section of `source-templates/base/template.html`. Find where the auth gate renders its message or heading.

**Step 2: Add joined detection**

In the AuthPopUp component (or wherever the sign-in prompt renders), add URL param detection:

```javascript
var urlParams = new URLSearchParams(window.location.search);
var isJoined = urlParams.get('joined') === 'true';
```

If `isJoined`, show: "Welcome! You've been invited to collaborate. Sign in to get started." instead of the generic auth prompt.

**Step 3: Update join callback redirect**

In `deploy-api/src/index.ts`, the OTA catch block (lines 1118-1122) redirects without OTA. Change line 1120's fallback:

```typescript
      // OTA is optional — user can sign in manually on the app
      console.warn(`[join] OTA failed for ${userId}, redirecting without it:`, otaErr);
      steps.push("OTA failed (non-fatal)");
      redirectUrl = `${appUrl}?joined=true`;
```

Wait — this is already the fallback path (line 1108 sets `redirectUrl = appUrl` and the OTA catch doesn't modify it). Add `?joined=true` to the fallback:

At line 1108, change:

```typescript
    let redirectUrl = appUrl;
```

To:

```typescript
    let redirectUrl = `${appUrl}?joined=true`;
```

This way the app always knows this is a join redirect. If OTA succeeds, the user gets auto-signed-in AND sees the welcome message. If it fails, they at least see a friendly prompt.

**Step 4: Rebuild templates**

```bash
bun scripts/merge-templates.js --force
```

**Step 5: Run deploy-api tests**

Run: `cd deploy-api && npx vitest run`

Expected: ALL PASS.

**Step 6: Commit**

```bash
git add source-templates/base/template.html deploy-api/src/index.ts
bun scripts/merge-templates.js --force
git add skills/*/templates/
git commit -m "feat: friendly welcome message for joined users

Join redirect now includes ?joined=true. The auth gate detects
this and shows a welcoming message instead of the generic prompt.
Works regardless of whether OTA succeeds."
```

---

## Task 7: Investigate OTA 500 (research — no code change expected)

**Problem:** `POST /api/users/{userId}/one-time-access-token` returns 500 from Pocket ID.

**Step 1: Check Pocket ID version**

```bash
# Via the service binding — check if the endpoint exists
curl -s https://vibesos.com/api/users/test/one-time-access-token \
  -X POST \
  -H "X-API-Key: $(grep POCKET_ID_API_KEY ~/.vibes/.env 2>/dev/null || echo 'check-wrangler')" \
  -w "\n%{http_code}"
```

**Step 2: Check Pocket ID docs/source**

The OTA endpoint may not be implemented in the deployed Pocket ID version. Check:
- Pocket ID release notes for OTA support
- The `pocket-id` Worker's routes

**Step 3: Document findings**

If OTA is not supported, note it in the remaining-work doc and close the item — Task 6's `?joined=true` fallback covers the UX gap.

---

## Dependency Graph

```
Task 1 (fix type)  ──┐
                     ├── Task 3 (lazy ledger) ── Task 4 (harden) ── Task 5 (secret)
Task 2 (binding)  ──┘
                                                 Task 6 (?joined=true) — independent
                                                 Task 7 (OTA research) — independent
```

**Parallelizable:** Tasks 1+2 can run in parallel. Tasks 6+7 are independent of everything else.

**Must be sequential:** Task 3 depends on Tasks 1+2. Task 4 modifies the same file as Task 3. Task 5 is operational and depends on Task 2 being deployed.

---

## Verification Checklist

After all tasks:

1. `cd deploy-api && npx vitest run` — all tests pass
2. `cd scripts && npm test` — all tests pass (template changes)
3. Deploy the Deploy API Worker: `cd deploy-api && npx wrangler deploy`
4. Set `SERVICE_API_KEY` secret (Task 5)
5. Deploy a test app: `bun scripts/deploy-cloudflare.js --name public-link-test --file index.html`
6. Generate a public link via VibesPanel
7. Open link in incognito → Pocket ID auth → redirect to app with `?joined=true`
8. Verify data sync: create a document on owner's side, confirm it appears on joined user's side
