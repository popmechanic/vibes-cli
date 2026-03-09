# Registry-Only Connect URL Management

**Date:** 2026-03-08
**Status:** Approved
**Problem:** Connect URLs stored in project root `.env` leak between apps, causing sync failures when switching between apps in the editor or CLI.

## Context

The "seq" app deployed with Connect URLs from a different app (`going-for-the-win`) because both the CLI assembler and editor write/read Connect URLs through a shared `.env` file at the project root. The registry (`~/.vibes/deployments.json`) already tracks per-app Connect URLs correctly, but the CLI path bypasses it.

## Design

### Core Principles

1. Registry (`~/.vibes/deployments.json`) is the single source of truth for Connect URLs.
2. Connect URLs are injected at deploy time only, never at assembly time.
3. `deploy-cloudflare.js` is the single entry point — takes `app.jsx`, assembles, injects, deploys.
4. `.env` is eliminated — no file-based config for Connect or credentials.

### State Machine

```
App Code (app.jsx)
    │
    ▼ deploy (single command)
Assemble → Registry Lookup → Inject URLs → Upload
                │
                ├─ first deploy: alchemy provisions → registry writes
                └─ subsequent: registry reads cached URLs
```

Two states per app: **no Connect** or **has Connect**. One transition: first deploy. One read path: deploy time.

### CLI Interface

```bash
# New (single step):
bun scripts/deploy-cloudflare.js --name seq --app app.jsx

# Legacy (pre-assembled HTML):
bun scripts/deploy-cloudflare.js --name seq --file index.html
```

### Changes

#### 1. `deploy-cloudflare.js` — unified entry point

- Accepts `--app app.jsx` (new) or `--file index.html` (existing)
- When `--app`: calls assembly internally, then injects Connect URLs from registry, then uploads
- When `--file`: injects Connect URLs from registry into pre-assembled HTML, then uploads
- First deploy: provisions via alchemy, saves to registry, then injects
- OpenRouter key: `process.env.OPENROUTER_API_KEY` or `--ai-key` flag (no `.env` reading)

#### 2. `assemble.js` — pure template assembler

- Removes all `.env` reading (`loadEnvFile` calls)
- Removes `populateConnectConfig()` call
- Only does: read template + insert app code + inject OIDC constants + validate + write
- Output has empty/placeholder Connect URLs — deploy handles injection

#### 3. `scripts/lib/env-utils.js` — remove file I/O

- Remove `loadEnvFile()`, `writeEnvFile()`
- Keep `populateConnectConfig()` — both deploy paths use it for regex replacement

#### 4. `scripts/server/router.ts` — remove `editorSaveCredentials`

- No longer writes Connect URLs to `.env`
- Editor deploy handler already reads registry — unaffected

### What stays the same

- `~/.vibes/deployments.json` schema
- Alchemy provisioning flow
- Deploy API protocol
- Editor deploy handler (`deploy.ts`) — already correct pattern
- OIDC constants — hardcoded at assembly time
- Preview path — unaffected (local-only, no Connect)

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| `--app app.jsx`, first deploy | Assemble → alchemy → registry write → inject → upload |
| `--app app.jsx`, existing app | Assemble → registry read → inject → upload |
| `--file index.html` | Registry read → inject → upload |
| `assemble.js` standalone | Pure assembly, empty Connect URLs — local preview only |
| Switch apps in editor | No leakage — deploy reads registry by app name |
| `OPENROUTER_API_KEY` needed | `process.env` or `--ai-key` flag |

### Files Touched

| File | Change |
|------|--------|
| `scripts/deploy-cloudflare.js` | Add `--app` flag, assembly, registry lookup, HTML injection |
| `scripts/assemble.js` | Remove `.env` reading and `populateConnectConfig` |
| `scripts/lib/env-utils.js` | Remove `loadEnvFile`/`writeEnvFile` |
| `scripts/server/router.ts` | Remove `editorSaveCredentials` |
| `scripts/server/handlers/deploy.ts` | No change |
| `scripts/lib/registry.js` | No change |
