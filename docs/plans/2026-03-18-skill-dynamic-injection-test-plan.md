# Test Plan: Skill Dynamic Injection

**Implementation plan:** `docs/plans/2026-03-18-skill-dynamic-injection.md`
**Test file:** `scripts/__tests__/unit/skill-injection.test.js`
**Harness:** vitest (Node environment) with `child_process.execSync` for command execution and `fs.readFileSync` for source-of-truth comparison.

---

## Harness Requirements

### Existing harness: vitest + Node environment (no build needed)

The existing vitest configuration (`scripts/vitest.config.js`) already supports:
- ESM imports from project modules (e.g., `parseSkillFrontmatter` from `server/config.js`)
- `child_process.execSync` for running shell commands and capturing output
- `fs.readFileSync` for reading source-of-truth files
- `performance.now()` for timing assertions
- Test pattern: `__tests__/**/*.test.{js,ts}`

No new harness construction is needed. All tests use the existing vitest runner and Node APIs.

### Existing harness: full test suite regression gate (no build needed)

The existing 490+ test suite (`npx vitest run` from `scripts/`) serves as the regression gate. No modifications needed.

---

## Test Plan

### 1. Import map extraction script produces output matching the authoritative base template

- **Name:** Import map extraction matches authoritative source template
- **Type:** integration
- **Disposition:** new
- **Harness:** vitest + child_process
- **Preconditions:** `source-templates/base/template.html` exists with a `<script type="importmap">` block. `scripts/lib/extract-import-map.js` exists (created by the implementation).
- **Actions:**
  1. Run `bun scripts/lib/extract-import-map.js` via `execSync` from the plugin root directory.
  2. Parse the stdout as JSON.
  3. Independently read `source-templates/base/template.html`, extract the `<script type="importmap">` content, and parse its `.imports` field.
- **Expected outcome:** The JSON object from the script output is deeply equal to the `.imports` object parsed directly from the base template HTML. Source of truth: `source-templates/base/template.html` (declared authoritative in CLAUDE.md "Package Versions" section and `.claude/rules/template-build.md`).
- **Interactions:** Exercises `bun` runtime, file system reads of the base template. If `bun` is not available or the template file is missing, this test will fail -- both conditions indicate a broken development environment.

### 2. Import map extraction script exits successfully

- **Name:** Import map extraction exits with code 0
- **Type:** integration
- **Disposition:** new
- **Harness:** vitest + child_process
- **Preconditions:** `scripts/lib/extract-import-map.js` exists. `source-templates/base/template.html` exists.
- **Actions:** Run `bun scripts/lib/extract-import-map.js` via `execSync`.
- **Expected outcome:** The command does not throw (execSync throws on non-zero exit). Output is a non-empty string. Source of truth: the `!`command`` contract requires commands to exit 0 and produce output (implementation plan, Risk Assessment section).
- **Interactions:** Same as test 1.

### 3. Import map extraction output is valid JSON with required package entries

- **Name:** Import map contains required React and Fireproof entries
- **Type:** integration
- **Disposition:** new
- **Harness:** vitest + child_process
- **Preconditions:** Same as test 1.
- **Actions:**
  1. Run `bun scripts/lib/extract-import-map.js` via `execSync`.
  2. Parse stdout as JSON.
  3. Check for required keys: `react`, `react-dom`, `@fireproof/core`, `oauth4webapi`, `use-fireproof`.
- **Expected outcome:** All five keys are present in the parsed object. Source of truth: the base template import map (verified by inspection of `source-templates/base/template.html` lines 102-115).
- **Interactions:** None beyond test 1.

### 4. Import map extraction output preserves the ?external=react,react-dom invariant

- **Name:** Extracted import map enforces React singleton pattern on Fireproof
- **Type:** invariant
- **Disposition:** new
- **Harness:** vitest + child_process
- **Preconditions:** Same as test 1.
- **Actions:**
  1. Run `bun scripts/lib/extract-import-map.js` via `execSync`.
  2. Parse stdout as JSON.
  3. Check that `@fireproof/core` value contains `?external=react,react-dom`.
- **Expected outcome:** The `?external=react,react-dom` query parameter is present. Source of truth: `.claude/rules/react-singleton.md` ("REQUIRED on any esm.sh package that depends on React") and CLAUDE.md ("Critical Rules" section).
- **Interactions:** None beyond test 1.

### 5. sell SKILL.md uses dynamic injection instead of hardcoded import map

- **Name:** sell SKILL.md import map section uses dynamic injection, not hardcoded URLs
- **Type:** integration
- **Disposition:** new
- **Harness:** vitest + fs
- **Preconditions:** `skills/sell/SKILL.md` has been edited by the implementation to replace the hardcoded import map with `!`command`` injection.
- **Actions:**
  1. Read `skills/sell/SKILL.md`.
  2. Check that it contains the `!`` injection marker referencing `extract-import-map.js`.
  3. Extract the section between `## Import Map` and the next `##` or `---` delimiter.
  4. Check that the import map section does NOT contain hardcoded esm.sh URLs with version pinning (e.g., `esm.sh/stable/react@19.2.4`).
- **Expected outcome:** The `!`command`` placeholder is present. No hardcoded esm.sh versioned URLs exist in the import map section. Source of truth: the implementation plan, Task 2 ("Replace hardcoded import map in sell/SKILL.md").
- **Interactions:** None (pure file read).

### 6. sell SKILL.md frontmatter remains valid after injection edit

- **Name:** sell SKILL.md YAML frontmatter parses correctly after dynamic injection edit
- **Type:** regression
- **Disposition:** new
- **Harness:** vitest + parseSkillFrontmatter
- **Preconditions:** `skills/sell/SKILL.md` exists and has been modified.
- **Actions:**
  1. Read `skills/sell/SKILL.md`.
  2. Pass content to `parseSkillFrontmatter()` (imported from `server/config.js`).
  3. Check that `name` equals `"sell"` and `description` is a non-empty string longer than 10 characters.
- **Expected outcome:** Frontmatter parses without error and contains expected fields. Source of truth: existing `plugin-skills.test.js` validates the same function; the sell SKILL.md is known to have `name: sell` frontmatter.
- **Interactions:** Exercises `parseSkillFrontmatter` -- a function already well-tested in `plugin-skills.test.js`.

### 7. All 8 SKILL.md files have valid frontmatter (regression gate)

- **Name:** Every skill's SKILL.md has valid frontmatter with name matching its directory
- **Type:** regression
- **Disposition:** new
- **Harness:** vitest + parseSkillFrontmatter + fs
- **Preconditions:** All 8 skill directories exist with SKILL.md files: vibes, cloudflare, sell, launch, test, upload-dmg, design, riff.
- **Actions:** For each skill:
  1. Read `skills/{skill}/SKILL.md`.
  2. Parse with `parseSkillFrontmatter()`.
  3. Assert `name` equals the directory name.
  4. Assert `description` is a non-empty string longer than 10 characters.
- **Expected outcome:** All 8 pass. Source of truth: the existing convention that each SKILL.md's `name:` field matches its directory name (observed across all 8 skills, validated by existing `plugin-skills.test.js` test patterns).
- **Interactions:** None (pure computation on file content).

### 8. Base template import map has ?external=react,react-dom on @fireproof/core (source-of-truth guard)

- **Name:** Authoritative import map enforces React singleton invariant
- **Type:** invariant
- **Disposition:** new
- **Harness:** vitest + fs
- **Preconditions:** `source-templates/base/template.html` exists.
- **Actions:**
  1. Read the base template.
  2. Extract the import map JSON.
  3. Check that `@fireproof/core` contains `?external=react,react-dom`.
- **Expected outcome:** The invariant holds. Source of truth: `.claude/rules/react-singleton.md`.
- **Interactions:** None (pure file read + JSON parse).

### 9. OIDC auth constants match expected values (source-of-truth guard)

- **Name:** auth-constants.js exports match expected OIDC authority and format
- **Type:** invariant
- **Disposition:** new
- **Harness:** vitest + fs
- **Preconditions:** `scripts/lib/auth-constants.js` exists.
- **Actions:**
  1. Read `scripts/lib/auth-constants.js`.
  2. Verify it contains `OIDC_AUTHORITY = 'https://vibesos.com'`.
  3. Verify it contains a UUID-formatted `OIDC_CLIENT_ID`.
  4. Verify it contains `DEPLOY_API_URL = 'https://share.vibesos.com'`.
- **Expected outcome:** All three constants are present with expected values. Source of truth: `scripts/lib/auth-constants.js` is the authoritative source for OIDC constants (CLAUDE.md "Non-Obvious Files" table).
- **Interactions:** This partially overlaps with `env-utils-oidc.test.js` which already tests the exported constants via import. This test reads the file directly to guard against file-level corruption or accidental edits.

### 10. plugin.json version is valid semver

- **Name:** plugin.json contains a valid semver version string
- **Type:** invariant
- **Disposition:** new
- **Harness:** vitest + fs
- **Preconditions:** `.claude-plugin/plugin.json` exists.
- **Actions:**
  1. Read and parse `.claude-plugin/plugin.json`.
  2. Assert `version` matches `/^\d+\.\d+\.\d+$/`.
- **Expected outcome:** The version field is a valid semver string. Source of truth: CLAUDE.md "Plugin Versioning" section requires version fields to exist and match.
- **Interactions:** None.

### 11. Import map extraction completes within performance budget

- **Name:** Import map extraction runs in under 500ms
- **Type:** boundary
- **Disposition:** new
- **Harness:** vitest + child_process + performance.now()
- **Preconditions:** Same as test 1.
- **Actions:**
  1. Record `performance.now()`.
  2. Run `bun scripts/lib/extract-import-map.js` via `execSync`.
  3. Record elapsed time.
- **Expected outcome:** Elapsed time is less than 500ms. This is a generous threshold; the implementation plan specifies <100ms for individual commands, but bun cold-start overhead on some machines can reach ~200ms. 500ms catches catastrophic regressions without flaking on normal variance. Source of truth: implementation plan, Design Decisions section ("The extraction command is fast (<100ms)").
- **Interactions:** Sensitive to system load and bun startup time. Unlikely to flake at 500ms but could on severely resource-constrained CI.

### 12. Full existing test suite passes (regression gate)

- **Name:** All existing 490+ tests pass after implementation changes
- **Type:** regression
- **Disposition:** existing
- **Harness:** vitest (full suite)
- **Preconditions:** `scripts/node_modules` installed.
- **Actions:** Run `cd scripts && npx vitest run`.
- **Expected outcome:** All tests pass. No new failures introduced. Source of truth: the existing passing test suite is the regression baseline.
- **Interactions:** Exercises the entire test infrastructure. Any failures here indicate either a regression from the implementation or a pre-existing instability.

---

## Coverage Summary

### Covered areas

| Area | Tests | Rationale |
|------|-------|-----------|
| Import map extraction correctness | 1, 2, 3, 4 | Core new functionality -- the extraction script must produce accurate, complete output |
| sell SKILL.md injection | 5 | The primary user-visible change -- hardcoded import map replaced with dynamic injection |
| SKILL.md frontmatter integrity | 6, 7 | Regression safety -- editing SKILL.md must not break the skill loader |
| Source-of-truth consistency | 8, 9, 10 | Guards against value drift -- the very problem this implementation solves |
| Performance | 11 | `!`command`` runs at prompt-load time; latency directly affects user experience |
| Regression safety | 12 | Full existing suite verifies no collateral damage |

### Explicitly excluded

| Area | Reason | Risk |
|------|--------|------|
| LLM behavior improvement from injected values | Cannot be tested mechanically -- the determinism improvement is a design argument, not a measurable output. The strategy acknowledged this gap explicitly. | Low. The mechanical correctness tests (1-5) ensure the right values reach the prompt. Whether the model uses them more reliably is outside the testing boundary. |
| `!`command`` substitution engine behavior | This is Claude Code infrastructure, not plugin code. We test that our commands are correct; we cannot test how Claude Code processes the `!`` syntax. | Low. The syntax is documented and used by other plugins. Failure mode is graceful (model sees raw text). |
| Other 7 SKILL.md files' content | The plan explicitly leaves them unchanged. The frontmatter integrity test (7) covers structural validity. Content-level consistency is irrelevant since no values are being changed. | Negligible. The plan's analysis of why each skill does NOT need injection is documented in the Appendix. |
| CLAUDE.md dynamic injection | Classified as a stretch target in the plan. Not part of the committed scope. | Low. CLAUDE.md version strings are developer documentation, not skill prompt content. |
