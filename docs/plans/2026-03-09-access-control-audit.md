# Access Control Architecture Audit

**Date:** 2026-03-09
**Purpose:** Reference document for informing new access control features

---

## Overview

Access control for VibesOS apps spans three independent layers: Pocket ID (OIDC-level app gating), Cloudflare KV Registry (subdomain ownership and collaborator tracking), and Fireproof Connect (data-level sync). These layers are coordinated but not tightly coupled — consistency depends on dual-writes during invite flows.

---

## Layer 1: Pocket ID (OIDC Server) — App-Level Gating

**Authority:** `https://vibesos.com` (hardcoded in `scripts/lib/auth-constants.js`)

### Per-App OIDC Registration

On deploy, the Deploy API (`deploy-api/src/pocket-id.ts`) registers each app as an OIDC client:

- Client name: `vibes-${appName}`
- Callback URLs: `${deployUrl}/**`
- `isPublic: true`, `isGroupRestricted: true`
- A user group `vibes-${appName}-users` is created and linked to the client
- The deployer is auto-added to the group

### Admin API Methods

| Method | Purpose | Auth |
|--------|---------|------|
| `createApp(opts)` | Register OIDC client | X-API-Key |
| `getApp(clientId)` | Verify client exists | X-API-Key |
| `updateApp(clientId, updates)` | Ensure isGroupRestricted | X-API-Key |
| `findAppByName(name)` | Lookup by name | X-API-Key |
| `createUserGroup(opts)` | Create group | X-API-Key |
| `findUserGroupByName(name)` | Lookup group | X-API-Key |
| `addUsersToGroup(groupId, userIds)` | Add members | X-API-Key |
| `setAllowedGroups(clientId, groupIds)` | Restrict access | X-API-Key |
| `findOrCreateUser({ email })` | User lookup/creation | X-API-Key |
| `createOneTimeAccessToken(userId)` | Generate OTA | X-API-Key |

### Key Files

- `deploy-api/src/pocket-id.ts` — Pocket ID Admin API client
- `deploy-api/src/index.ts` — Deploy endpoint with OIDC registration logic (`registerAppInPocketId`)
- `scripts/lib/auth-constants.js` — Hardcoded OIDC authority and client ID
- `scripts/lib/cli-auth.js` — CLI-side OIDC login (Authorization Code + PKCE, localhost:18192 callback)

### Token Flow (CLI)

1. `getAccessToken()` checks `~/.vibes/auth.json` cache (0o600 permissions)
2. If expired (60s buffer), refreshes via `refresh_token` grant
3. If no cache, opens browser for OIDC login (5 min timeout)
4. Stores `{ accessToken, refreshToken, idToken, expiresAt }`

---

## Layer 2: Cloudflare KV Registry — Subdomain Ownership & Collaborators

**Storage:** Per-subdomain KV keys in Cloudflare Workers KV

### Data Model

```typescript
SubdomainRecord {
  ownerId: string;           // Pocket ID user sub
  claimedAt: string;         // ISO timestamp
  collaborators: Collaborator[];
  status: 'active' | 'frozen';
  frozenAt?: string;
  oidcClientId?: string;     // Per-app OIDC client
  userGroupId?: string;      // Pocket ID group ID
}

Collaborator {
  email: string;
  userId?: string;           // Pocket ID sub (set on activation)
  status: 'invited' | 'active';
  right: 'read' | 'write';
  ledgerId?: string;
  inviteId?: string;
  invitedAt: string;
  joinedAt?: string;
}
```

### API Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /check/:subdomain` | Public | Availability check (reserved, preallocated, claimed) |
| `GET /check/:subdomain/access?userId=&email=` | Public | Access check → `{ hasAccess, role, frozen }` |
| `POST /claim` | OIDC JWT | Claim subdomain (idempotent, quota-checked) |
| `POST /invite` | OIDC JWT | Add collaborator to record |

### Access Decision Logic

```javascript
// registry-logic.ts
hasAccess(record, userId) {
  if (record.ownerId === userId) → { hasAccess: true, role: "owner" }
  if (collaborator with status="active" && matching userId) → { hasAccess: true, role: "collaborator" }
  return { hasAccess: false, role: "none" }
}

// Email fallback
hasAccessByEmail(record, email) {
  // Checks collaborator array by email (any status)
}
```

### Key Files

- `skills/cloudflare/worker/src/index.ts` — Worker routes
- `skills/cloudflare/worker/src/lib/registry-logic.ts` — Access decisions, collaborator mutations
- `skills/cloudflare/worker/src/lib/kv-storage.ts` — KV read/write

---

## Layer 3: Fireproof Connect — Data-Level Sync

**Purpose:** Provisions ledger (database) access for real-time data sync between collaborators.

### How It Works

- `dashApi.inviteUser({ ticket })` sends an invite for ledger access
- `dashApi.listLedgersByUser({})` discovers accessible ledgers
- `dashApi.redeemInvite({ inviteId })` accepts pending invites
- `dashApi.ensureCloudToken({ appId, ledger })` provisions sync credentials

### Ledger Discovery (3-tier)

1. `window.__VIBES_LEDGER_MAP__[dbName]` — direct mapping (injected at deploy)
2. `window.__VIBES_SHARED_LEDGER__` — fallback for single-DB apps
3. `dashApi.listLedgersByUser()` — dynamic discovery (matches by hostname or app name)

### Key File

- `bundles/fireproof-oidc-bridge.js` — Browser OIDC bridge with DashApi, OIDCTokenStrategy, ledger routing, sync polling

---

## Invite Flow (End-to-End)

```
1. Owner clicks "Invite" in VibesPanel UI
   → DOM event 'vibes-share-request' { email, right }

2. SharingBridge (inside OIDCProvider) catches the event and dual-writes:

   a) Deploy API: POST /apps/:name/invite
      → Pocket ID: findOrCreateUser(email) + addUsersToGroup(groupId, [userId])
      → Generates OTA token via createOneTimeAccessToken(userId)
      → Returns invite URL: https://${name}.vibesos.com?ota=${token}

   b) Fireproof Connect: dashApi.inviteUser({ ticket })
      → Provisions ledger access for data sync

   c) KV Registry: POST /invite
      → Adds Collaborator { email, status: 'invited', right }

3. Invitee receives URL and opens it:
   → OTA token exchanged with Pocket ID → auto-login
   → dashApi.redeemInvite() → ledger access activated
   → KV collaborator status updated: 'invited' → 'active'
```

### SharingBridge Pattern

SharingBridge exists because `useVibesPanelEvents()` runs outside `OIDCProvider` (at AppWrapper top level) and can't access `dashApi`. SharingBridge lives inside the provider tree and bridges via DOM events.

---

## Browser Auth (OIDC Bridge)

### Token Storage

- sessionStorage keys: `vibes_oidc_access_token`, `vibes_oidc_refresh_token`, `vibes_oidc_id_token`, `vibes_oidc_token_expiry`
- `window.__VIBES_OIDC_TOKEN__` exposed for AI proxy calls

### React Components

| Component | Purpose |
|-----------|---------|
| `OIDCProvider` | Context managing token lifecycle, refresh timers |
| `SignedIn` / `SignedOut` | Conditional rendering gates |
| `SignInButton` / `UserButton` | UI primitives |
| `useUser()` | Returns `{ isSignedIn, isLoaded, user }` |
| `useOIDCContext()` | Full context access (used by SharingBridge) |

### Template Config Injection

```javascript
window.__VIBES_CONFIG__ = {
  tokenApiUri: "__VITE_API_URL__",
  cloudBackendUrl: "__VITE_CLOUD_URL__",
  oidcAuthority: "__VITE_OIDC_AUTHORITY__",    // vibesos.com
  oidcClientId: "__VITE_OIDC_CLIENT_ID__",      // Per-app client ID
  deployApiUrl: "__VITE_DEPLOY_API_URL__"
}
```

---

## Current Access Roles

| Role | Source | Capabilities |
|------|--------|-------------|
| **Owner** | `record.ownerId === userId` | Deploy, invite, full data access |
| **Collaborator (write)** | `collaborator.right === 'write'` | Data read/write via sync |
| **Collaborator (read)** | `collaborator.right === 'read'` | Data read via sync |
| **None** | Not in group or registry | Blocked at OIDC sign-in |

---

## Known Gaps

| Gap | Description |
|-----|-------------|
| **No revocation** | Removing from KV registry does not remove from Pocket ID user group — user retains OIDC sign-in access |
| **No role granularity** | Only `read`/`write`; no admin/editor/viewer distinction |
| **Dual-write drift** | KV registry and Pocket ID groups can become inconsistent (no reconciliation) |
| **No audit trail** | No logging of access grants, revocations, or changes |
| **`aud` not validated** | Deploy API accepts any token from correct issuer regardless of audience |
| **Email-only fallback** | `hasAccessByEmail()` checks registry but not Pocket ID group membership |
| **No explicit accept** | Collaborators auto-added to Pocket ID group; no consent/acceptance step |
| **SessionStorage tokens** | Browser auth cleared on page close (no persistent sessions) |
| **Single authority** | All apps share `vibesos.com`; no multi-tenant OIDC support |
| **Frozen state incomplete** | `status: 'frozen'` exists but enforcement is inconsistent across layers |
