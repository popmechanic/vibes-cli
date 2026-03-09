# Public Link Sharing

**Date:** 2026-03-09
**Purpose:** Allow app owners to generate a public link that lets anyone join their app with shared data sync.

---

## Problem

Currently, sharing requires the owner to know each collaborator's email upfront. There's no way to share an app broadly — post a link in a group chat, share on social media, embed in a blog post. The owner must individually invite each person.

## Solution

Add a "Generate public link" option to the VibesPanel share UI. The link routes through the Deploy API, which authenticates the visitor via Pocket ID, adds them to the app's access group, provisions Connect (database sync) access, and redirects them into the app — signed in and syncing.

---

## Prerequisites: Upstream Dashboard PR

Two changes to `fireproof-storage/fireproof` on `selem/docker-for-all`:

### Fix: `redeemInvite` tenant membership

**File:** `dashboard/backend/public/redeem-invite.ts`

When `invite.invitedParams.ledger` is set, `redeemInvite` calls `addUserToLedger` but never `addUserToTenant`. The Cloud Backend's `ensureTendantLedger` validation then rejects the user because `selected.tenant` isn't in their `tenants[]` array.

Fix: call `addUserToTenant` with the ledger's parent `tenantId` before `addUserToLedger`. `addUserToTenant` is already idempotent.

### Feature: Service auth for machine-to-machine calls

**Files:** `core/protocols/dashboard/token.ts`, `dashboard/backend/create-handler.ts`, `dashboard/backend/utils/auth.ts`

Add `ServiceApiToken` class alongside existing `ClerkApiToken` and `DeviceIdApiToken`. Uses a compound token format: `<SERVICE_API_KEY>|<userId>|<email>` to carry identity without changing the `WithAuth` interface.

- `SERVICE_API_KEY` env var on the dashboard Worker (optional, opt-in)
- Registered in `tokenApi` as `"service"`
- `coercedVerifiedAuthUser` handles `"service"` type (same path as `"clerk"`)

This lets the Deploy API call `inviteUser` on the dashboard to create Connect invites for public link joiners.

---

## Architecture

### Owner generates a public link

```
VibesPanel                    SharingBridge              Deploy API
    |                              |                         |
    |-- "Generate public link" --> |                         |
    |                              |-- POST /apps/:name/ --> |
    |                              |   public-link           |
    |                              |   (Bearer: owner JWT)   |
    |                              |                         |-- Generate token
    |                              |                         |-- Store in KV:
    |                              |                         |   publicInvite: { token, right }
    |                              | <-- { joinUrl } --------|
    | <-- show link + Copy btn --- |                         |
```

### Visitor joins via public link

```
Visitor           Deploy API              Pocket ID         App
   |                   |                      |               |
   |-- click link ---> |                      |               |
   |   /join/:app/:tok |                      |               |
   |                   |-- validate token     |               |
   |                   |-- store OIDC state   |               |
   | <-- 302 ---------|                       |               |
   |-- authorize --------------------------> |               |
   |                                          |               |
   |   (user signs in / creates account)      |               |
   |                                          |               |
   | <-- 302 callback ---------------------- |               |
   |-- /join/callback -> |                    |               |
   |                     |-- exchange code    |               |
   |                     |-- extract identity |               |
   |                     |                    |               |
   |                     |-- addUsersToGroup ---------->      |
   |                     |-- POST inviteUser (service auth)   |
   |                     |   to Connect dashboard API         |
   |                     |-- update KV collaborators          |
   |                     |-- createOneTimeAccessToken ------> |
   |                     |                                    |
   | <-- 302 to app?ota=token --------------------------->   |
   |                                                     OTA redemption
   |                                                     ensureUser (auto-redeems invite)
   |                                                     ensureCloudToken (finds shared ledger)
   |                                                     sync starts
```

---

## Deploy API Changes

### New OIDC client: "vibes-join"

One shared OIDC client for all join flows:
- `isPublic: true`, `isGroupRestricted: false`
- Callback URL: `https://deploy.vibesos.com/join/callback`
- Auto-created on first join request, cached in KV (`config:join-client`)

### `POST /apps/:name/public-link`

Auth: Bearer token (owner). Same ownership verification as `/deploy` and `/apps/:name/invite`.

- Generates `crypto.randomUUID()` token
- Updates subdomain KV record: `publicInvite: { token, right, createdAt }`
- Returns `{ ok: true, joinUrl }`
- Calling again regenerates token (revokes old link)

### `GET /join/:app/:token`

No auth required — the token is the authorization.

- Validates token against KV subdomain record's `publicInvite.token`
- Generates PKCE `code_verifier` + `code_challenge` (crypto.subtle)
- Stores OIDC state in KV with 5-min TTL: `join-state:<uuid>`
- 302 redirect to Pocket ID authorize endpoint

### `GET /join/callback`

Pocket ID redirects here with `?code=&state=`.

- Looks up + deletes state from KV (single-use)
- Exchanges code for tokens via Pocket ID token endpoint (PKCE)
- Extracts `userId` (sub) and `email` from ID token
- Three writes:
  1. **Pocket ID:** `addUsersToGroup(record.userGroupId, [userId])`
  2. **Connect:** `inviteUser` via dashboard API with service auth
  3. **KV:** append collaborator to subdomain record
- Generates OTA: `createOneTimeAccessToken(userId)`
- 302 redirect to `https://<app>.vibesos.com?ota=<token>`

### No new env vars needed

Deploy API already has `POCKET_ID` (service binding), `POCKET_ID_API_KEY`, `REGISTRY_KV`, `CF_API_TOKEN`. The Connect dashboard URL comes from the subdomain record's `connect.apiUrl`. The `JOIN_CLIENT_ID` is auto-discovered and cached.

---

## Client-Side Changes

### VibesPanel

Add share mode selection before the existing email form:

- "Invite by email" → existing flow
- "Generate public link" → dispatches `vibes-public-link-request`
- Success shows link + Copy button in BrutalistCard (existing pattern)

### SharingBridge

Add listener for `vibes-public-link-request`. Single fetch to Deploy API `POST /apps/:name/public-link`. Dispatches `vibes-public-link-success` or `vibes-public-link-error`.

### OIDC Bridge

No changes. Existing flows handle everything:
- OTA redemption (`?ota=` detection)
- `ensureUser()` → auto `redeemInvite()`
- `ensureCloudToken()` with `__VIBES_SHARED_LEDGER__`

---

## Testing

### Upstream PR

1. **Tenant membership:** Create ledger invite → redeem → assert both `LedgerUsers` and `TenantUsers` rows exist → `ensureCloudToken` produces valid cloud token
2. **Service auth:** Call `inviteUser` with service token → assert invite created. Wrong key → 401. No key configured → rejected.

### Deploy API

3. **Public link generation:** Owner creates → token in KV. Non-owner → 403. Regenerate → old token invalid.
4. **Join start:** Valid token → 302 to Pocket ID with PKCE. Invalid token → 404.
5. **Join callback (mocked):** Assert group add, Connect invite, KV update, OTA generation, redirect to app.

### E2E

6. **Full flow:** Deploy app → generate public link → open in browser → verify redirect chain → user signed in and syncing.

---

## Risk Assessment

| Component | Risk | Mitigation |
|-----------|------|------------|
| Upstream `redeemInvite` fix | Low | Idempotent, backward-compatible |
| Upstream service auth | Low | Opt-in via env var, no existing behavior changes |
| Deploy API OIDC callback | Medium | Established pattern (same as cli-auth.js), oauth4webapi handles PKCE |
| Deploy API public-link endpoint | Low | Simple KV read/write |
| VibesPanel UI | Low | Additive, follows existing patterns |
| OIDC bridge | Zero | No changes |
