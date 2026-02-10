# Vibes DIY Plugin - Development Guide

## Agent Quick Reference

**This section helps coding agents navigate this codebase efficiently.**

### When to Read What

| Task | Read First |
|------|------------|
| Working on skills | The specific `skills/*/SKILL.md` file |
| Generating app code | SKILL.md has patterns; for advanced features, read `docs/fireproof.txt` |
| Working on scripts | `scripts/package.json` for deps, this file for architecture |
| Debugging React errors | "React Singleton Problem" section below; also `skills/vibes/SKILL.md` Common Mistakes |
| Deploying to Cloudflare | `skills/cloudflare/SKILL.md` |
| Testing plugin changes | `cd scripts && npm run test:fixtures` for structural tests; `/vibes:test` for full E2E |
| Understanding skill sequencing | "Workflow Sequence" section below |
| Editing SessionStart hook context | `hooks/session-context.md` for content; `hooks/session-start.sh` for logic |

### Fireproof API Reference

SKILL.md provides common patterns (useDocument, useLiveQuery, database.put/del) and critical gotchas.

**Read `docs/fireproof.txt` when the user's app needs:**

| Feature | Signal in prompt | fireproof.txt section |
|---------|------------------|----------------------|
| User authentication | "login", "auth", "accounts", "Clerk" | Quick Start, API Reference |
| Sync status indicators | "connection status", "online/offline" | Sync Status Display |
| User context/identity | "user name", "profile", "who is logged in" | User Context, useUser() |
| Complete example | "full example", "show me how" | Complete Example |
| Migration from use-fireproof | "migrate", "update existing" | Differences from Standard Fireproof |

### Architecture at a Glance

```
User invokes skill (e.g., /vibes:vibes)
       │
       ▼
skills/*.SKILL.md loaded into context
       │
       ▼
Agent generates app.jsx
       │
       ▼
scripts/assemble.js (inserts JSX into template)
       │
       ▼
index.html (ready to deploy)
```

### Workflow Sequence

All Vibes skills follow this dependency graph:

```
CR (credentials) → CO (connect) → G (generate) → A (assemble) → D (deploy) → V (verify)
SaaS path adds: S (sell config) before A, AD (admin setup) after D.
Iterate loop: edit app.jsx → A → D → V (always includes re-deploy)
```

**Hard rules:**
- Deploy is mandatory — Clerk auth requires a public URL. No local-only path.
- Connect is always required — no value in local-only Fireproof.
- Iterate loop always includes re-deploy: edit app.jsx → A → D → V.

**Node registry:**

| ID | Node | Inputs | Outputs | Prereqs | Skip If |
|----|------|--------|---------|---------|---------|
| CR | CREDENTIALS | user input | Clerk PK+SK in .env | -- | .env has valid Clerk keys |
| CO | CONNECT | Clerk PK+SK | .env with API_URL+CLOUD_URL | CR | .env has VITE_API_URL |
| G | GENERATE | user prompt | app.jsx | -- | app.jsx exists (ask reuse) |
| S | SELL | app context | sell config | CO | not SaaS path |
| A | ASSEMBLE | app.jsx + .env [+ sell config] | index.html | G + CO; SaaS: + S | -- |
| D | DEPLOY | index.html | live URL | A | -- |
| AD | ADMIN_SETUP | deployed URL + user signup | admin ID, re-assembled+re-deployed | D | admin ID cached; or not SaaS |
| V | VERIFY | live URL | user confirmation | D (or AD if SaaS) | -- |

**Hard dependencies:**
```
CR → CO       Connect needs Clerk keys
CO → G        Generate needs Connect configured
G + CO → A    Assembly needs app.jsx + .env
G + CO + S → A  SaaS assembly needs all three
A → D         Deploy needs index.html
D → AD        Admin setup needs deployed app for signup
D|AD → V      Verify needs live URL
```

Skill-specific context tables (Launch task assignments, Test phases, Native Skills entry/exit nodes) live in their respective SKILL.md and LAUNCH-REFERENCE.md files.

### Template Inheritance Architecture

Templates use a DRY inheritance pattern:

```
components/             → build-components.js → cache/vibes-menu.js
                                                       ↓
skills/_base/template.html  ←── shared code (components, CSS, imports)
         +
skills/vibes/template.delta.html  ←── vibes-specific code
skills/sell/template.delta.html   ←── sell-specific code (multi-tenant routing)
skills/riff/template.delta.html   ←── riff-specific code
         ↓
    merge-templates.js
         ↓
skills/*/templates/index.html  ←── final assembled templates
```

Build workflow:
```bash
node scripts/build-components.js --force  # Build components from local source
node scripts/merge-templates.js --force   # Merge base + deltas into final templates
```

### Auth Components

The `components/` directory contains TypeScript components designed by Amber (commit f34b5ebc). These are the **source of truth** for UI/UX patterns. Templates are directly informed by these components.

**Component inventory:**

| Component | Purpose | Used By |
|-----------|---------|---------|
| `AuthPopUp/` | Modal auth dialog (isOpen/onClose) | vibes template |
| `AuthScreen/` | Full-screen auth gate (always visible) | sell template |
| `BrutalistCard/` | Animated card with shred/collapse effects | Auth flows |
| `LabelContainer/` | Form field wrapper with labels | Auth forms |
| `VibesButton/` | Styled button component | All templates |
| `VibesPanel/` | Settings panel UI | Menu system |
| `VibesSwitch/` | Toggle switch for menu | All templates |
| `HiddenMenuWrapper/` | Slide-out menu container | All templates |
| `icons/` | SVG icon components | Various |

**AuthPopUp vs AuthScreen:**

Both components share the same visual design patterns but serve different purposes:

| Aspect | AuthPopUp | AuthScreen |
|--------|-----------|------------|
| Visibility | Modal (isOpen/onClose props) | Always visible (gate) |
| Close button | Yes (dismissible) | No (must complete auth) |
| Content | Hardcoded buttons | Flexible `children` prop |
| Use case | Optional auth prompt | Required auth gate (SaaS) |

**Style consistency rules:**

When creating or modifying auth components, match these values from AuthPopUp:
- `getButtonsContainerStyle`: `gap: "1rem"`, `maxWidth: "400px"`
- `getContainerStyle`: `minHeight: "500px"`, `gap: "2rem"`
- Animations: `shredCard`, `collapseToLine` keyframes

**Preserving Amber's work:**

Never modify the original component files without explicit request. Bug fixes to HiddenMenuWrapper (CSS variable fixes, button resets) are acceptable. Design changes require discussion.

### File Intent Guide

| File Pattern | Intent |
|--------------|--------|
| `skills/*/SKILL.md` | Loaded verbatim into Claude. Edit carefully - affects agent behavior |
| `skills/_base/template.html` | Base template with shared code. Edit for all skills. |
| `skills/*/template.delta.html` | Skill-specific code. Only unique functionality. |
| `skills/*/templates/*.html` | Generated templates. Don't edit - regenerated by merge-templates.js |
| `components/` | Local TypeScript components. Built by build-components.js |
| `scripts/*.js` | Node.js tools. Run locally, not loaded into Claude |
| `cache/*` | Working cache (gitignored). Source of truth for versions |
| `skills/*/cache/*` | Default cache (git-tracked). Stable fallback |
| `hooks/*` | SessionStart hook infrastructure. Context injected every conversation |

---

## Multi-Harness Support

This plugin works with multiple coding agents, not just Claude Code.

### Distribution Model

| Agent | Installation | Bootstrap |
|-------|--------------|-----------|
| Claude Code | `/plugin install vibes@vibes-cli` | Automatic via plugin system |
| Codex | Fetch `.codex/INSTALL.md` | `vibes-codex bootstrap` |
| OpenCode / Others | `git clone` to `~/.vibes` | `vibes-codex bootstrap` |

### Key Files

| File | Purpose |
|------|---------|
| `.codex/vibes-codex` | CLI wrapper for non-Claude-Code agents |
| `.codex/vibes-bootstrap.md` | Tool mappings (AskUserQuestion → prompt, etc.) |
| `.codex/INSTALL.md` | Fetchable installation guide |
| `lib/resolve-paths.js` | Finds plugin directory across install locations |

### Path Resolution

`lib/resolve-paths.js` checks these locations in order:
1. `VIBES_PLUGIN_ROOT` environment variable
2. Claude Code plugin cache (`~/.claude/plugins/cache/vibes-cli/vibes/<version>`)
3. Standard git clone (`~/.vibes`)
4. Development mode (relative to script)

### Adding or Removing Skills (Manual Checklist)

**When you add, remove, or rename a skill**, update these files:

| File | What to Update |
|------|----------------|
| `.codex/vibes-codex` | `SKILLS` array (line ~45) |
| `.codex/vibes-bootstrap.md` | Skills table |
| `README.md` | Skills section |
| `commands/` | Add a command `.md` if the skill should be user-invocable |

**Claude Code-only skills** (e.g., `launch` — requires Agent Teams) are excluded from `.codex/vibes-codex` and `.codex/vibes-bootstrap.md`. Add a note pointing Codex/OpenCode users to the sequential alternative.

**Skill content changes** (editing `skills/*/SKILL.md`) flow automatically to all harnesses—no manual steps needed.

---

## Package Versions

The import map in `skills/_base/template.html` is the authoritative source for current package versions (`esm.sh/stable/` URLs, `@necrodome/fireproof-clerk@0.0.3`, React 19.2.4).

## Critical Rules

### 1. Use `?external=` for React Singleton

When using `@necrodome/fireproof-clerk` via esm.sh, you MUST add `?external=react,react-dom` to ensure a single React instance:

```json
"@fireproof/clerk": "https://esm.sh/stable/@necrodome/fireproof-clerk@0.0.3?external=react,react-dom"
```

**Why `?external=`:** This tells esm.sh to keep `react` and `react-dom` as bare specifiers instead of bundling them. The browser's import map then intercepts these bare specifiers, ensuring all code uses the same React instance.

**Why NOT `?alias=`:** The `?alias` parameter rewrites imports at esm.sh build time, but doesn't prevent esm.sh from resolving its own React version for internal dependencies. `?external` is more reliable for no-build workflows.

### 2. Import Map Lives in Base Template

The authoritative import map is defined in `skills/_base/template.html` — read it there, not here. Key rule: `?external=react,react-dom` is REQUIRED on any esm.sh package that depends on React. After editing the base template, run `node scripts/merge-templates.js --force` to regenerate.

## Local Development

To test the plugin from local source (instead of the installed version):

```bash
# From the plugin directory
claude --plugin .

# Or with absolute path
claude --plugin /path/to/vibes-skill
```

This loads skills and commands from your local checkout, so you can test changes without publishing.

## Testing

The plugin includes a comprehensive test suite using Vitest. Tests are organized into three tiers:

### Running Tests

```bash
cd scripts

# Install dependencies (first time)
npm install

# Run all tests
npm test

# Run only unit tests (fastest, <1 second)
npm run test:unit

# Run integration tests (mocked external services)
npm run test:integration

# Start E2E local server for manual testing
npm run test:e2e:server
```

### Test Structure

```
scripts/__tests__/
├── unit/                           # Pure logic, no I/O
│   ├── ai-proxy.test.js
│   ├── assemble-validation.test.js
│   ├── auth-flows.test.js          # State machine transitions
│   ├── component-transforms.test.js
│   ├── generate-handoff.test.js
│   ├── jwt-validation.test.js      # azp matching, timing validation
│   ├── registry-logic.test.js
│   ├── strip-code.test.js
│   ├── template-merge.test.js
│   └── webhook-signature.test.js
├── integration/                    # Mocked external services
│   ├── assembly-pipeline.test.js
│   ├── deploy-ai-proxy.test.js
│   ├── deploy-handoff.test.js
│   └── registry-webhooks.test.js
├── e2e/                            # Local server for manual testing
│   └── local-server.js
└── mocks/                          # Shared test doubles
    └── clerk-webhooks.js
```

### E2E Testing with /etc/hosts

For full subdomain routing tests without real DNS:

1. Add to `/etc/hosts`:
```
127.0.0.1  test-app.local
127.0.0.1  tenant1.test-app.local
127.0.0.1  admin.test-app.local
```

2. Start the local server:
```bash
npm run test:e2e:server
```

3. Open in browser:
   - `http://test-app.local:3000` - Landing page
   - `http://tenant1.test-app.local:3000` - Tenant app
   - `http://admin.test-app.local:3000` - Admin dashboard

### Test Generated Apps

1. Generate a simple app with `/vibes:vibes`
2. Open `index.html` in your browser
3. Check console for errors:
   - No "Fireproof is not defined" errors
   - No infinite loops or page lockups

### Adding New Tests

- **Unit tests** go in `scripts/__tests__/unit/` - for pure functions with no I/O
- **Integration tests** go in `scripts/__tests__/integration/` - use mocks from `mocks/`
- **Mocks** go in `scripts/__tests__/mocks/` - shared test doubles for external services

## Integration Testing

| What Changed | How to Test |
|-------------|-------------|
| Template structure | `cd scripts && npm run test:fixtures` (vitest, ~200ms) |
| Full E2E (assembly + deploy + browser) | `/vibes:test` |

**Structural tests** (`npm run test:fixtures`) validate assembly output without credentials — no placeholders, import map present, Babel script block intact. Fast enough to run after every template edit.

**Full E2E** (`/vibes:test`) orchestrates real credentials, Connect studio, Cloudflare deploy, and presents a live URL for browser verification. Use after structural tests pass.

## File Reference

| File | Purpose |
|------|---------|
| `scripts/assemble.js` | Assembly script - inserts JSX into template |
| `scripts/assemble-sell.js` | SaaS assembly script - generates multi-tenant app |
| `scripts/assemble-vite.js` | Vite-based assembly (alternative to Babel for Connect apps) |
| `scripts/assemble-all.js` | Batch assembler for riff directories |
| `scripts/build-components.js` | Build components from local `components/` directory |
| `scripts/merge-templates.js` | Merge base + delta templates into final templates |
| `scripts/find-plugin.js` | Plugin directory lookup with validation |
| `scripts/generate-riff.js` | Parallel riff generator - spawns claude -p for variations |
| `scripts/generate-handoff.js` | Generate HANDOFF.md context document for remote Claude |
| `scripts/deploy-exe.js` | App deployment to exe.dev (static files, AI proxy, registry) |
| `scripts/deploy-connect.js` | Connect Studio deployment to exe.dev (Docker-based sync) |
| `scripts/deploy-cloudflare.js` | Cloudflare deployment script |
| `scripts/deployables/registry-server.ts` | Bun server for subdomain registry + Clerk webhooks (deployed to VMs) |
| `scripts/vitest.config.js` | Vitest test runner configuration |
| `scripts/package.json` | Node.js deps |
| `scripts/lib/env-utils.js` | Shared .env loading, Clerk key validation, Connect config |
| `scripts/lib/exe-ssh.js` | SSH automation for exe.dev |
| `scripts/lib/paths.js` | Centralized path resolution for all plugin paths |
| `scripts/lib/crypto-utils.js` | Session token and device CA key generation for Connect |
| `scripts/lib/ensure-deps.js` | Auto-install npm dependencies on first run |
| `scripts/lib/backup.js` | Timestamped backup utilities for file operations |
| `scripts/lib/prompt.js` | Readline prompt utilities for interactive CLI |
| `scripts/lib/strip-code.js` | Strip import/export statements from JSX before template injection |
| `scripts/lib/resolve-workers-url.js` | Resolve full Cloudflare Workers URL for an app |
| `scripts/lib/jwt-validation.js` | JWT validation utilities (azp matching, timing) |
| `scripts/lib/auth-flows.js` | Auth flow state machines (signup, signin, gate) |
| `scripts/lib/registry-logic.js` | Pure functions for subdomain registry operations (tested) |
| `scripts/deployables/ai-proxy.js` | AI proxy server for OpenRouter (deployed to exe.dev VMs) |
| `scripts/lib/template-merge.js` | Pure functions for merging base + delta templates |
| `scripts/lib/component-transforms.js` | Pure functions for transforming component source code |
| `scripts/__tests__/fixtures/` | Pre-written JSX test fixtures |
| `lib/resolve-paths.js` | Find plugin directory across install locations |
| `bundles/fireproof-clerk-bundle.js` | Patched Fireproof client bundle (CID fix, retry backoff, sync poll) |
| `bundles/fireproof-vibes-bridge.js` | ES module bridge — wraps useFireproofClerk with sync status + onTock kick |
| `assets/` | Favicon, branding images, auth card designs |
| `docs/plans/` | Architecture decision records and planning docs |
| `components/` | Local TypeScript components - source of truth for UI/UX |
| `components/AuthPopUp/` | Modal auth dialog (Amber's original design) |
| `components/AuthScreen/` | Full-screen auth gate for sell template |
| `components/BrutalistCard/` | Animated card with shred/collapse effects |
| `cache/style-prompt.txt` | Working cache - UI style guidance |
| `docs/fireproof.txt` | Fireproof API reference documentation |
| `cache/vibes-menu.js` | Built components from local source |
| `skills/_base/template.html` | Base template with shared code (components, CSS, imports) |
| `skills/vibes/template.delta.html` | Vibes-specific delta (Clerk auth wrapper) |
| `skills/vibes/templates/index.html` | Generated vibes template |
| `skills/vibes/SKILL.md` | Main vibes skill (has import map) |
| `skills/vibes/cache/` | Default cache (git-tracked) - ships with plugin |
| `skills/riff/template.delta.html` | Riff-specific delta |
| `skills/riff/templates/index.html` | Generated riff template |
| `skills/riff/SKILL.md` | Riff skill for parallel app generation |
| `skills/sell/template.delta.html` | Sell-specific delta (multi-tenant routing) |
| `skills/sell/templates/unified.html` | Generated SaaS template |
| `skills/sell/SKILL.md` | Sell skill for SaaS transformation |
| `skills/design-reference/SKILL.md` | Design reference skill - mechanical HTML→React transformation |
| `skills/launch/SKILL.md` | Launch skill - full SaaS pipeline with Agent Teams |
| `skills/launch/LAUNCH-REFERENCE.md` | Launch architecture reference (dependency graph, timing, skip modes) |
| `skills/launch/prompts/builder.md` | Builder agent prompt template with {placeholder} markers |
| `skills/launch/prompts/infra.md` | Infra agent prompt template with {placeholder} markers |
| `skills/exe/SKILL.md` | exe.dev app deployment skill |
| `skills/connect/SKILL.md` | Connect Studio deployment skill |
| `skills/cloudflare/SKILL.md` | Cloudflare Workers deployment skill |
| `skills/cloudflare/worker/` | Cloudflare Worker source (Hono, KV, Web Crypto JWT) |
| `skills/test/SKILL.md` | E2E integration test skill |
| `hooks/hooks.json` | SessionStart hook declaration |
| `hooks/run-hook.cmd` | Cross-platform polyglot wrapper for hooks |
| `hooks/session-start.sh` | SessionStart logic — reads context + detects project state |
| `hooks/session-context.md` | Static framework awareness content injected every conversation |

### Cache Locations

There are two cache locations by design:

1. **`/cache/`** (gitignored) - Working cache
   - `style-prompt.txt` - UI style guidance
   - `vibes-menu.js` - Built components (from build-components.js)

2. **`docs/fireproof.txt`** - Fireproof API reference
   - Contains `@fireproof/clerk` docs for authenticated sync
   - Read when Connect is set up and apps need Clerk auth patterns

**Build scripts:**
- `build-components.js` - Builds vibes-menu.js from local `components/` directory
- `merge-templates.js` - Combines base + delta templates into final templates

**When to read cache files:**
- `style-prompt.txt` - Read when you need UI/color guidance beyond what's in SKILL.md

## Architecture: JSX + Babel

The plugin uses JSX with Babel runtime transpilation (matching vibes.diy). See `skills/_base/template.html` for the `<script type="text/babel">` pattern.

## The React Singleton Problem

### Understanding the Architecture

vibes.diy uses import maps - a browser-native feature (since March 2023) that maps bare specifiers like `"react"` to CDN URLs.

### The Core Problem

**Import maps can only intercept bare specifiers**, not absolute URL paths:

| Import Type | Example | Import Map Intercepts? |
|-------------|---------|------------------------|
| Bare specifier | `import "react"` | ✅ Yes |
| Absolute path | `import "/react@19.2.4"` | ❌ No |

When esm.sh bundles `@fireproof/clerk`, internal React imports become absolute paths:
```javascript
import "/react@>=19.1.0?target=es2022";  // Resolved relative to esm.sh origin
```

**Result**: Our import map provides React 19.2.4, but `@fireproof/clerk` loads React 19.2.6 → TWO React instances → context fails.

### The Solution: `?external=`

From Preact's no-build workflow guide and esm.sh documentation:

> "By using `?external=preact`, we tell esm.sh that it shouldn't provide a copy of preact... the browser will use our importmap to resolve `preact`, using the same instance as the rest of our code."

The `?external=` parameter tells esm.sh to keep specified dependencies as **bare specifiers** so our import map can intercept them.

### esm.sh Query Parameters

| Parameter | Syntax | Effect |
|-----------|--------|--------|
| `?external=` | `?external=react,react-dom` | **Recommended.** Keeps bare specifiers for import map resolution |
| `?deps=` | `?deps=react@19.2.4` | Forces specific dependency versions at build time |
| `?alias=` | `?alias=react:react@19.2.4` | Rewrites import specifiers at build time (less reliable for no-build) |
| `*` prefix | `https://esm.sh/*pkg@ver` | Marks ALL deps as external (exposes internal deps) |

### Correct Import Map

See `skills/_base/template.html` for the current authoritative import map. The key points:
- The `/stable/` path uses pre-built, cached versions that avoid dependency resolution issues
- `?external=react,react-dom` ensures import map controls React
- Currently uses a local bundle workaround for `use-fireproof` and `@fireproof/clerk`

## Hooks (SessionStart)

The plugin uses a `SessionStart` hook to inject framework awareness context into every conversation. This ensures agents always know what Vibes is, when to use each skill, and what technical rules to follow — even before any skill is invoked.

### Hook Files

| File | Purpose |
|------|---------|
| `hooks/hooks.json` | Hook declaration — triggers on startup, resume, clear, compact |
| `hooks/run-hook.cmd` | Cross-platform polyglot wrapper (bash on Unix, Git Bash on Windows) |
| `hooks/session-start.sh` | Main logic — reads context file, detects project state, outputs JSON |
| `hooks/session-context.md` | Static framework awareness content (skill trigger table, workflow, rules) |

### How It Works

1. Claude Code fires `SessionStart` event
2. `hooks.json` triggers `run-hook.cmd session-start.sh`
3. `session-start.sh` reads `session-context.md` (static content)
4. Script detects project state in `$PWD`: `.env` (Clerk keys? Connect URLs?), `app.jsx`, `index.html`
5. Appends dynamic hints like "No .env found — run /vibes:connect first"
6. Outputs JSON with `additionalContext` field → appears in system reminders

### Editing Injected Context

- **Static content**: Edit `hooks/session-context.md`. Keep under 100 lines — this is injected into every conversation.
- **Dynamic detection**: Edit `hooks/session-start.sh`. Uses pure bash only (no sed/awk) for cross-platform compatibility.
- **Testing**: Run `echo '{}' | bash hooks/session-start.sh` to verify valid JSON output. Test from directories with/without `.env` to verify state detection.

## Skills Are Atomic

**Each skill is a self-contained automation.** When planning work, a skill invocation is always ONE plan step (e.g., "Invoke /vibes:connect"), never decomposed into its internal sub-steps. Skill selection and descriptions are driven by YAML frontmatter in each SKILL.md file.

The frontmatter description must signal atomicity (e.g., "Self-contained deploy automation — invoke directly, do not decompose") so the agent treats the skill as a single unit even in plan mode. Without this, agents read the SKILL.md during planning and extract internal steps as separate plan tasks.

## exe.dev Deployment

App VMs serve static HTML via nginx. A separate Studio VM runs Fireproof Connect (Docker-based sync). See `skills/exe/SKILL.md` and `skills/connect/SKILL.md` for full deployment guides.

### Connect Studio Environment

Point apps at the Studio VM:
```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=https://<studio>.exe.xyz/api
VITE_CLOUD_URL=fpcloud://<studio>.exe.xyz?protocol=wss
```

### DNS Configuration for Custom Domains

| Type | Name | Value |
|------|------|-------|
| ALIAS | @ | exe.xyz |
| CNAME | * | yourapp.exe.xyz |

- Use ALIAS (not A record) for apex → `exe.xyz`; CNAME for wildcard → `yourapp.exe.xyz`
- exe.dev's proxy handles SSL termination for both
- Fallback: `?subdomain=` query parameter if DNS provider lacks ALIAS support

### Manual File Transfer to exe.dev VMs

**Key distinction:**
- `ssh exe.dev` = orchestrator CLI (create VMs, share ports, manage account)
- `ssh <app>.exe.xyz` = actual VM (file operations, server access)

**Reliable transfer pattern (two-stage):**
```bash
# Upload: SCP to server /tmp/ → sudo move to /var/www/html/
scp index.html myapp.exe.xyz:/tmp/
ssh myapp.exe.xyz "sudo cp /tmp/index.html /var/www/html/"

# Download: Direct SCP works
scp myapp.exe.xyz:/var/www/html/index.html ./downloaded.html
```

**Common mistakes:**
| Mistake | Error | Fix |
|---------|-------|-----|
| `ssh exe.dev cat /var/www/...` | "No VMs found" | Use `ssh <app>.exe.xyz` |
| `scp file vm:/var/www/html/` | Permission denied | Use temp + sudo pattern |
| Forgetting sudo for /var/www | Permission denied | Always `sudo cp` for www-data dirs |

## Sharing / Invite Architecture

The sharing feature lets users invite others to collaborate on their Fireproof database via the VibesPanel invite UI.

### DOM Event Bridge Pattern

VibesPanel (inside HiddenMenuWrapper) dispatches DOM events. SharingBridge (rendered inside `ClerkFireproofProvider > SignedIn`) listens and calls `dashApi`:

```
VibesPanel → dispatches 'vibes-share-request' {email, right}
SharingBridge → calls dashApi.inviteUser() via useClerkFireproofContext()
SharingBridge → dispatches 'vibes-share-success' or 'vibes-share-error'
VibesPanel → listens for result events, shows BrutalistCard feedback
```

**Why a bridge?** `useVibesPanelEvents()` runs outside `ClerkFireproofProvider` (it's called at AppWrapper top level), so it can't access `dashApi`. SharingBridge solves this by living inside the provider tree.

### Ledger Discovery

SharingBridge calls `dashApi.listLedgersByUser({})` to find the current app's ledger. It matches by hostname (ledger name contains `window.location.hostname`), falling back to the first ledger. The result is cached after the first call.

### Available dashApi Methods

| Method | Purpose |
|--------|---------|
| `inviteUser({ ticket })` | Send invitation by email |
| `listLedgersByUser({})` | List user's ledgers for discovery |
| `findUser({ query })` | Look up users |

### useSharing Hook (for user app code)

If the bundle exports `useSharing`, user apps can use it directly:

```javascript
const { useSharing } = window;
const { inviteUser, listInvites, deleteInvite, findUser, ready } = useSharing();
```

The hook is conditionally exported via `window.useSharing` in the delta template's `initApp()`.

## Known Issues

### Sell Skill Deploy Issues (Future Improvements)

The `/vibes:sell` deploy has several issues that need fixing in `scripts/deploy-exe.js`:

1. **Port mismatch**: nginx is configured on port 80, but exe.dev requires ports 3000-9999. Fix: configure nginx to listen on port 8000 and run `ssh exe.dev share port <name> 8000`.

2. **Missing nginx registry routes**: Deploy doesn't add proxy routes for `/claim`, `/check/`, `/webhook` to the registry server on port 3002. These routes need to be added to the nginx config.

3. **Admin dashboard is placeholder**: The sell template (`skills/sell/templates/unified.html`) has a stub admin that just says "Admin dashboard coming soon...". Need to build a real admin dashboard that fetches `/registry.json` and displays claims/users/stats.

## Temporary Workaround: Local Fireproof Bundle + Bridge

**Status**: Temporary workaround until `@necrodome/fireproof-clerk` is updated on npm.

**Two-file architecture**:
- `bundles/fireproof-clerk-bundle.js` — patched client (CID fix, retry backoff, sync poll)
- `bundles/fireproof-vibes-bridge.js` — ES module bridge that wraps the bundle

The import map points `use-fireproof` → `/fireproof-vibes-bridge.js`. The bridge imports from `./fireproof-clerk-bundle.js` (relative path, bypasses import map) and re-exports everything, replacing `useFireproofClerk` with a wrapped version that adds:
1. **Sync status bridge** — forwards `syncStatus` to `window.__VIBES_SYNC_STATUS__` + dispatches `vibes-sync-status-change` event for SyncStatusDot
2. **onTock kick** — polls `allDocs()` after sync reaches "synced", then fires `noPayloadWatchers` to ensure `useLiveQuery` subscribers see new data

**Bundle issues fixed** (vs `@necrodome/fireproof-clerk@0.0.3` from esm.sh):
1. **CID stringification bug** — blob URLs show `[object Object]` instead of proper CID strings
2. **Retry fix** — exponential backoff for all `attach()` errors (PR #1593)
3. **Sync poll fix** — `allDocs()` polling after `attach()` to kick CRDT processing, so second-device sync works without manual refresh (PR #1593)

See `docs/plans/sync-poll-fix.md` for technical details on the sync poll fix.

**Deployment**:
- `deploy-exe.js` automatically uploads both files alongside each app (phase 4b)
- `deploy-cloudflare.js` copies `bundles/*.js` to the worker's public directory

**To revert when upstream package is fixed**:
1. Update import map in `skills/_base/template.html` to use esm.sh URLs:
   ```json
   "use-fireproof": "https://esm.sh/stable/@necrodome/fireproof-clerk@X.X.X?external=react,react-dom",
   "@fireproof/clerk": "https://esm.sh/stable/@necrodome/fireproof-clerk@X.X.X?external=react,react-dom"
   ```
2. Remove `phase4bBundleUpload` function and call from `scripts/deploy-exe.js`
3. Remove bundle copy step from `scripts/deploy-cloudflare.js`
4. Delete `bundles/` directory
5. Remove this section from CLAUDE.md

## Plugin Versioning

When releasing a new version, update the version number in **both** files to comply with Claude Code plugin standards:

1. `.claude-plugin/plugin.json` - The main plugin manifest
2. `.claude-plugin/marketplace.json` - The marketplace metadata (in the `plugins` array)

Both files must have matching version numbers.

**Name fields:** `plugin.json` uses `"name": "vibes"` (the plugin's internal name). `marketplace.json` uses `"name": "vibes-cli"` at the top level (the public listing name on the marketplace), while the plugin entry inside its `plugins` array uses `"name": "vibes"` to match `plugin.json`.

## Commit Messages

Do not credit Claude Code when making commit messages.
