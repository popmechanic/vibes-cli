# Connect Cloudflare Migration Design

**Date:** 2026-03-05
**Status:** Approved
**Scope:** Migrate Connect from exe.dev VMs to Cloudflare Workers via alchemy; eliminate exe.dev entirely; auto-deploy Connect paired 1:1 with each app.

## Context

Connect (Fireproof's cloud sync backend) currently deploys to exe.dev VMs via SSH + Docker. This is a separate state machine step (CO) that blocks app generation. The upstream fireproof repo (`selem/docker-for-all` branch) now includes an "alchemy" directory — TypeScript-as-infrastructure automation that provisions Connect on Cloudflare using Workers, R2, D1, and Durable Objects.

This redesign makes Connect deployment automatic and pairs each Vibes app 1:1 with its own Connect instance on Cloudflare.

## User Model

- Single developer, desktop environment, localhost GUI + Claude Code
- One Clerk account; one Clerk application per Vibes app (each with its own pk/sk)
- Over time: dozens to hundreds (possibly low thousands) of independent apps
- Each app gets a dedicated Connect instance

## Architecture Decisions

### 1. Approach: Modular Library (Approach C)

New `lib/alchemy-deploy.js` module handles Connect provisioning. The existing `deploy-cloudflare.js` calls it on first deploy. Clean separation of concerns — alchemy logic is isolated, testable, and reusable.

**Rejected alternatives:**
- Approach A (extend deploy-cloudflare.js inline) — grows script too much, mixes concerns
- Approach B (new unified deploy-vibes.js) — too much disruption, more code than needed

### 2. Alchemy Invocation: Shallow Sparse Checkout

Clone the fireproof repo with `--depth 1 --sparse --filter=blob:none` to `~/.vibes/upstream/fireproof/`. Only checkout: `alchemy/`, `cloud/backend/cf-d1/`, `dashboard/`. Approx 5-10MB instead of the full repo. Cache persists; re-fetch with `git pull` if older than 24 hours.

**Rejected alternatives:**
- Full repo clone (too large)
- Bundle alchemy in plugin (maintenance burden, sync issues)
- npm package (requires upstream to publish)

### 3. exe.dev: Dropped Entirely

All deployments go to Cloudflare. Remove `/vibes:exe` and `/vibes:connect` as separate skills. Simplifies the pipeline to one deployment target.

### 4. Credential Timing: CR Stays First

Users provide Clerk keys per-app before generation. The state machine becomes:

```
First deploy:  CR → G → A → D(connect + app) → V
Update:         edit app.jsx → A → D(app only) → V
SaaS:          CR → G → S → A → D(connect-if-first + app) → AD → V
```

CO node eliminated. D node is "smart" — reads registry to decide first deploy vs. update.

### 5. Metadata: Global Registry

File: `~/.vibes/deployments.json`

```json
{
  "version": 1,
  "cloudflare": {
    "accountId": "abc123...",
    "workersSubdomain": "vibes-diy",
    "apiKey": "...",
    "email": "..."
  },
  "apps": {
    "my-cool-app": {
      "name": "my-cool-app",
      "createdAt": "2026-03-05T10:30:00Z",
      "updatedAt": "2026-03-05T11:45:00Z",
      "clerk": {
        "publishableKey": "pk_test_abc...",
        "secretKey": "sk_test_xyz...",
        "domain": "my-cool-app.clerk.accounts.dev"
      },
      "app": {
        "workerName": "my-cool-app",
        "kvNamespaceId": "d6dc66d0...",
        "url": "https://my-cool-app.vibes-diy.workers.dev",
        "customDomain": null
      },
      "connect": {
        "stage": "my-cool-app",
        "cloudWorkerName": "fireproof-cloud-my-cool-app",
        "dashboardWorkerName": "fireproof-dashboard-my-cool-app",
        "r2BucketName": "fp-storage-my-cool-app",
        "d1BackendName": "fp-meta-my-cool-app",
        "d1DashboardName": "fp-connect-my-cool-app",
        "apiUrl": "https://fireproof-cloud-my-cool-app.workers.dev",
        "cloudUrl": "fpcloud://fireproof-cloud-my-cool-app.workers.dev?protocol=wss",
        "deployedAt": "2026-03-05T10:32:00Z"
      }
    }
  }
}
```

Design properties:
- **Global, not per-project** — one developer manages all apps from `~/.vibes/`
- **Per-app Clerk keys** — each app has its own Clerk application
- **Wrangler-addressable** — worker names, KV IDs, D1 names stored for future operations
- **Cloudflare account info** at top level for portability across machines
- **Flat JSON** — scales to thousands of entries (500KB at 1000 apps)
- **Idempotent** — deploy script checks registry before creating anything

## New State Machine

### Hard Dependencies

```
CR → G        Generate needs Clerk keys for template
G → A         Assembly needs app.jsx
A → D         Deploy needs index.html
D → V         Verify needs live URL
```

### Node Registry (Updated)

| ID | Node | Inputs | Outputs | Skip If |
|----|------|--------|---------|---------|
| CR | CREDENTIALS | user input | Per-app Clerk pk+sk in registry | App exists in registry |
| G | GENERATE | user prompt | app.jsx | app.jsx exists (ask reuse) |
| S | SELL | app context | sell config | not SaaS path |
| A | ASSEMBLE | app.jsx + registry | index.html | -- |
| D | DEPLOY | index.html + registry | live URL (+ connect if first) | -- |
| AD | ADMIN_SETUP | deployed URL | admin ID | not SaaS; or cached |
| V | VERIFY | live URL | user confirmation | -- |

## New Module: lib/alchemy-deploy.js

### Interface

```javascript
async function deployConnect({
  appName,              // Stage name (= app name)
  clerkPublishableKey,
  clerkSecretKey,
  cloudflareApiKey,
  cloudflareEmail,
  cacheDir,             // Default: ~/.vibes/upstream/fireproof/
  dryRun
}) → {
  apiUrl,               // https://fireproof-cloud-{stage}.workers.dev
  cloudUrl,             // fpcloud://...
  cloudWorkerName,
  dashboardWorkerName,
  r2BucketName,
  d1BackendName,
  d1DashboardName
}
```

### Responsibilities

1. **Sparse checkout management** — Clone/update repo to cache dir
2. **Environment preparation** — Generate alchemy `.env` from registry + crypto-utils
3. **Alchemy execution** — `pnpm alchemy:deploy -- --stage {app-name}`
4. **Verification** — Run `alchemy.verify.ts` to confirm health
5. **Output extraction** — Parse deployed resource metadata
6. **Registry update** — Write connect metadata to deployments.json

### Sparse Checkout Commands

```bash
git clone --depth 1 --sparse --filter=blob:none \
  https://github.com/fireproof-storage/fireproof.git \
  --branch selem/docker-for-all \
  ~/.vibes/upstream/fireproof/

cd ~/.vibes/upstream/fireproof/
git sparse-checkout set alchemy/ cloud/backend/cf-d1/ dashboard/
```

## New Module: lib/registry.js

Centralized read/write for `~/.vibes/deployments.json`.

```javascript
function loadRegistry() → Registry
function saveRegistry(registry) → void
function getApp(name) → AppEntry | null
function setApp(name, entry) → void
function getCloudflareConfig() → { accountId, workersSubdomain, apiKey, email }
function setCloudflareConfig(config) → void
function migrateFromLegacy(envVars, connectFile) → void
```

## Changes to deploy-cloudflare.js

### First Deploy Flow

```
Called with --name my-app
  ├─ Read ~/.vibes/deployments.json
  ├─ App exists in registry?
  │
  ├─ NO (first deploy):
  │   ├─ Prompt for Clerk keys (or read from CLI args)
  │   ├─ Call alchemy-deploy.js → get Connect URLs + metadata
  │   ├─ Write Connect metadata to registry
  │   ├─ Re-assemble index.html with real Connect URLs
  │   ├─ Deploy app worker (existing logic)
  │   └─ Write app metadata to registry
  │
  └─ YES (update):
      ├─ Read existing Connect URLs from registry
      ├─ Re-assemble index.html with stored URLs
      ├─ Deploy app worker (existing logic)
      └─ Update "updatedAt" in registry
```

### Existing Logic Preserved

- KV namespace creation for subdomain registry
- Wrangler secret setting (CLERK_PEM_PUBLIC_KEY, etc.)
- Asset copying (index.html, bridge bundle, assets/)
- Wrangler deploy for the app worker

## Skill Changes

### Removed

| Skill | Reason |
|-------|--------|
| `/vibes:connect` | Connect deploys automatically on first app deploy |
| `/vibes:exe` | exe.dev dropped entirely |

### Modified

| Skill | Changes |
|-------|---------|
| `/vibes:vibes` | Remove Connect pre-flight check. CR means "provide per-app Clerk keys." |
| `/vibes:sell` | Same Connect pre-flight removal. Assembly reads from registry. |
| `/vibes:cloudflare` | Primary deploy skill. Gains first-deploy orchestration (connect + app). |
| `/vibes:launch` | Remove T3 (Deploy Connect). Connect embedded in deploy step. |
| `/vibes:test` | Test Cloudflare-only flow. Remove exe.dev phases. |
| `/vibes:riff` | Remove exe.dev deploy option. |

## File Changes

### Removed

| File | Reason |
|------|--------|
| `scripts/deploy-connect.js` | Replaced by `lib/alchemy-deploy.js` |
| `scripts/deploy-exe.js` | exe.dev dropped |
| `scripts/lib/exe-ssh.js` | No more SSH |
| `scripts/lib/deploy-utils.js` | Only used by exe/connect deploys |
| `skills/connect/` | Skill removed |
| `skills/exe/` | Skill removed |
| `commands/connect.md` | Command removed |
| `commands/exe.md` | Command removed |

### Added

| File | Purpose |
|------|---------|
| `scripts/lib/alchemy-deploy.js` | Connect provisioning via alchemy |
| `scripts/lib/registry.js` | Read/write `~/.vibes/deployments.json` |

### Modified

| File | Changes |
|------|---------|
| `CLAUDE.md` | Update state machine, file reference, remove exe.dev sections |
| `hooks/session-context.md` | Remove connect/exe from dispatch table |
| `hooks/session-start.sh` | Detect registry instead of .env/.connect |
| `README.md` | Remove connect/exe skills |
| `.codex/vibes-bootstrap.md` | Remove connect/exe from skills table |
| `scripts/lib/env-utils.js` | Registry-aware config loading |
| `scripts/assemble.js` | Read Connect URLs from registry |
| `scripts/assemble-sell.js` | Same |
| `scripts/deploy-cloudflare.js` | Add first-deploy detection + alchemy integration |
| `skills/vibes/SKILL.md` | Remove Connect pre-flight gate |
| `skills/sell/SKILL.md` | Remove Connect dependency |
| `skills/launch/SKILL.md` | Remove T3, simplify pipeline |
| `skills/launch/LAUNCH-REFERENCE.md` | Update dependency graph |
| `skills/test/SKILL.md` | Cloudflare-only test flow |

## Migration & Backward Compatibility

On first deploy after update, if legacy `.env` + `.connect` exist:

1. Read `.env` for Clerk keys and Connect URLs
2. Read `.connect` for studio metadata
3. Create `~/.vibes/deployments.json` with migrated data
4. Log deprecation notice — existing exe.dev Connect still works
5. New deploys use Cloudflare Connect path

## Cloudflare Credentials

Alchemy requires `CLOUDFLARE_API_KEY` and `CLOUDFLARE_EMAIL` (Global API Key, not scoped token). Since wrangler may use OAuth, the deploy script prompts for the API key on first use and stores it in the registry under `cloudflare.apiKey`.

## Open Questions (for Implementation Planning)

1. Can alchemy be called programmatically from Node.js or only via CLI?
2. How does alchemy report resource IDs — stdout, state files, or return values?
3. What's the `.alchemy/` state directory format?
4. Error handling and rollback behavior when alchemy deployment partially fails?
5. Does the Cloudflare Workers subdomain need to be discovered or is it predictable?
