S# Registry Rewrite: Per-Subdomain Cloudflare KV

**Version:** 0.1.56
**Date:** 2026-02-11
**Commits:** `ee011dcb`, `0e0e562d`, `be4f526c`, `79864673`

## What Changed

The subdomain registry was rewritten from a monolithic KV blob + Bun JSON file server to per-subdomain Cloudflare KV keys with collaborator support. The Bun registry server on exe.dev VMs was retired entirely.

### Before

- Cloudflare Worker stored all claims in a single `"registry"` KV key (one big JSON blob)
- exe.dev VMs ran a separate Bun process (`registry-server.ts`) writing to a JSON file
- No concept of collaborators — `ClaimedSubdomainGate` only checked `user.id === ownerId`
- Invited users via sharing got "Access Denied" because the gate didn't know about them

### After

- Each subdomain gets its own KV key: `subdomain:<name>` with owner + collaborators array
- Secondary user index: `user:<userId>` for reverse lookups
- Config keys: `config:reserved`, `config:preallocated`
- Bun registry server deleted — exe.dev apps point at CF Worker via `--registry-url`
- `ClaimedSubdomainGate` does async access check for non-owners via `/check/:subdomain/access`
- SharingBridge dual-writes invites to both Fireproof Connect AND CF Worker KV

## KV Data Model

```
Key: "subdomain:alice"
Value: {
  ownerId: "user_abc123",
  claimedAt: "2026-02-11T...",
  status: "active",               // "active" | "frozen"
  frozenAt: null,                  // ISO-8601, present only when frozen
  collaborators: [
    { email: "bob@example.com", status: "invited", right: "write", invitedAt: "..." },
    { email: "carol@x.com", userId: "user_def", status: "active", right: "write",
      invitedAt: "...", joinedAt: "..." }
  ]
}

Key: "user:user_abc123"
Value: { subdomains: ["alice"], quota: 3 }

Key: "config:reserved"
Value: ["admin", "api", "www"]

Key: "config:preallocated"
Value: { "demo": "user_admin" }
```

The `subdomain:` key is authoritative. The `user:` key is a secondary index (can be rebuilt).

Legacy records without `status` are normalized to `'active'` on read via `normalizeRecord()`.

## Ownership vs. Billing

The subdomain owner is always the user who is billed. Ownership doesn't change. What changes is that the subdomain claim record survives billing state changes instead of being destroyed by them.

When the owner's subscription lapses (`subscription.deleted` webhook):
- All owner's subdomain records are **frozen** (status changes to `'frozen'`, `frozenAt` timestamp added)
- The `user:<userId>` index is preserved (required for unfreeze)
- **Owner** sees a resubscribe paywall with PricingTable
- **Collaborators** see "This app is paused — ask the owner to resubscribe"
- Everyone is blocked from the app; no read-only access

When the owner resubscribes (`subscription.created`/`subscription.updated` webhook):
- All owner's frozen subdomain records are **unfrozen** (status back to `'active'`, `frozenAt` removed)
- Everything is instantly restored — owner, collaborators, data. No reclaiming, no re-inviting.

A collaborator's subscription is theirs — it lets them claim their own subdomain but does NOT unfreeze someone else's frozen subdomain.

## JWT Custom Claims

For returning users who already claimed/joined a subdomain, the Worker writes `publicMetadata.vibes_subdomains` on the Clerk user via the Backend API after `/claim` and `/join` succeed:

```json
{
  "vibes_subdomains": {
    "my-app": { "role": "owner" },
    "other-app": { "role": "collaborator" }
  }
}
```

**Clerk Dashboard session token config** (custom claim):
```json
{ "vibes_subdomains": "{{user.public_metadata.vibes_subdomains}}" }
```

The client reads JWT claims first (instant, no fetch). If claims are missing (first visit, or Clerk not configured), it falls back to `/resolve`. This is optional — guarded by `if (c.env.CLERK_SECRET_KEY)` on the Worker side.

## New Worker Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /invite` | JWT (owner) | Add collaborator email to subdomain record |
| `POST /join` | JWT (invitee) | Redeem invite — associates email with userId, sets status=active |
| `GET /check/:subdomain/access?userId=` | None | Returns `{ hasAccess, role: 'owner'\|'collaborator'\|'none' }` |
| `GET /resolve/:subdomain` | None (optional JWT) | Returns `{ role, frozen }` — unified access resolution |

### Updated Endpoints

| Endpoint | What Changed |
|----------|-------------|
| `POST /claim` | Writes per-key `subdomain:<name>` + `user:<userId>` instead of blob |
| `GET /check/:subdomain` | Reads per-key instead of blob |
| `GET /registry.json` | Reconstructs old format from `kv.list({ prefix: 'subdomain:' })` |
| `POST /webhook` | Freezes subdomain records on subscription.deleted; unfreezes on subscription.created/updated |

### Migration

A middleware in `index.ts` auto-detects the old monolithic `"registry"` key on first request and decomposes it into per-key entries. This is a one-time migration — the old key is deleted after decomposition.

## Client-Side Changes

### UnifiedAccessGate (sell delta)

Previously: Three sequential async gates (owner fetch → access check → subscription check), each with its own loading interstitial.

Now: Single `UnifiedAccessGate` component with a two-phase resolution:
1. Check JWT custom claims (`user.publicMetadata.vibes_subdomains[subdomain]`) — instant, no fetch
2. Fall back to `GET /resolve/:subdomain` with userId + email + JWT Bearer

State machine: `phase: 'init' → 'resolved' | 'error'`, `role: 'unclaimed'|'owner'|'collaborator'|'invited'|'none'`, `frozen: boolean`

Rendering decisions:
- Unclaimed → SubscriptionGate → ClaimPrompt
- Owner/collaborator + active → TenantProvider + App
- Owner/collaborator + frozen → ResubscribePaywall (owner sees PricingTable, collaborator sees "ask the owner")
- No access → AccessDenied
- Signed out → AuthGate

Components removed: `SubdomainAccessGate`, `getSubdomainOwner()`, the three-gate cascade.

### SharingBridge (base template)

After the existing `inviteUser()` call to Fireproof Connect succeeds, a non-fatal `POST /invite` is sent to the CF Worker. This dual-writes the collaborator record to KV. If the KV write fails, a console warning is logged but the share flow isn't blocked.

Subdomain is extracted from the `?subdomain=` query param first (sell template routing), falling back to hostname extraction for real subdomain DNS.

### Registry URL Resolution

The sell delta sets `window.__VIBES_REGISTRY_URL__` from `CONFIG.registryUrl`. When no explicit URL is configured (common for Cloudflare deploys where the registry is same-origin), it falls back to `window.location.origin`.

The `registryApiUrl()` helper in the sell delta uses relative paths as fallback, so all fetch calls work regardless of whether an explicit URL is configured.

## Deploy Changes

### deploy-cloudflare.js

- KV namespace is created/found per app (e.g., `myapp-registry`)
- After deploying the Worker, config keys are seeded via `wrangler kv key put --namespace-id <id> --remote`
- Supports `--reserved` and `--preallocated` flags

### deploy-exe.js

- `phase6Registry` function removed (~200 lines) — no more Bun server setup, systemd service, or nginx proxy config for registry
- Added `--registry-url` flag — injects `__VIBES_REGISTRY_URL__` into deployed HTML
- exe.dev sell apps must point at a separately-deployed CF Worker for registry operations

### assemble-sell.js

- Added `--registry-url` flag
- `__REGISTRY_URL__` placeholder in sell delta CONFIG gets replaced during assembly
- Falls back to `VITE_REGISTRY_URL` env var, then empty string (same-origin fallback)

## Files Changed

### Created
- `skills/cloudflare/worker/src/types.ts` — SubdomainRecord, Collaborator, UserRecord interfaces
- `skills/cloudflare/worker/src/__tests__/registry-logic.test.ts` — 31 collaborator tests

### Deleted
- `scripts/deployables/registry-server.ts` — Retired Bun registry server
- `scripts/lib/registry-logic.js` — Old JS registry logic
- `scripts/__tests__/unit/registry-logic.test.js` — Tests for deleted JS logic
- `scripts/__tests__/integration/registry-webhooks.test.js` — Tests for deleted Bun webhooks

### Rewritten
- `skills/cloudflare/worker/src/lib/kv-storage.ts` — Per-key methods + blob migration
- `skills/cloudflare/worker/src/lib/registry-logic.ts` — Collaborator-aware pure functions
- `skills/cloudflare/worker/src/index.ts` — New endpoints + migration middleware

### Modified
- `skills/sell/template.delta.html` — Async gate + registry URL fallback
- `skills/_base/template.html` — SharingBridge KV dual-write
- `scripts/assemble-sell.js` — --registry-url flag + placeholder
- `scripts/deploy-cloudflare.js` — KV seeding with --namespace-id --remote
- `scripts/deploy-exe.js` — Removed Bun registry, added --registry-url
- `CLAUDE.md` — Updated docs

### Durable Ownership (2026-02-12)
- `skills/cloudflare/worker/src/types.ts` — `status`, `frozenAt` on SubdomainRecord; `CLERK_SECRET_KEY` on Env
- `skills/cloudflare/worker/src/lib/kv-storage.ts` — `normalizeRecord()` in `getSubdomain()`
- `skills/cloudflare/worker/src/lib/registry-logic.ts` — `freezeSubdomain()`, `unfreezeSubdomain()`, `hasAccess()` returns `frozen`
- `skills/cloudflare/worker/src/index.ts` — `/resolve` endpoint, freeze/unfreeze webhook, Clerk metadata helper
- `skills/sell/template.delta.html` — `UnifiedAccessGate`, `ResubscribePaywall`, removed `SubdomainAccessGate`
- `scripts/deploy-cloudflare.js` — `CLERK_SECRET_KEY` secret handling

## Testing

~530+ tests pass (425+ scripts + 100+ worker).

New test files:
- `resolve-endpoint.test.ts` — /resolve endpoint behavior (unclaimed, owner, collaborator, frozen, invited, no identity)
- Updated `registry-logic.test.ts` — freeze/unfreeze functions, hasAccess with frozen flag
- Updated `kv-storage.test.ts` — normalizeRecord for legacy records
- Updated `integration.test.ts` — webhook freeze/unfreeze behavior

### E2E Verified on https://vibes-test.marcus-e.workers.dev

- Landing page renders, subdomain claim form works
- `/claim` writes per-key to KV (verified via wrangler CLI)
- Owner passes ClaimedSubdomainGate (async access check)
- `/check/:subdomain/access` returns correct role for owner/stranger
- SharingBridge dual-write lands collaborator in KV (verified from UI)
- `/registry.json` backward compat works
- KV config seeding works during deploy
- Sync, AI proxy, React singleton all green

## Current Limitations

1. **exe.dev sell apps need a separately-deployed CF Worker** — no auto-provisioning yet. Pass `--registry-url` to deploy-exe.js.
2. **Full invite-join-gate loop** depends on upstream `redeemInvite` fix in Fireproof Connect (Dashboard returns success but doesn't create LedgerUsers row). The KV side works (`POST /invite` writes, `POST /join` activates, gate checks access), but the browser flow stalls at invite redemption.
3. **KV eventual consistency** — two users claiming the same subdomain simultaneously could theoretically both succeed. Single-threaded Worker isolate mitigates this in practice. Upgrade to Durable Objects for strict consistency if needed.
4. **JWT custom claims propagation** — `publicMetadata.vibes_subdomains` is written via Clerk Backend API after `/claim` and `/join`. Session tokens refresh every ~60 seconds, so the first visit after claiming/joining still hits `/resolve`. Subsequent visits use cached JWT claims for instant access.
