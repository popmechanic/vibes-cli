# Public Link Sharing — Remaining Work

## Branch
`feature/public-link-sharing` in worktree at `/Users/marcusestes/Websites/VibesCLI/vibes-skill-public-link`

## What's Done

### Phase 1: Upstream PR
- PR #1680 on `fireproof-storage/fireproof` (`fix/redeem-invite-tenant-and-service-auth`)
- `redeemInvite` now adds tenant membership for ledger invites
- Service auth (`ServiceApiToken`) for machine-to-machine API calls
- All upstream tests pass (37 passed, 1 pre-existing unrelated failure)

### Phase 2: Vibes-skill implementation
- **Deploy API types** — `SubdomainRecord` extended with `publicInvite`, `connect`, `SERVICE_API_KEY`
- **PKCE helpers** — `generateCodeVerifier`, `generateCodeChallenge` using Web Crypto API (4 tests)
- **Public link endpoint** — `POST /apps/:name/public-link` generates UUID token, stores on record, returns joinUrl
- **Join flow** — `GET /join/:app/:token` validates token, starts PKCE OIDC flow via `vibes-join` client
- **Join callback** — `GET /join/callback` exchanges auth code, adds user to Pocket ID group, adds KV collaborator, redirects to app
- **VibesPanel UI** — "Share Link" button, public-link mode with BrutalistCard feedback, "Copy Share Link" button
- **SharingBridge** — `handlePublicLinkRequest` event handler calls Deploy API, dispatches success/error events
- **Templates rebuilt** — vibes, riff, sell templates regenerated with public link handler
- **All tests pass** — 30/30 deploy-api tests, 662/664 scripts tests (2 pre-existing failures)

### E2E Verified
- App deploys with updated templates to `public-link-test.vibesos.com`
- Share Link button generates public link via Deploy API
- Join URL redirects to Pocket ID authorize (vibes-join client, PKCE S256)
- Second user authenticates on Pocket ID, gets added to group + KV collaborators
- Redirect back to app works (user sees app, can sign in)
- Invalid/expired tokens correctly rejected
- Link regeneration invalidates old tokens

## What's Remaining

### 1. Wire Connect URLs into KV subdomain record

**Problem:** The deploy script (`scripts/deploy-cloudflare.js`) stores Connect info in `~/.vibes/deployments.json` locally, but doesn't send it to the Deploy API's KV `SubdomainRecord`. The join callback checks `record.connect?.apiUrl` to create Connect invites — it's always `false`.

**Fix:** After deploying Connect, the deploy script should update the KV record with:
```json
{
  "connect": {
    "apiUrl": "https://fireproof-dashboard-{name}.marcus-e.workers.dev/api",
    "cloudBackendUrl": "https://fireproof-cloud-{name}.marcus-e.workers.dev",
    "ledgerId": "<ledger-id>"
  }
}
```

**Where to look:**
- `scripts/deploy-cloudflare.js` lines 94-132 — Connect deploy + local storage
- `deploy-api/src/index.ts` line 1006 — where callback reads `record.connect`
- Need a new Deploy API endpoint or extend the existing deploy endpoint to accept Connect URLs

**Note:** `ledgerId` isn't currently captured during deploy. The deploy script would need to query the Connect dashboard API to discover the ledger ID after provisioning, or the app would need to report it.

### 2. Set SERVICE_API_KEY Worker secret

**Problem:** The join callback uses `c.env.SERVICE_API_KEY` to create Connect invites via the dashboard's service auth. This secret isn't set on the Worker.

**Fix:**
```bash
cd deploy-api
npx wrangler secret put SERVICE_API_KEY
# Enter the same key configured on the Connect dashboard
```

The Connect dashboard needs the matching `SERVICE_API_KEY` env var. Check if the alchemy deploy sets this — if not, it needs to be added to the Connect Worker's config.

**Upstream dependency:** PR #1680 must be merged for service auth to work on the Connect dashboard.

### 3. Fix OTA (one-time-access-token) — currently non-fatal

**Problem:** `createOneTimeAccessToken` calls `POST /api/users/{userId}/one-time-access-token` on Pocket ID, which returns 500 `{"error":"Something went wrong"}`.

**Impact:** Without OTA, the user has to sign in twice — once on Pocket ID (join flow) and again on the app's auth gate. The join callback currently catches this error and redirects without OTA.

**Investigation needed:**
- Check Pocket ID logs for the 500 error
- The endpoint may not be implemented in this Pocket ID version
- Alternative: use a different mechanism for seamless sign-in (e.g., passing the ID token as a query param)

**Where:** `deploy-api/src/pocket-id.ts` lines 276-298, `deploy-api/src/index.ts` lines 1040-1055

### 4. Clean up debug code

Remove before merging:
- `deploy-api/src/index.ts` — `GET /debug/pocket-id` endpoint (near end of file)
- `deploy-api/src/index.ts` — verbose `steps[]` error reporting in join callback (replace with `console.error` only, return generic error page)

### 5. Double sign-in UX

Even after OTA is fixed, consider the UX flow:
- User clicks join link → Pocket ID sign-in (vibes-join client)
- Redirect to app with OTA → app auto-signs-in via the per-app OIDC client

The OTA bridges the two OIDC clients (vibes-join → per-app). Without it, the user faces two auth screens. If OTA can't be fixed, alternatives:
- Have the app detect the `?joined=true` query param and show a friendlier "Welcome! Sign in to start collaborating" message instead of the generic auth gate
- Skip the per-app OIDC client entirely for joined users (use vibes-join token directly)

## Test App

- **URL:** https://public-link-test.vibesos.com
- **Connect dashboard:** https://fireproof-dashboard-public-link-test.marcus-e.workers.dev/api
- **Connect cloud:** https://fireproof-cloud-public-link-test.marcus-e.workers.dev
- **Local Connect info:** `~/.vibes/deployments.json` → `apps.public-link-test.connect`

## Key Files

| File | Purpose |
|------|---------|
| `deploy-api/src/index.ts` | Public link + join endpoints |
| `deploy-api/src/pocket-id.ts` | Pocket ID admin API helpers |
| `deploy-api/src/pkce.ts` | PKCE helpers for join flow |
| `deploy-api/src/types.ts` | SubdomainRecord with publicInvite + connect |
| `components/VibesPanel/VibesPanel.tsx` | Share Link button + UI |
| `source-templates/base/template.html` | SharingBridge public link handler |
| `scripts/deploy-cloudflare.js` | Deploy script (needs Connect URL wiring) |
