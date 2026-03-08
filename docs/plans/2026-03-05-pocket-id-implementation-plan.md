# Pocket ID Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Clerk with Pocket ID as the identity provider across the entire Vibes plugin — templates, bridge, deploy scripts, Cloudflare Worker, and env utilities.

**Architecture:** Standard OIDC authorization code flow with PKCE. Pocket ID (self-hosted, passkey-only) co-locates on the Connect Studio VM. A new `fireproof-oidc-bridge.js` replaces the Clerk bridge. Templates use redirect-based auth. Billing is stubbed (deferred to phase 2).

**Tech Stack:** Pocket ID (Go/SvelteKit OIDC provider), `oauth4webapi` (browser OIDC client), React 19, Fireproof, Vitest

**Design doc:** `docs/plans/2026-03-05-pocket-id-migration-design.md`

---

## Pre-Flight

Before starting, read these files to understand the current auth architecture:

- `docs/plans/2026-03-05-pocket-id-migration-design.md` — the full design
- `CLAUDE.md` — project conventions, template inheritance, build workflow
- `source-templates/base/template.html` — base template with import map and `__VIBES_CONFIG__`
- `skills/vibes/template.delta.html` — vibes auth gate (Clerk components)
- `bundles/fireproof-vibes-bridge.js` — current bridge wrapping `@fireproof/clerk`
- `scripts/lib/env-utils.js` — Clerk key validation and config placeholders

---

## Task 1: Update env-utils — Replace Clerk Config with OIDC Config

**Files:**
- Modify: `scripts/lib/env-utils.js`
- Test: `scripts/__tests__/unit/env-utils-oidc.test.js` (create)

**Step 1: Write failing tests for new OIDC config utilities**

Create `scripts/__tests__/unit/env-utils-oidc.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  CONFIG_PLACEHOLDERS,
  validateOIDCAuthority,
  validateOIDCClientId,
} from '../../lib/env-utils.js';

describe('OIDC config placeholders', () => {
  it('includes OIDC authority and client ID placeholders', () => {
    expect(CONFIG_PLACEHOLDERS['__VITE_OIDC_AUTHORITY__']).toBe('VITE_OIDC_AUTHORITY');
    expect(CONFIG_PLACEHOLDERS['__VITE_OIDC_CLIENT_ID__']).toBe('VITE_OIDC_CLIENT_ID');
  });

  it('does NOT include Clerk publishable key placeholder', () => {
    expect(CONFIG_PLACEHOLDERS['__VITE_CLERK_PUBLISHABLE_KEY__']).toBeUndefined();
  });
});

describe('validateOIDCAuthority', () => {
  it('accepts valid HTTPS authority URL', () => {
    expect(validateOIDCAuthority('https://studio.exe.xyz/auth')).toBe(true);
  });

  it('rejects non-HTTPS URLs', () => {
    expect(validateOIDCAuthority('http://studio.exe.xyz/auth')).toBe(false);
  });

  it('rejects empty/null', () => {
    expect(validateOIDCAuthority('')).toBe(false);
    expect(validateOIDCAuthority(null)).toBe(false);
  });
});

describe('validateOIDCClientId', () => {
  it('accepts non-empty string', () => {
    expect(validateOIDCClientId('abc-123-def')).toBe(true);
  });

  it('rejects empty/null', () => {
    expect(validateOIDCClientId('')).toBe(false);
    expect(validateOIDCClientId(null)).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/env-utils-oidc.test.js`
Expected: FAIL — functions not exported

**Step 3: Update env-utils.js**

In `scripts/lib/env-utils.js`:

1. Replace `CONFIG_PLACEHOLDERS` — remove `__VITE_CLERK_PUBLISHABLE_KEY__`, add `__VITE_OIDC_AUTHORITY__` and `__VITE_OIDC_CLIENT_ID__`
2. Remove: `validateClerkKey()`, `extractClerkDomain()`, `validateClerkSecretKey()`, `validateClerkUserId()`
3. Add: `validateOIDCAuthority(url)` — checks `url` starts with `https://`
4. Add: `validateOIDCClientId(id)` — checks non-empty string

Keep: `loadEnvFile()`, `validateOpenRouterKey()`, `validateConnectUrl()`, `deriveConnectUrls()`, `writeEnvFile()`, `populateConnectConfig()`

**Step 4: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/env-utils-oidc.test.js`
Expected: PASS

**Step 5: Fix any existing tests that reference removed Clerk functions**

Run: `cd scripts && npx vitest run`
Fix any imports of `validateClerkKey`, `extractClerkDomain`, `validateClerkSecretKey`, `validateClerkUserId` in other test files. These should be deleted from the tests too.

**Step 6: Commit**

```bash
git add scripts/lib/env-utils.js scripts/__tests__/unit/env-utils-oidc.test.js
git commit -m "Replace Clerk config with OIDC config in env-utils"
```

---

## Task 2: Update Base Template — Import Map and Config

**Files:**
- Modify: `source-templates/base/template.html`

**Step 1: Update the import map**

In `source-templates/base/template.html`, find the `<script type="importmap">` block (around line 100-117). Make these changes:

- Remove: `"@clerk/clerk-react"` entry
- Remove: `"@fireproof/clerk"` entry
- Change: `"use-fireproof": "/fireproof-vibes-bridge.js"` → `"use-fireproof": "/fireproof-oidc-bridge.js"`
- Add: `"oauth4webapi": "https://esm.sh/stable/oauth4webapi@3.3.0"`

**Step 2: Update `__VIBES_CONFIG__`**

Find the `window.__VIBES_CONFIG__` block (around line 119-124). Change:

```javascript
window.__VIBES_CONFIG__ = {
  tokenApiUri: "__VITE_API_URL__",
  cloudBackendUrl: "__VITE_CLOUD_URL__",
  oidcAuthority: "__VITE_OIDC_AUTHORITY__",
  oidcClientId: "__VITE_OIDC_CLIENT_ID__"
};
```

Remove the `clerkPublishableKey` field.

**Step 3: Update the `useAI` hook**

Find the `useAI` function in the base template. Replace the Clerk session token logic:

```javascript
// Old (Clerk):
// if (window.Clerk?.session) {
//   const token = await window.Clerk.session.getToken();
//   authHeader = { 'Authorization': 'Bearer ' + token };
// }

// New (OIDC):
let authHeader = {};
const oidcToken = window.__VIBES_OIDC_TOKEN__;
if (oidcToken) {
  authHeader = { 'Authorization': 'Bearer ' + oidcToken };
}
```

**Step 4: Rebuild templates**

Run: `node scripts/merge-templates.js --force`

**Step 5: Run structural tests**

Run: `cd scripts && npm run test:fixtures`
Expected: Some tests may fail due to changed placeholder names — update test expectations.

**Step 6: Commit**

```bash
git add source-templates/base/template.html
git commit -m "Replace Clerk with OIDC in base template import map and config"
```

---

## Task 3: Build the OIDC Bridge — `fireproof-oidc-bridge.js`

**Files:**
- Create: `bundles/fireproof-oidc-bridge.js`
- Remove (later): `bundles/fireproof-vibes-bridge.js`

**Step 1: Write the OIDC bridge**

Create `bundles/fireproof-oidc-bridge.js`. This replaces `fireproof-vibes-bridge.js`. It must:

1. Export an `OIDCProvider` React component that manages the OIDC PKCE flow
2. Export `useFireproofOIDC(name, opts)` — wraps `useFireproof` with dashApi patching (same ledger routing logic as the Clerk bridge)
3. Export `SignedIn`, `SignedOut`, `SignInButton`, `UserButton`, `useUser` components
4. Manage token lifecycle: check for `?code=` callback, exchange for tokens, store in sessionStorage, handle refresh
5. Bridge sync status to `window.__VIBES_SYNC_STATUS__` (same as Clerk bridge)
6. Handle invite auto-redemption from `?invite=` URL param (same as Clerk bridge)
7. Store access token as `window.__VIBES_OIDC_TOKEN__` for the `useAI` hook

Key implementation notes:
- Use `oauth4webapi` for the PKCE flow (import from the import map)
- The OIDC authority URL and client ID come from `window.__VIBES_CONFIG__`
- `OIDCProvider` wraps children and provides auth context via React context
- `useUser()` returns `{ user: { id, firstName, lastName, email, username, imageUrl } }` parsed from the OIDC id_token claims
- The dashApi interaction pattern stays the same — the bridge needs to call `dashApi.ensureUser()` and `dashApi.ensureCloudToken()` with the OIDC access_token as the auth credential
- Read the existing `bundles/fireproof-vibes-bridge.js` carefully — the ledger routing (3-tier), invite redemption, sync status bridge, and onTock kick logic should be preserved

The bridge should export the same interface that templates currently import:
```javascript
// Templates import these:
export { OIDCProvider }           // replaces ClerkFireproofProvider
export { SignedIn, SignedOut }    // conditional rendering
export { SignInButton }          // triggers OIDC redirect
export { UserButton }            // user menu + sign out
export { useUser }               // current user data
export { useFireproofOIDC as useFireproofClerk }  // backward-compat alias
```

**Step 2: Commit**

```bash
git add bundles/fireproof-oidc-bridge.js
git commit -m "Add OIDC bridge replacing Clerk bridge"
```

---

## Task 4: Update Vibes Template Delta

**Files:**
- Modify: `skills/vibes/template.delta.html`

**Step 1: Rewrite the vibes delta for OIDC**

Replace the entire `<script type="text/babel">` block in `skills/vibes/template.delta.html`. The new version:

1. Imports from `"use-fireproof"` (which now resolves to the OIDC bridge)
2. Uses `OIDCProvider` instead of `ClerkFireproofProvider`
3. Uses `SignedIn`/`SignedOut` from the bridge (same component names, different implementation)
4. The `initApp()` function dynamically imports from the bridge instead of `@fireproof/clerk`
5. Exports the same window globals for user app code (`window.SignedIn`, `window.useUser`, etc.)

Key changes from current delta:
- Remove all `window.ClerkFireproofProvider` / `window.ClerkComponents` references
- `AppWrapper` uses `OIDCProvider` with `authority` and `clientId` props (from `window.__VIBES_CONFIG__`)
- `AuthGate` uses `SignInButton` from bridge (triggers OIDC redirect, not Clerk modal)
- Remove `config.clerkPublishableKey` check — replace with `config.oidcAuthority` and `config.oidcClientId` check

**Step 2: Rebuild templates**

Run: `node scripts/merge-templates.js --force`

**Step 3: Commit**

```bash
git add skills/vibes/template.delta.html
git commit -m "Update vibes template delta for OIDC auth flow"
```

---

## Task 5: Update Sell Template Delta

**Files:**
- Modify: `skills/sell/template.delta.html`

**Step 1: Update sell delta CONFIG block**

Replace Clerk config with OIDC config:
```javascript
// Old:
clerkPublishableKey: "__CLERK_PUBLISHABLE_KEY__",

// New:
oidcAuthority: "__OIDC_AUTHORITY__",
oidcClientId: "__OIDC_CLIENT_ID__",
```

**Step 2: Replace Clerk auth components with OIDC equivalents**

Same pattern as the vibes delta — use `OIDCProvider`, `SignedIn`/`SignedOut` from the bridge. The sell delta is more complex because it has multi-tenant routing, but the auth components are the same.

Key changes:
- Replace `CLERK_PUBLISHABLE_KEY` references with OIDC config
- Replace Clerk user ID format (`user_xxx`) with UUID format in admin ID checks
- Replace `has({ plan: 'starter' })` billing checks with a stub that always returns true when `BILLING_MODE === 'off'`
- Keep the tenancy model (subdomain routing, registry) — just change the user ID source

**Step 3: Update `assemble-sell.js`**

Find references to Clerk placeholders (`__CLERK_PUBLISHABLE_KEY__`) and replace with OIDC placeholders (`__OIDC_AUTHORITY__`, `__OIDC_CLIENT_ID__`). Read the file first to understand the placeholder substitution pattern.

**Step 4: Rebuild templates**

Run: `node scripts/merge-templates.js --force`

**Step 5: Commit**

```bash
git add skills/sell/template.delta.html scripts/assemble-sell.js
git commit -m "Update sell template delta for OIDC auth flow"
```

---

## Task 6: Update Cloudflare Worker JWT Validation

**Files:**
- Modify: `skills/cloudflare/worker/src/lib/crypto-jwt.ts`
- Modify: `skills/cloudflare/worker/src/index.ts`

**Step 1: Generalize JWT validation**

In `crypto-jwt.ts`, rename `verifyClerkJWT` to `verifyOIDCJWT`. Change it to:
- Accept a JWKS URL parameter (instead of hardcoding Clerk's JWKS endpoint)
- Keep the RS256 verification logic (same algorithm)
- Keep `azp` validation and timing checks
- Remove Clerk-specific domain extraction

**Step 2: Update webhook handling**

In `skills/cloudflare/worker/src/index.ts`:
- Remove the Svix webhook verification for Clerk events
- Remove webhook route handlers for `subscription.created`, `subscription.updated`, `subscription.deleted`, `user.created`, `user.deleted`
- Keep the route structure but stub webhook handling for future Stripe integration (phase 2)

**Step 3: Update deploy-cloudflare.js**

Read `scripts/deploy-cloudflare.js`. Replace:
- `--clerk-key` flag → `--oidc-jwks-url` flag
- Remove Clerk JWKS fetch and PEM conversion logic
- Replace with passing the Pocket ID JWKS URL as a Worker env var
- Remove `--webhook-secret` flag (no Clerk webhooks)

**Step 4: Commit**

```bash
git add skills/cloudflare/worker/src/lib/crypto-jwt.ts skills/cloudflare/worker/src/index.ts scripts/deploy-cloudflare.js
git commit -m "Generalize Cloudflare Worker JWT validation for OIDC"
```

---

## Task 7: Update Deploy Scripts

**Files:**
- Modify: `scripts/deploy-exe.js`
- Modify: `scripts/deploy-connect.js`
- Modify: `scripts/assemble.js`

**Step 1: Update assemble.js**

Read `scripts/assemble.js`. Replace any references to `VITE_CLERK_PUBLISHABLE_KEY` placeholder with `VITE_OIDC_AUTHORITY` and `VITE_OIDC_CLIENT_ID`. The `populateConnectConfig()` call from env-utils handles the actual replacement — Task 1 already updated the placeholder map.

**Step 2: Update deploy-exe.js**

Read the full file. Replace:
- Any Clerk key validation/injection with OIDC config injection
- The HTML should have OIDC placeholders populated before upload

**Step 3: Update deploy-connect.js**

Read the full file. Add Pocket ID deployment alongside Connect:
- Add Pocket ID container to the Docker Compose configuration
- Generate `ENCRYPTION_KEY` for Pocket ID via `openssl rand -base64 32`
- Set `APP_URL` env var for Pocket ID
- Add nginx routing: `/auth/*` → Pocket ID (port 1411)
- Replace Clerk key references with OIDC authority URL

**Step 4: Commit**

```bash
git add scripts/assemble.js scripts/deploy-exe.js scripts/deploy-connect.js
git commit -m "Update deploy scripts for Pocket ID integration"
```

---

## Task 8: Update SKILL.md Files

**Files:**
- Modify: `skills/vibes/SKILL.md`
- Modify: `skills/sell/SKILL.md`
- Modify: `skills/connect/SKILL.md`
- Modify: `skills/exe/SKILL.md`
- Modify: `skills/cloudflare/SKILL.md`
- Delete: `skills/sell/CLERK-SETUP.md`

**Step 1: Update skill files**

Read each SKILL.md and replace Clerk references with Pocket ID/OIDC equivalents:

- `skills/vibes/SKILL.md` — Replace Clerk component references in code patterns. Change `ClerkFireproofProvider` → `OIDCProvider`. Change `VITE_CLERK_PUBLISHABLE_KEY` → `VITE_OIDC_AUTHORITY` + `VITE_OIDC_CLIENT_ID`.
- `skills/sell/SKILL.md` — Same replacements plus remove Clerk Commerce billing references (stub billing).
- `skills/connect/SKILL.md` — Replace Clerk key requirements with Pocket ID deployment instructions.
- `skills/exe/SKILL.md` — Update any deploy flag references.
- `skills/cloudflare/SKILL.md` — Replace `--clerk-key` with `--oidc-jwks-url`.

**Step 2: Delete CLERK-SETUP.md**

```bash
git rm skills/sell/CLERK-SETUP.md
```

**Step 3: Commit**

```bash
git add skills/*/SKILL.md
git commit -m "Update skill docs for Pocket ID migration"
```

---

## Task 9: Clean Up — Remove All Remaining Clerk References

**Step 1: Search for remaining Clerk references**

Run: `grep -ri "clerk" --include="*.js" --include="*.ts" --include="*.html" --include="*.md" --include="*.json" -l`

Exclude: `docs/plans/` (design docs reference Clerk historically), `node_modules/`, `.git/`

**Step 2: Fix each file**

For each file found:
- Remove or replace Clerk-specific code
- Update comments that reference Clerk
- Update CLAUDE.md sections about Clerk

**Step 3: Remove old bridge**

```bash
git rm bundles/fireproof-vibes-bridge.js
```

**Step 4: Update scripts/lib/auth-flows.js**

This file contains Clerk-specific state machines (`SIGNUP_STATES`, `SIGNIN_STATES`, `GATE_STATES`). Either:
- Delete the file entirely if nothing else uses it
- Or replace with OIDC-appropriate auth states

**Step 5: Update scripts/lib/jwt-validation.js**

This file is already provider-agnostic (`matchAzp`, `validateJwtTiming`, `parsePermittedOrigins`). No changes needed unless there are Clerk-specific comments.

**Step 6: Update test mocks**

Remove or update `scripts/__tests__/mocks/clerk-webhooks.js` — this creates Clerk webhook event fixtures. Delete if webhooks are fully removed.

**Step 7: Update hooks/session-context.md and hooks/session-start.sh**

Replace `.env` detection logic that looks for `VITE_CLERK_PUBLISHABLE_KEY` with checks for `VITE_OIDC_AUTHORITY` and `VITE_OIDC_CLIENT_ID`.

**Step 8: Commit**

```bash
git add -A
git commit -m "Remove all remaining Clerk references"
```

---

## Task 10: Rebuild and Run Full Test Suite

**Step 1: Rebuild all templates**

```bash
node scripts/build-components.js --force
node scripts/build-design-tokens.js --force
node scripts/merge-templates.js --force
```

**Step 2: Run unit tests**

```bash
cd scripts && npm run test:unit
```

Fix any failures. Common issues:
- Test files importing removed Clerk functions
- Snapshot tests expecting Clerk placeholder strings
- Mock fixtures referencing Clerk webhook shapes

**Step 3: Run integration tests**

```bash
cd scripts && npm run test:integration
```

Fix any failures.

**Step 4: Run structural fixture tests**

```bash
cd scripts && npm run test:fixtures
```

These validate assembled HTML output. Update expectations for:
- New placeholder names (`__VITE_OIDC_AUTHORITY__` instead of `__VITE_CLERK_PUBLISHABLE_KEY__`)
- New import map entries (`oauth4webapi` instead of `@clerk/clerk-react`)
- New bridge filename (`fireproof-oidc-bridge.js` instead of `fireproof-vibes-bridge.js`)

**Step 5: Commit any test fixes**

```bash
git add -A
git commit -m "Fix tests for Pocket ID migration"
```

---

## Task 11: Update CLAUDE.md and README

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Step 1: Update CLAUDE.md**

Replace all Clerk references in the project development guide:
- "React Singleton Problem" section — remove `@clerk/clerk-react` and `@fireproof/clerk` references, add `oauth4webapi`
- "Correct Import Map" section — update to reflect new import map entries
- "Auth Components" section — update component descriptions for OIDC flow
- "Sharing / Invite Architecture" section — update to reference OIDC bridge instead of Clerk bridge
- "File Reference" table — replace `fireproof-vibes-bridge.js` with `fireproof-oidc-bridge.js`
- "Environment Variables" references — `VITE_OIDC_AUTHORITY` and `VITE_OIDC_CLIENT_ID`

**Step 2: Update README.md**

Replace any user-facing Clerk references with Pocket ID.

**Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Update docs for Pocket ID migration"
```

---

## Verification Checkpoint

Before declaring done, verify:

1. `cd scripts && npm test` — all tests pass
2. `cd scripts && npm run test:fixtures` — structural tests pass
3. `grep -ri "clerk" --include="*.js" --include="*.ts" --include="*.html" -l` — returns only design docs and historical references
4. `node scripts/merge-templates.js --force` — templates rebuild cleanly
5. Generated `skills/vibes/templates/index.html` contains `oauth4webapi` in import map, `fireproof-oidc-bridge.js` as use-fireproof target, `oidcAuthority` in config

---

## Out of Scope (Phase 2)

These items are intentionally deferred:

- **Billing / Stripe integration** — sell template ships with `--billing-mode off`
- **Connect dashboard changes** — separate repo (`fireproof-storage/fireproof` on `selem/docker-for-all` branch)
- **Pocket ID deployment automation** — `deploy-connect.js` gets Docker Compose additions but full automation (initial setup, admin account) is phase 2
- **E2E testing with live Pocket ID** — requires deployed instance; use `/vibes:test` after infrastructure is up
