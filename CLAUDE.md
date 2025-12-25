# Vibes DIY Plugin - Development Guide

## Core Design Principle

**Match vibes.diy exactly. Never deviate.**

This plugin generates React apps that are compatible with the vibes.diy ecosystem. All configuration—import maps, package versions, style prompts—MUST come from the upstream vibes.diy repository. Do not "improve" or "optimize" by changing values.

## HTTP Server Required

**Generated apps must be served via HTTP, not opened directly as files.**

```bash
# Serve the current directory
npx serve .
# Then open http://localhost:3000
```

### Why This Is Required

When esm.sh builds `use-vibes`, it creates internal imports like:
```javascript
import "/react@>=19.1.0?target=es2022";
```

Import maps can only redirect **bare specifiers** (like `react`), not absolute URLs (like `/react@>=19.1.0`). This means:
- User code imports `react` → redirected by import map
- use-vibes imports `/react@>=19.1.0` → NOT redirected → different React instance

**Result:** Multiple React instances cause "useContext is null" errors.

vibes.diy avoids this because it runs on a single origin (https://vibes.diy) where the browser's module cache deduplicates at the network level. Standalone files via `file://` don't have this shared cache.

**Solution:** Serve via HTTP so module caching works correctly.

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
   ├── skills/vibes/SKILL.md
   └── agents/vibes-gen.md
```

### How Sync Works

The `scripts/sync.js` script (Node.js + esbuild):

1. **Fetches** from vibes.diy GitHub raw URLs
2. **Parses** TypeScript source to extract values (handles both quoted and unquoted keys)
3. **Transpiles** menu components (TSX → React.createElement) using esbuild
4. **Caches** parsed data in `/cache/` as JSON/text/JS
5. **Updates** template files by regex-replacing `<script type="importmap">` blocks

Run sync with: `/vibes:sync` or `node scripts/sync.js --force`

**Prerequisites:** Node.js 18+ (uses native fetch). Install deps: `cd scripts && npm install`

### What Gets Synced

| Source | Cache File | Updates |
|--------|------------|---------|
| `import-map.ts` | `cache/import-map.json` | Import maps in SKILL.md, vibes-gen.md |
| `style-prompts.ts` | `cache/style-prompt.txt` | UI style guidance |
| `use-fireproof.com/llms-full.txt` | `cache/fireproof.txt` | Fireproof API docs |
| `vibes-variables.css` | `cache/vibes-variables.css` | CSS variables for theming |
| `VibesSwitch/*.tsx` | `cache/vibes-menu.js` | Menu toggle component |
| `HiddenMenuWrapper/*.tsx` | `cache/vibes-menu.js` | Menu wrapper component |

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
| Opening file:// directly | Module cache doesn't work | Serve via HTTP (`npx serve .`) |
| Hardcoded versions in docs | Docs become stale | Reference cache file |
| Editing templates without running sync | Versions out of date | Always run sync after edits |

## Testing Changes

### Verify Sync Worked

```bash
# Check cache was updated (should show 9 entries)
cat cache/import-map.json | jq '.imports | keys | length'

# Check templates were updated (should show 4 occurrences)
grep -c "esm.sh/use-vibes" skills/vibes/SKILL.md
```

### Test Generated Apps

1. Generate a simple app with `/vibes:vibes`
2. Serve via HTTP: `npx serve .`
3. Open http://localhost:3000 (NOT file://)
4. Check console for errors:
   - No "useContext" errors (React duplication)
   - No "Fireproof is not defined" errors
   - No infinite loops or page lockups

## File Reference

| File | Purpose |
|------|---------|
| `scripts/assemble.js` | Assembly script - inserts JSX into template |
| `scripts/sync.js` | Sync script - fetches, transpiles, and updates |
| `scripts/package.json` | Node.js deps (esbuild) |
| `cache/import-map.json` | Working cache - package versions |
| `cache/style-prompt.txt` | Working cache - UI style guidance |
| `cache/vibes-menu.js` | Working cache - transpiled menu components |
| `cache/vibes-variables.css` | Working cache - CSS variables |
| `skills/vibes/cache/` | Default cache (git-tracked) - ships with plugin |
| `skills/vibes/SKILL.md` | Main vibes skill (has import map) |
| `agents/vibes-gen.md` | Riff generator agent (has import map) |
| `skills/sync/SKILL.md` | User-facing sync skill definition |

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

### Why HTTP Server Is Required

Files opened via `file://` don't share the browser's module cache. HTTP serving enables proper module deduplication.

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
