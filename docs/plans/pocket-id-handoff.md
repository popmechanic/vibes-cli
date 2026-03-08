# Pocket ID Migration — Handoff Document

## What This Branch Does

This branch (`claude/elegant-nobel`) replaces Clerk with **Pocket ID** as the OIDC identity provider for Vibes apps. Pocket ID runs as a Cloudflare Container (Durable Object) with ephemeral SQLite storage.

## Current Architecture

```
User Browser
    │
    ▼
toe.marcus-e.workers.dev          ← Vibes test app (tic-tac-toe)
    │ OIDC redirect
    ▼
pocket-id.marcus-e.workers.dev    ← Pocket ID Worker (alchemy/src/worker.ts)
    │ container.fetch()
    ▼
Pocket ID Container (port 1411)   ← SvelteKit + Go backend, SQLite DB
    │
    ▼
fireproof-dashboard-tic3/toe      ← Dashboard Workers (cloud sync)
    │ JWKS verification
    ▼
CLERK_PUB_JWT_KEY secret          ← Embedded RSA public key (bypasses error 1042)
```

## Key Files

| File | Purpose |
|------|---------|
| `alchemy/src/worker.ts` | Pocket ID bridge Worker — routing, auto-registration, config bootstrap |
| `alchemy/wrangler.toml` | Worker config — container image, env vars, default OIDC clients |
| `.env` | App-level OIDC config (authority, client ID, API URLs) |
| `bundles/fireproof-oidc-bridge.js` | OIDC auth bridge for Fireproof (replaces Clerk bridge) |

## What Works

- **OIDC auth flow**: App → Pocket ID → consent → redirect → signed in
- **Cloud sync**: Dashboard Workers verify JWTs via embedded JWKS public key
- **Auto-registration**: OIDC clients re-created from config on container restart
- **App config bootstrap**: Middleware sets open signups + email login codes via admin API
- **Deploy pipeline**: assemble → deploy to Cloudflare Workers

## The Ephemeral SQLite Problem

Pocket ID stores everything in SQLite inside the container. When the container restarts (after 30min idle or crash), ALL data is lost:
- Users and passkeys
- OIDC client registrations
- Application configuration

**What we've automated (survives restarts):**
- OIDC client registration → `ensureOIDCClients()` in worker.ts
- App configuration → `ensureAppConfig()` in worker.ts

**What we haven't automated (lost on restart):**
- User accounts and passkey registrations
- The JWKS signing key (RSA keypair regenerated → dashboard Workers need new `CLERK_PUB_JWT_KEY`)

## Critical Operational Knowledge

### Cloudflare Error 1042
Worker-to-Worker fetch on the same account is blocked. The dashboard Workers can't fetch `/.well-known/jwks.json` from the Pocket ID Worker at runtime. **Solution**: embed the public key as the `CLERK_PUB_JWT_KEY` secret directly.

```bash
# Get current key
curl -s "https://pocket-id.marcus-e.workers.dev/.well-known/jwks.json" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['keys'][0]))"

# Set on dashboard Workers
cd ~/.vibes/upstream/fireproof/dashboard
echo '<key-json>' | npx wrangler secret put CLERK_PUB_JWT_KEY --name fireproof-dashboard-tic3
echo '<key-json>' | npx wrangler secret put CLERK_PUB_JWT_KEY --name fireproof-dashboard-toe
```

**After every container restart**, the JWKS key changes and you must update these secrets.

### Pocket ID Admin API

The admin API uses `X-API-Key` header authentication:
```
API key: <REDACTED — use `npx wrangler secret list` to retrieve>
```

**Critical format discovery**: The `PUT /api/application-configuration` endpoint requires:
- ALL fields as **strings** (not booleans/ints)
- **camelCase** JSON keys (not PascalCase)
- `smtpTls` must be `"none"`, `"starttls"`, or `"tls"` (not `"false"`)
- ALL required fields must be present (it rejects partial updates)

```bash
# Read config
curl -s "https://pocket-id.marcus-e.workers.dev/api/application-configuration" \
  -H "X-API-Key: <REDACTED — use `npx wrangler secret list` to retrieve>"

# Update config (all fields required, all strings)
curl -s -X PUT "https://pocket-id.marcus-e.workers.dev/api/application-configuration" \
  -H "X-API-Key: <REDACTED — use `npx wrangler secret list` to retrieve>" \
  -H "Content-Type: application/json" \
  -d '{"appName":"Pocket ID","sessionDuration":"480","homePageUrl":"/settings/account","smtpTls":"none",...}'
```

### Pocket ID User Management

```bash
# List users
curl -s "https://pocket-id.marcus-e.workers.dev/api/users" \
  -H "X-API-Key: <REDACTED — use `npx wrangler secret list` to retrieve>"

# Create user (no email required since requireUserEmail=false)
curl -s -X POST "https://pocket-id.marcus-e.workers.dev/api/users" \
  -H "X-API-Key: <REDACTED — use `npx wrangler secret list` to retrieve>" \
  -H "Content-Type: application/json" \
  -d '{"username":"marcus","firstName":"Marcus","lastName":"Estes","email":"marcus@example.com","isAdmin":true}'
```

### KV Namespace Swap for Deploys

The Cloudflare Worker `wrangler.toml` has a default KV namespace ID. When deploying the `toe` app, you must swap:

```bash
WORKER_DIR="skills/cloudflare/worker"
cd "$WORKER_DIR"

# Swap to toe's KV namespace
sed -i '' 's/id = "d6dc66d0615b4b88a07855d4e5a0f3d2"/id = "b0ce9c195c1347cebaea6c3194ea3183"/' wrangler.toml

# Deploy from worker dir (avoids workerd binary scan)
npx wrangler deploy --name toe --config ./wrangler.toml

# RESTORE original
sed -i '' 's/id = "b0ce9c195c1347cebaea6c3194ea3183"/id = "d6dc66d0615b4b88a07855d4e5a0f3d2"/' wrangler.toml
```

**Deploy from the worker directory** with `--config ./wrangler.toml` — deploying from the worktree root causes "asset too large" errors because wrangler scans the 94MB workerd binary in node_modules.

### WebAuthn / Passkey Quirks

- Pocket ID v2 does NOT have `/api/webauthn/login/begin` — challenge initiation happens via SvelteKit form actions (`POST /login?/passkey`)
- The worker previously had a `begin → start` rewrite that was wrong — it's been removed
- After container restart, all passkey registrations are lost. Users must re-register via the Pocket ID UI

### Env Vars vs DB Config

Pocket ID has environment variables like `ALLOW_USER_SIGNUPS=open`, but the application reads config from its SQLite database. On a fresh container boot:
1. Env vars may or may not seed the DB defaults (inconsistent in v2)
2. The `ensureAppConfig()` middleware calls the admin API as a belt-and-suspenders fix
3. Both mechanisms are in place; the API call is the reliable one

## Current State (as of last session)

| Component | Status |
|-----------|--------|
| Pocket ID Worker | Deployed, auto-registration + config bootstrap working |
| App config | `allowUserSignups: open`, email codes enabled |
| OIDC client | `vibes-test-app` (ID: `0bfd7b72-ff95-4d7a-a279-2dc16a5284d5`) |
| User `marcus` | Exists but has NO passkeys (container restarted) |
| Dashboard JWKS | Updated to kid `8WMK5Mo-iNA` |
| Test app (toe) | Deployed, OIDC redirect works |
| Cloud sync | Works when JWKS key matches |

## Likely Next Steps

1. **Test the full auth flow in browser** — go to `https://toe.marcus-e.workers.dev/`, sign in via Pocket ID, register a passkey
2. **Handle JWKS key rotation** — either automate updating `CLERK_PUB_JWT_KEY` secrets when the key changes, or find a way to persist the Pocket ID keypair across restarts
3. **User auto-creation** — add user auto-creation to the worker middleware (like we did for OIDC clients and app config) so a default admin user exists after restart
4. **Persistent storage** — investigate Cloudflare Durable Object storage or R2 for persisting the SQLite database across container restarts
5. **Generalize for production** — the `POCKET_ID_DEFAULT_CLIENTS` config currently only has the test app; production would need dynamic client registration

## Commits on This Branch

```
a10aff8 Add bootstrap-resilient app config to Pocket ID worker
7cd66f3 Fix OIDC auth pipeline: JWKS verification, auto-registration, preview mode
7673fca Fix editor preview and deploy pipeline for OIDC migration
d42f34c Fix post-merge Clerk remnants across codebase
589756b Merge main into Pocket ID branch (Connect-on-Cloudflare integration)
```
