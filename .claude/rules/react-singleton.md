---
globs:
  - source-templates/**
  - skills/*/template.delta.html
  - bundles/**
description: React singleton rules for import map and esm.sh configuration
---

# The React Singleton Problem

vibes.diy uses import maps to map bare specifiers like `"react"` to CDN URLs. Import maps can only intercept bare specifiers — not absolute URL paths that esm.sh resolves internally.

When esm.sh bundles a package like `@fireproof/core`, internal React imports become absolute paths → TWO React instances → context fails.

## The Fix: `?external=react,react-dom`

This tells esm.sh to keep React as bare specifiers so our import map intercepts them. REQUIRED on any esm.sh package that depends on React.

```json
"@fireproof/core": "https://esm.sh/stable/use-fireproof@0.24.12?external=react,react-dom"
```

**Why NOT `?alias=`:** Rewrites imports at build time but doesn't prevent esm.sh from resolving its own React version for internal deps. `?external` is more reliable for no-build workflows.

## esm.sh Query Parameters

| Parameter | Effect |
|-----------|--------|
| `?external=` | **Recommended.** Keeps bare specifiers for import map resolution |
| `?deps=` | Forces specific dependency versions at build time |
| `?alias=` | Rewrites import specifiers at build time (less reliable) |
| `*` prefix | Marks ALL deps as external |

After editing the import map in `source-templates/base/template.html`, run `node scripts/merge-templates.js --force` to regenerate templates.
