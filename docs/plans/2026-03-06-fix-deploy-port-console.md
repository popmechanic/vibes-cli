# Fix Deploy Crash, Port Flag, and Console Noise

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three bugs in the vibes-skill plugin: (1) alchemy deploy crash on first deploy due to env var mismatch, (2) preview server ignoring `--port` flag and `PORT` env var, (3) console noise from 404s and empty Connect URLs in the editor.

**Architecture:** Problem 1 is an env var name mismatch between `buildAlchemyEnv` and upstream `alchemy.run.ts` (which now expects `OIDC_AUTHORITY` instead of `CLERK_PUB_JWT_URL`). Problem 2 is a missing `PORT` env var fallback in `loadConfig()`. Problem 3 requires suppressing 404 responses and server-side warnings when no app is generated yet, and guarding both the vibes and sell templates' `ClerkFireproofProvider` config against empty Connect URLs.

**Tech Stack:** Node.js, vitest

---

### Task 1: Fix alchemy env var mismatch — `OIDC_AUTHORITY`

**Context:** Upstream `alchemy.run.ts` was updated to use `OIDC_AUTHORITY` (a Clerk JWKS URL) instead of `CLERK_PUB_JWT_URL`. It also references `OIDC_AUTHORITY` in multiple bindings. Our `buildAlchemyEnv()` still sets `CLERK_PUB_JWT_URL`, which alchemy.run.ts never reads. The result: `process.env.OIDC_AUTHORITY` is `undefined`, the non-null assertion `!` in alchemy.run.ts throws at runtime.

**Files:**
- Modify: `scripts/lib/alchemy-deploy.js:86-106`
- Test: `scripts/__tests__/unit/alchemy-deploy.test.js` (two existing tests need updating)

**Step 1: Update the unit tests to expect `OIDC_AUTHORITY`**

In `scripts/__tests__/unit/alchemy-deploy.test.js`, two tests reference `CLERK_PUB_JWT_URL`:

1. The `'generates required environment variables'` test (line 107-122) — add an assertion for `OIDC_AUTHORITY` and verify `CLERK_PUB_JWT_URL` is no longer set:

```javascript
// In the 'generates required environment variables' test:
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
  expect(env.CLOUD_SESSION_TOKEN_SECRET).toBe('token-sec');
  expect(env.ALCHEMY_PASSWORD).toBe('pass123');
  // CLERK_PUB_JWT_URL removed — upstream now uses OIDC_AUTHORITY
  expect(env.CLERK_PUB_JWT_URL).toBeUndefined();
});
```

2. The `'derives CLERK_PUB_JWT_URL from publishable key'` test (lines 139-156) — rename it to test `OIDC_AUTHORITY` instead:

```javascript
it('derives OIDC_AUTHORITY from publishable key', () => {
  // pk_test_ prefix + base64("example.clerk.accounts.dev$")
  const domain = 'example.clerk.accounts.dev';
  const b64 = Buffer.from(domain + '$').toString('base64');
  const pk = `pk_test_${b64}`;

  const env = alchemyDeploy.buildAlchemyEnv({
    clerkPublishableKey: pk,
    clerkSecretKey: 'sk_test_xyz',
    sessionTokenPublic: 'tp',
    sessionTokenSecret: 'ts',
    deviceCaPrivKey: 'dp',
    deviceCaCert: 'dc',
    alchemyPassword: 'pw'
  });

  expect(env.OIDC_AUTHORITY).toBe(`https://${domain}`);
  expect(env.CLERK_PUB_JWT_URL).toBeUndefined();
});
```

**Step 2: Run the tests to confirm they fail**

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

**Step 4: Run the tests to confirm they pass**

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

### Task 4: Suppress client-side console noise for empty Connect URLs in vibes and sell templates

**Context:** When `populateConnectConfig()` replaces `__VITE_CLOUD_URL__` and `__VITE_API_URL__` with empty strings, the template passes `{ apiUrl: "", cloudUrl: "" }` to `ClerkFireproofProvider`. This causes Fireproof internals to attempt connections to empty/invalid URLs, generating "unsupported protocol" and "notfound" console errors in the browser.

Both the vibes and sell delta templates have this problem. Each passes config unconditionally to `ClerkFireproofProvider`.

**Files:**
- Modify: `skills/vibes/template.delta.html:62-68`
- Modify: `skills/sell/template.delta.html:1788-1794`
- Regenerate: `skills/vibes/templates/index.html` (via merge-templates.js)
- Regenerate: `skills/sell/templates/unified.html` (via merge-templates.js)

**Step 1: Guard `ClerkFireproofProvider` config in the vibes delta template**

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

**Step 2: Apply the same guard in the sell delta template**

In `skills/sell/template.delta.html`, the `ClerkFireproofProvider` receives config on lines 1788-1794:

```jsx
<ClerkFireproofProvider
  publishableKey={publishableKey}
  config={{
    apiUrl: vibesConfig.tokenApiUri,
    cloudUrl: vibesConfig.cloudBackendUrl
  }}
>
```

Change to:

```jsx
<ClerkFireproofProvider
  publishableKey={publishableKey}
  config={vibesConfig.tokenApiUri && vibesConfig.cloudBackendUrl ? {
    apiUrl: vibesConfig.tokenApiUri,
    cloudUrl: vibesConfig.cloudBackendUrl
  } : undefined}
>
```

**Step 3: Rebuild both merged templates**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/fix-deploy-port-console && node scripts/merge-templates.js --force`

Verify vibes: `grep -A5 'ClerkFireproofProvider' skills/vibes/templates/index.html | head -8` should show the new conditional config.

Verify sell: `grep -A5 'ClerkFireproofProvider' skills/sell/templates/unified.html | head -8` should show the new conditional config with `vibesConfig`.

**Step 4: Run structural tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/fix-deploy-port-console/scripts && npm run test:fixtures`
Expected: PASS

**Step 5: Commit**

```bash
git add skills/vibes/template.delta.html skills/vibes/templates/index.html \
       skills/sell/template.delta.html skills/sell/templates/unified.html
git commit -m "Guard ClerkFireproofProvider against empty Connect URLs

Pass config as undefined when URLs are empty strings in both vibes
and sell templates, preventing Fireproof from attempting connections
to invalid URLs pre-deploy."
```

---

### Task 5: Return 200 placeholder for `/app-frame` when no app exists

**Context:** `serveAppFrame` in `scripts/server/routes.js` (lines 73-82) returns a 404 when `app.jsx` doesn't exist. This 404 shows as a red error in the browser console when the editor iframe loads `/app-frame` before any app has been generated. The `assembleAppFrame` function in `generate.js` already handles the missing-app case gracefully (returning a placeholder HTML page), but `serveAppFrame` short-circuits with a 404 before ever calling it.

**Files:**
- Modify: `scripts/server/routes.js:73-82`

**Step 1: Change `serveAppFrame` to return a 200 with a placeholder page**

In `scripts/server/routes.js`, replace lines 73-82:

```javascript
function serveAppFrame(ctx, req, res) {
  const appPath = join(ctx.projectRoot, 'app.jsx');
  if (!existsSync(appPath)) {
    res.writeHead(404);
    return res.end('app.jsx not found');
  }
  const assembled = assembleAppFrame(ctx);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  return res.end(assembled);
}
```

Replace with:

```javascript
function serveAppFrame(ctx, req, res) {
  const appPath = join(ctx.projectRoot, 'app.jsx');
  if (!existsSync(appPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!DOCTYPE html>
<html><head><style>
  body { margin: 0; display: flex; align-items: center; justify-content: center;
         height: 100vh; font-family: system-ui; color: #888; background: #1a1a1a; }
</style></head>
<body><p>Waiting for app to be generated...</p></body></html>`);
  }
  const assembled = assembleAppFrame(ctx);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  return res.end(assembled);
}
```

This returns a friendly placeholder with a 200 status instead of a 404, eliminating the red console error in the browser.

**Step 2: Commit**

```bash
git add scripts/server/routes.js
git commit -m "Return 200 placeholder for /app-frame when no app exists

Show a 'waiting for app' message in the iframe instead of a 404,
eliminating red console errors before the first app is generated."
```

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
- [ ] The `'derives OIDC_AUTHORITY from publishable key'` test passes (was `'derives CLERK_PUB_JWT_URL...'`)
- [ ] `loadConfig()` respects `PORT` env var when `--port` flag is absent
- [ ] `assembleAppFrame` only warns about missing Connect URLs once per server session
- [ ] `ClerkFireproofProvider` in vibes delta receives `undefined` config when Connect URLs are empty
- [ ] `ClerkFireproofProvider` in sell delta receives `undefined` config when Connect URLs are empty
- [ ] Merged vibes template (`skills/vibes/templates/index.html`) reflects the delta change
- [ ] Merged sell template (`skills/sell/templates/unified.html`) reflects the delta change
- [ ] `/app-frame` returns 200 with placeholder HTML when no app.jsx exists (not 404)
