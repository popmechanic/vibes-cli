# Workers for Platforms Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use `cloudflare:wrangler` and `cloudflare:cloudflare` skills for Cloudflare documentation when needed.

**Goal:** Migrate all app and dashboard workers from per-worker custom domains (limited to 100) to Workers for Platforms dispatch namespaces with wildcard DNS routing (unlimited).

**Architecture:** Two dispatch namespaces (`vibes-apps` for static app workers, `vibes-connect` for dashboard workers). Two dispatch workers extract the subdomain from the hostname and call `env.DISPATCHER.get(name)`. Wildcard DNS + Workers Routes replace 100 individual Workers Domain entries. The Deploy API uploads to namespace endpoints instead of standalone worker endpoints.

**Tech Stack:** Cloudflare Workers, Workers for Platforms, Hono (Deploy API), wrangler CLI

**Spec:** `docs/superpowers/specs/2026-03-19-workers-for-platforms-migration-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `deploy-api/dispatch-workers/vibes-app-dispatcher/src/index.ts` | Dispatch worker for `*.vibesos.com` — extracts subdomain, routes to app worker in namespace |
| `deploy-api/dispatch-workers/vibes-app-dispatcher/wrangler.toml` | Wrangler config with dispatch_namespaces binding to `vibes-apps` |
| `deploy-api/dispatch-workers/vibes-connect-dispatcher/src/index.ts` | Dispatch worker for `connect-*.vibesos.com` — extracts app name, routes to dashboard worker |
| `deploy-api/dispatch-workers/vibes-connect-dispatcher/wrangler.toml` | Wrangler config with dispatch_namespaces binding to `vibes-connect` |
| `deploy-api/scripts/migrate-to-namespaces.ts` | One-time migration script: uploads existing workers to namespaces, verifies, cleans up domains |

### Modified Files

| File | Changes |
|------|---------|
| `deploy-api/src/index.ts` | `deployCFWorker()` targets namespace; delete `assignCustomDomain()`; remove workers.dev subdomain enabling; unconditional vibesos.com URL; remove admin migrate-dashboard-domains endpoint |
| `deploy-api/src/connect.ts` | `uploadWorker()` gets namespace param; remove dashboard custom domain + workers.dev; `deleteWorker()` namespace-aware; `resetConnect()` uses namespace delete |

---

## Task 1: Create Dispatch Namespaces

Create the two dispatch namespaces via wrangler CLI. This is a one-time setup step.

**Files:** None (CLI commands only)

- [ ] **Step 1: Create the `vibes-apps` namespace**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/deploy-api
wrangler dispatch-namespace create vibes-apps
```

Expected: Namespace created successfully.

- [ ] **Step 2: Create the `vibes-connect` namespace**

```bash
wrangler dispatch-namespace create vibes-connect
```

Expected: Namespace created successfully.

- [ ] **Step 3: Verify both namespaces exist**

```bash
wrangler dispatch-namespace list
```

Expected: Both `vibes-apps` and `vibes-connect` appear in the list.

---

## Task 2: Create and Deploy App Dispatcher Worker

**Files:**
- Create: `deploy-api/dispatch-workers/vibes-app-dispatcher/src/index.ts`
- Create: `deploy-api/dispatch-workers/vibes-app-dispatcher/wrangler.toml`

- [ ] **Step 1: Create the wrangler config**

Create `deploy-api/dispatch-workers/vibes-app-dispatcher/wrangler.toml`:

```toml
name = "vibes-app-dispatcher"
main = "src/index.ts"
compatibility_date = "2025-01-01"
account_id = "e33948793047032de7f5e18ec342a7d1"

[[dispatch_namespaces]]
binding = "DISPATCHER"
namespace = "vibes-apps"
```

- [ ] **Step 2: Create the dispatch worker**

Create `deploy-api/dispatch-workers/vibes-app-dispatcher/src/index.ts`:

```typescript
interface Env {
  DISPATCHER: {
    get(name: string): { fetch(request: Request): Promise<Response> };
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const hostname = new URL(request.url).hostname;
    const name = hostname.split('.')[0];

    // Safety: don't dispatch empty or obviously wrong names
    if (!name || name === 'vibesos' || name === 'www') {
      return new Response('Not found', { status: 404 });
    }

    try {
      const worker = env.DISPATCHER.get(name);
      return await worker.fetch(request);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('Worker not found')) {
        return new Response('App not found', { status: 404 });
      }
      console.error(`[app-dispatcher] Error dispatching ${name}:`, msg);
      return new Response('Internal error', { status: 500 });
    }
  },
};
```

- [ ] **Step 3: Deploy the dispatcher**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/deploy-api/dispatch-workers/vibes-app-dispatcher
wrangler deploy
```

Expected: Successfully deployed `vibes-app-dispatcher`.

- [ ] **Step 4: Commit**

```bash
git add deploy-api/dispatch-workers/vibes-app-dispatcher/
git commit -m "feat: add vibes-app-dispatcher worker for Workers for Platforms routing"
```

---

## Task 3: Create and Deploy Connect Dispatcher Worker

**Files:**
- Create: `deploy-api/dispatch-workers/vibes-connect-dispatcher/src/index.ts`
- Create: `deploy-api/dispatch-workers/vibes-connect-dispatcher/wrangler.toml`

- [ ] **Step 1: Create the wrangler config**

Create `deploy-api/dispatch-workers/vibes-connect-dispatcher/wrangler.toml`:

```toml
name = "vibes-connect-dispatcher"
main = "src/index.ts"
compatibility_date = "2025-01-01"
account_id = "e33948793047032de7f5e18ec342a7d1"

[[dispatch_namespaces]]
binding = "DISPATCHER"
namespace = "vibes-connect"
```

- [ ] **Step 2: Create the dispatch worker**

Create `deploy-api/dispatch-workers/vibes-connect-dispatcher/src/index.ts`:

```typescript
interface Env {
  DISPATCHER: {
    get(name: string): { fetch(request: Request): Promise<Response> };
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const hostname = new URL(request.url).hostname;
    // connect-{appname}.vibesos.com → fireproof-dashboard-{appname}
    const subdomain = hostname.split('.')[0];
    const appName = subdomain.replace(/^connect-/, '');
    const workerName = `fireproof-dashboard-${appName}`;

    try {
      const worker = env.DISPATCHER.get(workerName);
      return await worker.fetch(request);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('Worker not found')) {
        return new Response('Not found', { status: 404 });
      }
      console.error(`[connect-dispatcher] Error dispatching ${workerName}:`, msg);
      return new Response('Internal error', { status: 500 });
    }
  },
};
```

- [ ] **Step 3: Deploy the dispatcher**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/deploy-api/dispatch-workers/vibes-connect-dispatcher
wrangler deploy
```

- [ ] **Step 4: Commit**

```bash
git add deploy-api/dispatch-workers/vibes-connect-dispatcher/
git commit -m "feat: add vibes-connect-dispatcher worker for Connect dashboard routing"
```

---

## Task 4: Set Up DNS and Workers Routes

This is done via the Cloudflare dashboard or API. The dispatch workers need routes to receive traffic.

**Files:** None (DNS/routing config)

- [ ] **Step 1: Add wildcard DNS record**

In the Cloudflare dashboard for vibesos.com zone, or via API:

```bash
# Add wildcard AAAA record (proxied) — catches all subdomains
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/dns_records" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"type":"AAAA","name":"*","content":"100::","proxied":true,"ttl":1}'
```

- [ ] **Step 2: Add Workers Route for connect dispatcher**

The `connect-*` route must be more specific than `*` so it takes priority:

```bash
# connect-*.vibesos.com/* → vibes-connect-dispatcher
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/workers/routes" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"pattern":"connect-*.vibesos.com/*","script":"vibes-connect-dispatcher"}'
```

- [ ] **Step 3: Add Workers Route for app dispatcher**

```bash
# *.vibesos.com/* → vibes-app-dispatcher (catch-all for non-connect subdomains)
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/workers/routes" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"pattern":"*.vibesos.com/*","script":"vibes-app-dispatcher"}'
```

- [ ] **Step 4: Verify exception routes exist**

Check that these have existing Workers Domains or Routes (they should already exist — if not, add them so they take priority over the wildcard):
- `vibesos.com` → `pocket-id`
- `share.vibesos.com` → `vibes-deploy-api`
- `install.vibesos.com` → `install-vibesos`
- `ai.vibesos.com` → `vibes-ai-proxy`

```bash
curl -s "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/workers/routes" \
  -H "Authorization: Bearer <TOKEN>" | python3 -m json.tool
```

---

## Task 5: Smoke Test — Deploy a Test App to Namespace

Before migrating anything, verify the full dispatch chain works end-to-end.

- [ ] **Step 1: Upload a test worker directly to the vibes-apps namespace**

```bash
# Create a minimal test worker
cat > /tmp/test-worker.js << 'EOF'
export default {
  async fetch(request) {
    return new Response('Hello from dispatch namespace!', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};
EOF

# Upload it to the vibes-apps namespace
ACCOUNT_ID="e33948793047032de7f5e18ec342a7d1"
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/dispatch/namespaces/vibes-apps/scripts/dispatch-test" \
  -H "Authorization: Bearer $(cat ~/.wrangler/config/default.toml | grep oauth_token | head -1 | sed 's/.*= *"//;s/".*//')" \
  -F 'metadata={"main_module":"worker.js"};type=application/json' \
  -F 'worker.js=@/tmp/test-worker.js;type=application/javascript+module'
```

- [ ] **Step 2: Verify it's reachable through the dispatcher**

```bash
curl -s https://dispatch-test.vibesos.com/
```

Expected: `Hello from dispatch namespace!`

- [ ] **Step 3: Clean up the test worker**

```bash
curl -X DELETE "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/dispatch/namespaces/vibes-apps/scripts/dispatch-test" \
  -H "Authorization: Bearer <TOKEN>"
```

- [ ] **Step 4: Also test buddy (the app that prompted this migration)**

Deploy buddy to the namespace to unblock it immediately:

```bash
# Fetch buddy's existing worker script
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/buddy" \
  -H "Authorization: Bearer <TOKEN>" \
  -X GET > /tmp/buddy-worker.js

# Upload to namespace
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/dispatch/namespaces/vibes-apps/scripts/buddy" \
  -H "Authorization: Bearer <TOKEN>" \
  -F 'metadata={"main_module":"index.js","compatibility_date":"2025-01-01"};type=application/json' \
  -F 'index.js=@/tmp/buddy-worker.js;type=application/javascript+module'
```

Then verify: `curl -s https://buddy.vibesos.com/ | head -c 100`

- [ ] **Step 5: Test service binding support in namespace (GATE for dashboard migration)**

Upload a test dashboard worker with a service binding to the `vibes-connect` namespace to verify CF supports this:

```bash
# Create a test worker that uses a service binding
cat > /tmp/test-dashboard.js << 'EOF'
export default {
  async fetch(request, env) {
    // Just verify the binding exists
    const hasOidc = !!env.OIDC_SERVICE;
    return new Response(JSON.stringify({ ok: true, hasOidc }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
EOF

# Upload with a service binding in metadata
ACCOUNT_ID="e33948793047032de7f5e18ec342a7d1"
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/dispatch/namespaces/vibes-connect/scripts/service-binding-test" \
  -H "Authorization: Bearer <TOKEN>" \
  -F 'metadata={"main_module":"worker.js","bindings":[{"type":"service","name":"OIDC_SERVICE","service":"pocket-id"}]};type=application/json' \
  -F 'worker.js=@/tmp/test-dashboard.js;type=application/javascript+module'
```

If the upload succeeds, verify the binding works at runtime:
```bash
curl -s https://connect-service-binding-test.vibesos.com/
```
Expected: `{"ok":true,"hasOidc":true}`

**If this fails** (upload rejected or binding is null at runtime): service bindings aren't supported in namespaces. In that case, **STOP** and implement the dispatcher-proxy fallback before proceeding:
- Add a service binding `POCKET_ID` to `vibes-connect-dispatcher/wrangler.toml`
- The connect dispatcher calls Pocket ID on behalf of dashboard workers and passes auth context via request headers
- Dashboard workers read auth from headers instead of calling `env.OIDC_SERVICE` directly
- This requires modifying the dashboard worker code (the pre-built bundle in `deploy-api/bundles/dashboard.txt`)

Clean up:
```bash
curl -X DELETE "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/dispatch/namespaces/vibes-connect/scripts/service-binding-test" \
  -H "Authorization: Bearer <TOKEN>"
```

---

## Task 6: Update Deploy API — deployCFWorker() to Use Namespace

**Files:**
- Modify: `deploy-api/src/index.ts`

- [ ] **Step 1: Add namespace constants**

Near the top of `deploy-api/src/index.ts` (after the imports), add:

```typescript
// Workers for Platforms namespace names
const APP_NAMESPACE = 'vibes-apps';
const CONNECT_NAMESPACE = 'vibes-connect';
```

- [ ] **Step 2: Update deployCFWorker() upload URL**

In `deployCFWorker()` (line ~364), change the upload URL from:

```typescript
const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${appName}`;
```

to:

```typescript
const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/dispatch/namespaces/${APP_NAMESPACE}/scripts/${appName}`;
```

- [ ] **Step 3: Remove workers.dev subdomain enabling from deployCFWorker()**

Delete lines ~377-391 (the `enableWorkerSubdomain` block) and lines ~393-397 (the `getWorkersSubdomain` URL construction). Replace the return with:

```typescript
  return { ok: true, url: `https://${appName}.vibesos.com` };
```

- [ ] **Step 4: Delete assignCustomDomain() function**

Delete the entire `assignCustomDomain()` function (lines ~239-276). It is no longer called from anywhere.

- [ ] **Step 5: Remove custom domain assignment from /deploy route**

In the `/deploy` route handler, delete lines ~699-713 (the `assignCustomDomain` call block) and replace the canonical URL logic (lines ~715-718) with:

```typescript
  const deployedUrl = `https://${name}.vibesos.com`;
```

- [ ] **Step 6: Remove /admin/migrate-dashboard-domains endpoint**

Delete the entire `app.post("/admin/migrate-dashboard-domains", ...)` handler (line ~864). This endpoint assigns Workers Domains and is incompatible with namespace routing.

- [ ] **Step 7: Replace all remaining CF_ZONE_ID URL conditionals**

Search `index.ts` for all remaining `CF_ZONE_ID` conditionals that construct URLs. There are at least three more besides the `/deploy` route:

1. **OIDC callback registration** (~line 606): The `deployUrl` used for Pocket ID client registration. Replace the `CF_ZONE_ID` conditional with unconditional `https://${name}.vibesos.com`.

2. **`/invite` handler** (~line 1025): The `appUrl` construction. Replace with unconditional `https://${appName}.vibesos.com`.

3. **`/join` handler** (~line 1413): The `appUrl` construction. Replace with unconditional `https://${state.app}.vibesos.com`.

Search for all occurrences: `grep -n 'CF_ZONE_ID' deploy-api/src/index.ts` and update each one. After this step, `CF_ZONE_ID` should only appear in the comments/secrets documentation block, not in any runtime code in index.ts.

- [ ] **Step 8: Clean up unused imports/helpers**

If `getWorkersSubdomain()` and `cachedWorkersSubdomain` are no longer used anywhere in index.ts, delete them. Check with grep first — they may still be used in connect.ts via import.

- [ ] **Step 9: Commit**

```bash
git add deploy-api/src/index.ts
git commit -m "feat: deployCFWorker uses Workers for Platforms namespace, remove custom domains"
```

---

## Task 7: Update connect.ts — Dashboard Uploads to Namespace

**Files:**
- Modify: `deploy-api/src/connect.ts`

- [ ] **Step 1: Add namespace constant**

Near the top of `connect.ts`, add:

```typescript
const CONNECT_NAMESPACE = 'vibes-connect';
```

- [ ] **Step 2: Add namespace parameter to uploadWorker()**

Change the `uploadWorker` function signature (line ~326) to accept an optional namespace:

```typescript
async function uploadWorker(
  accountId: string,
  apiToken: string,
  scriptName: string,
  scriptContent: string,
  metadata: Record<string, unknown>,
  namespace?: string,
): Promise<void> {
```

And change the URL construction (line ~346) to:

```typescript
  const basePath = namespace
    ? `${CF_API}/accounts/${accountId}/workers/dispatch/namespaces/${namespace}/scripts/${scriptName}`
    : `${CF_API}/accounts/${accountId}/workers/scripts/${scriptName}`;

  const res = await fetch(basePath, {
```

- [ ] **Step 3: Update dashboard worker upload to use namespace**

In `provisionConnect()`, change the dashboard `uploadWorker()` call (line ~537) to pass the namespace:

```typescript
await uploadWorker(accountId, apiToken, dashboardName, dashboardBundle, {
  // ... same metadata/bindings ...
}, CONNECT_NAMESPACE);
```

- [ ] **Step 4: Remove dashboard workers.dev subdomain enabling**

Delete the `await enableWorkerSubdomain(accountId, apiToken, dashboardName);` call after the dashboard upload (line ~565).

- [ ] **Step 5: Remove dashboard custom domain assignment**

Delete the entire block that assigns `connect-{stage}.vibesos.com` custom domain (lines ~567-590). Replace the `dashboardUrl` construction (lines ~592-599) with:

```typescript
const cloudBackendUrl = `https://${cloudBackendName}.${workersSubdomain}.workers.dev`;
const dashboardUrl = `https://connect-${stage}.vibesos.com`;
```

Note: `getWorkersSubdomain` is still needed for the cloud-backend URL. The dashboard URL is now unconditionally the `connect-*.vibesos.com` hostname (routed by the dispatcher).

- [ ] **Step 6: Make deleteWorker() namespace-aware**

Update `deleteWorker()` (line ~402) to accept an optional namespace:

```typescript
async function deleteWorker(
  accountId: string,
  apiToken: string,
  scriptName: string,
  namespace?: string,
): Promise<boolean> {
  const path = namespace
    ? `/accounts/${accountId}/workers/dispatch/namespaces/${namespace}/scripts/${scriptName}`
    : `/accounts/${accountId}/workers/scripts/${scriptName}`;
  const res = await cfApi(path, apiToken, { method: 'DELETE' });
  return res.success || res.errors?.[0]?.code === 10007;
}
```

- [ ] **Step 7: Update resetConnect() to use namespace delete for dashboard worker**

In `resetConnect()` (line ~425), the loop deletes both `cloudBackendName` and `dashboardName`. The dashboard worker is now in the namespace, but the cloud-backend is still standalone. Change the loop to handle them separately:

```typescript
// Delete cloud-backend (standalone worker)
try {
  const ok = await deleteWorker(accountId, apiToken, cloudBackendName);
  if (ok) deleted.push(cloudBackendName);
  else errors.push(`${cloudBackendName}: delete returned false`);
} catch (e) {
  errors.push(`${cloudBackendName}: ${e instanceof Error ? e.message : String(e)}`);
}

// Delete dashboard (namespace worker)
try {
  const ok = await deleteWorker(accountId, apiToken, dashboardName, CONNECT_NAMESPACE);
  if (ok) deleted.push(dashboardName);
  else errors.push(`${dashboardName}: delete returned false`);
} catch (e) {
  errors.push(`${dashboardName}: ${e instanceof Error ? e.message : String(e)}`);
}
```

- [ ] **Step 8: Remove zoneId from ProvisionParams and call site**

In `connect.ts`, remove `zoneId?: string` from the `ProvisionParams` interface (~line 26). Remove any usage of `params.zoneId` inside `provisionConnect()` (it was only used for the dashboard custom domain assignment, which was removed in Step 5).

In `index.ts`, remove `zoneId: c.env.CF_ZONE_ID` from the `provisionConnect()` call site (~line 652).

- [ ] **Step 9: Commit**

```bash
git add deploy-api/src/connect.ts deploy-api/src/index.ts
git commit -m "feat: connect.ts uploads dashboard to namespace, namespace-aware delete"
```

---

## Task 8: Deploy Updated Deploy API

**Files:** None (deploy command)

- [ ] **Step 1: Deploy the updated Deploy API Worker**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/deploy-api
wrangler deploy
```

- [ ] **Step 2: Verify new deploys go to namespace**

Deploy a fresh test app through the normal flow:

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill
bun scripts/deploy-cloudflare.js --name namespace-deploy-test --file /tmp/test-index.html
```

Then verify: `curl -s https://namespace-deploy-test.vibesos.com/ | head -c 100`

- [ ] **Step 3: Commit (push)**

```bash
git push
```

---

## Task 9: Migration Script — Migrate Existing Workers

**Files:**
- Create: `deploy-api/scripts/migrate-to-namespaces.ts`

This is a one-time script. It runs locally with your wrangler credentials.

- [ ] **Step 1: Create the migration script**

Create `deploy-api/scripts/migrate-to-namespaces.ts`:

```typescript
/**
 * One-time migration: move existing app workers and dashboard workers
 * from standalone CF Workers to dispatch namespaces.
 *
 * Usage: bun deploy-api/scripts/migrate-to-namespaces.ts [--phase 2|3|4] [--dry-run]
 *
 * Phase 2: Migrate app workers to vibes-apps namespace
 * Phase 3: Migrate dashboard workers to vibes-connect namespace
 * Phase 4: Delete orphaned Workers Domain entries
 *
 * Run without --phase to execute all phases sequentially.
 */

const ACCOUNT_ID = 'e33948793047032de7f5e18ec342a7d1';
const APP_NAMESPACE = 'vibes-apps';
const CONNECT_NAMESPACE = 'vibes-connect';

// Read wrangler OAuth token
function getToken(): string {
  const configPath = `${process.env.HOME}/.wrangler/config/default.toml`;
  const content = require('fs').readFileSync(configPath, 'utf-8');
  const match = content.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('No oauth_token found in wrangler config');
  return match[1];
}

const TOKEN = getToken();
const headers = { Authorization: `Bearer ${TOKEN}` };
const dryRun = process.argv.includes('--dry-run');

async function cfApi(path: string, opts?: RequestInit) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...opts,
    headers: { ...headers, ...(opts?.headers || {}) },
  });
  return res;
}

// Phase 2: Migrate app workers
async function migrateAppWorkers() {
  console.log('\n=== Phase 2: Migrate App Workers ===\n');

  // List all Workers Domains for vibesos.com (app workers only, not connect-*)
  const domainsRes = await cfApi(`/accounts/${ACCOUNT_ID}/workers/domains`);
  const domainsData = await domainsRes.json() as any;
  const appDomains = (domainsData.result || []).filter((d: any) =>
    d.hostname.endsWith('.vibesos.com') &&
    !d.hostname.startsWith('connect-') &&
    !['vibesos.com', 'share.vibesos.com', 'install.vibesos.com', 'ai.vibesos.com'].includes(d.hostname)
  );

  console.log(`Found ${appDomains.length} app workers to migrate`);

  let migrated = 0, skipped = 0, failed = 0;

  for (const domain of appDomains) {
    const name = domain.service; // Worker name = service name
    const hostname = domain.hostname;
    console.log(`\n[${name}] Migrating...`);

    try {
      // 1. Fetch existing worker script
      const scriptRes = await cfApi(`/accounts/${ACCOUNT_ID}/workers/scripts/${name}`, {
        headers: { ...headers, Accept: 'application/javascript' },
      });
      if (!scriptRes.ok) {
        console.log(`  SKIP: Worker script not found (${scriptRes.status})`);
        skipped++;
        continue;
      }
      const scriptContent = await scriptRes.text();

      if (dryRun) {
        console.log(`  DRY RUN: Would upload ${scriptContent.length} bytes to namespace`);
        migrated++;
        continue;
      }

      // 2. Upload to namespace
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({
        main_module: 'index.js',
        compatibility_date: '2025-01-01',
      })], { type: 'application/json' }));
      form.append('index.js', new Blob([scriptContent], {
        type: 'application/javascript+module',
      }), 'index.js');

      const uploadRes = await cfApi(
        `/accounts/${ACCOUNT_ID}/workers/dispatch/namespaces/${APP_NAMESPACE}/scripts/${name}`,
        { method: 'PUT', body: form }
      );
      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        console.error(`  FAIL: Upload failed (${uploadRes.status}): ${err}`);
        failed++;
        continue;
      }

      // 3. Verify via dispatcher
      const verifyRes = await fetch(`https://${hostname}/`, { redirect: 'manual' });
      if (verifyRes.status !== 200 && verifyRes.status !== 301 && verifyRes.status !== 302) {
        console.warn(`  WARN: Verification returned ${verifyRes.status} (may need DNS propagation)`);
      }

      // 4. Delete Workers Domain entry
      const domainId = domain.id;
      await cfApi(`/accounts/${ACCOUNT_ID}/workers/domains/${domainId}`, {
        method: 'DELETE',
      });

      console.log(`  OK: Migrated and domain entry removed`);
      migrated++;
    } catch (e) {
      console.error(`  FAIL: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  console.log(`\nPhase 2 complete: ${migrated} migrated, ${skipped} skipped, ${failed} failed`);
}

// Phase 3: Migrate dashboard workers
// Strategy: Dashboard workers have secret bindings that can't be fetched from
// the CF API (secrets are write-only). Instead of copying scripts directly,
// we trigger a redeploy of each app through the Deploy API, which has all the
// secrets and will re-provision dashboard workers to the namespace via the
// updated provisionConnect() code path.
async function migrateDashboardWorkers() {
  console.log('\n=== Phase 3: Migrate Dashboard Workers ===\n');

  const domainsRes = await cfApi(`/accounts/${ACCOUNT_ID}/workers/domains`);
  const domainsData = await domainsRes.json() as any;
  const connectDomains = (domainsData.result || []).filter((d: any) =>
    d.hostname.startsWith('connect-') && d.hostname.endsWith('.vibesos.com')
  );

  console.log(`Found ${connectDomains.length} dashboard workers to migrate`);

  // Verify naming convention invariant
  for (const domain of connectDomains) {
    const expected = `fireproof-dashboard-${domain.hostname.split('.')[0].replace(/^connect-/, '')}`;
    if (domain.service !== expected) {
      console.error(`INVARIANT VIOLATION: ${domain.hostname} → ${domain.service} (expected ${expected})`);
      console.error('Fix this before proceeding. Aborting Phase 3.');
      return;
    }
  }

  // For each app, trigger a redeploy through the Deploy API.
  // The updated Deploy API (Task 8) will re-provision the dashboard worker
  // to the vibes-connect namespace with all secret bindings intact.
  // We need a valid OIDC token for the app owner — use the migration user's token.
  const authToken = await getOidcToken();
  let migrated = 0, skipped = 0, failed = 0;

  for (const domain of connectDomains) {
    const appName = domain.hostname.split('.')[0].replace(/^connect-/, '');
    console.log(`\n[${appName}] Triggering redeploy...`);

    try {
      // Read the app's existing app.jsx / index.html from the app worker
      // We fetch the assembled HTML from the existing app worker
      const appRes = await fetch(`https://${appName}.vibesos.com/`, { redirect: 'manual' });
      if (!appRes.ok && appRes.status !== 301 && appRes.status !== 302) {
        console.log(`  SKIP: App not reachable (${appRes.status})`);
        skipped++;
        continue;
      }
      const html = await appRes.text();

      if (dryRun) {
        console.log(`  DRY RUN: Would redeploy ${appName} (${html.length} bytes)`);
        migrated++;
        continue;
      }

      // Call the Deploy API to redeploy — this re-provisions the dashboard
      // worker to the namespace with full secret bindings
      const deployRes = await fetch('https://share.vibesos.com/deploy', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: appName,
          files: { 'index.html': html },
        }),
      });
      const deployData = await deployRes.json() as any;

      if (!deployData.ok) {
        console.error(`  FAIL: Deploy API returned error: ${deployData.error}`);
        failed++;
        continue;
      }

      // Delete the Workers Domain entry for the dashboard
      await cfApi(`/accounts/${ACCOUNT_ID}/workers/domains/${domain.id}`, {
        method: 'DELETE',
      });

      console.log(`  OK: Redeployed and dashboard domain entry removed`);
      migrated++;
    } catch (e) {
      console.error(`  FAIL: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  console.log(`\nPhase 3 complete: ${migrated} migrated, ${skipped} skipped, ${failed} failed`);
}

async function getOidcToken(): Promise<string> {
  // Use the CLI auth module to get a valid token
  const { getAccessToken } = await import('../../scripts/lib/cli-auth.js');
  const { OIDC_AUTHORITY, OIDC_CLIENT_ID } = await import('../../scripts/lib/auth-constants.js');
  const tokens = await getAccessToken({ authority: OIDC_AUTHORITY, clientId: OIDC_CLIENT_ID });
  return tokens.accessToken;
}

// Phase 4: Verify and clean up
async function cleanup() {
  console.log('\n=== Phase 4: Verify & Cleanup ===\n');

  // Check remaining Workers Domains
  const domainsRes = await cfApi(`/accounts/${ACCOUNT_ID}/workers/domains`);
  const domainsData = await domainsRes.json() as any;
  const remaining = (domainsData.result || []).filter((d: any) =>
    d.hostname.endsWith('.vibesos.com')
  );

  console.log(`Remaining Workers Domains on vibesos.com: ${remaining.length}`);
  for (const d of remaining) {
    console.log(`  ${d.hostname} → ${d.service}`);
  }

  // Expected remaining: vibesos.com, share.vibesos.com, install.vibesos.com, ai.vibesos.com
  const expectedRemaining = ['vibesos.com', 'share.vibesos.com', 'install.vibesos.com', 'ai.vibesos.com'];
  const unexpected = remaining.filter((d: any) => !expectedRemaining.includes(d.hostname));
  if (unexpected.length > 0) {
    console.log(`\nUnexpected domains still present:`);
    for (const d of unexpected) {
      console.log(`  ${d.hostname} → ${d.service}`);
    }
  } else {
    console.log(`\nAll app/connect domains migrated. Only infrastructure domains remain.`);
  }
}

// Main
const phase = process.argv.find(a => a.startsWith('--phase='))?.split('=')[1];
(async () => {
  try {
    if (!phase || phase === '2') await migrateAppWorkers();
    if (!phase || phase === '3') await migrateDashboardWorkers();
    if (!phase || phase === '4') await cleanup();
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  }
})();
```

- [ ] **Step 2: Run Phase 2 (app workers) with dry run first**

```bash
bun deploy-api/scripts/migrate-to-namespaces.ts --phase=2 --dry-run
```

Review output. Then run for real:

```bash
bun deploy-api/scripts/migrate-to-namespaces.ts --phase=2
```

- [ ] **Step 3: Run Phase 3 (dashboard workers) with dry run first**

Phase 3 triggers a redeploy of each app through the Deploy API (which re-provisions dashboard workers to the namespace with full secret bindings). This requires the updated Deploy API to be live (Task 8).

```bash
bun deploy-api/scripts/migrate-to-namespaces.ts --phase=3 --dry-run
```

Review output. Then run for real:

```bash
bun deploy-api/scripts/migrate-to-namespaces.ts --phase=3
```

Note: This will take longer than Phase 2 since each app is fully redeployed. Failed apps should be investigated individually — the Deploy API logs will show the error.

- [ ] **Step 4: Run Phase 4 (verify and cleanup)**

```bash
bun deploy-api/scripts/migrate-to-namespaces.ts --phase=4
```

Expected: Only `vibesos.com`, `share.vibesos.com`, `install.vibesos.com`, `ai.vibesos.com` remain.

- [ ] **Step 5: Commit**

```bash
git add deploy-api/scripts/migrate-to-namespaces.ts
git commit -m "feat: one-time migration script for Workers for Platforms"
```

---

## Task 10: Full Verification Sweep

- [ ] **Step 1: Verify all app workers are reachable**

```bash
# Get all app names from the Workers Domains list we captured earlier
# and verify each one returns 200 via the dispatcher
for app in machine oracle buddy rocknroll cyoa fireproof mono nex black; do
  echo -n "$app: "
  curl -s -o /dev/null -w "%{http_code}" "https://$app.vibesos.com/"
  echo
done
```

- [ ] **Step 2: Verify all connect dashboard workers are reachable**

```bash
for app in machine oracle buddy rocknroll cyoa fireproof mono nex; do
  echo -n "connect-$app: "
  curl -s -o /dev/null -w "%{http_code}" "https://connect-$app.vibesos.com/api"
  echo
done
```

- [ ] **Step 3: Verify exception routes still work**

```bash
echo -n "vibesos.com: "; curl -s -o /dev/null -w "%{http_code}" https://vibesos.com/
echo -n "share: "; curl -s -o /dev/null -w "%{http_code}" https://share.vibesos.com/
echo -n "install: "; curl -s -o /dev/null -w "%{http_code}" https://install.vibesos.com/
echo -n "ai: "; curl -s -o /dev/null -w "%{http_code}" https://ai.vibesos.com/
```

- [ ] **Step 4: Deploy a brand new app through the full pipeline**

Use the editor or CLI to deploy a new app and verify it's immediately reachable at `{name}.vibesos.com` without any custom domain assignment.

- [ ] **Step 5: Test resetConnect for an app**

Reset connect for a test app and verify the namespace delete works:

```bash
# Use the admin reset-connect endpoint
TOKEN=$(bun --input-type=module -e "
import { getAccessToken } from '$VIBES_ROOT/scripts/lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '$VIBES_ROOT/scripts/lib/auth-constants.js';
const tokens = await getAccessToken({ authority: OIDC_AUTHORITY, clientId: OIDC_CLIENT_ID });
process.stdout.write(tokens.accessToken);
")
curl -s -X POST "https://share.vibesos.com/admin/reset-connect/dispatch-test" \
  -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 6: Final commit and push**

```bash
git add -A
git commit -m "chore: Workers for Platforms migration complete"
git push
```
