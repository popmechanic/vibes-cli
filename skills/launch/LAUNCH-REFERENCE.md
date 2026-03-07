# Launch Reference

Architecture and timing details for the `/vibes:launch` pipeline. Read this if you need background context — the main SKILL.md has all actionable instructions.

## Pipeline Overview

```
prompt → generate app.jsx → collect SaaS config → assemble → deploy → verify
```

Launch uses **Agent Teams** to run the builder in parallel with SaaS config collection. Auth and deploy credentials are fully automatic — no user setup required.

## Dependency Graph

T1 (build) runs in parallel with SaaS config collection (Phase 0.4). Both converge at T3 (assembly).

## Task Table

| Task | Subject | BlockedBy | Owner |
|------|---------|-----------|-------|
| T1 | Generate app.jsx from prompt | -- | builder |
| T3 | Run sell assembly | T1 | lead |
| T4 | Deploy to Cloudflare | T3 | lead |
| T5 | Browser verification | T4 | lead |

## Timing

| Step | Agent | Blocked By | Duration |
|------|-------|-----------|----------|
| Generate app.jsx | builder | prompt only | ~2-3 min |
| SaaS config | lead (interactive) | nothing | ~2 min |
| Sell assembly | lead | app.jsx + config | ~30 sec |
| Deploy (+ Pocket ID login) | lead | index.html | ~1 min |
| Browser test | lead (interactive) | deployed URL | ~1 min |

**Best case** (app.jsx exists): ~3-4 minutes
**Typical case** (new app): ~5-7 minutes

## Skip Modes

- `app.jsx` exists → skip T1 (ask reuse first)

## Common Builder Mistakes

Scan app.jsx for these before assembly:

1. **Hardcoded database name**: `useFireproofClerk("some-name")` → must use `useFireproofClerk(dbName)` with `const { dbName } = useTenant()`
2. **TypeScript syntax**: Remove type annotations, interface declarations, `as` casts
3. **Missing export default**: Must have `export default function App()`
4. **Import statements for React**: Remove — React is globally available
5. **Import statements for Fireproof**: Must use `import { useFireproofClerk } from "use-fireproof"`
