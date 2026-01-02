# Vibes DIY Plugin - Development Guide

## Core Design Principle

**Match vibes.diy exactly. Never deviate.**

This plugin generates React apps that are compatible with the vibes.diy ecosystem. All configuration—import maps, package versions, style prompts—MUST come from the upstream vibes.diy repository. Do not "improve" or "optimize" by changing values.

## Architecture: The Sync Pattern

### Data Flow

```
vibes.diy repo (GitHub)
        │
        │ fetch (HTTP)
        ▼
  /cache/ directory
   ├── import-map.json    ← Package versions
   ├── style-prompt.txt   ← UI style guide
   └── fireproof.txt      ← API documentation
        │
        │ regex replacement
        ▼
  Template files updated
   └── skills/vibes/SKILL.md
```

### How Sync Works

The `scripts/sync.js` script (Node.js + esbuild):

1. **Fetches** from vibes.diy GitHub raw URLs
2. **Parses** TypeScript source to extract values (handles both quoted and unquoted keys)
3. **Caches** parsed data in `/cache/` as JSON/text
4. **Updates** template files by regex-replacing `<script type="importmap">` blocks

Run sync with: `/vibes:sync` or `node scripts/sync.js --force`

**Prerequisites:** Node.js 18+ (uses native fetch). Install deps: `cd scripts && npm install`

### What Gets Synced

| Source | Cache File | Updates |
|--------|------------|---------|
| `import-map.ts` | `cache/import-map.json` | Import maps in SKILL.md |
| `style-prompts.ts` | `cache/style-prompt.txt` | UI style guidance |
| `use-fireproof.com/llms-full.txt` | `cache/fireproof.txt` | Fireproof API docs |

### Configuring Upstream Sources

The sync script supports custom upstream URLs via config file or environment variables.

**Priority:** Environment variables > `config/sources.json` > defaults

**Config file:** Copy `config/sources.example.json` to `config/sources.json` and modify URLs.

**Environment variables:**
- `VIBES_FIREPROOF_URL` - Fireproof documentation URL
- `VIBES_STYLE_PROMPT_URL` - Style prompts source
- `VIBES_IMPORT_MAP_URL` - Import map source
- `VIBES_CSS_VARIABLES_URL` - CSS variables source
- `VIBES_COMPONENTS_BASE_URL` - Vibes components base URL
- `VIBES_USE_VIBES_BASE_URL` - use-vibes base URL

Example:
```bash
VIBES_IMPORT_MAP_URL="https://example.com/my-import-map.ts" node scripts/sync.js --force
```

## Critical Rules

### 1. NEVER Hardcode Import Map Values

Let the sync script update templates from cache:

```bash
node scripts/sync.js --force
```

### 2. Use `?external=` for React Singleton

When using `use-vibes` via esm.sh, you MUST add `?external=react,react-dom` to ensure a single React instance:

```json
"use-vibes": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom"
```

**Why `?external=`:** This tells esm.sh to keep `react` and `react-dom` as bare specifiers instead of bundling them. The browser's import map then intercepts these bare specifiers, ensuring all code uses the same React instance.

**Why NOT `?alias=`:** The `?alias` parameter rewrites imports at esm.sh build time, but doesn't prevent esm.sh from resolving its own React version for internal dependencies. `?external` is more reliable for no-build workflows.

### 3. Include ALL Import Entries

The import map requires these entries:

```json
{
  "react": "https://esm.sh/react",
  "react-dom": "https://esm.sh/react-dom",
  "react-dom/client": "https://esm.sh/react-dom/client",
  "react/jsx-runtime": "https://esm.sh/react/jsx-runtime",
  "use-fireproof": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom",
  "call-ai": "https://esm.sh/call-ai@0.18.9?external=react,react-dom",
  "use-vibes": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom"
}
```

**Notes:**
- Unpinned React (`https://esm.sh/react` without version) lets esm.sh resolve the latest compatible version
- `?external=react,react-dom` is REQUIRED to prevent duplicate React instances
- Version `0.18.9` is the stable production version (dev versions have known bugs)

### 4. NEVER Update Documentation Examples Manually

Import map examples in documentation become stale. Reference `cache/import-map.json` instead of embedding versions.

## Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| Missing `?external=react,react-dom` on use-vibes URLs | Multiple React instances, context errors | Add `?external=react,react-dom` to all use-vibes/call-ai imports |
| Using dev versions (0.19.x-dev) | Known bugs, page lockups | Use stable version 0.18.9 |
| Missing `react/jsx-runtime` | Build errors | Run sync to get all entries |
| Hardcoded versions in docs | Docs become stale | Reference cache file |
| Editing templates without running sync | Versions out of date | Always run sync after edits |

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
├── unit/                    # Pure logic, no I/O
│   ├── config-parsing.test.js
│   ├── worker-utils.test.js
│   └── webhook-signature.test.js
├── integration/             # Mocked external services
│   └── worker-webhooks.test.js
├── e2e/                     # Local server for manual testing
│   └── local-server.js
└── mocks/                   # Shared test doubles
    ├── kv-storage.js
    ├── cloudflare-api.js
    ├── wrangler-cli.js
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

4. Test webhooks via curl:
```bash
curl -X POST http://test-app.local:3000/webhooks/clerk \
  -H "Content-Type: application/json" \
  -d '{"type": "user.created", "data": {"id": "test_user"}}'
```

### Verify Sync Worked

```bash
# Check cache was updated (should show 9 entries)
cat cache/import-map.json | jq '.imports | keys | length'

# Check templates were updated (should show 4 occurrences)
grep -c "esm.sh/use-vibes" skills/vibes/SKILL.md
```

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

## File Reference

| File | Purpose |
|------|---------|
| `scripts/assemble.js` | Assembly script - inserts JSX into template |
| `scripts/sync.js` | Sync script - fetches and updates cache |
| `scripts/find-plugin.js` | Plugin directory lookup with validation |
| `scripts/update.js` | Deterministic app updater |
| `scripts/package.json` | Node.js deps |
| `config/sources.example.json` | Example config for upstream URL overrides |
| `cache/import-map.json` | Working cache - package versions |
| `cache/style-prompt.txt` | Working cache - UI style guidance |
| `cache/fireproof.txt` | Working cache - Fireproof API docs |
| `skills/vibes/cache/` | Default cache (git-tracked) - ships with plugin |
| `skills/vibes/templates/index.html` | HTML template with menu components |
| `skills/vibes/SKILL.md` | Main vibes skill (has import map) |
| `skills/riff/SKILL.md` | Riff skill for parallel app generation |
| `skills/sell/SKILL.md` | Sell skill for SaaS transformation |
| `commands/sync.md` | User-facing sync command definition |
| `commands/update.md` | User-facing update command definition |
| `commands/sell.md` | User-facing sell command definition |
| `commands/deploy-exe.md` | User-facing exe.dev deployment command |
| `scripts/deploy-exe.js` | exe.dev deployment automation |
| `scripts/lib/exe-ssh.js` | SSH automation for exe.dev |
| `skills/exe/SKILL.md` | exe.dev deployment skill |

### Cache Locations

There are two cache locations by design:

1. **`/cache/`** (gitignored) - Working cache updated by the sync script
2. **`skills/vibes/cache/`** (git-tracked) - Default values shipped with the plugin

The sync script updates `/cache/` and the template files. The `skills/vibes/cache/` provides fallback values for users who haven't run sync yet.

## Architecture: JSX + Babel

The plugin now uses **JSX with Babel transpilation** (matching vibes.diy exactly):

1. **Model outputs JSX** - Standard React syntax, faster to generate
2. **Babel transpiles at runtime** - `<script type="text/babel">` in template
3. **Assembly script** - `node scripts/assemble.js app.jsx index.html`

This architecture matches vibes.diy and significantly improves generation speed.

## The React Singleton Problem

### Understanding the Architecture

vibes.diy uses import maps - a browser-native feature (since March 2023) that maps bare specifiers like `"react"` to CDN URLs.

### The Core Problem

**Import maps can only intercept bare specifiers**, not absolute URL paths:

| Import Type | Example | Import Map Intercepts? |
|-------------|---------|------------------------|
| Bare specifier | `import "react"` | ✅ Yes |
| Absolute path | `import "/react@19.2.1"` | ❌ No |

When esm.sh bundles `use-vibes`, internal React imports become absolute paths:
```javascript
import "/react@>=19.1.0?target=es2022";  // Resolved relative to esm.sh origin
```

**Result**: Our import map provides React 19.2.1, but use-vibes loads React 19.2.3 → TWO React instances → context fails.

### The Solution: `?external=`

From Preact's no-build workflow guide and esm.sh documentation:

> "By using `?external=preact`, we tell esm.sh that it shouldn't provide a copy of preact... the browser will use our importmap to resolve `preact`, using the same instance as the rest of our code."

The `?external=` parameter tells esm.sh to keep specified dependencies as **bare specifiers** so our import map can intercept them.

### esm.sh Query Parameters

| Parameter | Syntax | Effect |
|-----------|--------|--------|
| `?external=` | `?external=react,react-dom` | **Recommended.** Keeps bare specifiers for import map resolution |
| `?deps=` | `?deps=react@19.2.1` | Forces specific dependency versions at build time |
| `?alias=` | `?alias=react:react@19.2.1` | Rewrites import specifiers at build time (less reliable for no-build) |
| `*` prefix | `https://esm.sh/*pkg@ver` | Marks ALL deps as external (exposes internal deps) |

### Correct Import Map

```json
{
  "imports": {
    "react": "https://esm.sh/react",
    "react-dom": "https://esm.sh/react-dom",
    "react-dom/client": "https://esm.sh/react-dom/client",
    "react/jsx-runtime": "https://esm.sh/react/jsx-runtime",
    "use-fireproof": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom",
    "call-ai": "https://esm.sh/call-ai@0.18.9?external=react,react-dom",
    "use-vibes": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom"
  }
}
```

**Key points:**
- Version `0.18.9` is stable (dev versions have bugs)
- Unpinned React lets esm.sh resolve compatible version
- `?external=react,react-dom` ensures import map controls React

## Skills vs Commands

This plugin provides both skills and commands. Understanding when each is used:

### Skills (Auto-triggered by Claude)

| Skill | Triggered When | Description |
|-------|----------------|-------------|
| `/vibes:vibes` | User asks to "build an app", "create a todo list", etc. | Generates a single Vibes app |
| `/vibes:riff` | User asks to "explore ideas", "generate variations", "riff on X" | Generates multiple app variations in parallel |
| `/vibes:sell` | User asks to "monetize", "add billing", "make it SaaS" | Transforms app into multi-tenant SaaS |

Claude automatically selects the appropriate skill based on user intent. The skill description in the YAML frontmatter guides this selection.

### Commands (User-invoked)

| Command | When to Use | Description |
|---------|-------------|-------------|
| `/vibes:sync` | Periodically (every 30 days) or when docs seem stale | Updates cached documentation and import maps |
| `/vibes:update` | When existing app has outdated imports or patterns | Deterministic updater for existing apps |

Commands are explicitly invoked by the user with the `/` prefix.

### Selection Logic

- **vibes vs riff**: "Make me an app" → vibes (single). "Give me 5 variations" → riff (multiple).
- **vibes vs sell**: "Build X" → vibes. "Build X with billing" or "monetize my app" → sell.
- **sync**: Only when user explicitly runs `/vibes:sync` or skill warns about stale cache.
- **update**: Only when user explicitly runs `/vibes:update` on existing HTML files.

## exe.dev Deployment

Deploy static Vibes apps to exe.dev VM hosting. Uses pre-installed nginx on persistent VMs.

### Quick Start

```bash
# Deploy to exe.dev
node scripts/deploy-exe.js --name myapp --file index.html
```

### Architecture

```
exe.dev VM (exeuntu image)
├── nginx (serves all subdomains)
└── /var/www/html/index.html
```

### Multi-Tenant Support

For apps needing tenant isolation, use client-side subdomain parsing:
- Configure wildcard DNS: `*.myapp.com` → VM IP
- Set up wildcard SSL via certbot
- JavaScript reads `window.location.hostname` and uses subdomain as Fireproof database prefix

### Prerequisites

- SSH key in `~/.ssh/`
- exe.dev account (run `ssh exe.dev` to create)

### Related Files

- `scripts/deploy-exe.js` - Deployment automation
- `scripts/lib/exe-ssh.js` - SSH helpers
- `skills/exe/SKILL.md` - Deployment skill
- `commands/deploy-exe.md` - User command

## Known Issues

### React Context Error Symptoms

If you see these errors, React is being duplicated:
- `TypeError: Cannot read properties of null (reading 'useContext')`
- Page becomes unresponsive after focusing text inputs
- Controlled inputs trigger infinite render loops

**Fix:** Ensure all `use-vibes` and `call-ai` imports have `?external=react,react-dom`

### VibeContextProvider NOT Required

`VibeContextProvider` is used internally by the vibes.diy platform for database naming. **Standalone apps do NOT need it** - just render your App component directly with the VibesSwitch toggle.

## Plugin Versioning

When releasing a new version, update the version number in **both** files to comply with Claude Code plugin standards:

1. `.claude-plugin/plugin.json` - The main plugin manifest
2. `.claude-plugin/marketplace.json` - The marketplace metadata (in the `plugins` array)

Both files must have matching version numbers.

## Commit Messages

Do not credit Claude Code when making commit messages.
