# Skill Dynamic Injection Implementation Plan

> **For agentic workers:** REQUIRED: Use trycycle-executing to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `!`command`` dynamic injection placeholders to all 8 SKILL.md files to replace hardcoded values that can drift from their authoritative sources, improving prompt determinism without trade-offs.

**Architecture:** Each SKILL.md currently hardcodes values (package versions, import maps, OIDC constants, plugin version) or asks the model to discover them at runtime. The `!`command`` syntax causes Claude Code to execute a shell command at skill invocation time and substitute the output inline, so the model sees concrete values without needing to discover them. We will surgically replace specific hardcoded/discovered values with `!`command`` placeholders, then add new tests that validate the commands produce correct output and that SKILL.md frontmatter remains intact.

**Tech Stack:** Shell commands (jq, cat, grep), vitest for testing, existing SKILL.md markdown files.

---

## Design Decisions

### What qualifies for `!`command`` injection

A value qualifies for dynamic injection when ALL of these are true:
1. It has an authoritative source-of-truth file in the repo
2. It is currently hardcoded in a SKILL.md or must be discovered by the model at runtime
3. The value can drift when the source-of-truth is updated but the SKILL.md is not
4. The extraction command is fast (<100ms), deterministic, and uses only standard tools (jq, cat, grep, sed)

### What does NOT qualify

- **`${CLAUDE_SKILL_DIR}` and `${CLAUDE_PLUGIN_ROOT}` references**: These are already handled by Claude Code's text substitution at a different layer. They resolve to paths, not values. Replacing them with `!`command`` would be wrong because the current mechanism already works.
- **Bash blocks inside code fences**: The `!`command`` syntax should NOT be used inside ``` code blocks that the model is instructed to execute. Those are runtime commands, not prompt-time substitutions.
- **Values that vary per invocation context**: App names, user input, deploy URLs — these are dynamic per-session, not per-build.
- **File contents meant to be read by the model on demand**: The design tokens file, theme files, and fireproof-patterns.md are read conditionally. Injecting their full contents would bloat every invocation's prompt. The current "Read file: ..." pattern is correct.

### Concrete injection targets identified

After analyzing all 8 SKILL.md files against the source-of-truth files, here are the values that qualify:

#### 1. sell/SKILL.md — Import Map section (lines 561-573)

**Problem:** The sell SKILL.md contains a hardcoded import map that duplicates `source-templates/base/template.html`. The sell template (`skills/sell/templates/unified.html`) has its own import map, but the SKILL.md section exists to inform the model about versions. The SKILL.md copy already shows drift: it's missing `multiformats`, `@ipld/dag-cbor`, `@ipld/dag-json`, and it has a different `@fireproof/core` URL (missing `&target=es2022&deps=@adviser/cement@0.5.27`).

**Fix:** Replace the entire hardcoded import map JSON block with a `!`command`` that extracts it from the authoritative source.

**Command:** `!`jq -r '.imports' source-templates/base/template.html 2>/dev/null || echo "Run from plugin root"`

**However**, the import map is embedded in an HTML file, not a standalone JSON file. We need a more reliable extraction. A `sed`/`grep` approach is fragile. Instead, we should extract it with a small script.

**Revised approach:** Create a tiny helper script `scripts/lib/extract-import-map.js` that reads the base template and outputs the import map JSON. Then use `!`bun scripts/lib/extract-import-map.js`` in the SKILL.md.

**Why a script instead of inline shell:** The import map is embedded in `<script type="importmap">...</script>` inside HTML. Extracting it with sed/awk is fragile and non-obvious. A 10-line JS script is robust and self-documenting.

#### 2. sell/SKILL.md — Version strings in prose

The sell SKILL.md mentions "React 19" in prose (line 559: "The unified template uses React 19 with the OIDC bridge"). This is acceptable as a human-readable approximation — "React 19" won't drift to "React 20" without a major rewrite. No injection needed.

#### 3. upload-dmg/SKILL.md — Plugin version

**Problem:** The `upload-dmg` skill reads the version from `plugin.json` at runtime via `jq -r .version "$VIBES_ROOT/.claude-plugin/plugin.json"`. This is already a runtime command the model executes — it's correct as-is. However, the model must know to set `VIBES_ROOT` first. The current pattern works.

**Improvement opportunity:** We could inject the current version directly into the SKILL.md so the model sees it without running a command. But this would be misleading — the version is read at upload time, and if the user bumped it between invocations, the injected version from SKILL.md load time would be stale.

**Decision:** No change. The upload-dmg skill correctly reads the version at the moment it needs it.

#### 4. vibes/SKILL.md — Theme catalog availability

**Problem:** The vibes SKILL.md tells the model to read `${CLAUDE_SKILL_DIR}/themes/catalog.txt`. The model must discover available themes. This is correct — the catalog is a file meant to be read on demand.

**Improvement opportunity:** We could inject the list of available theme names (just names, not full content) so the model knows what themes exist before deciding whether to read the catalog. This gives the model better context.

**Command:** `!`ls -1 skills/vibes/themes/*.txt | xargs -I{} basename {} .txt | grep -v catalog | sort | paste -sd, -``

**This is a borderline case.** The catalog.txt already exists for this purpose, and injecting the theme list adds only marginal value. The model is already told to read catalog.txt first.

**Decision:** Skip. The catalog.txt file serves this purpose well. Adding a theme list injection is marginal benefit for added complexity.

#### 5. All skills using OIDC constants

**Problem:** Several SKILL.md files reference auth patterns that import from `scripts/lib/auth-constants.js`. The constants are `OIDC_AUTHORITY = 'https://vibesos.com'` and `OIDC_CLIENT_ID = '6c154be6-e6fa-47f3-ad2b-31740cedc1f1'`. These values are used in bash code blocks that the model copies and executes.

The auth check blocks in vibes/SKILL.md and launch/SKILL.md import these constants at runtime:
```bash
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '$VIBES_ROOT/scripts/lib/auth-constants.js';
```

This is already correct — the values are resolved at bash runtime, not at prompt time. No injection needed.

**Decision:** No change. The runtime import pattern is correct.

#### 6. vibes/SKILL.md — `useFireproofClerk` hook name

The SKILL.md hardcodes the hook name `useFireproofClerk` and the import `"use-fireproof"`. These are API surface names that won't change without a major version bump and coordinated update. No injection needed.

#### 7. CLAUDE.md — Package version documentation

**Problem:** CLAUDE.md states "React 19.2.4" and other version numbers. These are documentation for developers, not prompt content for the model during skill execution. CLAUDE.md is loaded as context, not as a skill.

**Improvement opportunity:** We could inject the current versions from the base template into CLAUDE.md. This would keep the developer documentation accurate.

**Command for CLAUDE.md versions:**
`!`bun -e "const fs=require('fs');const html=fs.readFileSync('source-templates/base/template.html','utf8');const m=html.match(/react@([\d.]+)/);const f=html.match(/use-fireproof@([\d.]+)/);const o=html.match(/oauth4webapi@([\d.]+)/);console.log('React '+m[1]+', use-fireproof '+f[1]+', oauth4webapi '+o[1]);"``

**However**, CLAUDE.md is not a SKILL.md. The `!`command`` syntax is documented as working in SKILL.md files specifically. We need to verify whether it also works in CLAUDE.md (which is loaded as project instructions, not as a skill).

**Decision:** Include CLAUDE.md injection as a **stretch target** only if `!`command`` is confirmed to work in CLAUDE.md files. For the plan, focus on SKILL.md files where the feature is documented.

#### 8. sell/SKILL.md — The primary high-value target

The sell SKILL.md's import map is the clearest, highest-value injection target:
- It has already drifted from the source of truth (missing packages, different query parameters)
- It's referenced by the model as the authoritative import map for the sell skill
- It can cause real bugs when the model uses stale version numbers

This is the centerpiece of the implementation.

### Summary of changes

| Target | Change | Rationale |
|--------|--------|-----------|
| `sell/SKILL.md` import map | Replace hardcoded JSON with `!`command`` | Prevents version drift, already drifted |
| `scripts/lib/extract-import-map.js` | New helper script | Extracts import map from HTML reliably |
| `scripts/__tests__/unit/skill-injection.test.js` | New test file | Validates commands, frontmatter integrity |

### What we are NOT changing

| Target | Why not |
|--------|---------|
| `vibes/SKILL.md` | Uses `${CLAUDE_SKILL_DIR}` text substitution (correct), runtime bash blocks (correct), and conditional file reads (correct design) |
| `cloudflare/SKILL.md` | No hardcoded values that can drift |
| `launch/SKILL.md` | Uses `${CLAUDE_SKILL_DIR}` text substitution and runtime bash (correct) |
| `test/SKILL.md` | No hardcoded values that can drift |
| `upload-dmg/SKILL.md` | Correctly reads version at runtime when needed |
| `design/SKILL.md` | No hardcoded values that can drift |
| `riff/SKILL.md` | No hardcoded values that can drift |
| Theme catalog/file reads | Conditional reads are the right pattern for large content |
| OIDC constants in bash blocks | Resolved at bash runtime correctly |

### Risk assessment

- **Low risk:** The `!`command`` substitution is a Claude Code feature — if it fails, the model sees the raw `!`command`` text, which is worse than a hardcoded value. We mitigate this by ensuring commands are fast and robust.
- **Build dependency:** The `extract-import-map.js` script runs at prompt-load time. If `source-templates/base/template.html` doesn't exist (shouldn't happen in a plugin install), the command should fail gracefully.
- **Frontmatter integrity:** Editing SKILL.md must not break YAML frontmatter parsing. Our tests will verify this.

---

## File Structure

### New files
- `scripts/lib/extract-import-map.js` — Extracts import map JSON from `source-templates/base/template.html`. Single responsibility: parse HTML, find `<script type="importmap">`, output JSON.
- `scripts/__tests__/unit/skill-injection.test.js` — Tests for dynamic injection: command validation, output format, frontmatter integrity, consistency with source of truth.

### Modified files
- `skills/sell/SKILL.md` — Replace hardcoded import map with `!`command`` placeholder.

---

## Task 1: Create the import map extraction helper

**Files:**
- Create: `scripts/lib/extract-import-map.js`
- Test: `scripts/__tests__/unit/skill-injection.test.js`

- [ ] **Step 1: Write the failing test for import map extraction**

```javascript
// scripts/__tests__/unit/skill-injection.test.js
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '..', '..');
const PLUGIN_ROOT = join(SCRIPTS_DIR, '..');

describe('extract-import-map.js', () => {
  it('exits with code 0', () => {
    const result = execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
    expect(result).toBeTruthy();
  });

  it('produces valid JSON', () => {
    const result = execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result.trim());
    expect(parsed).toBeDefined();
  });

  it('contains the authoritative import map entries', () => {
    const result = execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result.trim());

    // Verify key entries exist
    expect(parsed).toHaveProperty('react');
    expect(parsed).toHaveProperty('react-dom');
    expect(parsed).toHaveProperty('@fireproof/core');
    expect(parsed).toHaveProperty('oauth4webapi');
    expect(parsed).toHaveProperty('use-fireproof');

    // Verify React entries use ?external pattern for Fireproof
    expect(parsed['@fireproof/core']).toContain('?external=react,react-dom');
  });

  it('matches the base template import map exactly', () => {
    // Read import map from base template directly
    const templatePath = join(PLUGIN_ROOT, 'source-templates', 'base', 'template.html');
    const templateHtml = readFileSync(templatePath, 'utf8');
    const match = templateHtml.match(/<script\s+type="importmap">\s*([\s\S]*?)\s*<\/script>/);
    expect(match).toBeTruthy();
    const templateImports = JSON.parse(match[1]).imports;

    // Get output from the extraction script
    const result = execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
    const scriptImports = JSON.parse(result.trim());

    // They must be identical
    expect(scriptImports).toEqual(templateImports);
  });

  it('completes in under 500ms', () => {
    const start = performance.now();
    execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/skill-dynamic-injection/scripts && npx vitest run __tests__/unit/skill-injection.test.js`
Expected: FAIL — `extract-import-map.js` does not exist yet.

- [ ] **Step 3: Implement the extraction script**

```javascript
// scripts/lib/extract-import-map.js
//
// Extracts the import map from source-templates/base/template.html.
// Used by SKILL.md !`command` injection to keep import maps in sync.
//
// Output: JSON object of the "imports" field, pretty-printed.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatePath = join(__dirname, '..', '..', 'source-templates', 'base', 'template.html');

try {
  const html = readFileSync(templatePath, 'utf8');
  const match = html.match(/<script\s+type="importmap">\s*([\s\S]*?)\s*<\/script>/);
  if (!match) {
    console.error('No <script type="importmap"> found in base template');
    process.exit(1);
  }
  const importMap = JSON.parse(match[1]);
  console.log(JSON.stringify(importMap.imports, null, 2));
} catch (err) {
  console.error(`Failed to extract import map: ${err.message}`);
  process.exit(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/skill-dynamic-injection/scripts && npx vitest run __tests__/unit/skill-injection.test.js`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/skill-dynamic-injection
git add scripts/lib/extract-import-map.js scripts/__tests__/unit/skill-injection.test.js
git commit -m "feat: add import map extraction helper for SKILL.md dynamic injection"
```

---

## Task 2: Replace hardcoded import map in sell/SKILL.md

**Files:**
- Modify: `skills/sell/SKILL.md:557-574`
- Test: `scripts/__tests__/unit/skill-injection.test.js`

- [ ] **Step 1: Write the failing test for sell SKILL.md consistency**

Add to `scripts/__tests__/unit/skill-injection.test.js`:

```javascript
describe('sell SKILL.md import map consistency', () => {
  it('uses dynamic injection instead of hardcoded import map', () => {
    const skillPath = join(PLUGIN_ROOT, 'skills', 'sell', 'SKILL.md');
    const content = readFileSync(skillPath, 'utf8');

    // Should contain the !`command` injection placeholder
    expect(content).toContain('!`');
    expect(content).toContain('extract-import-map.js');

    // Should NOT contain hardcoded version strings from the import map
    // (Version strings in prose text like "React 19" are fine;
    //  hardcoded esm.sh URLs in the import map section are not)
    const importMapSection = content.split('## Import Map')[1]?.split('##')[0] || '';
    expect(importMapSection).not.toMatch(/esm\.sh\/stable\/react@[\d.]+/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/skill-dynamic-injection/scripts && npx vitest run __tests__/unit/skill-injection.test.js`
Expected: FAIL — sell SKILL.md still has hardcoded import map.

- [ ] **Step 3: Edit sell/SKILL.md to use dynamic injection**

Replace the hardcoded import map section (lines 557-574 of `skills/sell/SKILL.md`) with:

```markdown
## Import Map

The unified template uses React 19 with the OIDC bridge for auth and Fireproof sync. The current authoritative import map (from `source-templates/base/template.html`):

```json
!`bun scripts/lib/extract-import-map.js`
```

Note: `use-fireproof` maps to the local OIDC bridge (`/fireproof-oidc-bridge.js`), and `@fireproof/core` uses `?external=react,react-dom` to prevent the React singleton problem.
```

This replaces the hardcoded JSON block with a `!`command`` that extracts the live import map. The model sees the actual current values, not a stale copy.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/skill-dynamic-injection/scripts && npx vitest run __tests__/unit/skill-injection.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/skill-dynamic-injection
git add skills/sell/SKILL.md
git commit -m "feat: replace hardcoded import map in sell SKILL.md with dynamic injection"
```

---

## Task 3: Add SKILL.md frontmatter integrity tests

**Files:**
- Modify: `scripts/__tests__/unit/skill-injection.test.js`

- [ ] **Step 1: Write frontmatter integrity tests**

Add to `scripts/__tests__/unit/skill-injection.test.js`:

```javascript
import { parseSkillFrontmatter } from '../../server/config.js';

const ALL_SKILLS = ['vibes', 'cloudflare', 'sell', 'launch', 'test', 'upload-dmg', 'design', 'riff'];

describe('SKILL.md frontmatter integrity', () => {
  for (const skill of ALL_SKILLS) {
    it(`${skill}/SKILL.md has valid frontmatter with name field`, () => {
      const skillPath = join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md');
      const content = readFileSync(skillPath, 'utf8');
      const frontmatter = parseSkillFrontmatter(content);
      expect(frontmatter.name).toBe(skill);
    });

    it(`${skill}/SKILL.md has a non-empty description`, () => {
      const skillPath = join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md');
      const content = readFileSync(skillPath, 'utf8');
      const frontmatter = parseSkillFrontmatter(content);
      expect(frontmatter.description).toBeTruthy();
      expect(frontmatter.description.length).toBeGreaterThan(10);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it passes (this is a regression gate)**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/skill-dynamic-injection/scripts && npx vitest run __tests__/unit/skill-injection.test.js`
Expected: PASS — all frontmatter is currently valid and should remain so.

- [ ] **Step 3: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/skill-dynamic-injection
git add scripts/__tests__/unit/skill-injection.test.js
git commit -m "test: add SKILL.md frontmatter integrity tests for all skills"
```

---

## Task 4: Add source-of-truth consistency tests

**Files:**
- Modify: `scripts/__tests__/unit/skill-injection.test.js`

These tests verify that values mentioned in SKILL.md files are consistent with their authoritative sources, catching drift that already exists or could be introduced.

- [ ] **Step 1: Write consistency tests**

Add to `scripts/__tests__/unit/skill-injection.test.js`:

```javascript
describe('SKILL.md source-of-truth consistency', () => {
  // Read the authoritative import map once
  const templatePath = join(PLUGIN_ROOT, 'source-templates', 'base', 'template.html');
  const templateHtml = readFileSync(templatePath, 'utf8');
  const importMapMatch = templateHtml.match(/<script\s+type="importmap">\s*([\s\S]*?)\s*<\/script>/);
  const authoritativeImports = JSON.parse(importMapMatch[1]).imports;

  // Extract React version from authoritative import map
  const reactVersionMatch = authoritativeImports['react'].match(/react@([\d.]+)/);
  const reactVersion = reactVersionMatch[1];

  // Extract Fireproof version
  const fpVersionMatch = authoritativeImports['@fireproof/core'].match(/use-fireproof@([\d.]+)/);
  const fpVersion = fpVersionMatch[1];

  it('sell SKILL.md does not hardcode stale esm.sh URLs', () => {
    const content = readFileSync(join(PLUGIN_ROOT, 'skills', 'sell', 'SKILL.md'), 'utf8');
    // After our edit, the import map section should use !`command`, not hardcoded URLs
    // But if there are any remaining esm.sh URLs in the import map section, they should match
    const importMapSection = content.split('## Import Map')[1]?.split('---')[0] || '';
    const esmUrls = importMapSection.match(/esm\.sh\/stable\/\S+/g) || [];
    for (const url of esmUrls) {
      // Any remaining esm.sh URL should match the authoritative version
      if (url.includes('react@')) {
        expect(url).toContain(`react@${reactVersion}`);
      }
      if (url.includes('use-fireproof@')) {
        expect(url).toContain(`use-fireproof@${fpVersion}`);
      }
    }
  });

  it('OIDC constants in auth-constants.js match expected format', () => {
    // This test guards against accidental changes to the constants file
    const constantsPath = join(PLUGIN_ROOT, 'scripts', 'lib', 'auth-constants.js');
    const constants = readFileSync(constantsPath, 'utf8');

    expect(constants).toContain("OIDC_AUTHORITY = 'https://vibesos.com'");
    expect(constants).toContain("OIDC_CLIENT_ID = '");
    expect(constants).toContain("DEPLOY_API_URL = 'https://share.vibesos.com'");
  });

  it('plugin.json version is a valid semver string', () => {
    const pluginJson = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(pluginJson.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('base template import map has ?external=react,react-dom on @fireproof/core', () => {
    // This is a critical invariant documented in .claude/rules/react-singleton.md
    expect(authoritativeImports['@fireproof/core']).toContain('?external=react,react-dom');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/skill-dynamic-injection/scripts && npx vitest run __tests__/unit/skill-injection.test.js`
Expected: PASS — source-of-truth values should all be consistent.

- [ ] **Step 3: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/skill-dynamic-injection
git add scripts/__tests__/unit/skill-injection.test.js
git commit -m "test: add source-of-truth consistency tests for SKILL.md values"
```

---

## Task 5: Run full test suite as regression gate

**Files:**
- No changes — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/skill-dynamic-injection/scripts && npx vitest run`
Expected: All tests pass, including existing 490+ tests and all new tests.

- [ ] **Step 2: Verify no new test failures**

Compare test count before and after. The new tests should add to the total without breaking existing ones.

- [ ] **Step 3: Final commit if any adjustments were needed**

Only needed if the full suite revealed issues requiring fixes.

---

## Appendix: Why most SKILL.md files need no changes

The analysis found that 7 of 8 SKILL.md files do NOT benefit from `!`command`` injection. Here is the reasoning for each:

### vibes/SKILL.md
- Uses `${CLAUDE_SKILL_DIR}` text substitution (already handled by Claude Code)
- Uses runtime bash blocks for auth checks (correct — values needed at execution time)
- References files for conditional reading (design tokens, themes) — these should remain as file reads, not prompt injections, because they are large and conditionally needed
- The `useFireproofClerk` hook name and `"use-fireproof"` import are API surface names that change with major versions, not values that drift

### cloudflare/SKILL.md
- Contains no hardcoded values that can drift
- Script paths use `${CLAUDE_PLUGIN_ROOT}` fallback pattern (correct)
- Deploy API URL and auth are handled at runtime

### launch/SKILL.md
- Same auth check pattern as vibes (runtime bash, correct)
- References `${CLAUDE_SKILL_DIR}/prompts/builder.md` (text substitution, correct)
- SaaS config values are collected per-session

### test/SKILL.md
- References fixture files by relative path
- Credential collection is per-session
- No hardcoded values that can drift

### upload-dmg/SKILL.md
- Reads version from `plugin.json` at upload time (correct — version may change between skill invocations)
- Upload URL (`install.vibesos.com`) is infrastructure that doesn't drift

### design/SKILL.md
- Pure methodology — transformation rules, checklists
- No version numbers or config values

### riff/SKILL.md
- Generation workflow — prompt structure, evaluation criteria
- Script paths use `${CLAUDE_PLUGIN_ROOT}` fallback pattern
- No hardcoded values that can drift

This analysis is important for reviewers: the restraint in applying `!`command`` to only 1 of 8 skills is intentional. The technique adds value only where values can actually drift, and misapplying it would add maintenance burden without benefit.
