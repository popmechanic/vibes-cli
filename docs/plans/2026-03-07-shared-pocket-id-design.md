# Shared Pocket ID — Managed Infrastructure Design

**Date:** 2026-03-07
**Status:** Approved
**Branch:** Builds on `claude/elegant-nobel` (Pocket ID migration)

## Summary

Simplify the Pocket ID migration to a fully managed model. One Pocket ID instance, one Connect instance, one Cloudflare account — all operated by us. Users write app code, sign in with Pocket ID, and deploy. No credentials to manage, no infrastructure to own.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Infrastructure ownership | We own everything | Eliminates user-facing ops burden |
| OIDC client model | Single shared client | No per-app registration, no admin API in plugin |
| Auth constants | Hardcoded at assembly | No `.env` setup for auth |
| Deploy mechanism | Server-side deploy API | CF API token never leaves our server |
| User credentials | None — just Pocket ID login | Simplest possible onboarding |
| Local preview | No auth, no sync | Already implemented on branch |
| Billing | Deferred, but architecture supports it | JWT claims gate the deploy API |

## Architecture

```
User's machine                         Our Cloudflare account
┌─────────────┐                       ┌──────────────────────┐
│ Vibes Plugin │──OIDC token──────────▶│ Deploy API Worker    │
│ (CLI/Editor) │◀─live URL────────────│   ├─ verify JWT      │
└─────────────┘                       │   ├─ check billing   │
                                      │   ├─ registry KV     │
User's browser                        │   └─ CF Workers API  │
┌─────────────┐                       │        │             │
│ Deployed App │──OIDC redirect──────▶│ Pocket ID Worker     │
│ *.exe.xyz   │◀─tokens──────────────│   (single instance)  │
│             │──sync────────────────▶│ Connect (alchemy)    │
└─────────────┘                       └──────────────────────┘
```

### Components

| Component | Type | Count | Purpose |
|-----------|------|-------|---------|
| Pocket ID | CF Worker | 1 | OIDC identity provider (passkey auth) |
| Deploy API | CF Worker | 1 | Accepts assembled HTML, deploys via CF API |
| Registry | CF KV | 1 | Subdomain ownership, collaborators |
| Connect | CF via alchemy | 1 per app | Fireproof sync backend |
| App Workers | CF Workers | 1 per app | Serve the deployed app |

### Auth Constants

Two values, same for every app, injected at assembly time:

```javascript
// Baked into __VIBES_CONFIG__ during assembly
window.__VIBES_CONFIG__ = {
  oidcAuthority: "https://pocket-id.<account>.workers.dev",
  oidcClientId: "<shared-client-id>",
  // Connect URLs added at deploy time
  tokenApiUri: "...",
  cloudBackendUrl: "..."
};
```

### OIDC Client Setup

One-time manual configuration in Pocket ID admin:
- **Client name:** `vibes-apps`
- **Allowed callbacks:** `https://*.exe.xyz/*`, `http://localhost:*/*`
- **Grant types:** authorization_code, refresh_token
- **PKCE:** required

## Deploy API

New CF Worker that replaces client-side wrangler usage.

### Endpoint

```
POST /deploy
Authorization: Bearer <oidc-access-token>
Content-Type: multipart/form-data
Body: { name: "my-app", html: <assembled index.html> }

Response: { ok: true, url: "https://my-app.exe.xyz" }
```

### Deploy flow

1. Verify OIDC token against Pocket ID JWKS
2. Check billing claims (when enabled) — reject if no valid plan
3. Check registry KV — user owns or can create this subdomain
4. Upload Worker script via CF Workers API
5. Auto-provision Connect via alchemy if first deploy
6. Update registry KV with deployment metadata
7. Return live URL

### Secrets (on deploy API Worker)

| Secret | Purpose |
|--------|---------|
| `CF_API_TOKEN` | Deploy Workers on behalf of users |
| `OIDC_PEM_PUBLIC_KEY` | Verify user identity tokens |
| `OIDC_ISSUER` | Validate token issuer claim |

## User Authentication Flows

### Terminal mode (CLI deploy)

1. Plugin opens browser to Pocket ID authorize URL with localhost callback
2. User authenticates with passkey
3. Pocket ID redirects to `http://localhost:{port}/callback?code=...`
4. Plugin exchanges code for tokens (PKCE)
5. Tokens cached at `~/.vibes/auth.json` (access + refresh)
6. Deploy request sent with access token in Authorization header
7. Subsequent deploys reuse cached token, refresh if expired

### Editor mode

1. User clicks Deploy in editor
2. Same OIDC redirect flow, but callback lands in the editor page
3. Token stored in sessionStorage (already implemented in OIDC bridge)
4. Editor sends deploy request to deploy API

### Deployed app (production)

1. Standard OIDC redirect to Pocket ID (already implemented on branch)
2. `authority` and `clientId` from `__VIBES_CONFIG__`
3. Token stored in sessionStorage, refreshed automatically

## Changes vs. Existing Pocket ID Branch

### Keep as-is

- `fireproof-oidc-bridge.js` — OIDC PKCE flow, token management, sync status
- `verifyOIDCJWT` in CF Worker — standard JWKS verification
- Service binding for Worker-to-Worker JWKS fetch
- Template delta — `OIDCProvider`, `SignedIn`/`SignedOut`, local-only fallback
- `oauth4webapi` in import map

### Simplify

- **`deploy-cloudflare.js`** — replace wrangler CLI calls with HTTP POST to deploy API
- **`env-utils.js`** — remove `VITE_OIDC_AUTHORITY` and `VITE_OIDC_CLIENT_ID` from `.env` config; these become hardcoded constants
- **Setup wizard** — remove OIDC credential fields; auth is just "sign in"
- **`assemble.js` / `assemble-sell.js`** — inject hardcoded authority + clientId instead of reading from `.env`

### Add new

- **Deploy API Worker** — new CF Worker accepting assembled HTML + OIDC token
- **CLI auth flow** — localhost OIDC login for terminal deploys, token cache at `~/.vibes/auth.json`
- **Wildcard callback** — one-time manual registration in Pocket ID admin

### Delete

- CF API token / wrangler dependency on user machines
- Per-app OIDC client registration logic
- Clerk-related env validation (confirm cleanup from branch)

## Billing Integration Path

Not implemented now. The architecture supports it without structural changes:

1. **Pocket ID claims:** Add `plan` custom claim or group (`free`, `starter`, `pro`)
2. **Deploy API gate:** Check `plan` in JWT before deploying — already wired (`BILLING_MODE` + plan claim check in Worker)
3. **Stripe webhooks:** Payment event → call Pocket ID admin API → update user's plan claim
4. **Enforcement point:** Deploy API is the natural gate — no plan, no deploy
5. **Customer portal:** Stripe handles subscription management; link from a settings page

### What's already wired

- Worker billing gate (`BILLING_MODE` + `plan` claim) — implemented and tested on branch
- `verifyOIDCJWT` extracts all claims — `plan` comes through automatically
- Per-app user tracking via registry KV (subdomain → owner + collaborators)

### What you'd add later

- Stripe webhook handler (route on deploy API or separate Worker)
- Pocket ID admin API call to set user claims on payment events
- Pricing/checkout page (could be a Vibes app)

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Single point of failure (our CF account) | Medium | CF Workers have 99.99% SLA; multi-region by default |
| CF API token compromise on deploy Worker | High | Scoped token (Workers only), stored as Worker secret, audit logs |
| Abuse via free deploys | Medium | Billing gate deferred but architecture ready; rate limiting on deploy API |
| Pocket ID downtime blocks all auth | Medium | Passkey auth is fast; Pocket ID is single Go binary with SQLite |
| Deploy API becomes bottleneck | Low | CF Workers scale horizontally; no shared state beyond KV |
