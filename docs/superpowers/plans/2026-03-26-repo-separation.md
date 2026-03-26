# Repo Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic vibes-skill repo into three: VibesOS (public plugin), vibes-infra (private backend), vibes-dev-tools (private eval/autoresearch).

**Architecture:** Sequential extraction via `git filter-repo` on fresh clones, followed by cleanup of the original repo. Each new repo gets its own CLAUDE.md seeded from migrated sections. Cross-repo communication is only via HTTPS APIs and OIDC.

**Tech Stack:** git, git-filter-repo, GitHub CLI (gh), bash

**Spec:** `docs/superpowers/specs/2026-03-26-repo-separation-design.md`

---

### Task 1: Prerequisites and Safety Snapshot

**Files:**
- None created/modified in the working repo

- [ ] **Step 1: Install git-filter-repo if needed**

```bash
git filter-repo --version 2>/dev/null || brew install git-filter-repo
```

Expected: version string like `git-filter-repo 2.x.x`

- [ ] **Step 2: Verify GitHub CLI is authenticated**

```bash
gh auth status
```

Expected: `Logged in to github.com`

- [ ] **Step 3: Create a safety tag on the current state**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill
git tag pre-repo-split
git push origin pre-repo-split
```

This tag preserves the exact state before any changes. If anything goes wrong, `git checkout pre-repo-split` recovers everything.

- [ ] **Step 4: Ensure working tree is clean**

```bash
git status --porcelain
```

Expected: no output (or only untracked/gitignored files). If there are uncommitted changes, commit or stash them first.

---

### Task 2: Create vibes-infra Repo via git filter-repo

**Files:**
- Create: `/Users/marcusestes/Websites/VibesCLI/vibes-infra/` (new repo clone)

- [ ] **Step 1: Clone the current repo to a fresh directory**

```bash
git clone /Users/marcusestes/Websites/VibesCLI/vibes-skill /Users/marcusestes/Websites/VibesCLI/vibes-infra
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
git remote remove origin
```

- [ ] **Step 2: Run git filter-repo to keep only infra paths**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
git filter-repo \
  --path deploy-api/ \
  --path dispatch-worker/ \
  --path ai-worker/ \
  --path alchemy/ \
  --path scripts/install-worker/ \
  --path scripts/__tests__/unit/install-worker.test.js \
  --path scripts/lib/jwt-validation.js \
  --path scripts/__tests__/unit/jwt-validation.test.js \
  --path scripts/__tests__/unit/jwt-sync-check.test.js \
  --path scripts/__tests__/unit/ai-proxy.test.js \
  --path scripts/install.sh \
  --path scripts/build-desktop.sh \
  --path scripts/templates/ \
  --path scripts/deployables/ \
  --path skills/cloudflare/worker/ \
  --path skills/upload-dmg/ \
  --path vibes-desktop/ \
  --path .env \
  --path .env.backup \
  --path .env.example \
  --path .connect \
  --path wrangler.jsonc \
  --path wrangler.jsonc.bak \
  --force
```

Expected: `Parsed N commits` message. The repo now contains only infra files with preserved history.

- [ ] **Step 3: Verify the filter-repo result**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
find . -not -path './.git/*' -not -name '.git' -type f | head -40
git log --oneline -5
```

Expected: Only infra files remain. Recent commits should reference infra-related changes.

---

### Task 3: Set Up vibes-infra (CLAUDE.md, setup-deps, gitignore)

**Files:**
- Create: `/Users/marcusestes/Websites/VibesCLI/vibes-infra/CLAUDE.md`
- Create: `/Users/marcusestes/Websites/VibesCLI/vibes-infra/scripts/setup-deps.sh`
- Create: `/Users/marcusestes/Websites/VibesCLI/vibes-infra/.gitignore`

- [ ] **Step 1: Create CLAUDE.md for vibes-infra**

Read the current CLAUDE.md from the original repo at `/Users/marcusestes/Websites/VibesCLI/vibes-skill/CLAUDE.md` and extract the following sections into a new CLAUDE.md for vibes-infra:

Sections to extract (copy verbatim, then update file paths to be relative to the new repo root):
- Lines 74-87: **Deploy Workflow** (the full section — but reframe as server-side documentation, not client instructions)
- Lines 88-150: **Desktop App** and ALL sub-sections (First-Launch Setup, Code Signing & Notarization, DMG Gotchas, Key Files, Desktop-Specific Behavior, External Link Handling)
- Lines 211-212 from Non-Obvious Files: the `deploy-api/` and `dispatch-worker/` rows

Add a new header section:

```markdown
# vibes-infra — Backend Infrastructure

Private repository for VibesOS backend services and desktop app.

## Repos

| Repo | Purpose |
|------|---------|
| **vibes-infra** (this repo) | Backend workers, identity, desktop app |
| [VibesOS](https://github.com/popmechanic/VibesOS) | Public plugin (skills, CLI, GUI) |
| vibes-dev-tools | Eval/autoresearch tooling |

## Workers

| Worker | Directory | Deployed To |
|--------|-----------|-------------|
| Deploy API | `deploy-api/` | share.vibesos.com |
| Sync Dispatcher | `dispatch-worker/` | WebSocket sync |
| AI Proxy | `ai-worker/` | ai.vibesos.com |
| Pocket ID | `alchemy/` | vibesos.com |
| Install Worker | `scripts/install-worker/` | install.vibesos.com |
| Registry Worker | `skills/cloudflare/worker/` | vibes-registry |

## Desktop Build

Requires a local VibesOS checkout. Run `scripts/setup-deps.sh` first.
```

Then append the extracted Desktop App and Deploy Workflow sections below.

- [ ] **Step 2: Create setup-deps.sh**

Write to `/Users/marcusestes/Websites/VibesCLI/vibes-infra/scripts/setup-deps.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Clone or update VibesOS plugin repo for desktop builds.
# Override checkout location with VIBES_PLUGIN_DIR env var.

VIBES_PLUGIN_DIR="${VIBES_PLUGIN_DIR:-$(cd "$(dirname "$0")/.." && pwd)/../VibesOS}"

if [ -d "$VIBES_PLUGIN_DIR/.git" ]; then
  echo "Updating VibesOS at $VIBES_PLUGIN_DIR..."
  git -C "$VIBES_PLUGIN_DIR" pull --ff-only
else
  echo "Cloning VibesOS to $VIBES_PLUGIN_DIR..."
  git clone https://github.com/popmechanic/VibesOS.git "$VIBES_PLUGIN_DIR"
fi

echo "VibesOS available at $VIBES_PLUGIN_DIR"
```

```bash
chmod +x /Users/marcusestes/Websites/VibesCLI/vibes-infra/scripts/setup-deps.sh
```

- [ ] **Step 3: Update build-desktop.sh to use VIBES_PLUGIN_DIR**

In `/Users/marcusestes/Websites/VibesCLI/vibes-infra/scripts/build-desktop.sh`, find the line that sets the plugin source directory for rsync (look for the rsync command that copies plugin files into `.app/Contents/Resources/vibes-plugin/`). Update it to use:

```bash
VIBES_PLUGIN_DIR="${VIBES_PLUGIN_DIR:-$(cd "$(dirname "$0")/.." && pwd)/../VibesOS}"
```

instead of any hardcoded path like `$(dirname "$0")/..` that assumed the plugin was in the same repo.

- [ ] **Step 4: Create .gitignore for vibes-infra**

Write to `/Users/marcusestes/Websites/VibesCLI/vibes-infra/.gitignore`:

```
.DS_Store
node_modules/
.wrangler/
.env
.env.backup
.connect
.dev.vars*
alchemy/.alchemy/
dist/
vibes-desktop/artifacts/
vibes-desktop/build/
```

- [ ] **Step 5: Manually copy gitignored files that filter-repo skipped**

These files exist on disk in the original repo but are gitignored, so filter-repo didn't capture them:

```bash
# Only copy if they exist in the original repo
cp /Users/marcusestes/Websites/VibesCLI/vibes-skill/.env /Users/marcusestes/Websites/VibesCLI/vibes-infra/.env 2>/dev/null || true
cp /Users/marcusestes/Websites/VibesCLI/vibes-skill/.env.backup /Users/marcusestes/Websites/VibesCLI/vibes-infra/.env.backup 2>/dev/null || true
cp /Users/marcusestes/Websites/VibesCLI/vibes-skill/.connect /Users/marcusestes/Websites/VibesCLI/vibes-infra/.connect 2>/dev/null || true
```

- [ ] **Step 6: Commit setup files**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
git add CLAUDE.md scripts/setup-deps.sh .gitignore
git commit -m "chore: add CLAUDE.md, setup-deps.sh, and .gitignore for vibes-infra"
```

---

### Task 4: Create vibes-dev-tools Repo via git filter-repo

**Files:**
- Create: `/Users/marcusestes/Websites/VibesCLI/vibes-dev-tools/` (new repo clone)

- [ ] **Step 1: Clone the current repo to a fresh directory**

```bash
git clone /Users/marcusestes/Websites/VibesCLI/vibes-skill /Users/marcusestes/Websites/VibesCLI/vibes-dev-tools
cd /Users/marcusestes/Websites/VibesCLI/vibes-dev-tools
git remote remove origin
```

- [ ] **Step 2: Run git filter-repo to keep only dev-tools paths**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-dev-tools
git filter-repo \
  --path scripts/eval-harness.ts \
  --path scripts/eval-parallel.ts \
  --path scripts/eval-report.ts \
  --path scripts/eval-scoring.ts \
  --path scripts/eval-ssr-check.ts \
  --path scripts/eval-static-check.js \
  --path scripts/verify-tinybase-fixtures.mjs \
  --path scripts/verify-tinybase-fixtures.sh \
  --path skills/autoresearch/ \
  --path autoresearch-vibes/ \
  --path eval/ \
  --path eval-results-playground.html \
  --path eval-test.html \
  --path .claude/agents/autoresearch-cross-pollinator.md \
  --path .claude/agents/autoresearch-generator.md \
  --path .claude/agents/autoresearch-mutator.md \
  --path .claude/agents/autoresearch-orchestrator.md \
  --path .claude/agents/autoresearch-red-teamer.md \
  --path .claude/agent-memory/autoresearch-cross-pollinator/ \
  --path .claude/agent-memory/autoresearch-red-teamer/ \
  --path scripts/__tests__/unit/eval-ablation.test.ts \
  --path scripts/__tests__/unit/eval-directives.test.ts \
  --path scripts/__tests__/unit/eval-harness.test.ts \
  --path scripts/__tests__/unit/eval-report.test.ts \
  --path scripts/__tests__/unit/eval-scoring.test.ts \
  --path scripts/__tests__/unit/eval-shim.test.js \
  --path scripts/__tests__/unit/eval-ssr-check.test.ts \
  --path scripts/__tests__/unit/eval-static-check.test.js \
  --path scripts/__tests__/integration/eval-assembly.test.js \
  --path scripts/__tests__/integration/eval-pipeline.test.ts \
  --path scripts/__tests__/integration/eval-sync-replay.test.ts \
  --force
```

Expected: `Parsed N commits`. Only eval/autoresearch files remain.

- [ ] **Step 3: Verify the filter-repo result**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-dev-tools
find . -not -path './.git/*' -not -name '.git' -type f | head -30
```

---

### Task 5: Set Up vibes-dev-tools (CLAUDE.md, package.json, gitignore)

**Files:**
- Create: `/Users/marcusestes/Websites/VibesCLI/vibes-dev-tools/CLAUDE.md`
- Create: `/Users/marcusestes/Websites/VibesCLI/vibes-dev-tools/scripts/package.json`
- Create: `/Users/marcusestes/Websites/VibesCLI/vibes-dev-tools/.gitignore`

- [ ] **Step 1: Create CLAUDE.md for vibes-dev-tools**

Read the current CLAUDE.md from `/Users/marcusestes/Websites/VibesCLI/vibes-skill/CLAUDE.md` and extract lines 53-68 (the Autoresearch section) verbatim.

Add a header section:

```markdown
# vibes-dev-tools — Eval & Autoresearch Tooling

Private repository for VibesOS quality and optimization tools.

## Repos

| Repo | Purpose |
|------|---------|
| [VibesOS](https://github.com/popmechanic/VibesOS) | Public plugin (skills, CLI, GUI) |
| vibes-infra | Backend workers, identity, desktop app |
| **vibes-dev-tools** (this repo) | Eval/autoresearch tooling |

## Setup

This repo operates on a local VibesOS checkout. Set `VIBES_ROOT` to point to it:

\`\`\`bash
export VIBES_ROOT=/path/to/VibesOS
cd scripts && npm install
\`\`\`

## Key Scripts

| Script | Purpose |
|--------|---------|
| `scripts/eval-ssr-check.ts` | Tier 1.5 SSR smoke test |
| `scripts/eval-harness.ts` | Tier 2 render-and-record data model harness |
| `scripts/eval-scoring.ts` | Triple-run scoring with consistency penalty |
| `scripts/eval-parallel.ts` | Orchestrator with generation loop |
| `scripts/eval-report.ts` | Final report generator |
| `scripts/eval-static-check.js` | Static analysis check |

## Agent Definitions

`.claude/agents/autoresearch-*.md` — orchestrator, mutator, generator, red-teamer, cross-pollinator

## Running Autoresearch

\`\`\`bash
VIBES_ROOT=/path/to/VibesOS bun scripts/eval-parallel.ts --mode=continuous
\`\`\`
```

Then append the extracted Autoresearch section below.

- [ ] **Step 2: Create scripts/package.json for dev-tools**

Read the current `scripts/package.json` at `/Users/marcusestes/Websites/VibesCLI/vibes-skill/scripts/package.json`. Create a new `package.json` for dev-tools that includes only the dependencies used by eval scripts. Check imports in the eval-*.ts files to determine which packages are needed. At minimum, include:
- `vitest` (test runner)
- `puppeteer` or `playwright` (if used by eval-harness.ts)
- `react` and `react-dom` (if used for SSR checks)
- Any other imports found in the eval scripts

Set the name to `vibes-dev-tools-scripts` and copy the test script configuration.

- [ ] **Step 3: Create .gitignore for dev-tools**

Write to `/Users/marcusestes/Websites/VibesCLI/vibes-dev-tools/.gitignore`:

```
.DS_Store
node_modules/
scripts/coverage/
eval/results/
```

- [ ] **Step 4: Manually copy gitignored files that filter-repo skipped**

```bash
# Only copy if they exist
cp /Users/marcusestes/Websites/VibesCLI/vibes-skill/eval-results-playground.html /Users/marcusestes/Websites/VibesCLI/vibes-dev-tools/ 2>/dev/null || true
cp /Users/marcusestes/Websites/VibesCLI/vibes-skill/eval-test.html /Users/marcusestes/Websites/VibesCLI/vibes-dev-tools/ 2>/dev/null || true
```

- [ ] **Step 5: Commit setup files**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-dev-tools
git add CLAUDE.md scripts/package.json .gitignore
git commit -m "chore: add CLAUDE.md, package.json, and .gitignore for vibes-dev-tools"
```

---

### Task 6: Create Private GitHub Repos and Push

**Files:** None (GitHub operations)

- [ ] **Step 1: Create vibes-infra repo on GitHub**

```bash
gh repo create popmechanic/vibes-infra --private --description "VibesOS backend infrastructure — Workers, Pocket ID, desktop app" --confirm
```

- [ ] **Step 2: Push vibes-infra**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
git remote add origin https://github.com/popmechanic/vibes-infra.git
git push -u origin main
```

- [ ] **Step 3: Create vibes-dev-tools repo on GitHub**

```bash
gh repo create popmechanic/vibes-dev-tools --private --description "VibesOS eval and autoresearch tooling" --confirm
```

- [ ] **Step 4: Push vibes-dev-tools**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-dev-tools
git remote add origin https://github.com/popmechanic/vibes-dev-tools.git
git push -u origin main
```

---

### Task 7: Clean Up VibesOS — Delete Extracted Files

**Files:**
- Modify: many files deleted from `/Users/marcusestes/Websites/VibesCLI/vibes-skill/`

- [ ] **Step 1: Delete vibes-infra files from VibesOS**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill
git rm -rf deploy-api/
git rm -rf dispatch-worker/
git rm -rf ai-worker/
git rm -rf alchemy/
git rm -rf vibes-desktop/
git rm -rf scripts/install-worker/
git rm -rf scripts/templates/
git rm -rf scripts/deployables/
git rm -rf skills/cloudflare/worker/
git rm -rf skills/upload-dmg/
git rm -f scripts/__tests__/unit/install-worker.test.js
git rm -f scripts/lib/jwt-validation.js
git rm -f scripts/__tests__/unit/jwt-validation.test.js
git rm -f scripts/__tests__/unit/jwt-sync-check.test.js
git rm -f scripts/__tests__/unit/ai-proxy.test.js
git rm -f scripts/install.sh
git rm -f scripts/build-desktop.sh
git rm -f wrangler.jsonc
git rm -f .env.example
```

Note: `.env`, `.env.backup`, `.connect`, `wrangler.jsonc.bak` are gitignored — just delete them from disk:

```bash
rm -f .env .env.backup .connect wrangler.jsonc.bak
```

- [ ] **Step 2: Delete vibes-dev-tools files from VibesOS**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill
git rm -f scripts/eval-harness.ts
git rm -f scripts/eval-parallel.ts
git rm -f scripts/eval-report.ts
git rm -f scripts/eval-scoring.ts
git rm -f scripts/eval-ssr-check.ts
git rm -f scripts/eval-static-check.js
git rm -f scripts/verify-tinybase-fixtures.mjs
git rm -f scripts/verify-tinybase-fixtures.sh
git rm -rf skills/autoresearch/
git rm -rf autoresearch-vibes/
git rm -f scripts/__tests__/unit/eval-ablation.test.ts
git rm -f scripts/__tests__/unit/eval-directives.test.ts
git rm -f scripts/__tests__/unit/eval-harness.test.ts
git rm -f scripts/__tests__/unit/eval-report.test.ts
git rm -f scripts/__tests__/unit/eval-scoring.test.ts
git rm -f scripts/__tests__/unit/eval-shim.test.js
git rm -f scripts/__tests__/unit/eval-ssr-check.test.ts
git rm -f scripts/__tests__/unit/eval-static-check.test.js
git rm -f scripts/__tests__/integration/eval-assembly.test.js
git rm -f scripts/__tests__/integration/eval-pipeline.test.ts
git rm -f scripts/__tests__/integration/eval-sync-replay.test.ts
```

Note: `.claude/agents/autoresearch-*.md` and `.claude/agent-memory/autoresearch-*/` are gitignored — delete from disk:

```bash
rm -f .claude/agents/autoresearch-*.md
rm -rf .claude/agent-memory/autoresearch-*/
```

Also delete gitignored eval files from disk:

```bash
rm -rf eval/
rm -f eval-results-playground.html eval-test.html
```

- [ ] **Step 3: Delete stale root files from disk**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill
rm -f VIBES-SYSTEM-PROMPT-ANALYSIS.md
rm -f package.json  # the 59-byte root one, not scripts/package.json
```

- [ ] **Step 4: Commit the deletions**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill
git add -A
git commit -m "chore: remove infra and dev-tools code extracted to private repos

Removed: deploy-api, dispatch-worker, ai-worker, alchemy, vibes-desktop,
install-worker, eval scripts, autoresearch, and related tests.
These now live in vibes-infra and vibes-dev-tools private repos."
```

---

### Task 8: Clean Up VibesOS — Update CLAUDE.md

**Files:**
- Modify: `/Users/marcusestes/Websites/VibesCLI/vibes-skill/CLAUDE.md`

- [ ] **Step 1: Remove the Autoresearch section**

Delete lines 53-68 (the `## Autoresearch (Parallel Autoresearch Engine)` section through `**Agent definitions:**...`).

- [ ] **Step 2: Remove the Desktop App section and all sub-sections**

Delete lines 88-150 (from `## Desktop App` through the end of `### External Link Handling`).

- [ ] **Step 3: Update the Deploy Workflow section**

In the `## Deploy Workflow` section (line 74), remove the third bullet point that references `dispatch-worker/`:

```
- **Sync**: Handled by TinyBase Durable Objects via the dispatch worker (`dispatch-worker/`). The DO auto-creates on first WebSocket connection — no provisioning step needed.
```

Replace with:

```
- **Sync**: Handled server-side by TinyBase Durable Objects. The DO auto-creates on first WebSocket connection — no provisioning step needed.
```

- [ ] **Step 4: Update the Agent Quick Reference table**

In the `### When to Read What` table, remove these rows:
- `| Working on scripts | scripts/package.json for deps |` — keep this one
- `| Running autoresearch | ... |` — REMOVE
- `| Autoresearch scoring/reports | ... |` — REMOVE
- `| Autoresearch test harness | ... |` — REMOVE

- [ ] **Step 5: Update the Non-Obvious Files table**

Remove these rows from the `## Non-Obvious Files` table:
- `| deploy-api/ | ... |`
- `| dispatch-worker/ | ... |`

Keep all other rows.

- [ ] **Step 6: Update the Testing section**

Remove the eval-related test commands from `## Testing`. The section should keep:
```bash
cd scripts
npm install          # First time
npm test             # All tests
npm run test:unit    # Unit only (<1 second)
npm run test:integration  # Mocked external services
npm run test:e2e:server   # E2E local server for manual testing
```

Remove any references to `test:fixtures`, eval commands, or eval-related testing.

- [ ] **Step 7: Remove .env references**

Remove any remaining references to `.env` files, `OPENROUTER_API_KEY` environment variable, or Fireproof Connect configuration in CLAUDE.md. The plugin needs no environment variables.

- [ ] **Step 8: Commit CLAUDE.md changes**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md after repo separation

Remove infra sections (desktop, deploy internals, dispatch-worker),
autoresearch/eval sections, and .env references. These now live in
the CLAUDE.md files of their respective private repos."
```

---

### Task 9: Clean Up VibesOS — Update .gitignore, README, cloudflare SKILL.md

**Files:**
- Modify: `/Users/marcusestes/Websites/VibesCLI/vibes-skill/.gitignore`
- Modify: `/Users/marcusestes/Websites/VibesCLI/vibes-skill/README.md`
- Modify: `/Users/marcusestes/Websites/VibesCLI/vibes-skill/skills/cloudflare/SKILL.md`

- [ ] **Step 1: Clean up .gitignore**

Remove these entries from `.gitignore` (they reference files/dirs that no longer exist):

```
# Fireproof Connect (auto-provisioned on deploy)
.env
.connect
fireproof/

# Alchemy state (auto-generated on deploy)
alchemy/.alchemy/

# Eval infrastructure (local autoresearch, not distributed)
eval/
.mcp.json

# Backup and temp artifacts
.env.backup
.git-backup/
.vibes-tmp/
dist/

# Root scratch files (not part of plugin)
eval-results-playground.html
eval-test.html
VIBES-SYSTEM-PROMPT-ANALYSIS.md
*.jsonc.bak

# Cloudflare worker public dir
skills/cloudflare/worker/public/
```

Keep all other entries (node_modules, build/, .DS_Store, test dirs, riff dirs, etc.).

- [ ] **Step 2: Update README.md**

Read `/Users/marcusestes/Websites/VibesCLI/vibes-skill/README.md`. Remove any references to:
- Backend workers (deploy-api, dispatch-worker, ai-worker)
- Pocket ID / alchemy
- Desktop app / ElectroBun
- Eval / autoresearch infrastructure
- Internal Cloudflare account details

Keep: plugin description, installation instructions, skills list, contributing guide, license.

- [ ] **Step 3: Update skills/cloudflare/SKILL.md**

Read `/Users/marcusestes/Websites/VibesCLI/vibes-skill/skills/cloudflare/SKILL.md`. Remove any references to `skills/cloudflare/worker/` or the registry worker deployment. The SKILL.md should only contain client-side deploy instructions (using `scripts/deploy-cloudflare.js`).

- [ ] **Step 4: Commit .gitignore, README, SKILL.md changes**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill
git add .gitignore README.md skills/cloudflare/SKILL.md
git commit -m "chore: clean up .gitignore, README, and cloudflare SKILL.md after repo split

Remove references to extracted infra/eval code."
```

---

### Task 10: Verify VibesOS

**Files:** None (verification only)

- [ ] **Step 1: Verify plugin loads**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill
claude --plugin . --version 2>&1 | head -5
```

Expected: No errors about missing files.

- [ ] **Step 2: Run tests**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/scripts
npm test
```

Expected: All remaining tests pass. No failures from missing eval/infra test subjects.

- [ ] **Step 3: Verify no dangling imports**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill
grep -r "deploy-api/" scripts/lib/ scripts/*.js scripts/*.ts 2>/dev/null || echo "No dangling deploy-api refs"
grep -r "dispatch-worker/" scripts/lib/ scripts/*.js scripts/*.ts 2>/dev/null || echo "No dangling dispatch-worker refs"
grep -r "jwt-validation" scripts/lib/ scripts/*.js scripts/*.ts 2>/dev/null || echo "No dangling jwt-validation refs"
grep -r "eval-harness\|eval-parallel\|eval-scoring\|eval-ssr-check" scripts/lib/ scripts/*.js scripts/*.ts 2>/dev/null || echo "No dangling eval refs"
```

Expected: "No dangling..." for all four checks.

- [ ] **Step 4: Push VibesOS changes**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill
git push origin main
```

---

### Task 11: Verify vibes-infra and vibes-dev-tools

**Files:** None (verification only)

- [ ] **Step 1: Verify vibes-infra has all expected files**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
test -d deploy-api && echo "✓ deploy-api" || echo "✗ deploy-api"
test -d dispatch-worker && echo "✓ dispatch-worker" || echo "✗ dispatch-worker"
test -d ai-worker && echo "✓ ai-worker" || echo "✗ ai-worker"
test -d alchemy && echo "✓ alchemy" || echo "✗ alchemy"
test -d vibes-desktop && echo "✓ vibes-desktop" || echo "✗ vibes-desktop"
test -d scripts/install-worker && echo "✓ install-worker" || echo "✗ install-worker"
test -f scripts/build-desktop.sh && echo "✓ build-desktop.sh" || echo "✗ build-desktop.sh"
test -f scripts/setup-deps.sh && echo "✓ setup-deps.sh" || echo "✗ setup-deps.sh"
test -f CLAUDE.md && echo "✓ CLAUDE.md" || echo "✗ CLAUDE.md"
```

Expected: All checks pass (✓).

- [ ] **Step 2: Verify vibes-infra setup-deps works**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
VIBES_PLUGIN_DIR=/Users/marcusestes/Websites/VibesCLI/vibes-skill bash scripts/setup-deps.sh
```

Expected: "VibesOS available at ..."

- [ ] **Step 3: Verify vibes-dev-tools has all expected files**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-dev-tools
test -f scripts/eval-harness.ts && echo "✓ eval-harness" || echo "✗ eval-harness"
test -f scripts/eval-parallel.ts && echo "✓ eval-parallel" || echo "✗ eval-parallel"
test -f scripts/eval-scoring.ts && echo "✓ eval-scoring" || echo "✗ eval-scoring"
test -f scripts/eval-ssr-check.ts && echo "✓ eval-ssr-check" || echo "✗ eval-ssr-check"
test -d skills/autoresearch && echo "✓ autoresearch skill" || echo "✗ autoresearch skill"
test -f .claude/agents/autoresearch-orchestrator.md && echo "✓ agent defs" || echo "✗ agent defs"
test -f CLAUDE.md && echo "✓ CLAUDE.md" || echo "✗ CLAUDE.md"
```

Expected: All checks pass (✓).

---

### Task 12: Rename Local Directory and Update Project Memory

**Files:**
- Modify: project memory files at `~/.claude/projects/-Users-marcusestes-Websites-VibesCLI-vibes-skill/memory/`

- [ ] **Step 1: Rename the local directory**

```bash
cd /Users/marcusestes/Websites/VibesCLI
mv vibes-skill VibesOS
```

**Note:** This will change the Claude Code project memory path. The next conversation in this directory will use a new memory path based on `VibesOS`.

- [ ] **Step 2: Verify the rename didn't break git**

```bash
cd /Users/marcusestes/Websites/VibesCLI/VibesOS
git status
git remote -v
```

Expected: `origin` still points to `popmechanic/VibesOS`. Working tree is clean.

- [ ] **Step 3: Update project memory**

In the new project memory directory (or manually copy from old), update or create memory files noting:
- The repo was split on 2026-03-26
- vibes-infra and vibes-dev-tools are private repos at the same GitHub org
- Local paths: `~/Websites/VibesCLI/VibesOS`, `~/Websites/VibesCLI/vibes-infra`, `~/Websites/VibesCLI/vibes-dev-tools`

- [ ] **Step 4: Final commit updating any remaining references**

```bash
cd /Users/marcusestes/Websites/VibesCLI/VibesOS
# Check if CLAUDE.md or any file still references vibes-skill
grep -r "vibes-skill" CLAUDE.md README.md CONTRIBUTING.md 2>/dev/null
# If found, update to VibesOS and commit
```
