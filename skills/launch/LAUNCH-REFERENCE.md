# Launch Reference

Architecture and timing details for the `/vibes:launch` pipeline. Read this if you need background context — the main SKILL.md has all actionable instructions.

## Pipeline Overview

```
prompt → vibes app → Clerk setup → Connect deploy → sell transform → Cloudflare deploy → browser test
```

Launch uses **Agent Teams** to parallelize independent steps. The key insight: app generation only needs the user's prompt, so it runs in parallel with Clerk setup (the longest manual step).

## Dependency Graph

Parallel lanes: T1 || T2→T3 || T4. All converge at T5 (assembly).

## Task Table

| Task | Subject | BlockedBy | Owner |
|------|---------|-----------|-------|
| T1 | Generate app.jsx from prompt | -- | builder |
| T2 | Collect Clerk credentials | -- | lead |
| T3 | Deploy Connect studio | T2 | infra |
| T4 | Collect sell config | -- | lead |
| T5 | Run sell assembly | T1, T3, T4 | lead |
| T6 | Deploy to Cloudflare (includes webhook secret) | T5 | lead |
| T7 | Browser verification | T6 | lead |

## Timing

| Step | Agent | Blocked By | Duration |
|------|-------|-----------|----------|
| Generate app.jsx | builder | prompt only | ~2-3 min |
| Clerk dashboard setup | lead (interactive) | nothing | ~5-20 min |
| Deploy Connect | infra | Clerk pk + sk | ~5-10 min |
| Sell config | lead (interactive) | nice-to-have | ~2 min |
| Sell assembly | lead | app.jsx + .env + config | ~30 sec |
| Cloudflare deploy (+ webhook secret) | lead | sell index.html + secrets | ~2 min |
| Browser test | lead (interactive) | deployed URL | ~1 min |

**Best case** (Clerk already configured): ~8-10 minutes
**Typical case** (new Clerk app): ~20-25 minutes

## Skip Modes

- `.env` has Clerk keys + Connect URLs → skip T2 + T3 (don't spawn infra)
- `app.jsx` exists → skip T1 (ask reuse first)
- `.env` has `CLERK_ADMIN_USER_ID` → skip Phase 3 (admin setup)
- All three present → skip T1-T4, jump to Phase 2

## Common Builder Mistakes

Scan app.jsx for these before assembly:

1. **Hardcoded database name**: `useFireproofClerk("some-name")` → must use `useFireproofClerk(dbName)` with `const { dbName } = useTenant()`
2. **TypeScript syntax**: Remove type annotations, interface declarations, `as` casts
3. **Missing export default**: Must have `export default function App()`
4. **Import statements for React**: Remove — React is globally available
5. **Import statements for Fireproof**: Must use `import { useFireproofClerk } from "use-fireproof"`
