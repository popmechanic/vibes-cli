# vibesos.com Custom Subdomain Routing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy Vibes apps to `{app}.vibesos.com` instead of `{app}.{account}.workers.dev` using Cloudflare Workers Custom Domains API.

**Architecture:** After deploying a worker script (existing flow), the Deploy API makes one additional CF API call to assign `{appName}.vibesos.com` as a custom domain. CF handles DNS + SSL automatically. CORS and OIDC callback URLs are updated to match the new domain.

**Tech Stack:** Cloudflare Workers API, Hono, TypeScript, Pocket ID OIDC

**Design doc:** `docs/plans/2026-03-08-vibesos-custom-subdomains-design.md`

---

### Task 1: Add `CF_ZONE_ID` to Deploy API types and wrangler config

**Files:**
- Modify: `deploy-api/src/types.ts:1-14`
- Modify: `deploy-api/wrangler.toml`

**Step 1: Add CF_ZONE_ID to Env interface**

In `deploy-api/src/types.ts`, add `CF_ZONE_ID` to the Env interface:

```typescript
export interface Env {
  // Secrets
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_ZONE_ID: string;
  POCKET_ID_API_KEY: string;
  // Vars
  OIDC_ISSUER: string;

  // Service Bindings
  POCKET_ID: Fetcher;

  // KV
  REGISTRY_KV: KVNamespace;
}
```

**Step 2: Document CF_ZONE_ID in wrangler.toml**

In `deploy-api/wrangler.toml`, add to the secrets comment:

```toml
# Secrets (set via `wrangler secret put`):
# CF_API_TOKEN - scoped to Workers deploys on our account
# CF_ACCOUNT_ID - our Cloudflare account ID
# CF_ZONE_ID - vibesos.com zone ID (for custom domain assignment)
# POCKET_ID_API_KEY - Pocket ID admin API key for per-app registration
```

**Step 3: Commit**

```bash
git add deploy-api/src/types.ts deploy-api/wrangler.toml
git commit -m "Add CF_ZONE_ID to Deploy API types and wrangler config"
```

---

### Task 2: Add custom domain assignment function to Deploy API

**Files:**
- Modify: `deploy-api/src/index.ts:213-362`

**Step 1: Add `assignCustomDomain` function**

Add this function after the `getWorkersSubdomain` function (after line 238), before `deployCFWorker`:

```typescript
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
```

**Step 2: Commit**

```bash
git add deploy-api/src/index.ts
git commit -m "Add assignCustomDomain function to Deploy API"
```

---

### Task 3: Wire custom domain assignment into deploy flow

**Files:**
- Modify: `deploy-api/src/index.ts:542-565`

**Step 1: Call assignCustomDomain after deployCFWorker and update returned URL**

Replace the deploy + response section (lines 542-565) in the `/deploy` handler. After the existing `deployCFWorker` call succeeds, assign the custom domain and use `vibesos.com` as the canonical URL:

```typescript
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
    ? { ...existing, oidcClientId, userGroupId, updatedAt: now }
    : { owner: userId, collaborators: [], connectProvisioned: false, oidcClientId, userGroupId, createdAt: now, updatedAt: now };
  await setSubdomain(c.env.REGISTRY_KV, name, record);

  // Update user mapping (append if new)
  const userKey = `user:${userId}`;
  const userRaw = await c.env.REGISTRY_KV.get(userKey);
  const userApps: string[] = userRaw ? JSON.parse(userRaw) : [];
  if (!userApps.includes(name)) {
    userApps.push(name);
    await c.env.REGISTRY_KV.put(userKey, JSON.stringify(userApps));
  }

  const response: DeployResponse = { ok: true, url: deployedUrl, name };
  return c.json(response);
```

**Step 2: Commit**

```bash
git add deploy-api/src/index.ts
git commit -m "Wire custom domain assignment into deploy flow"
```

---

### Task 4: Update per-app OIDC callback URLs and invite URL

**Files:**
- Modify: `deploy-api/src/index.ts:511-540` (OIDC registration section)
- Modify: `deploy-api/src/index.ts:646-654` (invite URL section)

**Step 1: Update OIDC registration to use vibesos.com callback URL**

In the `/deploy` handler's per-app Pocket ID registration section (around line 515-540), change the deploy URL used for callback registration:

```typescript
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
```

**Step 2: Update invite endpoint URL construction**

In the `/apps/:name/invite` handler (around line 646-654), replace the URL construction:

```typescript
    // Build the app URL
    const appUrl = c.env.CF_ZONE_ID
      ? `https://${name}.vibesos.com`
      : (() => {
          const subdomain = await getWorkersSubdomain(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN);
          return subdomain
            ? `https://${name}.${subdomain}.workers.dev`
            : `https://${name}.workers.dev`;
        })();

    const inviteUrl = `${appUrl}?ota=${encodeURIComponent(ota.token)}`;
```

**Step 3: Commit**

```bash
git add deploy-api/src/index.ts
git commit -m "Use vibesos.com URLs for OIDC callbacks and invite links"
```

---

### Task 5: Update CORS in both workers

**Files:**
- Modify: `deploy-api/src/index.ts:432-443`
- Modify: `skills/cloudflare/worker/src/index.ts:28-41`

**Step 1: Add vibesos.com to Deploy API CORS**

In `deploy-api/src/index.ts`, update the CORS origin check:

```typescript
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
```

**Step 2: Add vibesos.com to Registry Worker CORS**

In `skills/cloudflare/worker/src/index.ts`, update the CORS origin check:

```typescript
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      if (!origin) return origin; // non-browser (CLI) requests
      if (origin === "http://localhost:3333") return origin; // editor preview
      if (origin.endsWith(".workers.dev")) return origin; // deployed apps
      if (origin.endsWith(".vibes.diy")) return origin; // custom domain (legacy)
      if (origin.endsWith(".vibesos.com")) return origin; // custom domain
      const permitted = parsePermittedOrigins((c.env as Env).PERMITTED_ORIGINS);
      if (permitted.some((p) => p === origin)) return origin;
      return null; // reject unknown origins
    },
  })
);
```

**Step 3: Commit**

```bash
git add deploy-api/src/index.ts skills/cloudflare/worker/src/index.ts
git commit -m "Add vibesos.com to CORS allowlists in both workers"
```

---

### Task 6: Update Pocket ID shared OIDC client callback URLs

**Files:**
- Modify: `alchemy/src/worker.ts:89-100`

**Step 1: Add vibesos.com wildcard to shared OIDC client**

```typescript
const VIBES_OIDC_CLIENT = {
  id: "6c154be6-e6fa-47f3-ad2b-31740cedc1f1",
  name: "vibes-cli",
  callbackURLs: [
    "http://localhost/callback",
    "http://127.0.0.1/callback",
    "http://localhost:18192/callback",
    "http://127.0.0.1:18192/callback",
    "https://*.vibesos.com/**",
    "https://*.marcus-e.workers.dev/**",  // legacy — remove after migration
  ],
  isPublic: true,
};
```

**Step 2: Commit**

```bash
git add alchemy/src/worker.ts
git commit -m "Add vibesos.com wildcard to shared OIDC client callbacks"
```

---

### Task 7: Update client-side deploy script fallback URL

**Files:**
- Modify: `scripts/deploy-cloudflare.js:179`

**Step 1: Update fallback URL**

Change line 179:

```javascript
  const deployedUrl = result.url || `https://${name}.vibesos.com`;
```

**Step 2: Commit**

```bash
git add scripts/deploy-cloudflare.js
git commit -m "Update deploy fallback URL to vibesos.com"
```

---

### Task 8: Update tests

**Files:**
- Modify: `scripts/__tests__/integration/deploy-cloudflare-connect.test.js`

**Step 1: Update URL expectations in tests**

In `deploy-cloudflare-connect.test.js`, update the test at line 107 that asserts `vibes.diy`:

```javascript
      registry.setApp('my-app', {
        ...appEntry,
        app: {
          workerName: 'my-app',
          url: 'https://my-app.vibesos.com'
        }
      });

      const loaded = registry.getApp('my-app');
      expect(loaded.app.workerName).toBe('my-app');
      expect(loaded.app.url).toBe('https://my-app.vibesos.com');
```

**Step 2: Run tests**

```bash
cd scripts && npm test
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add scripts/__tests__/integration/deploy-cloudflare-connect.test.js
git commit -m "Update test URL expectations to vibesos.com"
```

---

### Task 9: Set CF_ZONE_ID secret on Deploy API Worker

**Step 1: Get vibesos.com zone ID**

```bash
# Get zone ID from Cloudflare dashboard or API
curl -s "https://api.cloudflare.com/client/v4/zones?name=vibesos.com" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[0].id'
```

**Step 2: Set the secret**

```bash
cd deploy-api && wrangler secret put CF_ZONE_ID
# Paste the zone ID when prompted
```

**Step 3: Deploy updated Deploy API Worker**

```bash
cd deploy-api && wrangler deploy
```

---

### Task 10: Deploy updated Pocket ID worker and Registry Worker

**Step 1: Deploy Pocket ID worker**

```bash
cd alchemy && wrangler deploy
```

The updated callback URLs take effect on next container start (Pocket ID re-registers the OIDC client on first request after restart).

**Step 2: Deploy Registry Worker**

```bash
cd skills/cloudflare/worker && wrangler deploy
```

**Step 3: Verify CORS works**

```bash
curl -s -I -H "Origin: https://test-app.vibesos.com" \
  https://vibes-registry.marcus-e.workers.dev/registry.json \
  | grep -i access-control
```

Expected: `access-control-allow-origin: https://test-app.vibesos.com`

---

### Task 11: End-to-end verification

**Step 1: Deploy a test app**

```bash
bun scripts/deploy-cloudflare.js --name subdomain-test --file index.html
```

Expected output: `Deployed to https://subdomain-test.vibesos.com`

**Step 2: Verify in browser**

Open `https://subdomain-test.vibesos.com` — should serve the app with valid SSL.

**Step 3: Verify OIDC login works**

Click sign-in in the app — should redirect to `vibesos.com` for Pocket ID auth and return to `subdomain-test.vibesos.com` on success.
