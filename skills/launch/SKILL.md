---
name: launch
description: Self-contained SaaS pipeline — invoke directly, do not decompose.
  Generates a Vibes app, adds auth + billing, and deploys live. Uses Agent Teams
  to parallelize for maximum speed.
license: MIT
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, Task, Teammate, SendMessage, TaskCreate, TaskUpdate, TaskList, TaskGet
compatibility: Requires Claude Code with Agent Teams support
metadata:
  author: "Marcus Estes"
---

> **Plan mode**: If you are planning work, this entire skill is ONE plan step: "Invoke /vibes:launch". Do not decompose the steps below into separate plan tasks.

**Display this ASCII art immediately when starting:**

```
░▒▓█▓▒░      ░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓███████▓▒░░▒▓██████▓▒ ░▒▓█▓▒░░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓█▓▒░░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓████████▓▒░
░▒▓█▓▒░      ░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓█▓▒░░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░     ░▒▓█▓▒░░▒▓█▓▒░
░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░▒▓█▓▒░░▒▓█▓▒░
```

## Notation

**Ask [Header]**: "question" means call AskUserQuestion with that header and question. Options listed as bullets. User can always type custom via "Other". When collecting a key/secret, put one option like "Paste key" — the user types the actual value via Other.

For architecture context, see `LAUNCH-REFERENCE.md` in this directory.

---

## FIRST: Terminal or Editor UI?

**This is the very first question — ask before anything else.**
**DO NOT check .env, credentials, or project state before asking this question.**
**DO NOT invoke /vibes:connect or any other skill before asking this question.**
**If Editor is chosen, skip ALL pre-flight checks — the editor handles everything.**

Ask the user:
> "How do you want to build? **Editor** (opens a browser UI with live preview, chat, and deploy button) or **Terminal** (I'll generate and deploy from here)?"

Present Editor as the first/recommended option.

- **If Editor**: Start the editor server and **END YOUR TURN. Do not ask any more questions. Do not continue to Phase 0 or any phase below.** The editor UI handles the entire workflow — setup, generation, preview, deploy.

  Launch the editor server:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/preview-server.js" --mode=editor --prompt "USER_PROMPT_HERE"
  ```
  If no prompt was given, omit `--prompt`:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/preview-server.js" --mode=editor
  ```
  Tell the user: "Open http://localhost:3333 — the editor handles everything from here."
  **Your job is done. Stop. Do not read further. Do not proceed to any phase below.**

- **If Terminal**: Continue with the pre-flight checks and normal workflow below.

---

## ⛔ EVERYTHING BELOW IS TERMINAL MODE ONLY

**If the user chose Editor above, STOP. Do not read or execute anything below this line.**
**The editor UI handles setup, generation, preview, and deployment.**

---

## Pre-Flight Decision Tree

Run all five checks before collecting any input:

| # | Check | Command | If True |
|---|-------|---------|---------|
| 1 | .env has OIDC config + Connect URLs | `grep -qE '^VITE_OIDC_AUTHORITY=' .env && grep -qE '^VITE_OIDC_CLIENT_ID=' .env && grep -qE '^VITE_API_URL=' .env && grep -qE '^VITE_CLOUD_URL=' .env` | Set `CONNECT_READY`. Read .env for oidcAuthority/clientId. Skip T2, T3, infra spawn. |
| 2 | .env has admin user ID | `grep OIDC_ADMIN_USER_ID .env` | Store value. Skip Phase 3. |
| 3 | app.jsx exists | `test -f app.jsx` | **Ask [Reuse]**: "app.jsx exists. Reuse it or regenerate?" If reuse: skip T1. |
| 4 | Wrangler authenticated | `npx wrangler whoami 2>&1` | If NOT authenticated: tell user to run `npx wrangler login` and wait. |
| 5 | SSH key exists | `ls ~/.ssh/id_ed25519 ~/.ssh/id_rsa ~/.ssh/id_ecdsa 2>/dev/null` | If missing AND not CONNECT_READY: warn about Connect deploy. |

## Phase 0: Collect Inputs

### 0.1 App Prompt

**Ask [App prompt]**: "What do you want to build? Describe the app you have in mind."
- "Todo list" — A simple task manager with categories and due dates
- "Photo gallery" — A shareable photo gallery with albums and captions
- "Team dashboard" — A metrics and status dashboard for small teams

Store as `appPrompt`.

### 0.2 App Name + Domain

**Ask [App name]**: "What's the app name? (used for subdomain + database)" AND **[Domain]**: "Where will this be deployed?"
- App name: "Derive from prompt" or "Let me specify"
- Domain: "Cloudflare Workers (Recommended)" or "Custom domain"

If "Derive from prompt": generate URL-safe slug (lowercase, hyphens, max 30 chars). If "Custom domain": ask for domain name. Store as `appName`.

Resolve Workers URL (if Cloudflare):
```bash
node "{pluginRoot}/scripts/lib/resolve-workers-url.js" --name "{appName}"
```
Store output as `domain`. If script fails, ask for their Cloudflare subdomain and construct `{appName}.{subdomain}.workers.dev`.

### 0.3 AI Features (conditional)

Scan `appPrompt` for AI keywords: "chatbot", "chat with AI", "summarize", "generate", "analyze", "AI-powered", "intelligent".

If detected: **Ask [AI features]**: "Does this app need AI features?"
- "Yes — I have an OpenRouter key" — I'll paste my API key
- "Yes — I need to get one" — I'll sign up at openrouter.ai
- "No AI needed" — Skip AI capabilities

If yes: check `grep OPENROUTER_API_KEY ~/.vibes/.env`. If found, offer reuse (mask key). Otherwise collect via Ask and offer to cache to `~/.vibes/.env`. Store as `openRouterKey` (or null if no AI).

### 0.4 Theme Selection

Theme switching is handled by the live preview wrapper, not inside the app. The builder generates a single-theme layout. Set `themeCount = 1`.

---

## Phase 1: Spawn Team & Parallel Work

### 1.1 Setup

1. Resolve plugin root: `printenv CLAUDE_PLUGIN_ROOT` → store as `pluginRoot`
2. Create team: `TeamCreate("launch-{appName}", "Full SaaS pipeline for {appName}")`
3. Create all tasks per the table in LAUNCH-REFERENCE.md. If `CONNECT_READY`: mark T2+T3 completed immediately.

### 1.2 Spawn Builder (T1)

1. Read `${CLAUDE_SKILL_DIR}/prompts/builder.md`
2. Substitute: `{appPrompt}`, `{appName}`, `{pluginRoot}`
3. Set `{aiInstructions}`: if `openRouterKey` is set, add rule about `useAI` hook (see vibes SKILL.md "AI Features"). If null, leave empty.
4. Spawn: Task tool, `team_name="launch-{appName}"`, `name="builder"`, `subagent_type="general-purpose"`

### 1.3 OIDC Credentials (T2) — simultaneous with builder

**Skip entirely if CONNECT_READY.**

OIDC credentials come from the Connect Studio's Pocket ID instance. If Connect has not been deployed yet, the infra agent (T3) will set it up.

**Ask [OIDC config]**: "Do you have your OIDC credentials from Connect Studio?"
- "Yes, I have them" — I have the authority URL and client ID
- "Not yet" — Connect needs to be deployed first (infra agent will handle this)

If "Yes": collect two credentials via Ask (user types actual values via Other):

**Ask [OIDC Authority]**: "Paste your OIDC Authority URL (e.g., https://studio.exe.xyz/auth)"
- "Paste URL" — From your Connect Studio .env.

**Ask [OIDC Client ID]**: "Paste your OIDC Client ID"
- "Paste ID" — From your Connect Studio's Pocket ID configuration.

If "Not yet": Mark T2 as blocked on T3 (infra). The infra agent will provide credentials after Connect + Pocket ID deployment.

Mark T2 completed.

### 1.4 Spawn Infra (T3) — after T2 completes

**Skip if CONNECT_READY.**

1. Read `${CLAUDE_SKILL_DIR}/prompts/infra.md`
2. Substitute: `{appName}`, `{pluginRoot}`, `{oidcAuthority}`, `{oidcClientId}`
3. Spawn: Task tool, `team_name="launch-{appName}"`, `name="infra"`, `subagent_type="general-purpose"`

### 1.5 Sell Config (T4) — while infra deploys

**Sell config is collected here but applied later by invoking `/vibes:sell` (or its assembly script) as an atomic step.** Do NOT hand-implement SaaS logic — the sell skill handles tenant routing, auth gating, billing, and admin setup.

Choose billing mode based on monetization intent:
- **"off" (free)** — all authenticated users get full access. Good for MVPs and internal tools.
- **"required" (subscription)** — users must subscribe. Stripe billing integration is phase 2.

**Always ask the user** — do not assume a default.

**Ask [Billing]**: "What billing mode for your SaaS?" AND **[Title]**: "App display title?"
- Billing: "Free (no billing)" or "Subscription required"
- Title: "Derive from app name" or "Let me specify"

**If billing is "Subscription required"**: Note that Stripe billing integration is phase 2. For now, billing mode gates access but Stripe checkout is not yet wired up.

**Ask [Tagline]**: "Describe your app's tagline (short punchy phrase)"
- "Generate one" — Create from app description
- "Let me write it" — I'll provide it

**When billing is "required"**: These fields appear on a pricing section visible to potential customers before signup. Optimize for marketing copy quality — benefit-driven language, not technical descriptions. Tagline = sales headline. Subtitle = value proposition ("why should I pay?"). Features = compelling benefit statements (3-5 items).

Repeat pattern for subtitle and features list (3-5 bullet points).

Store: `billingMode` ("off"/"required"), `appTitle`, `tagline`, `subtitle`, `features` (JSON array). Mark T4 completed.

---

## Phase 2: Assembly & Deploy

**Blocked by T1 + T3 + T4.** Check TaskList until all complete.

### 2.1 Verify Inputs

Confirm: `app.jsx` exists with valid JSX. `.env` has `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, `VITE_API_URL`, `VITE_CLOUD_URL`. All sell config values collected.

Scan app.jsx for builder mistakes (see LAUNCH-REFERENCE.md "Common Builder Mistakes"). Fix any found before proceeding.

### 2.1.5 Preview Before Deploy

**Ask [Preview]**: "Want to preview the app before deploying?"
- "Yes — open live preview" — Start the preview server and iterate on the design
- "No — deploy now" — Skip preview, go straight to deploy

If yes: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/preview-server.js"` and tell the user to open `http://localhost:3333`. They can chat to iterate on the design and switch themes. When satisfied, stop the server and continue to 2.2.

### 2.2 Deploy Cycle

This sequence runs twice: first here (with `--admin-ids '[]'`), then in Phase 3 (with real admin ID). Steps:

**Step A — Assemble:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble-sell.js" app.jsx index.html \
  --oidc-authority "{oidcAuthority}" \
  --oidc-client-id "{oidcClientId}" \
  --app-name "{appName}" \
  --app-title "{appTitle}" \
  --domain "{domain}" \
  --billing-mode "{billingMode}" \
  --tagline "{tagline}" \
  --subtitle "{subtitle}" \
  --features '{featuresJSON}' \
  --admin-ids '{adminIds}'
```

**Step B — Validate:** `grep -c '__VITE_\|__OIDC_\|__APP_' index.html` — must be 0.

**Step C — Deploy:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-cloudflare.js" \
  --name "{appName}" \
  --file index.html \
  --oidc-authority "{oidcAuthority}" \
  --billing-mode "{billingMode}" \
  {aiKeyFlag}
```
Where `{aiKeyFlag}` = `--ai-key "{openRouterKey}"` if set, omitted if null. The `--billing-mode` flag controls whether the client enforces JWT-based plan checks.

Run the cycle now with `{adminIds}` = `'[]'` (or `'["{existingAdminId}"]'` if found in pre-flight). Mark T5, T6 completed.

---

## Phase 3: Admin Setup

**Skip if `OIDC_ADMIN_USER_ID` was found in pre-flight.**

### 3.1 Guide Signup

Tell the user:
> Your app is live! Create your admin account:
> 1. Open: `https://{domain}?subdomain=test`
> 2. Sign up with your email
> 3. Complete email verification
> 4. Create a passkey when prompted

**Ask [Signup]**: "Have you completed signup on the app?"
- "Yes, signed up" — Completed verification + passkey
- "Skip admin setup" — I'll do this later

If skip: proceed to Phase 4.

### 3.2 Collect Admin ID

Tell user: Find your User ID from the Pocket ID admin panel or your app's user profile (starts with `user_`).

**Ask [User ID]**: "Paste your User ID (starts with user_)"
- "I need help finding it" — Check Pocket ID admin panel > Users > click name > ID at top

Validate starts with `user_`. Save to `.env`:
```bash
echo "OIDC_ADMIN_USER_ID={userId}" >> .env
```

### 3.3 Re-run Deploy Cycle

Re-run Phase 2.2 steps A-D with `{adminIds}` = `'["{userId}"]'`.

Tell user: Admin dashboard now works at `https://{domain}?subdomain=admin`

---

## Phase 4: Verify & Cleanup

### 4.1 Verify

**Ask [Verify]**: "Your app is live! Open each URL and verify:\n\n- Landing: https://{domain}\n- Tenant: https://{domain}?subdomain=test\n- Admin: https://{domain}?subdomain=admin\n\nDoes everything look right?"
- "All working" — Everything loads correctly
- "Something's broken" — Need to troubleshoot

**If `billingMode === "required"`**: Also ask the user to verify the auth gate:
> "Check auth flow: Visit `https://{domain}?subdomain=test` — you should see the auth gate. Sign in via Pocket ID. Note: Stripe billing integration is phase 2, so the paywall UI may be a placeholder."

Mark T7 completed. If broken, ask what's wrong and troubleshoot.

### 4.2 Shutdown

Send `shutdown_request` to "builder" and "infra" (if spawned). Wait for responses. Clean up team.

### 4.3 Summary

```
## Launch Complete

**App**: {appTitle}
**URL**: https://{domain}
**OIDC Authority**: {oidcAuthority}
**Connect**: {studioUrl}
**Billing**: {billingMode}

### What's deployed:
- Cloudflare Worker with KV registry
- Fireproof Connect studio for real-time sync
- OIDC authentication via Pocket ID (with passkeys)
- Subdomain-based multi-tenancy

### Next steps:
- Configure a custom domain (see CLAUDE.md DNS section)
- Stripe billing integration is phase 2
```

---

## Error Handling

| Failure | Recovery |
|---------|----------|
| Builder generates invalid JSX | Read app.jsx, fix TS syntax / wrong hooks, re-save |
| Connect deploy fails | Infra reports via SendMessage. Present error + fix steps |
| Assembly has placeholders | Check .env for missing values, re-run assembly |
| Cloudflare deploy fails | Check `npx wrangler whoami`. Guide `npx wrangler login` if needed |
| Wrangler secret put fails | Retry. If persistent, have user run manually |
| Teammate silent 3+ min | SendMessage status check. If no response, take over task |
| Builder hardcodes DB name | Edit app.jsx: replace with `useTenant()` pattern before assembly |
