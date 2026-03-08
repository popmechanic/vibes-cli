# Clerk → Pocket ID Migration Design

**Date:** 2026-03-05
**Status:** Proposed
**Approach:** Big bang replacement (all systems at once)

## Summary

Replace Clerk with [Pocket ID](https://github.com/pocket-id/pocket-id), an open-source, self-hosted, passkey-only OIDC identity provider. This eliminates the Clerk dependency across the entire Vibes ecosystem: generated app templates, the Fireproof Connect dashboard, and the bridge layer.

## Why Pocket ID

- **Passkey-only:** WebAuthn/FIDO2 authentication. No passwords, no social OAuth providers.
- **Self-hosted:** Single Docker container (Go + SvelteKit + SQLite). No external service dependency.
- **Standard OIDC:** Full OpenID Connect provider with JWKS, authorization code flow, refresh tokens.
- **Mature:** v2.3, ~7k GitHub stars, BSD 2-Clause license, active development.
- **Minimal ops:** No Redis, no message queue, no external database required.

## Auth UX Decision

**Redirect-based OIDC flow.** Users click "Sign In" in the Vibes app, redirect to Pocket ID's hosted login page (passkey prompt), then return. This is the standard OIDC pattern — works everywhere, no Pocket ID modifications needed, no cross-origin complications.

Embedded passkey UI was evaluated and deferred due to cross-origin cookie/CORS complexity that would require either forking Pocket ID or building a server-side proxy.

## Billing Decision

Billing (Clerk Commerce) is **stubbed but deferred to phase 2**. The sell template will have a billing interface but ship with `--billing-mode off`. Direct Stripe integration will be designed separately.

---

## 1. Deployment Architecture

Pocket ID co-locates on the Connect Studio VM as another Docker container:

```
Studio VM (studio.exe.xyz)
├── Pocket ID     (port 1411) — identity provider
├── Connect       (port 8909) — sync backend
├── Dashboard     (port 7370) — management UI
└── nginx         — reverse proxy
    /auth/*     → Pocket ID
    /ws, /fp    → Connect backend
    /api/*      → Dashboard
```

**Rationale:** Vibes minimizes infrastructure. One VM for all backend services. Pocket ID's SQLite database lives alongside Connect's — single backup target.

**Domain topology:**
- Pocket ID: `https://studio.exe.xyz/auth/` (path-based routing via nginx)
- Vibes apps: `https://myapp.exe.xyz` redirect to Pocket ID for login
- OIDC discovery: `https://studio.exe.xyz/auth/.well-known/openid-configuration`

## 2. OIDC Flow in Vibes App Templates

Replace `ClerkFireproofProvider` + inline `<SignedIn>/<SignedOut>` with standard OIDC authorization code flow using PKCE:

```
User opens app → app checks for stored tokens
  → No token: show "Sign In" button
  → Click: redirect to Pocket ID /authorize endpoint
  → User authenticates with passkey on Pocket ID's page
  → Pocket ID redirects back with ?code=...
  → App exchanges code for id_token + access_token (PKCE)
  → App stores tokens, renders authenticated UI
```

### New template components (replacing Clerk's)

| New Component | Replaces | Purpose |
|---------------|----------|---------|
| `OIDCProvider` | `ClerkFireproofProvider` | Token lifecycle (acquire, refresh, store) |
| `useUser()` | `useUser()` from Clerk | Parse user info from OIDC id_token claims |
| `SignedIn` / `SignedOut` | Same names from Clerk | Conditional render based on token presence |
| `SignInButton` | `SignInButton` from Clerk | Trigger redirect to Pocket ID authorize URL |
| `UserButton` | `UserButton` from Clerk | User info display + sign out |

### OIDC client library

`oauth4webapi` (~4KB, standards-focused, no dependencies) via esm.sh in the import map. Handles PKCE, token exchange, and refresh.

## 3. New Bridge: `fireproof-oidc-bridge.js`

Replaces `fireproof-vibes-bridge.js` (which wraps `@fireproof/clerk`):

```
Current:  ClerkFireproofProvider → @fireproof/clerk → dashApi (Clerk JWT)
New:      OIDCProvider → fireproof-oidc-bridge → dashApi (OIDC access_token)
```

The bridge:
- Takes the OIDC access_token from Pocket ID
- Passes it to `dashApi.ensureUser()` and `dashApi.ensureCloudToken()` on Connect
- Connect validates the token against Pocket ID's JWKS endpoint
- Connect returns a Fireproof cloud JWT (unchanged)
- Bridge manages sync status, ledger routing, invite redemption (same logic as current bridge)

## 4. Connect Dashboard Changes

### Frontend
- Replace `<ClerkProvider>` + `<SignIn>` with OIDC redirect flow
- Replace `useClerk()` / `useSession()` with OIDC token management
- `CloudContext` calls `dashApi` with OIDC tokens instead of Clerk tokens

### Backend (`tokenApi`)
- Add/replace `"clerk"` token type with `"pocket-id"` — standard JWKS-based JWT verification
- Fetch public keys from Pocket ID's `/.well-known/jwks.json`
- Verify RS256 signature, extract claims

### Claims mapping

| Pocket ID Claim | Maps To (existing schema) |
|-----------------|--------------------------|
| `sub` | `userId` |
| `email` | `params.email` |
| `preferred_username` | `params.nick` |
| `given_name` | `params.first` |
| `family_name` | `params.last` |
| `picture` | `params.image_url` |
| `groups` | (new field, for RBAC) |

### Cloud backend
Zero changes. It only validates Fireproof-issued JWTs (`fp-cloud-jwt`), never sees auth provider tokens directly.

## 5. Sell Template / Multi-Tenant

- **Auth:** Same OIDC redirect flow as vibes template
- **Tenancy:** Subdomain-to-user mapping uses `sub` from Pocket ID (UUID format, replaces Clerk's `user_xxx` format)
- **User groups:** Pocket ID has native user groups with group claims in tokens — replaces Clerk's organization concept
- **Billing:** Stub interface. `--billing-mode off` initially. Stripe integration deferred to phase 2.
- **Webhooks:** Pocket ID doesn't have outbound webhooks. Subscription lifecycle events will come from Stripe directly (phase 2).

## 6. Deploy Script Changes

### `deploy-connect.js`
- Add Pocket ID container to Docker Compose
- Auto-generate Pocket ID `ENCRYPTION_KEY`
- Configure Pocket ID's `APP_URL` to match studio domain
- Set up initial admin account via Pocket ID's setup API

### `deploy-exe.js` / `deploy-cloudflare.js`
- Auto-register app as OIDC client in Pocket ID via admin API
- Set callback URLs to the app's deployed URL
- Inject OIDC client_id and Pocket ID authority URL into assembled template

### New `.env` variables

```bash
# Replaces VITE_CLERK_PUBLISHABLE_KEY
VITE_OIDC_AUTHORITY=https://studio.exe.xyz/auth
VITE_OIDC_CLIENT_ID=<auto-registered-client-id>

# Unchanged
VITE_API_URL=https://studio.exe.xyz/api
VITE_CLOUD_URL=fpcloud://studio.exe.xyz?protocol=wss
```

## 7. What Gets Deleted

- All `@clerk/clerk-react` imports and esm.sh references
- `@necrodome/fireproof-clerk` package reference
- `fireproof-vibes-bridge.js` (replaced by `fireproof-oidc-bridge.js`)
- `VITE_CLERK_PUBLISHABLE_KEY` env var and validation
- Clerk-specific JWT validation in Cloudflare Worker (`crypto-jwt.ts`)
- Clerk webhook handling (Svix signature verification)
- `skills/sell/CLERK-SETUP.md`
- Auth flow state machines in `scripts/lib/auth-flows.js` (Clerk signup/signin states)
- `scripts/lib/env-utils.js` Clerk key validation functions

## 8. What Stays the Same

- Fireproof database layer (completely auth-agnostic)
- Cloud backend WebSocket sync protocol
- `fp-cloud-jwt` token format (Fireproof's own JWT)
- Device ID certificate authority system
- Template inheritance architecture (base + delta)
- Assembly scripts (assemble.js, assemble-sell.js)
- Design tokens, components (AuthPopUp/AuthScreen restyled but keep structure)
- All non-auth UI code in generated apps

## 9. New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `oauth4webapi` | OIDC PKCE flow in browser | ~4KB |

## 10. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Pocket ID OIDC token format doesn't match Connect's expectations | Medium | Claims mapping layer; Pocket ID supports custom claims |
| WebAuthn RP ID mismatch across domains | Low | Pocket ID's RP ID is configurable |
| Token refresh in SPAs | Low | `oauth4webapi` handles refresh; Pocket ID issues 30-day refresh tokens |
| Pocket ID goes unmaintained | Low | BSD-licensed, Go codebase is readable, we can fork |
| Big bang breaks everything | Medium | Comprehensive test suite; `/vibes:test` E2E validates full flow |

## Pocket ID Capabilities Reference

| Feature | Status |
|---------|--------|
| OIDC/OAuth2 provider | Full (authorization_code, refresh_token, client_credentials, device_code) |
| Passkey auth (WebAuthn/FIDO2) | Core feature |
| Multi-client support | Yes (one instance, multiple OIDC clients) |
| User groups / RBAC | Yes (groups claim in tokens) |
| Custom claims | Yes (per-user and per-group) |
| Admin panel | Yes (user CRUD, client management, audit logs) |
| Self-hosted | Single Docker container, SQLite or Postgres |
| Embeddable UI components | No (redirect-based OIDC only) |
| Social login | No (passkey-only + email one-time access) |
| Outbound webhooks | No |
| Billing | No |
| License | BSD 2-Clause |
