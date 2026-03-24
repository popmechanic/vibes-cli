---
name: Test Diagnostics & Fix Flow
description: Diagnosis tables, root cause classification, fix-and-verify loop, resolution summary, and unit test phases for the test skill. Read when browser testing reveals issues.
---

## Phase 7: Diagnosis

**You are a plugin developer testing your own code.** The test instance is disposable. Bugs found here are bugs in plugin source code — deploy scripts, templates, assembly logic, or skill instructions. Fix the plugin source, NOT the test instance.

Ask the user to describe the issue. Then work through these diagnostic steps. Skip ahead when diagnosis is clear.

**7.1 Browser console** — ask the user to check, or use browser automation tools if available:

| Console Error | Likely Cause | Check File |
|---------------|-------------|------------|
| `Cannot read properties of null (reading 'useContext')` | Duplicate React instances | `source-templates/base/template.html` import map |
| `Failed to fetch` / CORS errors | Deploy script wrong URL or missing CORS headers | `scripts/deploy-cloudflare.js` |
| `TinyBase is not defined` / hooks not found | Missing import map entry | `source-templates/base/template.html` import map |
| `Unexpected token '<'` | Babel script block malformed | `scripts/assemble.js` |
| 404 on `/api/` routes | Connect not provisioned or Worker misconfigured | `scripts/deploy-cloudflare.js` |

**7.2 Network requests** — probe the deployed services:

```bash
# Test Cloudflare Worker
curl -v https://vibes-test.<account>.workers.dev/
```

**7.3 Plugin source** — map symptoms to source files:

| Symptom Category | Files to Read |
|-----------------|---------------|
| Assembly/template | `scripts/assemble.js`, `source-templates/base/template.html`, relevant `template.delta.html` |
| Deploy/hosting | `scripts/deploy-cloudflare.js` |
| Auth/OIDC | `source-templates/base/template.html` (OIDC provider), `scripts/deploy-cloudflare.js` (env vars) |
| Import/module errors | `source-templates/base/template.html` (import map) |

## Phase 8: Root Cause Classification

Before touching any file, state the classification:

| Category | Signal | Fix Target | Example |
|----------|--------|-----------|---------|
| **A: Plugin source bug** | Deploy script produces wrong output | `scripts/*.js` | `deploy-cloudflare.js` writes wrong URL |
| **B: Template bug** | HTML output is structurally wrong | `source-templates/base/template.html` or `template.delta.html` | Missing import map entry |
| **C: Skill instruction bug** | Agent followed wrong steps | `skills/*/SKILL.md` | Wrong hook name in instructions |
| **D: Fixture bug** | Only this fixture fails | `scripts/__tests__/fixtures/` | Bad JSX in test fixture |
| **E: External/transient** | VM down, CDN outage, rate limit | None — retry | esm.sh 503, VM unreachable |

```
AskUserQuestion:
  Question: "I believe this is Category <X>: <description>. The fix belongs in <file>. Proceed?"
  Header: "Fix plan"
  Options:
  - Label: "Yes, fix it"
    Description: "Apply the fix to plugin source"
  - Label: "Wrong diagnosis"
    Description: "I think the problem is something else"
```

If "Wrong diagnosis": ask what they think and re-diagnose.

## Phase 9: Apply Fix and Verify

**Fix the plugin source file, NOT the test instance.**

1. Apply the fix to the identified source file
2. If the fix touched templates or components, regenerate:
   ```bash
   bun scripts/merge-templates.js --force   # If template.html or delta changed
   bun scripts/build-components.js --force  # If components/ changed
   ```
3. Re-run from the appropriate phase:

| Category | Restart From |
|----------|-------------|
| A: Plugin source | Phase that uses the fixed script (4 or 5) |
| B: Template | Phase 4 (re-assemble) |
| C: Skill instruction | Note the fix — no re-run needed |
| D: Fixture | Phase 4 (re-assemble) |
| E: External | Retry the failed phase |

4. Present the URL and ask:

```
AskUserQuestion:
  Question: "How does it look now?"
  Header: "Verify"
  Options:
  - Label: "Fixed"
    Description: "The issue is resolved"
  - Label: "Still broken"
    Description: "Same problem persists"
  - Label: "Different issue"
    Description: "Original issue fixed but something else is wrong"
```

If "Still broken" or "Different issue": loop back to Phase 7. After 3 loops, say:
> This needs hands-on investigation. Here's what I've tried so far: <summary>. Try debugging manually or open an issue.

Then ask:

```
AskUserQuestion:
  Question: "What next?"
  Header: "Next"
  Options:
  - Label: "Test another fixture"
    Description: "Go back to Phase 3 and pick a different fixture"
  - Label: "End test session"
    Description: "Clean up artifacts and finish"
```

If "Test another fixture": go to Phase 3.
If "End test session": go to Phase 11.

## Phase 10: Resolution Summary

Write `test-vibes/FIX-REPORT.md`:

```markdown
# Fix Report

**Date:** <date>
**Fixture:** <fixture>
**Category:** <A-E>

## Symptom
<What the user reported>

## Root Cause
<What was actually wrong>

## Fix
- **File:** <path>
- **Change:** <one-line description>

## Diagnosis Commands
<Commands that revealed the issue>

## Prevention
<How to avoid this in the future>
```

```
AskUserQuestion:
  Question: "What next?"
  Header: "Next"
  Options:
  - Label: "Test another fixture"
    Description: "Go back to Phase 3 with the fix in place"
  - Label: "Commit the fix"
    Description: "Review and commit the plugin source changes"
  - Label: "End test session"
    Description: "Clean up artifacts and finish"
```

If "Commit the fix": show `git diff` of plugin source changes (exclude `test-vibes/`), suggest a commit message derived from the fix report. After committing, offer "Test another fixture" or "End test session".

If "Test another fixture": go to Phase 3.
If "End test session": go to Phase 11.
