# Fix Deploy Crash, Port Flag, and Console Noise

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three bugs in the vibes-skill plugin: (1) alchemy deploy crash on first deploy due to env var mismatch, (2) preview server ignoring `--port` flag and `PORT` env var, (3) console noise from 404s and empty Connect URLs in the editor.

**Architecture:** Problem 1 is an env var name mismatch between `buildAlchemyEnv` and upstream `alchemy.run.ts` (which now expects `OIDC_AUTHORITY` instead of `CLERK_PUB_JWT_URL`). Problem 2 is a missing `PORT` env var fallback in `loadConfig()`. Problem 3 requires suppressing 404 responses and server-side warnings when no app is generated yet, and guarding the template's `ClerkFireproofProvider` config against empty Connect URLs.

**Tech Stack:** Node.js, vitest

---

### Task 1: Fix alchemy env var mismatch — `OIDC_AUTHORITY`

**Context:** Upstream `alchemy.run.ts` was updated to use `OIDC_AUTHORITY` (a Clerk JWKS URL) instead of `CLERK_PUB_JWT_URL`. It also references `OIDC_AUTHORITY` in multiple bindings. Our `buildAlchemyEnv()` still sets `CLERK_PUB_JWT_URL`, which alchemy.run.ts never reads. The result: `process.env.OIDC_AUTHORITY` is `undefined`, the non-null assertion `!` in alchemy.run.ts throws at runtime.

**Files:**
- Modify: `scripts/lib/alchemy-deploy.js:86-106`
- Test: `scripts/__tests__/unit/alchemy-deploy.test.js` (existing test for `buildAlchemyEnv`)

**Step 1: Update the unit test to expect `OIDC_AUTHORITY`**

In `scripts/__tests__/unit/alchemy-deploy.test.js`, find the `buildAlchemyEnv` test and update the assertion. The test currently checks for `CLERK_PUBLISHABLE_KEY` and `CLOUD_SESSION_TOKEN_PUBLIC`. Add an assertion for `OIDC_AUTHORITY` and verify `CLERK_PUB_JWT_URL` is no longer set.

```javascript
// In the buildAlchemyEnv test:
it('generates required environment variables', () => {
  const env = alchemyDeploy.buildAlchemyEnv({
    clerkPublishableKey: 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k',
    clerkSecretKey: 'sk_test_xyz',
    sessionTokenPublic: 'token-pub',
    sessionTokenSecret: 'token-sec',
    deviceCaPrivKey: 'ca-priv',
    deviceCaCert: 'ca-cert',
    alchemyPassword: 'pass123'
  });

  expect(env.CLERK_PUBLISHABLE_KEY).toBe('pk_test_Y2xlcmsuZXhhbXBsZS5jb20k');
  expect(env.OIDC_AUTHORITY).toMatch(/^https:\/\//);
  expect(env.CLOUD_SESSION_TOKEN_PUBLIC).toBe('token-pub');
  expect(env.ALCHEMY_PASSWORD).toBe('pass123');
  // CLERK_PUB_JWT_URL removed — upstream now uses OIDC_AUTHORITY
  expect(env.CLERK_PUB_JWT_URL).toBeUndefined();
});
```

**Step 2: Run the test to confirm it fails**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/fix-deploy-port-console/scripts && npx vitest run __tests__/unit/alchemy-deploy.test.js`
Expected: FAIL — `OIDC_AUTHORITY` is undefined, `CLERK_PUB_JWT_URL` is still set.

**Step 3: Fix `buildAlchemyEnv` in `alchemy-deploy.js`**

In `scripts/lib/alchemy-deploy.js`, lines 86-106, replace `CLERK_PUB_JWT_URL` with `OIDC_AUTHORITY`. The value is the same — the Clerk JWKS base URL derived from the publishable key.

Change line 93 from:
```javascript
    CLERK_PUB_JWT_URL: `https://${clerkDomain}`,
```
to:
```javascript
    OIDC_AUTHORITY: `https://${clerkDomain}`,
```

Remove the `CLERK_PUB_JWT_URL` key entirely — it's no longer referenced by alchemy.run.ts.

**Step 4: Run the test to confirm it passes**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/fix-deploy-port-console/scripts && npx vitest run __tests__/unit/alchemy-deploy.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/lib/alchemy-deploy.js scripts/__tests__/unit/alchemy-deploy.test.js
git commit -m "Fix alchemy deploy crash: rename CLERK_PUB_JWT_URL to OIDC_AUTHORITY

Upstream alchemy.run.ts now expects OIDC_AUTHORITY for Clerk JWKS URL.
The old CLERK_PUB_JWT_URL key was never read, causing undefined! to throw."
```

---

### Task 2: Fix preview server `--port` flag and `PORT` env var

**Context:** `scripts/server/config.js` line 20 parses `--port` from argv but ignores the `PORT` environment variable. The `PORT` env var is a standard convention. Additionally, the banner in `preview-server.js` has hardcoded column widths that assume a 4-digit port (3333), so the box art breaks with different port lengths.

**Files:**
- Modify: `scripts/server/config.js:20`
- Modify: `scripts/preview-server.js:66-78`

**Step 1: Add `PORT` env var fallback to `loadConfig()`**

In `scripts/server/config.js`, change line 20 from:
```javascript
  const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '3333', 10);
```
to:
```javascript
  const port = parseInt(
    process.argv.find((_, i, a) => a[i - 1] === '--port') ||
    process.env.PORT ||
    '3333',
    10
  );
```

Priority: `--port` flag > `PORT` env var > default 3333.

**Step 2: Fix the banner to handle variable-length ports**

In `scripts/preview-server.js`, replace the hardcoded banner (lines 66-78) with a dynamic one that adjusts to the port string length:

```javascript
  server.listen(ctx.port, () => {
    const modeLabel = ctx.mode === 'editor' ? 'Editor' : 'Preview';
    const url = `http://localhost:${ctx.port}`;
    console.log(`\nVibes ${modeLabel} Server`);
    console.log(`  Open:   ${url}`);
    console.log(`  Mode:   ${modeLabel}`);
    console.log(`  Themes: ${ctx.themes.length} loaded`);
    console.log(`  Anims:  ${ctx.animations.length} loaded`);
    console.log(`  Press Ctrl+C to stop\n`);
  });
```

This removes the fragile box-drawing that breaks with different port lengths.

**Step 3: Test manually**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/fix-deploy-port-console && PORT=3334 node scripts/preview-server.js --mode=editor 2>&1 | head -10`
Expected: Output shows `http://localhost:3334`, not `http://localhost:3333`.

Kill the server (Ctrl+C).

Run: `node scripts/preview-server.js --mode=editor --port 3335 2>&1 | head -10`
Expected: Output shows `http://localhost:3335` (flag overrides env var).

**Step 4: Commit**

```bash
git add scripts/server/config.js scripts/preview-server.js
git commit -m "Fix preview server to respect --port flag and PORT env var

Priority: --port flag > PORT env > default 3333.
Also fix banner formatting that assumed 4-digit port."
```

---

### Task 3: Suppress server-side console warnings for missing Connect URLs

**Context:** `assembleAppFrame()` in `scripts/server/handlers/generate.js` logs warnings to the server console every time `/app-frame` is requested and `.env` lacks `VITE_API_URL` / `VITE_CLOUD_URL`. Pre-deploy, these are always missing — the warnings are expected and noisy.

**Files:**
- Modify: `scripts/server/handlers/generate.js:278-283`

**Step 1: Downgrade the server-side warnings to debug-level**

In `scripts/server/handlers/generate.js`, replace lines 278-283:

```javascript
  if (!envVars.VITE_API_URL) {
    console.warn('[preview] \u26a0 VITE_API_URL missing from .env \u2014 sync will not work');
  }
  if (!envVars.VITE_CLOUD_URL) {
    console.warn('[preview] \u26a0 VITE_CLOUD_URL missing from .env \u2014 sync will not work');
  }
```

Replace with a single debug-level log (only on first request):

```javascript
  if (!envVars.VITE_API_URL || !envVars.VITE_CLOUD_URL) {
    if (!assembleAppFrame._warnedMissingConnect) {
      assembleAppFrame._warnedMissingConnect = true;
      console.log('[preview] Connect URLs not configured — sync disabled until first deploy');
    }
  }
```

This logs once instead of on every `/app-frame` reload.

**Step 2: Commit**

```bash
git add scripts/server/handlers/generate.js
git commit -m "Suppress repeated Connect URL warnings in preview server

Log once instead of on every /app-frame reload. Pre-deploy, these URLs
are always missing — repeated warnings are just noise."
```

---

### Task 4: Suppress client-side console noise for empty Connect URLs

**Context:** When `populateConnectConfig()` replaces `__VITE_CLOUD_URL__` and `__VITE_API_URL__` with empty strings, the template passes `{ apiUrl: "", cloudUrl: "" }` to `ClerkFireproofProvider`. This causes Fireproof internals to attempt connections to empty/invalid URLs, generating "unsupported protocol" and "notfound" console errors in the browser.

The fix belongs in the vibes delta template (`skills/vibes/template.delta.html`), which already has a guard for placeholder values (lines 19-29). We need to also guard against empty strings by not passing empty Connect config to the provider.

**Files:**
- Modify: `skills/vibes/template.delta.html:62-68`

**Step 1: Guard `ClerkFireproofProvider` config against empty URLs**

In `skills/vibes/template.delta.html`, the `ClerkFireproofProvider` receives config on lines 62-68:

```jsx
<ClerkFireproofProvider
  publishableKey={config.clerkPublishableKey}
  config={{
    apiUrl: config.tokenApiUri,
    cloudUrl: config.cloudBackendUrl
  }}
>
```

Change the config prop to only include URLs when they're non-empty:

```jsx
<ClerkFireproofProvider
  publishableKey={config.clerkPublishableKey}
  config={config.tokenApiUri && config.cloudBackendUrl ? {
    apiUrl: config.tokenApiUri,
    cloudUrl: config.cloudBackendUrl
  } : undefined}
>
```

When config is `undefined`, `ClerkFireproofProvider` skips sync entirely — no connection attempts, no console errors.

**Step 2: Rebuild the merged template**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/fix-deploy-port-console && node scripts/merge-templates.js --force`

Verify: `grep -A3 'ClerkFireproofProvider' skills/vibes/templates/index.html | head -8` should show the new conditional config.

**Step 3: Run structural tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/fix-deploy-port-console/scripts && npm run test:fixtures`
Expected: PASS

**Step 4: Commit**

```bash
git add skills/vibes/template.delta.html skills/vibes/templates/index.html
git commit -m "Guard ClerkFireproofProvider against empty Connect URLs

Pass config as undefined when URLs are empty strings, preventing
Fireproof from attempting connections to invalid URLs pre-deploy."
```

---

### Task 5: Suppress 404 noise for `/app.jsx` and `/app-frame` pre-generation

**Context:** The editor fetches `/app.jsx` and `/app-frame` during phase transitions. When no app has been generated yet, the server returns 404 with text bodies like "app.jsx not found". These show up in the browser console as red 404 errors and in the server logs.

The fix is two-fold:
1. In the route handlers (`routes.js`), return a graceful empty response instead of a 404 for `/app.jsx` and `/app-frame` when no app exists.
2. In the editor.html client code, the existing `if (!res.ok) return;` guard on line 3945 already handles `/app.jsx` 404s silently for version history — this is fine.

For `/app-frame`, the `assembleAppFrame` function already returns a basic HTML page when app.jsx is missing (line 264). The 404 comes from the `/app.jsx` route, not `/app-frame`. The editor's fetch of `/app.jsx` (line 3944) already checks `if (!res.ok) return;`. So the client-side noise is primarily from the iframe loading `/app-frame`, which shows the "app.jsx not found" page in the frame — not a console error.

Actually, re-reading the code: `serveAppJsx` returns a 404, and `serveAppFrame` calls `assembleAppFrame` which returns a 200 with an HTML error page when app.jsx is missing. The `/app.jsx` 404 shows in the browser Network tab but the existing `if (!res.ok) return;` suppresses it from the JS console. So the real noise is just server-side `console.warn` from step 3 above (already fixed) and the Fireproof protocol errors from step 4.

**Decision:** No additional changes needed for this task. Tasks 3 and 4 address the actual console noise. The `/app.jsx` 404 is correctly handled by the editor's existing `if (!res.ok) return;` guard.

Skip this task.

---

### Task 6: Run full test suite and verify

**Files:**
- No modifications — verification only.

**Step 1: Run all script tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/fix-deploy-port-console/scripts && npm test`
Expected: ALL PASS

**Step 2: Run structural fixture tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/fix-deploy-port-console/scripts && npm run test:fixtures`
Expected: ALL PASS

**Step 3: Verify no regressions in the alchemy-deploy test**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/fix-deploy-port-console/scripts && npx vitest run __tests__/unit/alchemy-deploy.test.js`
Expected: PASS

**Step 4: Verify the preview server starts with custom port**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/fix-deploy-port-console && timeout 3 node scripts/preview-server.js --port 4444 2>&1 || true`
Expected: Output includes `http://localhost:4444`

---

### Verification Checklist

Before claiming complete, verify all of these:

- [ ] `cd scripts && npm test` — all tests pass
- [ ] `cd scripts && npm run test:fixtures` — structural tests pass
- [ ] `buildAlchemyEnv` sets `OIDC_AUTHORITY` (not `CLERK_PUB_JWT_URL`)
- [ ] `loadConfig()` respects `PORT` env var when `--port` flag is absent
- [ ] `assembleAppFrame` only warns about missing Connect URLs once per server session
- [ ] `ClerkFireproofProvider` receives `undefined` config when Connect URLs are empty
- [ ] Merged template (`skills/vibes/templates/index.html`) reflects the delta change
