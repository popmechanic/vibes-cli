# Fix Fireproof Bridge Imports

**Date:** 2026-03-07
**Branch:** fix-fireproof-bridge-imports (worktree of `upgrade`)
**Status:** Plan ready for execution

## Problem Summary

After merging disparate worktrees into `upgrade`, apps fail at runtime with:

```
fireproof-vibes-bridge.js:18 Uncaught SyntaxError: The requested module '@fireproof/clerk'
does not provide an export named 'useFireproof'
```

The root cause is a mismatch between what the bridge re-exports and what generated app code imports. There are four distinct bugs plus additional deprecated-API contamination found during code review.

---

## Bug 1 (CRITICAL): Bridge cannot provide `useFireproof` export

**Files:** `bundles/fireproof-vibes-bridge.js`, `source-templates/base/template.html`

**Root cause:** Line 17 of the bridge does `export * from "@fireproof/clerk"`. The import map resolves `@fireproof/clerk` to `@necrodome/fireproof-clerk@0.0.7`, which exports: `ClerkFireproofProvider`, `ClerkTokenStrategy`, `SignInButton`, `SignedIn`, `SignedOut`, `UserButton`, `useClerk`, `useClerkFireproofContext`, `useFireproofClerk`, `useSharing`, `useUser`. There is no `useFireproof` export. Any app code that does `import { useFireproof } from "use-fireproof"` hits this error because the import map maps `"use-fireproof"` to the bridge.

**Why `useFireproof` is needed:** The bridge should support local-only mode (no Clerk key configured) by providing `useFireproof` from the raw `use-fireproof` npm package. This is the standard Fireproof hook without auth/sync. However, importing from `"use-fireproof"` inside the bridge is circular (the import map points `"use-fireproof"` back to the bridge itself).

**Fix:**

1. Add a new import map entry in `source-templates/base/template.html`:
   ```json
   "use-fireproof-core": "https://esm.sh/stable/use-fireproof@0.24.12?external=react,react-dom"
   ```
   This gives the bridge a non-circular path to the raw package.

2. In `bundles/fireproof-vibes-bridge.js`, add:
   ```js
   import { useFireproof as _coreUseFireproof } from "use-fireproof-core";
   ```
   Then export a `useFireproof` function that delegates to `_coreUseFireproof`. This provides backward compatibility for any app code using the deprecated import name, and serves as the local-only fallback.

3. Run `node scripts/merge-templates.js --force` to regenerate all skill templates with the updated import map.

**Verification:** After rebuild, `import { useFireproof } from "use-fireproof"` resolves through the bridge, finds the named export, and works. `import { useFireproofClerk } from "use-fireproof"` continues to work via the bridge's own export + re-export from `@fireproof/clerk`.

**Detailed implementation for `bundles/fireproof-vibes-bridge.js`:**

- Add import at top: `import { useFireproof as _coreUseFireproof } from "use-fireproof-core";`
- Add export near line 23 (after the existing `useFireproofClerk` wrapper):
  ```js
  export function useFireproof(name, opts) {
    return _coreUseFireproof(name, opts);
  }
  ```
  This is a thin passthrough. It does NOT include the sync-status bridge, dashApi patching, or onTock kick that `useFireproofClerk` provides — those features require Clerk auth context. Apps using `useFireproof` get local-only Fireproof with no sync.

**Import map entry placement:** Insert after the `"@fireproof/clerk"` line in the import map in `source-templates/base/template.html` (line 114):
```json
"use-fireproof-core": "https://esm.sh/stable/use-fireproof@0.24.12?external=react,react-dom",
```

**Note on version:** `use-fireproof@0.24.12` should be verified as the current compatible version. Check the existing bundle or `docs/fireproof.txt` for the pinned version.

---

## Bug 2: Riff generation prompt teaches deprecated API

**File:** `scripts/generate-riff.js`

**Root cause:** Lines 68-71 of the prompt template instruct riff-generating agents to use:
```js
import { useFireproof } from "use-fireproof";
const { useLiveQuery, useDocument } = useFireproof("riff-db");
```

This is the deprecated local-only API. While Bug 1's fix makes this technically work again, riff apps should use the same API as vibes apps for consistency and to get sync support.

**Fix:** Update the prompt template (lines 67-71) to:
```js
import { useFireproofClerk } from "use-fireproof";

export default function App() {
  const { useLiveQuery, useDocument } = useFireproofClerk("riff-db");
```

Also update line 86 from `- Use useFireproof for all data persistence` to `- Use useFireproofClerk for all data persistence (provides sync when Clerk is configured)`.

And update line 88 reference pattern accordingly.

---

## Bug 3: assemble-sell.js regex searches for deprecated API

**File:** `scripts/assemble-sell.js`

**Root cause:** Line 308 uses:
```js
const firepoolMatch = appCode.match(/useFireproof\s*\(\s*["']([^"']+)["']\s*\)/);
```

This only matches the deprecated `useFireproof(...)` call, not the current `useFireproofClerk(...)`. If an app uses the correct API, the hardcoded-database-name warning never fires.

**Fix:** Update the regex to match both forms:
```js
const firepoolMatch = appCode.match(/useFireproof(?:Clerk)?\s*\(\s*["']([^"']+)["']\s*\)/);
```

The `(?:Clerk)?` makes "Clerk" an optional non-capturing group, matching both `useFireproof("x")` and `useFireproofClerk("x")`.

---

## Bug 4: claude-subprocess test expects `--allowedTools` but code uses `--allowedTools`

**File:** `scripts/__tests__/unit/claude-subprocess.test.js`

**Root cause analysis:** The context says `scripts/lib/claude-subprocess.js` was modified to use `--tools` instead of `--allowedTools`, plus added `--disable-slash-commands` and `--disallowed-tools` flags. However, reading the ACTUAL current code in the worktree, `claude-subprocess.js` still uses `--allowedTools` (line 54), and the test expects `--allowedTools` (lines 91-101). **These are currently in sync.**

**Decision:** The context description appears to reference changes that were planned but not yet applied to this worktree. The current code and tests match. **No change needed for Bug 4** unless the implementer confirms the CLI has actually changed its flag names. If the Claude CLI has migrated from `--allowedTools` to `--tools`, then both the source and test need updating simultaneously:

- `scripts/lib/claude-subprocess.js` line 54: `args.push('--tools', config.tools);`
- `scripts/__tests__/unit/claude-subprocess.test.js` lines 91-101: update `--allowedTools` references to `--tools`

**Action:** Implementer should run `claude --help 2>&1 | grep -E 'allowedTools|--tools'` to determine the current CLI flag name, then update both files if needed.

---

## Bug 5 (Code Review Finding): Riff delta template has duplicated sync-status bridge

**File:** `skills/riff/template.delta.html`

**Root cause:** Lines 107-146 of the riff delta template manually re-implement the sync-status bridge and onTock kick inside `initApp()`, creating a wrapped `window.useFireproofClerk`. But line 3 already imports `useFireproofClerk` from `"use-fireproof"`, which resolves to the bridge module that ALREADY wraps these behaviors. This means riff apps get double-wrapped: the bridge wraps once, then the delta wraps again.

**Impact:** Potentially double-fired sync status events, double onTock kicks, and wasted CPU on duplicate polling. Not a crash bug, but wasteful and confusing.

**Fix:** Simplify the riff delta's `initApp()` to match the vibes delta pattern (line 107 of `skills/vibes/template.delta.html`):
```js
window.useFireproofClerk = clerkModule.useFireproofClerk;
```

The bridge module already handles sync status forwarding and onTock kicks. The delta should just pass through the raw export for `window.useFireproofClerk` (used by app code that accesses it as a global).

**Note:** This is in a generated file (`skills/riff/templates/index.html`), so the fix goes in `skills/riff/template.delta.html` and gets regenerated by `merge-templates.js --force`.

---

## Execution Order

Steps must be executed in this order due to dependencies:

1. **Bug 1a** — Edit `source-templates/base/template.html`: add `"use-fireproof-core"` import map entry
2. **Bug 1b** — Edit `bundles/fireproof-vibes-bridge.js`: add `use-fireproof-core` import, add `useFireproof` export
3. **Bug 5** — Edit `skills/riff/template.delta.html`: remove duplicated sync-status bridge wrapper in `initApp()`
4. **Rebuild** — Run `node scripts/merge-templates.js --force` (regenerates all `skills/*/templates/index.html`)
5. **Bug 2** — Edit `scripts/generate-riff.js`: update prompt template to use `useFireproofClerk`
6. **Bug 3** — Edit `scripts/assemble-sell.js`: update regex to match both API forms
7. **Bug 4** — Verify CLI flag name, update `scripts/lib/claude-subprocess.js` and test if needed
8. **Test** — Run `cd scripts && npm test` to verify all tests pass
9. **Manual verification** — Generate a test app, confirm no console errors about missing exports

---

## Files Modified (Summary)

| File | Change |
|------|--------|
| `source-templates/base/template.html` | Add `use-fireproof-core` import map entry |
| `bundles/fireproof-vibes-bridge.js` | Import from `use-fireproof-core`, export `useFireproof` passthrough |
| `skills/riff/template.delta.html` | Remove duplicated sync bridge wrapper in `initApp()` |
| `scripts/generate-riff.js` | Update prompt: `useFireproof` -> `useFireproofClerk` |
| `scripts/assemble-sell.js` | Update regex: `useFireproof\s*\(` -> `useFireproof(?:Clerk)?\s*\(` |
| `scripts/lib/claude-subprocess.js` | Conditional: update `--allowedTools` to `--tools` if CLI changed |
| `scripts/__tests__/unit/claude-subprocess.test.js` | Conditional: update test expectations to match |

**Regenerated (by merge-templates.js):**
- `skills/vibes/templates/index.html`
- `skills/riff/templates/index.html`
- `skills/sell/templates/unified.html`
- `skills/design/templates/index.html`
- (all other skill templates)
