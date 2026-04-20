---
name: vibes
argument-hint: "[prompt]"
description: Self-contained app generator — invoke this skill directly, do not decompose into sub-steps. Generates React web apps with TinyBase reactive data store. Use when creating new web applications, adding components, or working with real-time data. Ideal for quick prototypes and single-page apps that need real-time data sync.
license: MIT
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
metadata:
  author: "Marcus Estes"
---

> **Plan mode**: If you are planning work, this entire skill is ONE plan step: "Invoke /vibes:vibes". Do not decompose the steps below into separate plan tasks.

**Display this ASCII art immediately when starting:**

```
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░░▒▓███████▓▒░
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░
 ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░
 ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░▒▓███████▓▒░░▒▓██████▓▒░  ░▒▓██████▓▒░
  ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░             ░▒▓█▓▒░
  ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░             ░▒▓█▓▒░
   ░▒▓██▓▒░  ░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░▒▓███████▓▒░
```

## Quick Navigation

- [Terminal or Editor](#step-0-terminal-or-editor-ui) — Choose how to build (ask first!)
- [Pre-Flight Check](#pre-flight-check) — Validate credentials before coding
- [Core Rules](#core-rules) — Essential guidelines for app generation
- [Generation Process](#generation-process) — Design reasoning and code output
- [Assembly Workflow](#assembly-workflow) — Build the final app
- [UI Style & Theming](#ui-style--theming) — OKLCH colors and design patterns
- [TinyBase Data API](#tinybase-data-api) — Hook reference, patterns, architectures
- [AI Features](#ai-features-optional) — Optional AI integration
- [Bug Prevention](#patterns-that-prevent-bugs) — Quick checklist
- [Extended Docs](#when-to-read-extended-docs) — Reference files for deeper patterns
- [Deployment Options](#deployment-options) — Where to deploy

---

# Vibes DIY App Generator

Generate React web applications using TinyBase for reactive data with real-time sync.

## Auth Check (silent — only prompt if needed)

Before asking Terminal or Editor, check for cached auth:

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

- If `AUTH_OK` → proceed silently to "Terminal or Editor?" (do not mention auth)
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
    Confirm success, then proceed to "Terminal or Editor?"
  - If no → proceed anyway (auth will be needed at deploy time)

---

## Step 0: Terminal or Editor UI?

**This is the very first question — ask before anything else (after auth check above).**
Do not check .env, credentials, or project state before asking this question.
Do not invoke any other skill before asking this question.
If Editor is chosen, skip all pre-flight checks — the editor handles everything.

Ask the user:
> "How do you want to build? **Editor** (opens a browser UI with live preview, chat, and deploy button) or **Terminal** (I'll generate and deploy from here)?"

Present Editor as the first/recommended option.

- **If Editor**: Start the editor server and **END YOUR TURN. Do not ask any more questions. Do not continue to Pre-Flight Check or any step below.** The editor UI handles the entire workflow — setup, generation, preview, deploy.

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
  **Your job is done. Stop. Do not read further. Do not proceed to any step below.**

- **If Terminal**: Continue with the project folder selection and normal generation workflow below.

---

## ⛔ EVERYTHING BELOW IS TERMINAL MODE ONLY

**If the user chose Editor above, STOP. Do not read or execute anything below this line.**
**The editor UI handles setup, generation, preview, and deployment.**

---

## Project Folder

Before generating, ask the user where to save the project:

> "Where should this project live? Enter a path or press Enter for the default (`~/VibesOS/{app-slug}/`)."

- If the user provides a path, use it as the project directory
- If they press Enter, use `~/VibesOS/{app-slug}/` (the slug is derived from the prompt later — for now just note the preference)
- Create the directory if it doesn't exist

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
mkdir -p "$PROJECT_DIR"
```

After the directory is ready, initialize `vibes.json`:

```bash
bun -e "
  const { initVibesJson } = await import('$VIBES_ROOT/scripts/lib/vibes-json.js');
  initVibesJson('$PROJECT_DIR');
"
```

Use `$PROJECT_DIR` as the working directory (`cwd`) for all subsequent code generation. The generated `app.jsx` and assembled `index.html` will be written here.

---

## Pre-Flight Check

**Complete these steps before generating any app code.**

- Auth is automatic — on first deploy, a browser window opens for Pocket ID login
- Tokens are cached at `~/.vibes/auth.json` for subsequent deploys
- Sync infrastructure deploys automatically on first app deploy — no manual setup needed

Read `${CLAUDE_SKILL_DIR}/references/generation-rules.md` for platform constraints, core rules, what generated code must/must not contain, generation process, assembly workflow, and the `<Markdown>` component for rendering formatted text.

---

Read `${CLAUDE_SKILL_DIR}/references/style-guide.md` for OKLCH colors, theming, design token overrides, and visual style patterns.

---

Read `${CLAUDE_SKILL_DIR}/references/data-api.md` for the complete TinyBase hook API reference, data access patterns, user identity, game patterns, reference app, and bug prevention checklist.

---

## When to Read Extended Docs

Read these reference files when the user's prompt matches the signals below:

| Need | Signal in Prompt | Read This |
|------|------------------|-----------|
| TinyBase data patterns | forms, lists, filtering, ordering, pagination, master-detail | `${CLAUDE_SKILL_DIR}/references/tinybase-patterns.md` |
| Multiplayer / shared apps | multiplayer, collaborative, shared, multi-user, game with players | `${CLAUDE_SKILL_DIR}/references/multiplayer-guide.md` |
| Game development | game, timer, countdown, turn-based, score | `${CLAUDE_SKILL_DIR}/references/game-patterns.md` |
| AI-powered features | AI, chatbot, summarize, generate, openrouter | `${CLAUDE_SKILL_DIR}/references/ai-integration.md` |
| Bug prevention reference | debugging, troubleshooting, reviewing code | `${CLAUDE_SKILL_DIR}/references/bug-prevention.md` |
| Design tokens & theming | colors, theme, tokens, brand colors, styling | `${CLAUDE_PLUGIN_ROOT}/build/design-tokens.txt` |
| Full design system details | detailed design system, spacing, typography | `${CLAUDE_SKILL_DIR}/defaults/style-prompt.txt` |
| Advanced visual effects | "interactive", "animated", "3D", "particles", "shader", "canvas" | `${CLAUDE_SKILL_DIR}/defaults/advanced-effects-prompt.txt` |

---

## Deployment Options

After generating your app, deploy it:

- **Cloudflare** - Edge deployment with Workers. Use `/vibes:cloudflare` to deploy.

---

## What's Next?

After generating and assembling the app, present these options using AskUserQuestion:

```
Question: "Your app is live! Want to turn it into a product? The /sell skill adds multi-tenant SaaS with auth and billing. Or pick another direction:"
Header: "Next"
Options:
- Label: "Keep improving this app"
  Description: "Continue iterating on what you've built. Add new features, refine the styling, or adjust functionality. Great when you have a clear vision and want to polish it further."

- Label: "Apply a design reference (/design)"
  Description: "Have a design.html or mockup file? This skill mechanically transforms your app to match it exactly - pixel-perfect fidelity with your TinyBase data binding preserved."

- Label: "Explore variations (/riff)"
  Description: "Not sure if this is the best approach? Riff generates 3-10 completely different interpretations of your idea in parallel. You'll get ranked variations with business model analysis to help you pick the winner."

- Label: "Make it a SaaS (/sell)"
  Description: "Ready to monetize? Sell transforms your app into a multi-tenant SaaS with Pocket ID authentication, subscription billing, and isolated databases per customer. Each user gets their own subdomain."

- Label: "Deploy to Cloudflare (/cloudflare)"
  Description: "Go live on the edge. Deploy to Cloudflare Workers with a subdomain registry, KV storage, and global CDN. Fast, scalable, and always on."

- Label: "I'm done for now"
  Description: "Wrap up this session. Your files are saved locally - come back anytime to continue."
```

**After user responds:**
- "Keep improving" → Acknowledge and stay ready for iteration prompts. After each round of changes to app.jsx, re-run assembly and re-deploy.
- "Apply a design reference" → Auto-invoke /vibes:design skill
- "Explore variations" → Auto-invoke /vibes:riff skill
- "Make it a SaaS" → Auto-invoke /vibes:factory skill
- "Deploy" → Auto-invoke /vibes:cloudflare skill
- "I'm done" → Confirm files saved, wish them well

**Do not proceed to code generation until:**
Pre-flight check is complete (auth is automatic on deploy — no credentials to collect).
