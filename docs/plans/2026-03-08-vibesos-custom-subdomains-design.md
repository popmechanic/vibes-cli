# Custom Subdomain Routing on vibesos.com

**Date:** 2026-03-08
**Status:** Approved

## Problem

Deployed Vibes apps get URLs like `https://{app}.{account}.workers.dev` — long, ugly, and not branded. We want apps to live at `https://{app}.vibesos.com`.

## Solution: Cloudflare Workers Custom Domains API

After deploying a worker, the Deploy API makes one additional CF API call to assign `{app}.vibesos.com` as a custom domain. Cloudflare handles DNS record creation and SSL provisioning automatically.

No wildcard DNS entry needed. No dispatcher worker. No route patterns.

## DNS Setup (one-time, manual)

Keep existing A record for `vibesos.com` apex (Pocket ID). The Workers Custom Domains API creates per-subdomain DNS records automatically.

## Changes

### 1. Deploy API Worker (`deploy-api/src/index.ts`)

After `deployCFWorker()` deploys the worker script, add:

```
PUT /accounts/{account_id}/workers/domains
{
  hostname: "{appName}.vibesos.com",
  service: "{appName}",
  zone_id: "{vibesos_zone_id}",
  environment: "production"
}
```

New env var: `CF_ZONE_ID` (the vibesos.com zone ID, set via `wrangler secret put`).

Return URL changes from `https://{app}.{account}.workers.dev` to `https://{app}.vibesos.com`.

### 2. OIDC Callback URLs

Add wildcard `https://*.vibesos.com/**` to the shared Pocket ID OIDC client. This covers all apps — no per-app callback URL changes needed.

Per-app OIDC registration in the Deploy API should set callback URL to `https://{app}.vibesos.com/**` instead of workers.dev.

Legacy `https://*.marcus-e.workers.dev/**` can be removed once migration is complete.

### 3. CORS Updates

**Deploy API Worker (`deploy-api/src/index.ts`):**
Add `origin.endsWith(".vibesos.com")` to the CORS origin check, alongside existing `.workers.dev`.

**Registry Worker (`skills/cloudflare/worker/src/index.ts`):**
Add `.vibesos.com` alongside existing `.vibes.diy` and `.workers.dev`.

### 4. Client-side (`scripts/deploy-cloudflare.js`)

Fallback URL changes from `https://${name}.vibes.diy` to `https://${name}.vibesos.com`.

### 5. Local Registry (`~/.vibes/deployments.json`)

Stored URLs use `vibesos.com` domain. No schema change needed — just different URL values.

### 6. Tests

Update expected URL patterns in:
- `scripts/__tests__/integration/deploy-cloudflare-connect.test.js`
- Any other tests asserting `.workers.dev` or `.vibes.diy` URLs

## What Stays the Same

- Worker deployment mechanics (CF Workers Scripts API)
- Connect provisioning (alchemy)
- Registry KV schema and ownership logic
- CLI auth flow (OIDC via Pocket ID)
- Per-app Pocket ID client registration (just different callback URL)

## Rollout

1. Add `CF_ZONE_ID` secret to Deploy API Worker
2. Add `*.vibesos.com/**` callback to shared OIDC client in Pocket ID
3. Deploy updated Deploy API Worker
4. New deploys get `vibesos.com` subdomains automatically
5. Existing apps keep workers.dev URLs until redeployed
