# Registry Rewrite: Per-Subdomain Cloudflare KV

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

## New Worker Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /invite` | JWT (owner) | Add collaborator email to subdomain record |
| `POST /join` | JWT (invitee) | Redeem invite — associates email with userId, sets status=active |
| `GET /check/:subdomain/access?userId=` | None | Returns `{ hasAccess, role: 'owner'\|'collaborator'\|'none' }` |

### Updated Endpoints

| Endpoint | What Changed |
|----------|-------------|
| `POST /claim` | Writes per-key `subdomain:<name>` + `user:<userId>` instead of blob; enforces per-plan quota (0.1.59) |
| `GET /check/:subdomain` | Reads per-key instead of blob |
| `GET /registry.json` | Reconstructs old format from `kv.list({ prefix: 'subdomain:' })` |
| `POST /webhook` | Reads `user:<userId>` to find subdomains, deletes each per-key |

### Migration

A middleware in `index.ts` auto-detects the old monolithic `"registry"` key on first request and decomposes it into per-key entries. This is a one-time migration — the old key is deleted after decomposition.

## Client-Side Changes

### ClaimedSubdomainGate (sell delta)

Previously: `if (user.id !== ownerId) → blocked`

Now:
1. Owner fast-path: if `user.id === ownerId`, pass through immediately (no fetch)
2. Non-owners: fetch `GET /check/:subdomain/access?userId=` from the Worker
3. If `hasAccess === true`, proceed to app
4. Otherwise, show "Access Denied"

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
- `templates/base/template.html` — SharingBridge KV dual-write
- `scripts/assemble-sell.js` — --registry-url flag + placeholder
- `scripts/deploy-cloudflare.js` — KV seeding with --namespace-id --remote
- `scripts/deploy-exe.js` — Removed Bun registry, added --registry-url
- `CLAUDE.md` — Updated docs

## Testing

561 tests pass (425 scripts + 136 worker).

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
4. **Per-plan quota enforcement** added in 0.1.59 (`533747a4`). `/claim` checks `PLAN_QUOTAS` env var against user's `ownedSubdomains` count. See `docs/plans/access-control.md` for full details.
