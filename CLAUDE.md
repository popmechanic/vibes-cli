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

The `scripts/fetch-prompt.ts` script:

1. **Fetches** from vibes.diy GitHub raw URLs
2. **Parses** TypeScript source to extract values (handles both quoted and unquoted keys)
3. **Caches** parsed data in `/cache/` as JSON/text
4. **Updates** template files by regex-replacing `<script type="importmap">` blocks

Run sync with: `/vibes:sync` or `bun scripts/fetch-prompt.ts --force`

### What Gets Synced

| Source | Cache File | Updates |
|--------|------------|---------|
| `import-map.ts` | `cache/import-map.json` | Import maps in SKILL.md, vibes-gen.md |
| `style-prompts.ts` | `cache/style-prompt.txt` | UI style guidance |
| `use-fireproof.com/llms-full.txt` | `cache/fireproof.txt` | Fireproof API docs |

## Critical Rules

### 1. NEVER Hardcode Import Map Values

Let the sync script update templates from cache:

```bash
bun scripts/fetch-prompt.ts --force
```

### 2. NEVER Add Query Parameters

vibes.diy does not use `?external=` or other esm.sh query parameters. Adding them causes page lockups and infinite loops.

### 3. Include ALL Import Entries

The import map requires 9 entries including absolute URL remappings:

```json
{
  "react": "https://esm.sh/react@...",
  "react-dom": "https://esm.sh/react-dom@...",
  "react-dom/client": "https://esm.sh/react-dom@.../client",
  "react/jsx-runtime": "https://esm.sh/react@.../jsx-runtime",
  "use-fireproof": "https://esm.sh/use-vibes@...",
  "call-ai": "https://esm.sh/call-ai@...",
  "use-vibes": "https://esm.sh/use-vibes@...",
  "https://esm.sh/use-fireproof": "https://esm.sh/use-vibes@...",
  "https://esm.sh/use-vibes": "https://esm.sh/use-vibes@..."
}
```

The last two entries (absolute URL remappings) are REQUIRED to prevent duplicate React instances.

### 4. NEVER Update Documentation Examples Manually

Import map examples in documentation become stale. Reference `cache/import-map.json` instead of embedding versions.

## Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| Hardcoded versions in docs | Docs become stale | Reference cache file |
| Missing `react/jsx-runtime` | Build errors | Run sync to get all entries |
| Missing absolute URL remappings | Multiple React instances, context errors | Include all 9 import entries |
| Adding `?external=react,react-dom` | Page lockup, infinite loops | Never add—vibes.diy doesn't use it |
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
| `scripts/fetch-prompt.ts` | Sync script - fetches and updates |
| `cache/import-map.json` | Working cache (gitignored) - updated by sync |
| `cache/style-prompt.txt` | Working cache (gitignored) - updated by sync |
| `skills/vibes/cache/` | Default cache (git-tracked) - ships with plugin |
| `skills/vibes/SKILL.md` | Main vibes skill (has import map) |
| `agents/vibes-gen.md` | Riff generator agent (has import map) |
| `commands/sync.md` | User-facing sync command definition |

### Cache Locations

There are two cache locations by design:

1. **`/cache/`** (gitignored) - Working cache updated by the sync script
2. **`skills/vibes/cache/`** (git-tracked) - Default values shipped with the plugin

The sync script updates `/cache/` and the template files. The `skills/vibes/cache/` provides fallback values for users who haven't run sync yet.

## Known Issues

### use-vibes @0.19.4-dev-vibes-refactor Bug (Dec 2024)

The `@0.19.4-dev-vibes-refactor` version has a React context bug that causes page lockups when interacting with form inputs. Symptoms:
- Page becomes unresponsive after focusing text inputs
- "Cannot read properties of null (reading 'useContext')" errors
- Controlled inputs trigger infinite render loops

**Current workaround:** Use `@0.18.9` (the version deployed on vibes.diy production).

**Root cause:** The dev version has internal React imports that conflict with the user's React instance, even with proper import maps.

**TODO:** Once the dev version is fixed upstream, run `/vibes:sync` to update to the newer version.

### Unpinned React Strategy

vibes.diy uses **unpinned React URLs** (e.g., `https://esm.sh/react` without version):

```json
"react": "https://esm.sh/react"
```

NOT:
```json
"react": "https://esm.sh/react@19.2.1"
```

This lets esm.sh resolve React versions consistently between user code and use-vibes internals, preventing duplicate instances.

## Commit Messages

Do not credit Claude Code when making commit messages.
