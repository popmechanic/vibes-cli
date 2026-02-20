# Vibes Pipeline: How an App Gets Built

A step-by-step guide to how the LLM receives data, generates code, and produces a deployable page.

---

## Overview

```
Session Start → Skill Invocation → Code Generation → Template Build → Assembly → Deploy → Browser Runtime
```

The pipeline has 7 phases. Each phase feeds into the next.

---

## Phase 0: Session Initialization

**What happens when you open Claude Code in this project.**

### Step 0.1: SessionStart Hook Fires

The file `hooks/hooks.json` declares a hook that runs on every conversation start, resume, clear, or compact. It triggers `hooks/session-start.sh`.

### Step 0.2: Context Injection

`session-start.sh` does two things:

1. **Reads static context** from `hooks/session-context.md` — this contains the skill trigger table (which user intents map to which skills), core workflow summary, and critical rules
2. **Detects project state** — checks `$PWD` for:
   - `.env` with Clerk keys and Connect URLs
   - `app.jsx` (existing app code)
   - `index.html` (assembled output)

The result is injected into the system prompt as `additionalContext`. This means the LLM **always knows** what Vibes is, which skills exist, and whether the project is ready to generate.

### Step 0.3: CLAUDE.md Loaded

Claude Code automatically reads `/CLAUDE.md` — the project instructions file. This gives the LLM:

- Architecture overview (template inheritance, component system)
- File intent guide (which files to edit vs. which are generated)
- Critical rules (React singleton, `?external=`, import maps)
- Build commands and test commands

**Result:** Before any user interaction, the LLM has full framework awareness.

---

## Phase 1: Skill Invocation

**What happens when you say "build me an app" or run `/vibes:vibes`.**

### Step 1.1: Skill Matching

The session context includes a trigger table:

| User says | Skill invoked |
|-----------|---------------|
| "build an app", "create a..." | `/vibes:vibes` |
| "deploy to cloudflare" | `/vibes:cloudflare` |
| "make it SaaS" | `/vibes:sell` |
| "launch" (full pipeline) | `/vibes:launch` |

The LLM matches user intent to the correct skill.

### Step 1.2: SKILL.md Loaded

The skill's instruction file is loaded into the LLM's context. For app generation, this is `skills/vibes/SKILL.md`. It contains:

- **Pre-flight check** — bash command to verify `.env` has valid Clerk keys + Connect URLs
- **Core rules** — use JSX, single HTML file, Fireproof for data, Tailwind for styling
- **Generation process** — design reasoning, token reading, theme selection, code output format
- **Fireproof API** — correct hook patterns (`useFireproofClerk`), document operations, live queries
- **Common mistakes** — what NOT to do (no standalone imports, no old API, etc.)
- **Assembly + deploy workflow** — exact commands to run after code generation

### Step 1.3: Design Tokens Read

SKILL.md instructs the LLM to read `build/design-tokens.txt`. This file contains:

- **TOKEN_CATALOG** — all CSS custom properties organized by category:
  - `vibes-core` (cream, pink, yellow, lavender brand colors)
  - `vibes-buttons` (button background, text, icon fills)
  - `vibes-grid` (grid size, colors, opacity)
  - `colors` (semantic: primary, secondary, accent, background, surface)
  - `radius` (none, sm, md, lg, xl, full)
  - `shadows` (brutalist offset shadows in multiple sizes)
  - `spacing` (0 through 16 scale)
  - `typography` (font families, sizes, weights, line heights)
- **VIBES_THEME_CSS** — grid background, page frame, `.btn` button classes
- **Component Catalog** — bare HTML structures (card, input, badge, table, tabs, etc.)

The LLM uses these tokens as `var(--token-name)` references instead of hardcoded values.

### Step 1.4: Theme Selection (Always 3 Themes)

SKILL.md instructs the LLM to read `skills/vibes/themes/catalog.txt`, which lists the full catalog of 6 available layout themes:

| Theme | Best for |
|-------|----------|
| `default` (Neo-Brutalist) | Forms, CRUD, dashboards, planners |
| `archive` | Portfolios, catalogs, galleries, timelines |
| `industrial` | Showcases, product pages, landing pages |
| `vault` | Data-heavy apps, encrypted/secure feel, dark UIs |
| `scrapbook` | Creative tools, mood boards, collage-style layouts |
| `poster` | Bold hero sections, announcement pages, editorial splash |

The LLM always picks exactly **3 themes** from this catalog of 6. The selection is based on which 3 themes best complement the app's purpose — for example, a recipe manager might get `default`, `scrapbook`, and `archive`, while a finance tracker might get `default`, `vault`, and `industrial`.

After selecting 3 themes, the LLM reads **all 3 full theme files** (e.g., `themes/default.txt`, `themes/scrapbook.txt`, `themes/vault.txt`). Each theme file provides:

- Color token overrides (`:root` values — the mood identity)
- Design principles (border style, typography feel, animation tempo)
- Reference CSS (one possible interpretation to study, not copy)
- Personality notes (how the theme should FEEL)
- Animation and SVG guidelines

**Completely different layouts per theme:** Each of the 3 themes gets its own distinct JSX layout in the generated `app.jsx`. This is not just a color swap — the LLM generates structurally different layouts, card designs, navigation patterns, and visual hierarchies for each theme. For example, the same to-do app might render as a compact dashboard in `default`, a pinboard of sticky notes in `scrapbook`, and a minimal dark terminal-style list in `vault`.

**Creative liberty:** Themes are mood boards, not rigid templates. The LLM uses the color tokens exactly (they define the mood) and follows the design principles (sharp vs rounded, editorial vs playful), but invents unique layouts, card designs, and visual details for each theme variant. Two apps using the same theme should feel like siblings, not twins.

**Component consistency:** All 3 theme variants share the same React components with the same props/interface. Themes differ through CSS (token overrides + theme-specific class styles) and through different JSX layout structures rendered conditionally based on the active theme. This ensures runtime theme switching works — the user can cycle between all 3 themes live.

**Result:** The LLM now has all the context it needs — framework rules, design tokens, 3 theme personalities, and Fireproof API patterns — and will produce an app with 3 fully distinct visual interpretations.

---

## Phase 2: Code Generation

**The LLM writes `app.jsx`.**

### Step 2.1: Design Reasoning

The LLM first reasons about the design inside `<design>` tags:

- Core functionality and user flow
- OKLCH color choices (dark/light, warm/cool)
- Layout selection (cards, list, dashboard)
- Micro-interactions (hover states, transitions)
- Visual style (minimal, bold, playful)

### Step 2.2: Code Output

The LLM generates a complete React component in `<code>` tags:

```jsx
// Typical structure of a generated app.jsx

// Imports (resolved by import map at runtime, NOT by bundler)
import React, { useState, useEffect } from "react";
import { useFireproofClerk } from "use-fireproof";

export default function App() {
  // Fireproof database + hooks
  const { database, useLiveQuery, useDocument, syncStatus } = useFireproofClerk("my-app-db");

  // Live query for real-time data
  const { docs } = useLiveQuery("type", { key: "item" });

  // Document hook for create/edit
  const { doc, merge, save } = useDocument({ type: "item", name: "" });

  // App styles using design tokens
  const appStyles = `
    :root {
      --app-bg: oklch(0.15 0.02 250);
      --app-accent: oklch(0.75 0.15 50);
    }
    .app-container { /* uses var(--app-bg) */ }
  `;

  return (
    <>
      <style>{appStyles}</style>
      <div className="app-container">
        {/* App UI here */}
      </div>
    </>
  );
}
```

### Step 2.3: Write to Disk

The LLM writes the code to `app.jsx` in the project root.

**Result:** A complete React component file ready for assembly.

---

## Phase 3: Template Build Infrastructure

**How the template gets built (this happens during plugin development, not every generation).**

This phase creates the template that `app.jsx` gets inserted into. It runs when templates need rebuilding.

### Step 3.1: Build Components

```bash
node scripts/build-components.js --force
```

This script:

1. Reads TypeScript components from `components/` directory (VibesPanel, VibesButton, AuthScreen, HiddenMenuWrapper, icons, etc.)
2. Transpiles each `.tsx`/`.ts` file with **esbuild** (JSX → `React.createElement`)
3. Applies component transforms (`scripts/lib/component-transforms.js`) — rewrites imports, namespaces hooks
4. Concatenates all transpiled code into `build/vibes-menu.js`
5. Adds `window.*` exports so components are globally accessible

**Component dependency order:**
```
Hooks (useMobile, useIsMobile)
  → Icons (BackIcon, InviteIcon, LoginIcon, etc.)
    → BrutalistCard, LabelContainer
      → AuthScreen
        → VibesSwitch, HiddenMenuWrapper
          → VibesButton
            → VibesPanel
```

### Step 3.2: Build Design Tokens

```bash
node scripts/build-design-tokens.js --force
```

Reads the single source of truth (`scripts/lib/design-tokens.js`) and generates:

- `build/design-tokens.css` — the `:root {}` block + theme CSS for template injection
- `build/design-tokens.txt` — AI-readable documentation for the LLM

### Step 3.3: Merge Templates

```bash
node scripts/merge-templates.js --force
```

This script combines three inputs:

```
skills/_base/template.html     ← Base template (shared HTML, CSS, import map)
build/vibes-menu.js            ← Built components
build/design-tokens.css        ← Design token CSS
skills/vibes/template.delta.html  ← Skill-specific code (Clerk auth wrapper)
                    ↓
skills/vibes/templates/index.html  ← Final assembled template
```

**Placeholder replacement:**

| Placeholder | Replaced with |
|-------------|---------------|
| `__TITLE__` | "Made on Vibes DIY" |
| `/* === DESIGN_TOKENS_PLACEHOLDER === */` | Contents of `build/design-tokens.css` |
| `// === COMPONENTS_PLACEHOLDER ===` | Contents of `build/vibes-menu.js` |
| `<!-- === DELTA_PLACEHOLDER === -->` | Contents of the skill's `template.delta.html` |

**Result:** A complete HTML template with all components, styles, and auth wrappers — just missing the app code.

---

## Phase 4: Assembly

**`app.jsx` gets inserted into the template to create `index.html`.**

```bash
node scripts/assemble.js app.jsx index.html
```

### Step 4.1: Read Inputs

- Reads the final template from `skills/vibes/templates/index.html`
- Reads the app code from `app.jsx`
- Reads `.env` file for Connect configuration

### Step 4.2: Validate Credentials

Checks that `.env` contains valid:
- `VITE_CLERK_PUBLISHABLE_KEY` (must start with `pk_test_` or `pk_live_`)
- `VITE_API_URL` (Connect Studio endpoint)

**Fails fast** if credentials are missing — no local-only path.

### Step 4.3: Insert App Code

Replaces the `{/* === APP_PLACEHOLDER === */}` marker in the template with the contents of `app.jsx`.

### Step 4.4: Populate Connect Config

Replaces placeholder values in the template with actual `.env` values:

| Template placeholder | Replaced with |
|---------------------|---------------|
| `YOUR_CLERK_PUBLISHABLE_KEY` | `VITE_CLERK_PUBLISHABLE_KEY` from .env |
| `YOUR_API_URL` | `VITE_API_URL` from .env |
| `YOUR_CLOUD_URL` | `VITE_CLOUD_URL` from .env |

### Step 4.5: Validate Output

Checks the assembled HTML for:
- Non-empty app code
- No remaining placeholders
- App component function present
- Properly closed script tags

### Step 4.6: Backup + Write

Creates a timestamped backup of any existing `index.html`, then writes the new assembled file.

**Result:** A complete, self-contained `index.html` with everything needed to run in a browser.

---

## Phase 5: Deployment

**`index.html` gets deployed to a public URL.**

### Option A: Cloudflare Workers

```bash
node scripts/deploy-cloudflare.js --name my-app --file index.html
```

1. Reads `index.html` and the Fireproof bundle files from `bundles/`
2. Writes the HTML into the Cloudflare Worker's KV storage
3. Copies bundle files (`fireproof-clerk-bundle.js`, `fireproof-vibes-bridge.js`) as static assets
4. Deploys the Worker using `wrangler`
5. The Worker serves the HTML on `https://my-app.amber-e8c.workers.dev`

The Worker handles:
- Serving the main HTML page
- Serving bundle JS files from KV
- JWT verification for authenticated requests

### Option B: exe.dev

```bash
node scripts/deploy-exe.js --name my-app
```

1. Creates (or reuses) a VM on exe.dev
2. Uploads `index.html` via SCP to `/tmp/`, then `sudo cp` to `/var/www/html/`
3. Uploads bundle files alongside
4. Configures nginx on port 8000
5. Shares the port publicly via `ssh exe.dev share port`

**Result:** The app is live at a public URL.

---

## Phase 6: Browser Runtime

**What happens when a user opens the deployed URL.**

### Step 6.1: HTML Loads

The browser receives the single `index.html` file containing:
- Import map (maps bare specifiers to CDN URLs)
- Design token CSS (`:root` variables)
- Built components (VibesPanel, HiddenMenuWrapper, etc.)
- Skill-specific code (Clerk auth wrapper, sharing bridge)
- The app code inside a `<script type="text/babel">` block
- Babel standalone transpiler

### Step 6.2: Import Map Resolution

The browser's native import map resolves bare specifiers:

```json
{
  "imports": {
    "react": "https://esm.sh/stable/react@19.1.0",
    "react-dom/client": "https://esm.sh/stable/react-dom@19.1.0/client",
    "use-fireproof": "/fireproof-vibes-bridge.js",
    "@clerk/clerk-react": "https://esm.sh/stable/@clerk/clerk-react@5.23.0?external=react,react-dom"
  }
}
```

Key: `?external=react,react-dom` ensures all packages use the SAME React instance (the React singleton problem).

### Step 6.3: Babel Transpilation

Babel standalone runs in the browser:
1. Finds the `<script type="text/babel">` block
2. Transpiles JSX → `React.createElement` calls
3. Resolves `import` statements via the import map
4. Executes the transpiled code

### Step 6.4: Clerk Authentication

The template's delta code wraps the app in `ClerkProvider`:

1. `ClerkProvider` initializes with the publishable key from `window.__VIBES_CONFIG__`
2. Shows sign-in/sign-up UI if the user isn't authenticated
3. Once signed in, renders the `App` component

### Step 6.5: Fireproof Database + Sync

Inside the app:

1. `useFireproofClerk("db-name")` is called
2. The bridge module (`fireproof-vibes-bridge.js`) wraps the raw bundle
3. Fireproof creates a local IndexedDB database
4. Clerk provides a JWT token for cloud sync authentication
5. Fireproof connects to the Connect Studio WebSocket (`fpcloud://studio.exe.xyz`)
6. Data syncs bidirectionally — local-first, works offline, syncs when connected

### Step 6.6: Component System

The built-in components are globally available:

- **HiddenMenuWrapper** — slide-out settings menu (toggle via VibesSwitch)
- **VibesPanel** — settings panel with Logout, Design, and Invite buttons
- **VibesButton** — styled buttons with icon support and hover animations
- **AuthScreen** — full-screen auth gate (for SaaS apps)
- **SyncStatusDot** — shows connection status (synced/connecting/error)

The Design button in VibesPanel dispatches a `vibes-design-request` DOM event. Apps can listen for this to switch themes in real-time.

---

## Phase 7: Iteration

**The edit-reassemble-redeploy loop.**

After the initial deployment, changes follow a tight loop:

```
Edit app.jsx
     ↓
node scripts/assemble.js app.jsx index.html
     ↓
node scripts/deploy-cloudflare.js --name my-app --file index.html
     ↓
Verify in browser (hard refresh)
```

Each cycle takes about 30 seconds. The LLM can also:
- Add new features to `app.jsx`
- Switch themes by modifying CSS token overrides
- Add sharing/invite functionality via the VibesPanel
- Transform the app into SaaS with `/vibes:sell`

---

## File Flow Diagram

```
                    PLUGIN INFRASTRUCTURE
                    =====================

components/*.tsx ──→ build-components.js ──→ build/vibes-menu.js
                                                    │
scripts/lib/design-tokens.js ──→ build-design-tokens.js ──→ build/design-tokens.css
                                                                    │
skills/_base/template.html ─────────────────────────────────────────┤
skills/vibes/template.delta.html ───────────────────────────────────┤
                                                                    │
                                                        merge-templates.js
                                                                    │
                                                                    ▼
                                            skills/vibes/templates/index.html
                                                        (final template)

                    APP GENERATION
                    ==============

User prompt ──→ LLM reads:                    .env (Clerk keys,
                  SKILL.md                      Connect URLs)
                  design-tokens.txt                  │
                  themes/catalog.txt                 │
                  themes/{theme1}.txt                │
                  themes/{theme2}.txt                │
                  themes/{theme3}.txt                │
                       │                             │
                       ▼                             │
                   app.jsx                           │
                       │                             │
                       └──────────┐    ┌─────────────┘
                                  ▼    ▼
                             assemble.js
                                  │
                                  ▼
                             index.html
                                  │
                                  ▼
                        deploy-cloudflare.js
                          or deploy-exe.js
                                  │
                                  ▼
                          Live public URL
                                  │
                                  ▼
                      Browser loads + runs:
                        Import map resolves
                        Babel transpiles JSX
                        Clerk authenticates
                        Fireproof syncs data
```

---

## Summary Table

| Phase | Input | Output | Key Script |
|-------|-------|--------|------------|
| 0. Session Init | `hooks/session-context.md`, `.env` | LLM context | `session-start.sh` |
| 1. Skill Invocation | User prompt | SKILL.md + tokens in context | (Claude Code) |
| 2. Code Generation | Design reasoning + tokens | `app.jsx` | (LLM) |
| 3. Template Build | Components + base template + delta | `templates/index.html` | `merge-templates.js` |
| 4. Assembly | `app.jsx` + template + `.env` | `index.html` | `assemble.js` |
| 5. Deployment | `index.html` + bundles | Public URL | `deploy-cloudflare.js` |
| 6. Browser Runtime | HTML + import map + CDN | Running app | (browser) |
| 7. Iteration | Edits to `app.jsx` | Updated deployment | assemble + deploy |
