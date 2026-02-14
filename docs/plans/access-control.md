S# Registry Rewrite: Per-Subdomain Cloudflare KV

**Version:** 0.1.56 → 0.1.59
**Date:** 2026-02-11 (registry rewrite), 2026-02-13 (quota enforcement)
**Commits:** `ee011dcb`, `0e0e562d`, `be4f526c`, `79864673`, `533747a4`

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
Value: { subdomains: ["alice"], ownedSubdomains: ["alice"], quota: 3 }

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

### Per-Plan Quota Enforcement (0.1.59)

The Worker enforces per-plan subdomain quotas via the `PLAN_QUOTAS` environment variable (JSON map of plan slug → max subdomains, e.g. `{"starter":3,"pro":10}`). On `/claim`, the handler checks the user's `ownedSubdomains` count against their plan's limit. If exceeded, returns 403 with `{ reason: "quota_exceeded", current, limit }`.

- **Admins bypass** the check entirely (existing admin logic)
- **Unknown/missing plans** default to unlimited for backward compatibility
- The `ownedSubdomains` field on `UserRecord` is lazily migrated from `subdomains` on first write
- `parsePlanQuotas()`, `getQuotaForPlan()`, `isQuotaExceeded()` are pure functions in `registry-logic.ts`

## JWT Custom Claims

For returning users who already claimed/joined a subdomain, the Worker writes `publicMetadata.vibes_subdomains` on the Clerk user via the Backend API after `/claim` and `/join` succeed:

```json
{
  "vibes_subdomains": {
    "my-app": { "role": "owner", "frozen": false },
    "other-app": { "role": "collaborator", "frozen": false }
  }
}
```

**Clerk Dashboard session token config** (custom claim):
```json
{ "vibes_subdomains": "{{user.public_metadata.vibes_subdomains}}" }
```

The client reads JWT claims first (instant, no fetch). If claims are missing (first visit, or Clerk not configured), it falls back to `/resolve`. This is optional — guarded by `if (c.env.CLERK_SECRET_KEY)` on the Worker side.

JWT claims include a `frozen` boolean per subdomain, propagated by webhook freeze/unfreeze to both owner AND collaborator users. This enables the JWT shortcut for collaborators (not just owners) — a collaborator returning to a frozen app sees the paywall instantly without a `/resolve` fetch.

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
| `POST /claim` | Writes per-key `subdomain:<name>` + `user:<userId>` instead of blob; enforces per-plan quota via `PLAN_QUOTAS` env var |
| `GET /check/:subdomain` | Reads per-key instead of blob |
| `GET /registry.json` | Reconstructs old format from `kv.list({ prefix: 'subdomain:' })` |
| `POST /webhook` | Freezes subdomain records on subscription.deleted; unfreezes on subscription.created/updated |

### Migration

A middleware in `index.ts` auto-detects the old monolithic `"registry"` key on first request and decomposes it into per-key entries. This is a one-time migration — the old key is deleted after decomposition.

## Client-Side Changes

### UnifiedAccessGate (sell delta)

Previously: Three sequential async gates (owner fetch → access check → subscription check), each with its own loading interstitial.

Now: Single `UnifiedAccessGate` component with module-level cache and three-tier resolution:

**Resolution tiers** (checked in order):
1. **Cache hit** — `_gateCache[userId:subdomain]` or `_gateCache[subdomain]` → instant, no fetch
2. **JWT claims** — `user.publicMetadata.vibes_subdomains[subdomain]` → synchronous from Clerk session
3. **Async fetch** — `GET /resolve/:subdomain` or `GET /check/:subdomain/access` → network round-trip

**Module-level cache** (`_gateCache`): Dual-keyed by `userId:subdomain` (primary) and `subdomain` (fallback). Survives ClerkProvider remounts since it lives outside React's component tree. Updated by `setGateState` which writes both keys.

**Render-time cache recovery**: React 18 pattern — if `state.phase === 'init'` but cache has a resolved entry, `setState` during render discards the current render output and immediately re-renders with cached state. This prevents stale `'unclaimed'` from the initial useState from overriding a cached `'owner'` result.

**Direct claim transition**: `onClaimSuccess` calls `setGateState({phase:'resolved', role:'owner'})` directly instead of resetting to `phase:'init'`. This was the fix for the stuck-after-claim bug (29ea3e2f) — resetting to init triggered render-time cache recovery of the stale pre-claim state, creating an infinite loop.

State machine: `phase: 'init' → 'resolved' | 'error'`, `role: 'unclaimed'|'owner'|'collaborator'|'invited'|'none'`, `frozen: boolean`

Rendering decisions:
- Unclaimed → SubscriptionGate → ClaimPrompt
- Owner/collaborator + active → TenantProvider + App
- Owner/collaborator + frozen → ResubscribePaywall (owner sees PricingTable, collaborator sees "ask the owner")
- No access → AccessDenied
- Signed out → AuthGate

Components removed: `SubdomainAccessGate`, `getSubdomainOwner()`, the three-gate cascade.

### Quota Enforcement UI (0.1.59)

- **SubscriptionGate** checks all plan slugs from `CONFIG.planQuotas` (not just hardcoded `'starter'`). `isFrozen` detection uses the same multi-plan logic. This fixed the bug where SubscriptionGate failed to detect subscriptions for plans other than `'starter'`.
- **ClaimPrompt** handles `quota_exceeded` responses from `/claim`: shows "You've reached the limit of N apps on your current plan" instead of a generic error.

### Cache Architecture

The gate uses module-level variables (outside React) to persist resolved state across ClerkProvider remounts:

| Variable | Key Format | Purpose |
|----------|-----------|---------|
| `_gateCache` | `userId:subdomain` | Primary cache — set by `setGateState`, read by useState initializer and render-time recovery |
| `_gateCache` | `subdomain` | Fallback cache — always written alongside primary key, used when userId isn't available yet |
| `_subdomainCheck` | (single promise) | Module-level fetch that fires before React renders for tenant routes |
| `resolvedForRef` | `userId:subdomain` string | Ref tracking which user+subdomain combo has been resolved, prevents duplicate fetches |

**Lifecycle:**
1. On first mount, `useState` initializer checks `_gateCache[userId:subdomain]` — cache hit skips all resolution
2. If cache misses, `useEffect` runs three-tier resolution and calls `setGateState` (writes cache + setState)
3. On ClerkProvider remount (e.g., Clerk token refresh), component unmounts and re-mounts — but `_gateCache` survives because it's module-scoped
4. New mount's `useState` initializer finds cached state → instant render, no flash

**Claim flow:**
1. User clicks "Claim" → `POST /claim` succeeds
2. `onClaimSuccess` calls `setGateState({phase:'resolved', role:'owner'})` directly
3. Cache is updated atomically with state — no window for stale recovery

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
- Supports `--reserved`, `--preallocated`, and `--plan-quotas` flags
- `--plan-quotas` patches `PLAN_QUOTAS` into `wrangler.toml` `[vars]` section

### deploy-exe.js

- `phase6Registry` function removed (~200 lines) — no more Bun server setup, systemd service, or nginx proxy config for registry
- Added `--registry-url` flag — injects `__VIBES_REGISTRY_URL__` into deployed HTML
- exe.dev sell apps must point at a separately-deployed CF Worker for registry operations

### assemble-sell.js

- Added `--registry-url` and `--plan-quotas` flags
- `__REGISTRY_URL__` placeholder in sell delta CONFIG gets replaced during assembly
- `__PLAN_QUOTAS__` placeholder gets replaced with JSON quota map
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
- `templates/base/template.html` — SharingBridge KV dual-write
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

### Quota Enforcement (2026-02-13)
- `skills/cloudflare/worker/src/lib/registry-logic.ts` — `parsePlanQuotas()`, `getQuotaForPlan()`, `isQuotaExceeded()`
- `skills/cloudflare/worker/src/types.ts` — `ownedSubdomains` on `UserRecord`
- `skills/cloudflare/worker/src/index.ts` — quota check in `/claim` handler
- `skills/cloudflare/worker/wrangler.toml` — `PLAN_QUOTAS` var
- `skills/sell/template.delta.html` — multi-plan SubscriptionGate, quota_exceeded ClaimPrompt
- `scripts/assemble-sell.js` — `--plan-quotas` flag, `__PLAN_QUOTAS__` placeholder
- `scripts/deploy-cloudflare.js` — `--plan-quotas` flag, wrangler.toml patching
- `skills/cloudflare/worker/src/__tests__/quota-enforcement.test.ts` — 11 integration tests
- `skills/cloudflare/worker/src/__tests__/registry-logic.test.ts` — 24 unit tests added

## Testing

561 tests pass (425 scripts + 136 worker).

New test files:
- `resolve-endpoint.test.ts` — /resolve endpoint behavior (unclaimed, owner, collaborator, frozen, invited, no identity)
- `quota-enforcement.test.ts` — 11 integration tests for quota check on /claim (at limit, below, above, no quotas, admin bypass)
- Updated `registry-logic.test.ts` — freeze/unfreeze functions, hasAccess with frozen flag, 24 quota pure function tests
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
- Quota enforcement: free user hitting limit gets 403, subscriber can claim up to plan limit

## Current Limitations

1. **exe.dev sell apps need a separately-deployed CF Worker** — no auto-provisioning yet. Pass `--registry-url` to deploy-exe.js.
2. **Full invite-join-gate loop** depends on upstream `redeemInvite` fix in Fireproof Connect (Dashboard returns success but doesn't create LedgerUsers row). The KV side works (`POST /invite` writes, `POST /join` activates, gate checks access), but the browser flow stalls at invite redemption.
3. **KV eventual consistency** — two users claiming the same subdomain simultaneously could theoretically both succeed. Single-threaded Worker isolate mitigates this in practice. Upgrade to Durable Objects for strict consistency if needed.
4. **JWT custom claims propagation** — `publicMetadata.vibes_subdomains` is written via Clerk Backend API after `/claim` and `/join`. Session tokens refresh every ~60 seconds, so the first visit after claiming/joining still hits `/resolve`. Subsequent visits use cached JWT claims for instant access.
5. **Shared ledger sync for collaborators** depends on upstream `redeemInvite` fix. The sell template writes `window.__VIBES_SHARED_LEDGER__` from `/resolve` responses and invite URLs, but the bundle does not read this global (bundle was reverted to pre-shared-ledger state). These writes are harmless no-ops. When the upstream fix lands, the bundle can be re-patched to use the global for collaborator ledger routing.
6. **Quota downgrade enforcement** — quotas are only checked on new `/claim` requests. If a user downgrades from pro (10 apps) to starter (3 apps) while owning 8 subdomains, existing subdomains are not frozen. Future work: webhook handler for `subscription.updated` that freezes excess subdomains on downgrade.
