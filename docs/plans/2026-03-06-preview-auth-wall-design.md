# Preview Auth Wall Fix — Conditional OIDC Auth in Delta Template

**Date**: 2026-03-06
**Branch**: claude/elegant-nobel (Pocket ID)

## Problem

The OIDC delta template (`skills/vibes/template.delta.html`) wraps all apps in an always-on auth gate. During editor preview, this blocks the app behind a sign-in wall even though no sync is needed. Main branch solves this with a conditional pattern: no Connect URLs = local-only (no auth, no sync).

## Design

Port main's conditional pattern to the OIDC delta template.

### AppWrapper changes

Add Connect and OIDC detection:
```javascript
const hasConnect = !!(config?.tokenApiUri && config?.cloudBackendUrl &&
  !config.tokenApiUri.startsWith('__') && !config.cloudBackendUrl.startsWith('__'));
const hasOidc = !!(config?.oidcAuthority && !config.oidcAuthority.startsWith('__') &&
  config?.oidcClientId && !config.oidcClientId.startsWith('__'));
```

Three paths:
1. `!hasConnect` → local-only: `<HiddenMenuWrapper><App /></HiddenMenuWrapper>`
2. `hasConnect && !hasOidc` → `<ConfigError />` (missing OIDC config)
3. Both present → full OIDC auth gate (existing code)

### initApp() changes

Only dynamically import the OIDC bridge when Connect is configured. Skip import for local-only mode.

## Files

| File | Change |
|------|--------|
| `skills/vibes/template.delta.html` | Conditional AppWrapper + initApp |
| Generated: `skills/vibes/templates/index.html` | Rebuild via merge-templates.js |

## Verification

1. Restart editor server from worktree
2. Generate an app — preview should show the app without auth wall
3. Verify no console errors about missing OIDC config in local-only mode
