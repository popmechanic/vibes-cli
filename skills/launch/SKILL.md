---
name: launch
description: Full SaaS pipeline — generates a Vibes app, adds auth + billing,
  and deploys live. Uses Agent Teams to parallelize for maximum speed.
license: MIT
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, Task, Teammate, SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet
---

**Display this ASCII art immediately when starting:**

```
░▒▓█▓▒░      ░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓███████▓▒░░▒▓██████▓▒░▒▓█▓▒░░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓█▓▒░░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓████████▓▒░
░▒▓█▓▒░      ░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓█▓▒░░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓█▓▒░░▒▓█▓▒░
░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░▒▓█▓▒░░▒▓█▓▒░
```

## Quick Navigation

- [Phase 0: Pre-Flight & Prompt Collection](#phase-0-pre-flight--prompt-collection)
- [Phase 1: Spawn Team & Parallel Work](#phase-1-spawn-team--parallel-work)
- [Phase 2: Sell Assembly](#phase-2-sell-assembly)
- [Phase 3: Deploy to Cloudflare](#phase-3-deploy-to-cloudflare)
- [Phase 4: Verify & Cleanup](#phase-4-verify--cleanup)
- [Error Handling](#error-handling)

---

## Overview

Launch orchestrates the full pipeline from prompt to live SaaS product:

```
prompt → vibes app → Clerk setup → Connect deploy → sell transform → Cloudflare deploy → browser test
```

It uses **Agent Teams** to parallelize independent steps. The key insight: app generation only needs the user's prompt, so it runs in parallel with Clerk setup (the longest manual step).

### Dependency Graph
Parallel lanes: T1 || T2->T3 || T4. All converge at T5 (assembly).

### Timing

| Step | Agent | Blocked By | Duration |
|------|-------|-----------|----------|
| Generate app.jsx | builder | prompt only | ~2-3 min |
| Clerk dashboard setup | lead (interactive) | nothing | ~5-20 min |
| Deploy Connect | infra | Clerk pk + sk | ~5-10 min |
| Sell config (remaining Qs) | lead (interactive) | app context nice-to-have | ~2 min |
| Sell assembly | lead | app.jsx + .env + all config | ~30 sec |
| Cloudflare deploy | lead | sell index.html + secrets | ~2 min |
| Browser test | lead (interactive) | deployed URL | ~1 min |

**Best case** (Clerk already configured): ~8-10 minutes total
**Typical case** (new Clerk app): ~20-25 minutes total

---

## Phase 0: Pre-Flight & Prompt Collection

### 0.1 Pre-Flight Checks

Run these checks before doing anything else:

**Check for existing .env (skip Connect if present):**
```bash
if test -f "./.env" && \
   grep -qE "^VITE_CLERK_PUBLISHABLE_KEY=pk_(test|live)_" ./.env 2>/dev/null && \
   grep -qE "^VITE_API_URL=" ./.env 2>/dev/null && \
   grep -qE "^VITE_CLOUD_URL=" ./.env 2>/dev/null; then
  echo "CONNECT_READY"
else
  echo "CONNECT_NOT_READY"
fi
```

If `CONNECT_READY`, you can skip the infra teammate and T2/T3 entirely. Read `.env` to get the existing Clerk publishable key.

**Check for existing admin user ID (skip Phase 3.5 if present):**
```bash
grep CLERK_ADMIN_USER_ID .env 2>/dev/null
```

If found, store the value and use it in Phase 2.2 assembly (`--admin-ids '["user_xxx"]'`). Phase 3.5 can be skipped.

**Check for existing app.jsx:**
If `app.jsx` exists in the working directory, ask the user whether to reuse it or regenerate.

**Check SSH key (needed for Connect):**
```bash
ls ~/.ssh/id_ed25519 ~/.ssh/id_rsa ~/.ssh/id_ecdsa 2>/dev/null | head -1
```

**Check exe.dev account (needed for Connect):**
```bash
ssh -o ConnectTimeout=5 exe.dev 2>&1 | head -3
```

**Check wrangler auth (needed for Cloudflare):**
```bash
npx wrangler whoami 2>&1
```

If wrangler is not authenticated, tell the user to run `npx wrangler login` and wait.

### 0.2 Collect Essential Information

Use AskUserQuestion to collect these three pieces upfront (enough to spawn the builder immediately):

```
Question 1: "What do you want to build? Describe the app you have in mind."
Header: "App prompt"
Options:
- Label: "Todo list"
  Description: "A simple task manager with categories and due dates"
- Label: "Photo gallery"
  Description: "A shareable photo gallery with albums and captions"
- Label: "Team dashboard"
  Description: "A metrics and status dashboard for small teams"
multiSelect: false
```

Then use a second AskUserQuestion for app identity:

```
Question 1: "What's the app name? (used for subdomain + database)"
Header: "App name"
Options:
- Label: "Derive from prompt"
  Description: "I'll generate a slug from your app description (e.g., wedding-photos)"
- Label: "Let me specify"
  Description: "I'll type in the exact name I want"
multiSelect: false

Question 2: "Where will this be deployed?"
Header: "Domain"
Options:
- Label: "Cloudflare Workers (Recommended)"
  Description: "appname.your-account.workers.dev — free, fast, global"
- Label: "Custom domain"
  Description: "I have my own domain configured"
multiSelect: false
```

If the user selects "Derive from prompt", generate a URL-safe slug from the prompt (lowercase, hyphens, no special chars, max 30 chars).

If the user selects "Custom domain", ask for the domain name.

Store these values:
- `appPrompt` - the full app description
- `appName` - URL-safe slug (e.g., `wedding-photos`)
- `domain` - where it'll live (auto-resolved for Cloudflare Workers, or user-provided custom domain)

### 0.3 Resolve Workers URL

If deploying to Cloudflare Workers (the default), resolve the full URL now — this is needed for the Clerk webhook setup in Phase 1.5:

```bash
node "{pluginRoot}/scripts/lib/resolve-workers-url.js" --name "{appName}"
```

The script outputs the full URL, e.g., `wedding-photos.marcus-e.workers.dev`. Store this as `domain`.

**Fallback**: If the script fails (e.g., wrangler not authenticated, config not found), ask the user:

```
Question: "What's your Cloudflare Workers subdomain? (Run `npx wrangler whoami` to find your account name)"
Header: "CF subdomain"
Options:
- Label: "Let me check"
  Description: "I'll run wrangler whoami and tell you"
- Label: "I know it"
  Description: "I'll type my subdomain (e.g., marcus-e)"
multiSelect: false
```

Then construct: `{appName}.{subdomain}.workers.dev`

### 0.4 Check for AI Requirements

Look for AI-related keywords in `appPrompt`:
- "chatbot", "chat with AI", "ask AI"
- "summarize", "generate", "write", "create content"
- "analyze", "classify", "recommend"
- "AI-powered", "intelligent", "smart" (in context of features)

If detected (or ambiguous), ask:

```
Question: "Does this app need AI features (chatbot, summarization, content generation)?"
Header: "AI features"
Options:
- Label: "Yes — I have an OpenRouter key"
  Description: "I'll paste my API key from openrouter.ai/keys"
- Label: "Yes — I need to get one"
  Description: "I'll sign up at openrouter.ai and get a key"
- Label: "No AI needed"
  Description: "This app doesn't need AI capabilities"
multiSelect: false
```

- If "Yes — I have an OpenRouter key" or "Yes — I need to get one": before prompting for the key, check for a cached value:

  ```bash
  grep OPENROUTER_API_KEY ~/.vibes/.env 2>/dev/null
  ```

  **If found**, offer to reuse it (mask the key, e.g., `sk-or-v1-...a3b2`):

  ```
  AskUserQuestion:
    Question: "Reuse stored OpenRouter API key? (sk-or-v1-...a3b2)"
    Header: "AI Key"
    Options:
    - Label: "Yes, reuse"
      Description: "Use the cached key from ~/.vibes/.env"
    - Label: "Enter new"
      Description: "I'll paste a different key"
  ```

  If "Yes, reuse": use the stored value. If "Enter new": collect via a follow-up AskUserQuestion, then update `~/.vibes/.env`.

  **If not found** (or user chose "Enter new"): collect the key via a follow-up AskUserQuestion. After collecting, offer to save:

  ```
  AskUserQuestion:
    Question: "Save this OpenRouter key to ~/.vibes/.env for future projects?"
    Header: "Cache"
    Options:
    - Label: "Yes, save"
      Description: "Cache the key so you don't have to paste it again"
    - Label: "No, skip"
      Description: "Use for this session only"
  ```

  If "Yes, save":
  ```bash
  mkdir -p ~/.vibes
  grep -q OPENROUTER_API_KEY ~/.vibes/.env 2>/dev/null && \
    sed -i '' 's/^OPENROUTER_API_KEY=.*/OPENROUTER_API_KEY=<new>/' ~/.vibes/.env || \
    echo "OPENROUTER_API_KEY=<new>" >> ~/.vibes/.env
  ```

  Store as `openRouterKey`.

- If "No AI needed": set `openRouterKey` to null.

If no AI keywords detected, skip this step and set `openRouterKey` to null.

---

## Phase 1: Spawn Team & Parallel Work

### 1.1 Resolve Plugin Root

Before spawning teammates, resolve `${CLAUDE_PLUGIN_ROOT}` to an absolute path. Teammates don't have this environment variable — they receive plain text prompts, so all paths must be fully resolved.

```bash
echo "${CLAUDE_PLUGIN_ROOT}"
```

Store the output as `pluginRoot`. Use this resolved path when constructing all teammate spawn prompts below (substitute `{pluginRoot}` with the actual value).

### 1.2 Spawn Team

```
Teammate.spawnTeam("launch-{appName}", "Full SaaS pipeline for {appName}")
```

### 1.3 Create Task List

Create all tasks with dependencies:

| Task | Subject | BlockedBy | Owner |
|------|---------|-----------|-------|
| T1 | Generate app.jsx from prompt | -- | builder |
| T2 | Collect Clerk credentials | -- | lead |
| T3 | Deploy Connect studio | T2 | infra |
| T4 | Collect sell config (billing, title, tagline) | -- | lead |
| T5 | Run sell assembly | T1, T3, T4 | lead |
| T6 | Deploy to Cloudflare | T5 | lead |
| T7 | Set webhook secret on Cloudflare | T6 | lead |
| T8 | Browser verification | T7 | lead |

If `CONNECT_READY` (from Phase 0), skip T2 and T3 — mark them completed immediately and don't spawn infra.

### 1.4 Spawn Builder Teammate

Spawn via `Task` tool with `team_name: "launch-{appName}"`, `name: "builder"`, `subagent_type: "general-purpose"`.

**Builder spawn prompt — include ALL of this.**

When constructing the prompt, set `{aiInstructions}` based on `openRouterKey`:
- If `openRouterKey` is set: `10. This app needs AI features. Use the \`useAI\` hook (from the template) for AI calls: \`const { callAI, loading, error } = useAI();\`. See the vibes SKILL.md "AI Features" section for the full API.`
- If `openRouterKey` is null: (leave `{aiInstructions}` empty)

```
You are the builder agent for a Vibes app launch. Your ONLY job is to generate app.jsx.

## Your Task
Generate a React JSX app based on this prompt:
"{appPrompt}"

App name: {appName}

## CRITICAL: Use useTenant() for database name
This app will become a multi-tenant SaaS. You MUST use useTenant() to get the database name:

```jsx
const { dbName } = useTenant();
const { database, useLiveQuery, useDocument } = useFireproofClerk(dbName);
```

Do NOT hardcode database names. `useTenant()` is provided by the sell template at runtime.

## Generation Rules
1. Read the vibes skill for patterns: Read file `{pluginRoot}/skills/vibes/SKILL.md`
2. Read Fireproof API docs: Read file `{pluginRoot}/cache/fireproof.txt`
3. Read style guidance: Read file `{pluginRoot}/cache/style-prompt.txt`
4. Output ONLY JSX — no HTML wrapper, no import map, no Babel script tags
5. Export a default function component: `export default function App() { ... }`
6. Use Tailwind CSS for styling (available via CDN in template)
7. All Fireproof imports come from "use-fireproof" (mapped by import map)
8. Do NOT use TypeScript syntax — pure JSX only
9. Do NOT use AskUserQuestion — you have everything you need
10. Do NOT import React or hooks — `React`, `useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`, `createContext`, `useContext` are all globally available from the template. No import statement needed.
11. Do NOT define a useTenant() fallback — `useTenant()` is provided by the sell template. Just call it directly: `const { dbName } = useTenant();`
12. Do NOT use `window.__*__` dunder patterns — hooks and globals are direct function calls, not accessed via window properties.
{aiInstructions}

## Write Output
Write the generated JSX to: ./app.jsx

## When Done
Mark your task (T1) as completed via TaskUpdate.
```

### 1.5 Lead Collects Clerk Credentials (T2) — Simultaneous With Builder

**Skip this step entirely if CONNECT_READY.**

While the builder generates app.jsx, guide the user through Clerk setup. Use AskUserQuestion for each step:

**Step 1: Clerk App Setup**
```
Question: "Do you have a Clerk app configured, or do we need to create one?"
Header: "Clerk app"
Options:
- Label: "I have one ready"
  Description: "I already have a Clerk app with passkeys and email auth enabled"
- Label: "I need to create one"
  Description: "Walk me through setting up a new Clerk app"
multiSelect: false
```

If they need to create one, walk them through:
1. Go to [clerk.com/dashboard](https://clerk.com/dashboard) and create a new application
2. Name it after the app (e.g., "Wedding Photos")
3. Enable **Email** and **Passkey** as sign-in methods
4. Under Email settings: set "Require email address" OFF, "Verify at sign-up" ON, "Email link" ON, "Email code" ON
5. Enable passkeys under "Multi-factor" or "Passkeys" section

**Step 2: Create JWT Template**
Tell the user:
> In Clerk dashboard, go to **JWT Templates** > **Create template**. Name it "fireproof". Leave the claims as default. Click **Save**.

**Step 3: Create Webhook**

Use AskUserQuestion:
```
Question: "Create a webhook in Clerk: Go to Webhooks > Add Endpoint. Set the URL to: https://{domain}/webhook — Subscribe to these events: subscription.created, subscription.updated, subscription.deleted"
Header: "Webhook"
Options:
- Label: "Webhook created"
  Description: "I've added the endpoint and subscribed to the events"
- Label: "I need help"
  Description: "I'm having trouble finding the webhooks page"
multiSelect: false
```

If "I need help": walk them through navigating Clerk dashboard > Webhooks > Add Endpoint, making sure to repeat the URL `https://{domain}/webhook`.

**Step 4: Collect Credentials**

Use AskUserQuestion:
```
Question: "Please paste your Clerk Publishable Key (starts with pk_test_ or pk_live_)"
Header: "Clerk PK"
Options:
- Label: "Paste key"
  Description: "The publishable key from Clerk dashboard > API Keys"
multiSelect: false
```

The user will type their key via "Other". Validate it starts with `pk_test_` or `pk_live_`.

Repeat for:
- **Secret Key** — starts with `sk_test_` or `sk_live_`
- **JWKS PEM Public Key** — from Clerk dashboard > API Keys > Advanced > Public Key. Must start with `-----BEGIN PUBLIC KEY-----`
- **Webhook Secret** — from Clerk dashboard > Webhooks > your endpoint > Signing Secret. Starts with `whsec_`

Save the PEM key to `clerk-jwks-key.pem`:
```bash
cat > clerk-jwks-key.pem << 'PEMEOF'
{pemKey}
PEMEOF
```

Mark T2 completed.

### 1.6 Spawn Infra Teammate (After T2 Completes)

**Skip if CONNECT_READY.**

Spawn via `Task` tool with `team_name: "launch-{appName}"`, `name: "infra"`, `subagent_type: "general-purpose"`.

**Infra spawn prompt — include ALL of this:**

```
You are the infra agent for a Vibes app launch. Your ONLY job is to deploy Fireproof Connect.

## Your Task
Deploy a Fireproof Connect studio named "{appName}-studio" using deploy-connect.js.

## Credentials
- Clerk Publishable Key: {clerkPk}
- Clerk Secret Key: {clerkSk}

## Run the Deploy Script
```bash
node "{pluginRoot}/scripts/deploy-connect.js" \
  --studio "{appName}-studio" \
  --clerk-publishable-key "{clerkPk}" \
  --clerk-secret-key "{clerkSk}"
```

## Expected Outcome
The script will create a `.env` file with these variables:
- VITE_CLERK_PUBLISHABLE_KEY
- VITE_API_URL (e.g., https://{appName}-studio.exe.xyz/api/)
- VITE_CLOUD_URL (e.g., fpcloud://{appName}-studio.exe.xyz?protocol=wss)

## Verify
Confirm the .env file exists and contains all three variables.

## When Done
Mark your task (T3) as completed via TaskUpdate.
Send a message to the lead with the .env contents.

## Rules
- Do NOT use AskUserQuestion — you have everything you need
- If the deploy fails, send the error to the lead via SendMessage
```

### 1.7 Lead Collects Sell Config (T4) — While Infra Deploys

While infra deploys Connect, collect the remaining sell config. Use AskUserQuestion:

```
Question 1: "What billing mode for your SaaS?"
Header: "Billing"
Options:
- Label: "Free (no billing)"
  Description: "Users sign up and use the app for free"
- Label: "Subscription required"
  Description: "Users must have an active subscription to access the app"
multiSelect: false

Question 2: "App display title? (shown on landing page)"
Header: "Title"
Options:
- Label: "Derive from app name"
  Description: "I'll title-case your app name (e.g., 'Wedding Photos')"
- Label: "Let me specify"
  Description: "I'll type the exact title"
multiSelect: false
```

Then ask for tagline, subtitle, and features:

```
Question: "Describe your app's tagline (short punchy phrase for the landing page)"
Header: "Tagline"
Options:
- Label: "Generate one"
  Description: "I'll create a tagline based on your app description"
- Label: "Let me write it"
  Description: "I'll provide the exact tagline"
multiSelect: false
```

Repeat similar for subtitle and features list (3-5 bullet points).

Store these values:
- `billingMode` — `"off"` or `"required"`
- `appTitle` — display title
- `tagline` — landing page tagline (can include `<br>` for line breaks)
- `subtitle` — landing page subtitle
- `features` — JSON array of feature strings

Mark T4 completed.

---

## Phase 2: Sell Assembly

**Blocked by: T1 (app.jsx), T3 (.env/Connect), T4 (sell config)**

Wait for all three tasks to complete. Check TaskList periodically.

### 2.1 Verify Inputs

Before running assembly, verify:
1. `app.jsx` exists and contains valid JSX
2. `.env` exists with `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_API_URL`, `VITE_CLOUD_URL`
3. All sell config values are collected

### 2.2 Run Sell Assembly

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble-sell.js" app.jsx index.html \
  --clerk-key "{clerkPk}" \
  --app-name "{appName}" \
  --app-title "{appTitle}" \
  --domain "{domain}" \
  --billing-mode "{billingMode}" \
  --tagline "{tagline}" \
  --subtitle "{subtitle}" \
  --features '{featuresJSON}' \
  --admin-ids '[]'
```

**Note:** Admin IDs default to `[]` here. If a `CLERK_ADMIN_USER_ID` was found in `.env` during Phase 0.1, use `--admin-ids '["user_xxx"]'` instead. Otherwise, admin access is configured in Phase 3.5 after the first deploy.

### 2.3 Validate Output

Check for leftover placeholders:
```bash
grep -c '__VITE_\|__CLERK_\|__APP_' index.html
```

If count > 0, there are unresolved placeholders. Check `.env` for missing values and re-run assembly.

Mark T5 completed.

---

## Phase 3: Deploy to Cloudflare

**Blocked by: T5 (sell assembly)**

### 3.1 Deploy

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-cloudflare.js" \
  --name "{appName}" \
  --file index.html \
  --clerk-key "{clerkPk}" \
  {aiKeyFlag}
```

When constructing this command:
- If `openRouterKey` is set: `{aiKeyFlag}` = `--ai-key "{openRouterKey}"`
- If `openRouterKey` is null: omit `{aiKeyFlag}` entirely

This automatically:
- Copies index.html + bundles to the worker
- Sets `CLERK_PEM_PUBLIC_KEY` and `PERMITTED_ORIGINS` secrets
- Sets `OPENROUTER_API_KEY` secret (if `--ai-key` provided)
- Runs `wrangler deploy`

Mark T6 completed.

### 3.2 Set Webhook Secret

The deploy script doesn't set the webhook secret. Do it manually:

```bash
echo "{webhookSecret}" | npx wrangler secret put CLERK_WEBHOOK_SECRET --name "{appName}"
```

Mark T7 completed.

---

## Phase 3.5: Admin Setup

**Skip this phase if `CLERK_ADMIN_USER_ID` was found in `.env` during Phase 0.1.**

After the initial deploy, the admin dashboard won't work yet (no admin IDs configured). Guide the user through signing up and collecting their user ID.

### 3.5.1 Guide Signup

Tell the user:
> Your app is live! Before we set up admin access, you need to create an account:
>
> 1. Open: `https://{domain}?subdomain=test`
> 2. Sign up with your email
> 3. Complete email verification (enter the code sent to your inbox)
> 4. Create a passkey when prompted
>
> Once signed up, we'll grab your user ID for admin access.

```
AskUserQuestion:
  Question: "Have you completed signup on the app?"
  Header: "Signup"
  Options:
  - Label: "Yes, signed up"
    Description: "I completed email verification and passkey creation"
  - Label: "Skip admin setup"
    Description: "I'll set up admin access later"
  multiSelect: false
```

If "Skip admin setup": proceed to Phase 4 without admin.

### 3.5.2 Collect User ID

Tell the user:
> Now let's get your admin user ID:
>
> 1. Go to [clerk.com/dashboard](https://clerk.com/dashboard)
> 2. Open your app → click **Users** in the sidebar
> 3. Click on your user (the one you just signed up with)
> 4. Copy the **User ID** shown at the top (starts with `user_`)

```
AskUserQuestion:
  Question: "Paste your Clerk User ID (starts with user_)"
  Header: "User ID"
  Options:
  - Label: "I need help finding it"
    Description: "Clerk Dashboard → your app → Users → click your name → User ID at top"
  multiSelect: false
```

The user will type their ID via "Other". Validate it starts with `user_`. If invalid, ask again.

### 3.5.3 Save & Re-deploy

1. Save user ID to the project `.env`:
   ```bash
   echo "CLERK_ADMIN_USER_ID={userId}" >> .env
   ```

2. Re-run sell assembly with admin ID:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble-sell.js" app.jsx index.html \
     --clerk-key "{clerkPk}" \
     --app-name "{appName}" \
     --app-title "{appTitle}" \
     --domain "{domain}" \
     --billing-mode "{billingMode}" \
     --tagline "{tagline}" \
     --subtitle "{subtitle}" \
     --features '{featuresJSON}' \
     --admin-ids '["user_xxx"]'
   ```

3. Re-deploy to Cloudflare:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-cloudflare.js" \
     --name "{appName}" \
     --file index.html \
     --clerk-key "{clerkPk}" \
     {aiKeyFlag}
   ```

4. Re-set webhook secret:
   ```bash
   echo "{webhookSecret}" | npx wrangler secret put CLERK_WEBHOOK_SECRET --name "{appName}"
   ```

Tell the user:
> Admin access configured! The admin dashboard should now work at:
> `https://{domain}?subdomain=admin`

---

## Phase 4: Verify & Cleanup

### 4.1 Present URLs

Tell the user:

> Your app is live! Here are the URLs to verify:
>
> - **Landing page**: `https://{domain}`
> - **Tenant test**: `https://{domain}?subdomain=test`
> - **Admin dashboard**: `https://{domain}?subdomain=admin`
>
> Open each one and confirm:
> 1. Landing page loads with your title, tagline, and features
> 2. Tenant route shows the auth gate (Clerk sign-in)
> 3. Admin route loads the admin dashboard (if Phase 3.5 was completed)

Mark T8 completed after user confirms.

### 4.2 Shutdown Teammates

After verification, shut down all teammates:

```
SendMessage type: "shutdown_request" to "builder"
SendMessage type: "shutdown_request" to "infra"
```

Wait for shutdown responses, then clean up:

```
Teammate.cleanup
```

### 4.3 Summary

Present a final summary:

```
## Launch Complete

**App**: {appTitle}
**URL**: https://{domain}
**Clerk**: {clerkPk}
**Connect**: {studioUrl}
**Billing**: {billingMode}

### What's deployed:
- Cloudflare Worker with KV registry
- Fireproof Connect studio for real-time sync
- Clerk authentication with passkeys
- Subdomain-based multi-tenancy

### Next steps:
- Configure a custom domain (see CLAUDE.md DNS section)
- Set up Clerk billing plans if using subscription mode
```

---

## Error Handling

| Failure | Recovery |
|---------|----------|
| Builder generates invalid JSX | Read app.jsx, check for TS syntax or wrong hooks, fix and re-save |
| Connect deploy fails | Infra reports error via SendMessage. Present to user with fix steps (SSH issues, VM quota) |
| Sell assembly has placeholders | Check .env for missing values, verify all config collected, re-run assembly |
| Cloudflare deploy fails | Check `npx wrangler whoami`. If not logged in, guide through `npx wrangler login` |
| Wrangler secret put fails | Retry. If persistent, have user run manually in terminal |
| Teammate goes silent (3+ min) | Send status check via SendMessage. If no response, take over the task directly |
| Builder uses hardcoded DB name | Edit app.jsx to replace hardcoded name with `useTenant()` pattern before assembly |

### Common Builder Mistakes to Watch For

After builder completes, scan app.jsx for these issues before running assembly:

1. **Hardcoded database name**: Look for `useFireproofClerk("some-name")` — must be `useFireproofClerk(dbName)` with `const { dbName } = useTenant()`
2. **TypeScript syntax**: Remove type annotations, interface declarations, `as` casts
3. **Missing export default**: Must have `export default function App()`
4. **Import statements for React**: Remove — React is globally available via import map
5. **Import statements for Fireproof**: Must use `import { useFireproofClerk } from "use-fireproof"`

---

## Skip Modes
If .env has Clerk keys -> skip T2+T3. If app.jsx exists -> skip T1. If both -> skip T1-T4, go to Phase 2.
