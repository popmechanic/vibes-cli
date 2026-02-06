---
name: test
description: End-to-end integration test — assembles a fixture, deploys Connect + Cloudflare, and presents a live URL for browser verification
license: MIT
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

## Integration Test Skill

Orchestrates the full test pipeline: credentials → Connect studio → fixture assembly → Cloudflare deploy → live URL.

**Working directory:** `test-vibes/` (gitignored, persists across runs)

### Phase 1: Credentials

Check if `test-vibes/.env` exists and has Clerk keys.

```bash
# From the plugin root
cat test-vibes/.env 2>/dev/null
```

**If the file exists and contains `VITE_CLERK_PUBLISHABLE_KEY`:**

```
AskUserQuestion:
  Question: "Reuse existing test credentials? (publishable key: pk_test_...)"
  Header: "Credentials"
  Options:
  - Label: "Yes, reuse"
    Description: "Use the Clerk keys already in test-vibes/.env"
  - Label: "No, enter new keys"
    Description: "I want to use different Clerk credentials"
```

**If the file doesn't exist or keys are missing, or user wants new keys:**

```
AskUserQuestion:
  Question: "Paste your Clerk Publishable Key (starts with pk_test_ or pk_live_)"
  Header: "Clerk PK"
  Options:
  - Label: "I need to get keys first"
    Description: "I'll go to clerk.com and come back"
```

If they need keys, tell them:
> Go to [clerk.com](https://clerk.com) → your application → API Keys → copy Publishable Key and Secret Key.

Then ask for the secret key:

```
AskUserQuestion:
  Question: "Paste your Clerk Secret Key (starts with sk_test_ or sk_live_)"
  Header: "Clerk SK"
```

Write `test-vibes/.env`:
```
VITE_CLERK_PUBLISHABLE_KEY=<key>
VITE_CLERK_SECRET_KEY=<key>
```

### Phase 2: Connect Studio

Check if `test-vibes/.connect` exists (marks a deployed studio).

```bash
cat test-vibes/.connect 2>/dev/null
```

**If `.connect` exists:** Read the studio name and API/Cloud URLs. Confirm reuse:

```
AskUserQuestion:
  Question: "Reuse existing Connect studio '<name>'?"
  Header: "Connect"
  Options:
  - Label: "Yes, reuse"
    Description: "Studio is already running"
  - Label: "No, deploy fresh"
    Description: "Deploy a new Connect studio"
```

**If `.connect` doesn't exist or user wants fresh deploy:**

Run the deploy script. Read the Clerk keys from `test-vibes/.env` first:

```bash
node scripts/deploy-connect.js \
  --studio vibes-test-studio \
  --clerk-publishable-key "$VITE_CLERK_PUBLISHABLE_KEY" \
  --clerk-secret-key "$VITE_CLERK_SECRET_KEY"
```

After deploy, save the studio info:

```bash
# Write connect marker
echo "vibes-test-studio" > test-vibes/.connect
```

Update `test-vibes/.env` with the Connect URLs:
```
VITE_API_URL=https://vibes-test-studio.exe.xyz/api
VITE_CLOUD_URL=fpcloud://vibes-test-studio.exe.xyz?protocol=wss
```

### Phase 3: Fixture Selection

```
AskUserQuestion:
  Question: "Which fixture to test?"
  Header: "Fixture"
  Options:
  - Label: "fireproof-basic (Recommended)"
    Description: "Fireproof CRUD with React singleton — the standard integration test"
  - Label: "minimal"
    Description: "Template + Babel + import map only — fastest, no Fireproof"
  - Label: "sell-ready"
    Description: "useTenant() + multi-tenant routing — tests sell assembly path"
  - Label: "ai-proxy"
    Description: "/api/ai/chat endpoint + CORS — requires OpenRouter key"
```

**For sell-ready fixture:** Collect additional configuration:

```
AskUserQuestion:
  Question: "Paste your Clerk user ID for admin access (find it in Clerk Dashboard → Users)"
  Header: "Admin ID"
  Options:
  - Label: "I need to find it"
    Description: "Go to clerk.com → your app → Users → click your user → copy User ID (starts with user_)"
  - Label: "Skip admin"
    Description: "Deploy without admin access configured"
```

Save the admin user ID for use in Phase 4.

### Phase 4: Assembly

Copy the selected fixture and assemble:

```bash
# Copy fixture to working directory
cp scripts/__tests__/fixtures/<fixture>.jsx test-vibes/app.jsx

# Source env for assembly
set -a && source test-vibes/.env && set +a
```

**For sell-ready fixture:**
```bash
node scripts/assemble-sell.js test-vibes/app.jsx test-vibes/index.html \
  --domain vibes-test.exe.xyz \
  --admin-ids '["<admin-user-id>"]'
```
If admin was skipped, omit `--admin-ids`. The `--domain` flag is always required.

**For all other fixtures:**
```bash
node scripts/assemble.js test-vibes/app.jsx test-vibes/index.html
```

**Validate the output** (same checks as the vitest suite):
1. File exists and is non-empty
2. No `__PLACEHOLDER__` strings remain
3. Import map `<script type="importmap">` is present
4. `<script type="text/babel">` contains the fixture code
5. For sell-ready: `getRouteInfo` function is present

If any check fails, report the error, then ask:

```
AskUserQuestion:
  Question: "What next?"
  Header: "Next"
  Options:
  - Label: "Test another fixture"
    Description: "Go back to Phase 3 and pick a different fixture"
  - Label: "End test session"
    Description: "Clean up artifacts and finish"
```

If "Test another fixture": go to Phase 3.
If "End test session": go to Phase 11.

### Phase 5: Deploy to Cloudflare

**For ai-proxy fixture:** Ask for OpenRouter key first:

```
AskUserQuestion:
  Question: "Paste your OpenRouter API key for the AI proxy"
  Header: "AI Key"
  Options:
  - Label: "Skip AI proxy"
    Description: "Deploy without AI endpoint"
```

Run the deploy:

```bash
node scripts/deploy-cloudflare.js --name vibes-test --file test-vibes/index.html
```

**For sell-ready fixture:** Pass `--clerk-key` to configure JWT verification secrets on the Worker (required for `/claim` endpoint):
```bash
node scripts/deploy-cloudflare.js --name vibes-test --file test-vibes/index.html \
  --clerk-key $VITE_CLERK_PUBLISHABLE_KEY
```
Read the publishable key from `test-vibes/.env`. The `--clerk-key` flag automatically fetches the JWKS, converts to PEM, and sets `CLERK_PEM_PUBLIC_KEY` and `PERMITTED_ORIGINS` as Worker secrets.

**For ai-proxy with key:**
```bash
node scripts/deploy-cloudflare.js --name vibes-test --file test-vibes/index.html --ai-key <key>
```

### Phase 6: Present URL

Print the live URL and what to check:

**For minimal / fireproof-basic:**
```
Deployed! Open in your browser:
  https://vibes-test.<account>.workers.dev

What to verify:
- Page loads without console errors
- (fireproof-basic) CRUD operations work — add, edit, delete items
- Settings gear icon opens the menu
```

**For sell-ready:**
```
Deployed! Open these URLs:
  Landing:  https://vibes-test.<account>.workers.dev
  Tenant:   https://vibes-test.<account>.workers.dev?subdomain=test
  Admin:    https://vibes-test.<account>.workers.dev?subdomain=admin

What to verify:
- Landing page shows pricing/marketing content
- Claim a subdomain — should succeed (tests /claim + JWT auth)
- Tenant URL shows auth gate (Clerk sign-in)
- Admin URL shows admin dashboard (if --admin-ids was configured)
- Admin URL shows "Admin Access Required" (if --admin-ids was skipped)
```

**For ai-proxy:**
```
Deployed! Open in your browser:
  https://vibes-test.<account>.workers.dev

What to verify:
- App loads and renders
- AI chat feature works (sends to /api/ai/chat)
- Check Network tab: requests go to OpenRouter via proxy
```

Then ask:

```
AskUserQuestion:
  Question: "How does it look?"
  Header: "Result"
  Options:
  - Label: "Working"
    Description: "Everything renders correctly"
  - Label: "Has issues"
    Description: "Something isn't right — I'll describe it"
```

**If "Working":**

Print a summary table:

```
| Phase       | Status |
|-------------|--------|
| Credentials | ✓      |
| Connect     | ✓ <studio-name>.exe.xyz |
| Assembly    | ✓ <fixture>.jsx → index.html |
| Cloudflare  | ✓ <url> |
| Browser     | ✓ User confirmed working |
```

```
AskUserQuestion:
  Question: "What next?"
  Header: "Next"
  Options:
  - Label: "Test another fixture"
    Description: "Go back to Phase 3 and pick a different fixture"
  - Label: "End test session"
    Description: "Clean up artifacts and finish"
```

If "Test another fixture": go to Phase 3.
If "End test session": go to Phase 11.

**If "Has issues":** proceed to Phase 7.

---

### Phase 7: Diagnosis

**You are a plugin developer testing your own code.** The test instance is disposable. Bugs found here are bugs in plugin source code — deploy scripts, templates, assembly logic, or skill instructions. Fix the plugin source, NOT the test instance.

Ask the user to describe the issue. Then work through these diagnostic steps. Skip ahead when diagnosis is clear.

**7.1 Browser console** — ask the user to check, or use browser automation tools if available:

| Console Error | Likely Cause | Check File |
|---------------|-------------|------------|
| `Cannot read properties of null (reading 'useContext')` | Duplicate React instances | `skills/_base/template.html` import map |
| `Failed to fetch` / CORS errors | Deploy script wrong URL or missing CORS headers | `scripts/deploy-connect.js`, `scripts/deploy-cloudflare.js` |
| `Fireproof is not defined` | Missing import map entry | `skills/_base/template.html` import map |
| `Unexpected token '<'` | Babel script block malformed | `scripts/assemble.js` |
| 404 on `/api/` routes | nginx config or Connect not running | `scripts/deploy-connect.js` |

**7.2 Network requests** — probe the deployed services:

```bash
# Test Connect Studio API
curl -v https://<studio>.exe.xyz/api/

# Test Cloudflare Worker
curl -v https://vibes-test.<account>.workers.dev/
```

**7.3 Server-side** — SSH into the VM if network probes fail:

```bash
ssh <studio>.exe.xyz "docker ps"           # Check containers running
ssh <studio>.exe.xyz "sudo nginx -t"       # Check nginx config
ssh <studio>.exe.xyz "docker logs gateway"  # Check gateway logs
```

**7.4 Plugin source** — map symptoms to source files:

| Symptom Category | Files to Read |
|-----------------|---------------|
| Assembly/template | `scripts/assemble.js`, `skills/_base/template.html`, relevant `template.delta.html` |
| Deploy/hosting | `scripts/deploy-connect.js`, `scripts/deploy-cloudflare.js`, `scripts/deploy-exe.js` |
| Auth/Clerk | `skills/_base/template.html` (Clerk script), `scripts/deploy-connect.js` (env vars) |
| Import/module errors | `skills/_base/template.html` (import map), `cache/import-map.json` |

### Phase 8: Root Cause Classification

Before touching any file, state the classification:

| Category | Signal | Fix Target | Example |
|----------|--------|-----------|---------|
| **A: Plugin source bug** | Deploy script produces wrong output | `scripts/*.js` | `deploy-connect.js` writes wrong URL |
| **B: Template bug** | HTML output is structurally wrong | `skills/_base/template.html` or `template.delta.html` | Missing import map entry |
| **C: Skill instruction bug** | Agent followed wrong steps | `skills/*/SKILL.md` | Wrong hook name in instructions |
| **D: Fixture bug** | Only this fixture fails | `scripts/__tests__/fixtures/` | Bad JSX in test fixture |
| **E: External/transient** | VM down, CDN outage, rate limit | None — retry | esm.sh 503, VM unreachable |

```
AskUserQuestion:
  Question: "I believe this is Category <X>: <description>. The fix belongs in <file>. Proceed?"
  Header: "Fix plan"
  Options:
  - Label: "Yes, fix it"
    Description: "Apply the fix to plugin source"
  - Label: "Wrong diagnosis"
    Description: "I think the problem is something else"
```

If "Wrong diagnosis": ask what they think and re-diagnose.

### Phase 9: Apply Fix and Verify

**Fix the plugin source file, NOT the test instance.**

1. Apply the fix to the identified source file
2. If the fix touched templates or components, regenerate:
   ```bash
   node scripts/merge-templates.js --force   # If template.html or delta changed
   node scripts/build-components.js --force  # If components/ changed
   ```
3. Re-run from the appropriate phase:

| Category | Restart From |
|----------|-------------|
| A: Plugin source | Phase that uses the fixed script (2, 4, or 5) |
| B: Template | Phase 4 (re-assemble) |
| C: Skill instruction | Note the fix — no re-run needed |
| D: Fixture | Phase 4 (re-assemble) |
| E: External | Retry the failed phase |

4. Present the URL and ask:

```
AskUserQuestion:
  Question: "How does it look now?"
  Header: "Verify"
  Options:
  - Label: "Fixed"
    Description: "The issue is resolved"
  - Label: "Still broken"
    Description: "Same problem persists"
  - Label: "Different issue"
    Description: "Original issue fixed but something else is wrong"
```

If "Still broken" or "Different issue": loop back to Phase 7. After 3 loops, say:
> This needs hands-on investigation. Here's what I've tried so far: <summary>. Try debugging manually or open an issue.

Then ask:

```
AskUserQuestion:
  Question: "What next?"
  Header: "Next"
  Options:
  - Label: "Test another fixture"
    Description: "Go back to Phase 3 and pick a different fixture"
  - Label: "End test session"
    Description: "Clean up artifacts and finish"
```

If "Test another fixture": go to Phase 3.
If "End test session": go to Phase 11.

### Phase 10: Resolution Summary

Write `test-vibes/FIX-REPORT.md`:

```markdown
# Fix Report

**Date:** <date>
**Fixture:** <fixture>
**Category:** <A-E>

## Symptom
<What the user reported>

## Root Cause
<What was actually wrong>

## Fix
- **File:** <path>
- **Change:** <one-line description>

## Diagnosis Commands
<Commands that revealed the issue>

## Prevention
<How to avoid this in the future>
```

```
AskUserQuestion:
  Question: "What next?"
  Header: "Next"
  Options:
  - Label: "Test another fixture"
    Description: "Go back to Phase 3 with the fix in place"
  - Label: "Commit the fix"
    Description: "Review and commit the plugin source changes"
  - Label: "End test session"
    Description: "Clean up artifacts and finish"
```

If "Commit the fix": show `git diff` of plugin source changes (exclude `test-vibes/`), suggest a commit message derived from the fix report. After committing, show the canonical prompt:

```
AskUserQuestion:
  Question: "What next?"
  Header: "Next"
  Options:
  - Label: "Test another fixture"
    Description: "Go back to Phase 3 and pick a different fixture"
  - Label: "End test session"
    Description: "Clean up artifacts and finish"
```

If "Test another fixture": go to Phase 3.
If "End test session": go to Phase 11.

### Phase 11: Session Cleanup

Triggered when user selects "End test session" from any "What next?" prompt.

Clean up test artifacts while preserving reusable credentials:

```bash
# Clean test artifacts, preserve .env and .connect
cd test-vibes && find . -maxdepth 1 ! -name '.' ! -name '.env' ! -name '.connect' -exec rm -rf {} +
```

Print:

```
Test session complete.
  Cleaned: test-vibes/ artifacts
  Preserved: .env, .connect (reusable next session)
```
