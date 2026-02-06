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
node scripts/assemble-sell.js test-vibes/app.jsx test-vibes/index.html
```

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

If any check fails, report the error and stop.

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

If ai-proxy with key:
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
- Tenant URL shows auth gate (Clerk sign-in)
- Admin URL shows admin dashboard
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

If "Has issues": help debug based on user's description.
