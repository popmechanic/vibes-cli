# Server-Side Connect Provisioning

## Problem

Connect provisioning runs alchemy locally on the user's machine, requiring a
Cloudflare API token at `~/.vibes/cloudflare-api-token`. Users shouldn't need
CF credentials — the Deploy API Worker holds the platform token. When a user
without a local CF token deploys (e.g., `--stage mike-demo`), alchemy fails
with a 403 on AccountApiToken creation and the error surfaces as an opaque
"Command failed" message.

## Solution

Move Connect provisioning into the Deploy API Worker. Each first-deploy
creates per-app Cloudflare resources (R2, D1, Workers, Durable Objects) via
the CF REST API using the platform `CF_API_TOKEN`. No client-side alchemy,
no user CF tokens.

## Architecture

```
Editor/CLI                          Deploy API Worker
    │                                       │
    POST /deploy {name, files, token} ────► │
                                            ├─ Verify JWT
                                            ├─ Check KV: first deploy?
                                            │   YES → provisionConnect():
                                            │     1. Generate crypto (Web Crypto API)
                                            │     2. Create R2 bucket
                                            │     3. Create AccountApiToken
                                            │     4. Create D1 (backend) + run migrations
                                            │     5. Create D1 (dashboard) + run migrations
                                            │     6. Deploy cloud-backend Worker
                                            │     7. Deploy dashboard Worker
                                            │     8. Save Connect info to KV
                                            │   NO → Read existing Connect from KV
                                            ├─ Inject Connect URLs into HTML
                                            ├─ Deploy app Worker
                                            └─ Return URL + Connect info
```

## Resources Per App

| Resource | Name | CF API |
|----------|------|--------|
| R2 Bucket | `fp-storage-{stage}` | `POST /accounts/{id}/r2/buckets` |
| AccountApiToken | `fp-r2-s3-{stage}` | `POST /user/tokens` |
| D1 Database | `fp-meta-{stage}` | `POST /accounts/{id}/d1/database` |
| D1 Database | `fp-connect-{stage}` | `POST /accounts/{id}/d1/database` |
| Worker | `fireproof-cloud-{stage}` | `PUT /accounts/{id}/workers/scripts/{name}` |
| Worker | `fireproof-dashboard-{stage}` | `PUT /accounts/{id}/workers/scripts/{name}` |

Stage name = app name, truncated to 34 chars (existing logic).

## Pre-Built Bundles

Two JS bundles checked into the repo at `deploy-api/bundles/`:

- `cloud-backend.js` — R2 blobs, D1 metadata, Durable Object WebSocket rooms
- `dashboard.js` — Auth, tenants, ledgers, static asset serving

Built from upstream fireproof source (`selem/docker-for-all` branch) using
esbuild. Rebuilt manually when upstream changes. The dashboard bundle includes
its static frontend assets embedded (same pattern the Deploy API already uses
for app Workers — file map embedded in script).

## Crypto

`generateSessionTokens()` and `generateDeviceCAKeys()` from `crypto-utils.js`
use Web Crypto API (`crypto.subtle`). Runs natively in CF Workers. Port into
the Deploy API Worker as a module.

## Migration SQL

Inlined as string constants. Two small schemas:

**Cloud backend** (`fp-meta-{stage}`): Tenant, TenantLedger,
KeyByTenantLedger, MetaByTenantLedger, MetaSend tables (~15 lines).

**Dashboard** (`fp-connect-{stage}`): Generated Drizzle migration for auth,
tenants, ledgers, users, invites (~30 lines).

Executed via `POST /accounts/{id}/d1/database/{db_id}/query`.

## KV Registry Extension

Existing `subdomain:{name}` entries gain a `connect` field:

```json
{
  "owner": "user-id",
  "collaborators": [],
  "connect": {
    "cloudBackendUrl": "https://fireproof-cloud-{stage}.workers.dev",
    "dashboardUrl": "https://fireproof-dashboard-{stage}.workers.dev",
    "apiUrl": "https://fireproof-dashboard-{stage}.workers.dev/api",
    "cloudUrl": "fpcloud://fireproof-cloud-{stage}.workers.dev?protocol=wss",
    "r2BucketName": "fp-storage-{stage}",
    "d1BackendId": "<uuid>",
    "d1DashboardId": "<uuid>",
    "sessionTokenPublic": "<base58>",
    "deployedAt": "ISO-8601"
  }
}
```

Secrets (session token secret, device CA private key, alchemy password) are
injected into Worker bindings at deploy time and NOT stored in KV.

## Client-Side Changes

**Remove:**
- `scripts/lib/alchemy-deploy.js`
- Connect provisioning block in `scripts/server/handlers/deploy.ts`
- `~/.vibes/cloudflare-api-token` file requirement
- `~/.vibes/upstream/fireproof/` sparse checkout dependency

**Update:**
- Deploy handler reads Connect URLs from Deploy API response instead of
  running alchemy locally
- Local registry (`~/.vibes/deployments.json`) still updated from response

## What Doesn't Change

- POST /deploy endpoint signature (same request format)
- Pocket ID auth flow and JWT verification
- Per-app Pocket ID client registration (already in Deploy API)
- Editor UI deploy experience (progress stages)
- App Worker deployment (same CF API call, already in Deploy API)

## Error Handling

- Each CF API call wrapped in `withRetry()` (existing pattern)
- Connect failures return structured error to client with the actual CF API
  error message (not "Command failed: bunx...")
- Partial provisioning: KV tracks which resources were created. Retry
  attempts skip already-created resources (idempotent creates where possible,
  existence checks otherwise).
- R2 bucket creation is idempotent (409 = already exists = success)
- D1 creation is not idempotent — check KV for existing DB ID first

## Platform Token Permissions

CF_API_TOKEN needs: Workers Scripts Edit, R2 Storage Edit, D1 Edit,
Account API Tokens Edit, Account Settings Read. Same permissions alchemy
required, now held by a single platform-managed token in the Deploy API
Worker secrets.

## Timing

Connect provisioning adds ~20-40s to first deploys (6 sequential CF API
calls). Subsequent deploys skip provisioning entirely (Connect URLs read
from KV). The editor already shows progress stages, so UX is acceptable.
