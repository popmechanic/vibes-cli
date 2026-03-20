# Workers for Platforms Migration

**Date**: 2026-03-19
**Problem**: Cloudflare Workers Domains has a hard limit of 100 custom domains per zone. vibesos.com is at exactly 100 (40 app workers + 60 connect dashboard workers). New app deploys fail silently — the worker deploys but the custom domain assignment is rejected, leaving the app unreachable at `{name}.vibesos.com`.

**Solution**: Migrate from per-worker custom domains to Workers for Platforms dispatch namespaces with wildcard DNS routing. This removes the 100-domain limit entirely.

## Architecture

### Two Dispatch Namespaces

| Namespace | Purpose | Contains |
|-----------|---------|----------|
| `vibes-apps` | App workers | Static file servers (~40 existing + all future) |
| `vibes-connect` | Dashboard workers | Fireproof Connect dashboard workers with D1/service bindings (~60 existing + all future) |

### Two Dispatch Workers

**`vibes-app-dispatcher`** — bound to `vibes-apps` namespace, handles `*.vibesos.com/*`:

```javascript
export default {
  async fetch(request, env) {
    const hostname = new URL(request.url).hostname;
    const name = hostname.split('.')[0];
    try {
      const worker = env.DISPATCHER.get(name);
      return await worker.fetch(request);
    } catch (e) {
      if (e.message.startsWith('Worker not found')) {
        return new Response('App not found', { status: 404 });
      }
      return new Response('Internal error', { status: 500 });
    }
  }
};
```

**`vibes-connect-dispatcher`** — bound to `vibes-connect` namespace, handles `connect-*.vibesos.com/*`:

```javascript
export default {
  async fetch(request, env) {
    const hostname = new URL(request.url).hostname;
    // connect-{appname}.vibesos.com → fireproof-dashboard-{appname}
    const appName = hostname.split('.')[0].replace(/^connect-/, '');
    const workerName = 'fireproof-dashboard-' + appName;
    try {
      const worker = env.DISPATCHER.get(workerName);
      return await worker.fetch(request);
    } catch (e) {
      if (e.message.startsWith('Worker not found')) {
        return new Response('Not found', { status: 404 });
      }
      return new Response('Internal error', { status: 500 });
    }
  }
};
```

### DNS & Routing

**Wildcard DNS record** (new):
- `* AAAA 100::` (proxied) — catches all subdomains not matched by specific records

**Workers Routes** (new):
- `*.vibesos.com/*` → `vibes-app-dispatcher`
- `connect-*.vibesos.com/*` → `vibes-connect-dispatcher`

**Existing routes/domains kept for non-app workers** (CF route precedence ensures these take priority over the wildcard):
- `vibesos.com/*` → `pocket-id`
- `share.vibesos.com/*` → `vibes-deploy-api`
- `install.vibesos.com/*` → `install-vibesos`
- `ai.vibesos.com/*` → `vibes-ai-proxy`

These four workers stay as standalone workers with Workers Domains (or migrate to Workers Routes). They are not app/dashboard workers and don't belong in a namespace.

### What Changes in the Deploy API

**`deployCFWorker()`** in `deploy-api/src/index.ts`:

Currently uploads to:
```
PUT /accounts/{id}/workers/scripts/{name}
```

Changes to:
```
PUT /accounts/{id}/workers/dispatch/namespaces/vibes-apps/scripts/{name}
```

The metadata payload (main_module, compatibility_date) stays the same. The worker script (static file server) stays the same. No bindings needed — app workers are stateless.

Remove after upload:
- `assignCustomDomain()` call for the app worker (no longer needed)
- Workers.dev subdomain enabling (namespace workers don't use it)

**`provisionConnect()` dashboard deploy** in `deploy-api/src/connect.ts`:

Currently uploads dashboard worker to:
```
PUT /accounts/{id}/workers/scripts/fireproof-dashboard-{name}
```

Changes to:
```
PUT /accounts/{id}/workers/dispatch/namespaces/vibes-connect/scripts/fireproof-dashboard-{name}
```

The metadata includes per-worker bindings (D1, service binding to Pocket ID, secrets). These are specified in the metadata object of the multipart upload — the same structure as today, just a different endpoint.

Remove after upload:
- `assignCustomDomain()` call for the dashboard worker
- Workers.dev subdomain enabling

**Cloud-backend workers stay as standalone workers.** They use Durable Objects (which may not be supported in dispatch namespaces) and are accessed via `fpcloud://` protocol URLs, not HTTP custom domains. They don't contribute to the 100-domain limit since they use workers.dev subdomains, not custom domains.

### What Stays the Same

- CLI deploy script (`scripts/deploy-cloudflare.js`) — talks to Deploy API, not CF directly
- KV registry structure — unchanged
- Connect provisioning for R2, D1, crypto key generation — unchanged
- OIDC client/group registration — unchanged
- HTML injection (OIDC client ID, Connect URLs, shared ledger) — unchanged
- Cloud-backend workers — unchanged (standalone, Durable Objects)
- App worker script content — unchanged (same static file server)
- Dashboard worker script content — unchanged (same code, same bindings)

### Connect URL Updates

Currently, Connect URLs in the KV registry and injected HTML use:
- Dashboard: `https://connect-{name}.vibesos.com/api` (custom domain)
- Cloud-backend: `fpcloud://fireproof-cloud-{name}.marcus-e.workers.dev` (workers.dev)

After migration, dashboard workers in the namespace are reached through the `vibes-connect-dispatcher` via the wildcard route on `connect-*.vibesos.com`. The URLs don't change — `https://connect-{name}.vibesos.com/api` still works, it just routes through the dispatcher instead of a Workers Domain entry.

## Migration Script

One-time script run after dispatch infrastructure is set up:

### Phase 1: Set up infrastructure
1. Create dispatch namespace `vibes-apps` via CF API
2. Create dispatch namespace `vibes-connect` via CF API
3. Deploy `vibes-app-dispatcher` worker with `dispatch_namespaces` binding
4. Deploy `vibes-connect-dispatcher` worker with `dispatch_namespaces` binding
5. Add wildcard DNS record `* AAAA 100::` (proxied)
6. Add Workers Routes: `*.vibesos.com/*` → `vibes-app-dispatcher`, `connect-*.vibesos.com/*` → `vibes-connect-dispatcher`
7. Add specific Workers Routes for exceptions (pocket-id, deploy-api, install, ai-proxy) if not already routed

### Phase 2: Migrate app workers
For each app in the KV registry (`subdomain:*` keys):
1. Fetch the existing worker script from CF API: `GET /workers/scripts/{name}`. If 404 (never deployed or failed), skip and log.
2. Upload to namespace: `PUT /dispatch/namespaces/vibes-apps/scripts/{name}` (same script, same metadata — app workers have no bindings)
3. Verify: request `https://{name}.vibesos.com` returns 200 via the dispatcher
4. Delete the Workers Domain entry for `{name}.vibesos.com`
5. Delete the standalone worker script (optional — leave for rollback)

### Phase 3: Migrate dashboard workers
Dashboard worker secrets (session tokens, crypto keys, device CA, OIDC authority, service API key) cannot be fetched from the CF API — secrets are write-only. Instead, re-provision each dashboard worker via the updated `provisionConnect()` code path (which now targets the namespace endpoint).

For each app with `connectProvisioned: true`:
1. Read the KV record to get Connect resource IDs (D1 databases, R2 bucket, crypto keys stored in KV)
2. Re-deploy the dashboard worker to the namespace using the same `deployDashboard()` flow from `connect.ts` (now targeting the namespace endpoint), passing all the stored resource IDs and secrets
3. Verify: request `https://connect-{name}.vibesos.com/api` returns via the dispatcher
4. Delete the Workers Domain entry for `connect-{name}.vibesos.com`
5. Delete the standalone worker script (optional — leave for rollback)

Note: If a KV record exists but the dashboard worker was never deployed (failed mid-provision), skip and log. The migration script must handle 404s from the CF API gracefully.

### Phase 4: Cleanup
1. Verify all apps accessible via wildcard routing
2. Delete orphaned Workers Domain entries
3. Update Deploy API code to use namespace endpoints
4. Deploy updated Deploy API

## Rollback

If the wildcard routing has issues:
- Standalone workers still exist (not deleted until verified)
- Re-add Workers Domain entries via CF API
- Remove wildcard DNS record and Workers Routes
- Revert Deploy API code

## Testing

1. **Before migration**: Deploy a test app (`migration-test`) directly to the `vibes-apps` namespace. Verify it's reachable at `migration-test.vibesos.com` through the dispatcher.
2. **During migration**: Verify each app returns 200 after namespace upload, before deleting the Workers Domain.
3. **After migration**: Full sweep — hit every `{name}.vibesos.com` and `connect-{name}.vibesos.com` URL, confirm 200 responses.
4. **Deploy pipeline**: Deploy a new app via the Deploy API, confirm it works end-to-end without custom domain assignment.

## Files Changed

- `deploy-api/src/index.ts`:
  - `deployCFWorker()` — upload to `vibes-apps` namespace instead of standalone
  - `assignCustomDomain()` — delete entirely (no longer needed for any worker)
  - Remove workers.dev subdomain enabling after app worker deploy
  - Canonical URL logic — replace `CF_ZONE_ID` conditional with unconditional `https://{name}.vibesos.com` (wildcard routing handles this now)
  - Remove `/admin/migrate-dashboard-domains` endpoint (assigns Workers Domains — incompatible post-migration)
- `deploy-api/src/connect.ts`:
  - Dashboard worker upload — target `vibes-connect` namespace instead of standalone
  - Remove `assignCustomDomain()` call for dashboard worker
  - Remove workers.dev subdomain enabling for dashboard worker
  - `resetConnect()` — update `deleteWorker()` calls to use namespace delete path: `DELETE /dispatch/namespaces/vibes-connect/scripts/{name}` instead of `/workers/scripts/{name}`
  - `deleteWorker()` helper — add namespace parameter, construct URL accordingly
- `deploy-api/wrangler.toml` — no changes (namespace names are in the upload URL paths, not wrangler config)
- New: `deploy-api/scripts/migrate-to-namespaces.ts` — one-time migration script
- New: `deploy-api/dispatch-workers/vibes-app-dispatcher/` — dispatcher worker + wrangler.toml
- New: `deploy-api/dispatch-workers/vibes-connect-dispatcher/` — dispatcher worker + wrangler.toml

## Constraints

- Workers for Platforms plan: $25/mo, includes 1000 scripts (currently ~100 workers total — well within limit)
- Requests count as 1 across dispatch → user worker chain
- Cloud-backend workers with Durable Objects stay standalone — DO support in namespaces is unconfirmed
- **Service binding risk for dashboard workers**: Dashboard workers have a `{ type: 'service', name: 'OIDC_SERVICE', service: '<pocket-id-worker>' }` binding. If namespace workers can't have service bindings to host-account workers, the fallback is: the `vibes-connect-dispatcher` holds the Pocket ID service binding and injects auth context into the request before dispatching. Implementation plan: try service bindings first during Phase 3 test. If the upload fails or the binding doesn't work at runtime, implement the dispatcher-proxy fallback before proceeding with the full migration.

## Naming Convention Invariant

All dashboard workers follow the naming pattern `fireproof-dashboard-{appname}`, reachable at `connect-{appname}.vibesos.com`. The connect dispatcher relies on this: it strips the `connect-` prefix from the hostname and prepends `fireproof-dashboard-`. Any dashboard worker that doesn't follow this convention will be unreachable after migration. The migration script must verify this invariant for all existing dashboard workers before proceeding.
