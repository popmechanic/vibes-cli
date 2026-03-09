---
name: launch
argument-hint: "[prompt]"
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

**Ask [Header]**: "question" means call AskUserQuestion with that header and question. Options listed as bullets. User can always type custom via "Other".

For architecture context, see `LAUNCH-REFERENCE.md` in this directory.

---

## FIRST: Terminal or Editor UI?

**This is the very first question — ask before anything else.**
**DO NOT check .env, credentials, or project state before asking this question.**
**DO NOT invoke any other skill before asking this question.**
**If Editor is chosen, skip ALL remaining steps — the editor handles everything.**

Ask the user:
> "How do you want to build? **Editor** (opens a browser UI with live preview, chat, and deploy button) or **Terminal** (I'll generate and deploy from here)?"

Present Editor as the first/recommended option.

- **If Editor**: Start the editor server and **END YOUR TURN. Do not ask any more questions. Do not continue to Phase 0 or any phase below.** The editor UI handles the entire workflow — setup, generation, preview, deploy.

  Launch the editor server:
  ```bash
  VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
  bun "$VIBES_ROOT/scripts/server.ts" --mode=editor --prompt "USER_PROMPT_HERE"
  ```
  If no prompt was given, omit `--prompt`:
  ```bash
  VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
  bun "$VIBES_ROOT/scripts/server.ts" --mode=editor
  ```
  Tell the user: "Open http://localhost:3333 — the editor handles everything from here."
  **Your job is done. Stop. Do not read further. Do not proceed to any phase below.**

- **If Terminal**: Continue with the workflow below.

---

## ⛔ EVERYTHING BELOW IS TERMINAL MODE ONLY

**If the user chose Editor above, STOP. Do not read or execute anything below this line.**
**The editor UI handles setup, generation, preview, and deployment.**

---

## Auth Check (Terminal mode only — silent unless needed)

Check for cached auth. Editor mode handles auth in the browser, so this only runs for Terminal:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
bun --input-type=module -e "
import { readCachedTokens, isTokenExpired } from '$VIBES_ROOT/scripts/lib/cli-auth.js';
const tokens = readCachedTokens();
if (tokens && !isTokenExpired(tokens.expiresAt)) {
  console.log('AUTH_OK');
} else {
  console.log('AUTH_NEEDED');
}
"
```

- If `AUTH_OK` → proceed silently (do not mention auth)
- If `AUTH_NEEDED` → ask: "To deploy apps, you'll need a Vibes account. Sign in now? (A browser window will open for Pocket ID — takes about 10 seconds.)"
  - If yes:
    ```bash
    VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
    bun --input-type=module -e "
    import { getAccessToken } from '$VIBES_ROOT/scripts/lib/cli-auth.js';
    import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '$VIBES_ROOT/scripts/lib/auth-constants.js';
    const tokens = await getAccessToken({ authority: OIDC_AUTHORITY, clientId: OIDC_CLIENT_ID });
    if (tokens) console.log('Signed in successfully!');
    "
    ```
    Confirm success, then continue.
  - If no → proceed anyway (auth will be needed at deploy time)

---

## Pre-Flight Check

Only one check before collecting input:

| # | Check | Command | If True |
|---|-------|---------|---------|
| 1 | app.jsx exists | `test -f app.jsx` | **Ask [Reuse]**: "app.jsx exists. Reuse it or regenerate?" If reuse: skip T1. |

Auth and deploy credentials are handled automatically — no user setup needed. On first deploy, a browser window opens for Pocket ID login. Tokens are cached at `~/.vibes/auth.json`.

## Phase 0: Collect Inputs

### 0.1 App Prompt

**Ask [App prompt]**: "What do you want to build? Describe the app you have in mind."
- "Todo list" — A simple task manager with categories and due dates
- "Photo gallery" — A shareable photo gallery with albums and captions
- "Team dashboard" — A metrics and status dashboard for small teams

Store as `appPrompt`.

### 0.2 App Name

**Ask [App name]**: "What's the app name? (used for subdomain + database)"
- "Derive from prompt" — Generate a URL-safe slug automatically
- "Let me specify" — I'll type my own name

If "Derive from prompt": generate URL-safe slug (lowercase, hyphens, max 30 chars). Store as `appName`.

### 0.3 AI Features (conditional)

Scan `appPrompt` for AI keywords: "chatbot", "chat with AI", "summarize", "generate", "analyze", "AI-powered", "intelligent".

If detected: **Ask [AI features]**: "Does this app need AI features?"
- "Yes — I have an OpenRouter key" — I'll paste my API key
- "Yes — I need to get one" — I'll sign up at openrouter.ai
- "No AI needed" — Skip AI capabilities

If yes: check `grep OPENROUTER_API_KEY ~/.vibes/.env`. If found, offer reuse (mask key). Otherwise collect via Ask and offer to cache to `~/.vibes/.env`. Store as `openRouterKey` (or null if no AI).

### 0.4 SaaS Config

**Sell config is collected here but applied later by the assembly script.** Do NOT hand-implement SaaS logic — the sell assembly handles tenant routing, auth gating, and billing.

Choose billing mode based on monetization intent:
- **"off" (free)** — all authenticated users get full access. Good for MVPs and internal tools.
- **"required" (subscription)** — users must subscribe. Stripe billing integration is phase 2.

**Always ask the user** — do not assume a default.

**Ask [Billing]**: "What billing mode for your SaaS?" AND **[Title]**: "App display title?"
- Billing: "Free (no billing)" or "Subscription required"
- Title: "Derive from app name" or "Let me specify"

**Ask [Tagline]**: "Describe your app's tagline (short punchy phrase)"
- "Generate one" — Create from app description
- "Let me write it" — I'll provide it

**When billing is "required"**: These fields appear on a pricing section visible to potential customers before signup. Optimize for marketing copy quality — benefit-driven language, not technical descriptions. Tagline = sales headline. Subtitle = value proposition ("why should I pay?"). Features = compelling benefit statements (3-5 items).

Repeat pattern for subtitle and features list (3-5 bullet points).

Store: `billingMode` ("off"/"required"), `appTitle`, `tagline`, `subtitle`, `features` (JSON array).

### 0.5 Theme Selection

Theme switching is handled by the live preview wrapper, not inside the app. The builder generates a single-theme layout. Set `themeCount = 1`.

---

## Phase 1: Build

### 1.1 Setup

1. Resolve plugin root — use this in all bash blocks:
   ```bash
   VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
   ```
2. Create team: `TeamCreate("launch-{appName}", "Full SaaS pipeline for {appName}")`
3. Create tasks: T1 (generate app.jsx), T3 (assembly), T4 (deploy), T5 (verify).

### 1.2 Spawn Builder (T1)

1. Read `${CLAUDE_SKILL_DIR}/prompts/builder.md`
2. Substitute: `{appPrompt}`, `{appName}`, `{pluginRoot}`
3. Set `{aiInstructions}`: if `openRouterKey` is set, add rule about `useAI` hook (see vibes SKILL.md "AI Features"). If null, leave empty.
4. Spawn: Task tool, `team_name="launch-{appName}"`, `name="builder"`, `subagent_type="general-purpose"`

While the builder generates, SaaS config was already collected in Phase 0. Nothing else needs to happen in parallel — no credential collection, no manual setup.

---

## Phase 2: Assembly & Deploy

**Blocked by T1.** Check TaskList until builder completes.

### 2.1 Verify Inputs

Confirm: `app.jsx` exists with valid JSX. All sell config values collected.

Scan app.jsx for builder mistakes (see LAUNCH-REFERENCE.md "Common Builder Mistakes"). Fix any found before proceeding.

### 2.2 Preview Before Deploy

**Ask [Preview]**: "Want to preview the app before deploying?"
- "Yes — open live preview" — Start the preview server and iterate on the design
- "No — deploy now" — Skip preview, go straight to deploy

If yes: run `bun "$VIBES_ROOT/scripts/server.ts"` and tell the user to open `http://localhost:3333`. They can chat to iterate on the design and switch themes. When satisfied, stop the server and continue to 2.3.

### 2.3 Assemble & Deploy

**Step A — Assemble:**
```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
bun "$VIBES_ROOT/scripts/assemble-sell.js" app.jsx index.html \
  --app-name "{appName}" \
  --app-title "{appTitle}" \
  --domain "{appName}.vibes.diy" \
  --billing-mode "{billingMode}" \
  --tagline "{tagline}" \
  --subtitle "{subtitle}" \
  --features '{featuresJSON}' \
  --admin-ids '[]'
```

**Step B — Validate:** `grep -c '__VITE_\|__OIDC_\|__APP_' index.html` — must be 0.

**Step C — Deploy:**
```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
bun "$VIBES_ROOT/scripts/deploy-cloudflare.js" \
  --name "{appName}" \
  --file index.html \
  {aiKeyFlag}
```
Where `{aiKeyFlag}` = `--ai-key "{openRouterKey}"` if set, omitted if null.

On first deploy, the CLI opens a browser for Pocket ID login. The user signs in once and tokens are cached for future deploys.

---

## Phase 3: Verify & Cleanup

### 3.1 Verify

**Ask [Verify]**: "Your app is live! Open each URL and verify:\n\n- Landing: https://{appName}.vibes.diy\n- Tenant: https://{appName}.vibes.diy?subdomain=test\n\nDoes everything look right?"
- "All working" — Everything loads correctly
- "Something's broken" — Need to troubleshoot

If broken, ask what's wrong and troubleshoot.

### 3.2 Shutdown

Send `shutdown_request` to "builder" (if spawned). Wait for response. Clean up team.

### 3.3 Summary

```
## Launch Complete

**App**: {appTitle}
**URL**: https://{appName}.vibes.diy
**Billing**: {billingMode}

### What's deployed:
- Cloudflare Worker via Deploy API
- Fireproof Connect for real-time sync (auto-provisioned)
- Pocket ID authentication with passkeys
- Subdomain-based multi-tenancy

### Next steps:
- Sign in at your app URL to become the first user
- Configure admin access via the app settings
- Set up Stripe billing if using subscription mode
```

---

## Error Handling

| Failure | Recovery |
|---------|----------|
| Builder generates invalid JSX | Read app.jsx, fix TS syntax / wrong hooks, re-save |
| Assembly has placeholders | Re-run assembly — auth constants are hardcoded, no .env needed |
| Deploy fails (auth) | Delete `~/.vibes/auth.json` and retry — browser login will re-open |
| Deploy fails (other) | Check error output from deploy-cloudflare.js |
| Teammate silent 3+ min | SendMessage status check. If no response, take over task |
| Builder hardcodes DB name | Edit app.jsx: replace with `useTenant()` pattern before assembly |
