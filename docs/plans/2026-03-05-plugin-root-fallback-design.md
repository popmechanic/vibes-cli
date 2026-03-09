# CLAUDE_PLUGIN_ROOT Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all SKILL.md bash blocks work even when `CLAUDE_PLUGIN_ROOT` env var isn't set, by falling back to `CLAUDE_SKILL_DIR` (which is always text-interpolated).

**Architecture:** Every bash code block that references `${CLAUDE_PLUGIN_ROOT}` gets a one-line preamble that derives the plugin root from `CLAUDE_SKILL_DIR` when the env var is missing. Since `CLAUDE_SKILL_DIR` is text-substituted before Claude sees the markdown, the fallback path becomes a literal string in the code block — no env var needed.

**Tech Stack:** Shell (bash), SKILL.md markdown editing

---

## Pattern

The fallback line to prepend to bash blocks:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
```

Then replace `${CLAUDE_PLUGIN_ROOT}` with `$VIBES_ROOT` in the same block.

**Why this works:**
- `CLAUDE_SKILL_DIR` = `<plugin-root>/skills/<skill-name>/` (always, for all skills)
- `dirname dirname` strips two levels -> plugin root
- Text substitution happens before Claude sees it, so the path is a literal string
- If `CLAUDE_PLUGIN_ROOT` IS set (normal plugin install), it takes priority

**What NOT to change:**
- `Read file: ${CLAUDE_PLUGIN_ROOT}/...` directives — these are text-interpolated, not shell
- `${CLAUDE_PLUGIN_ROOT}` in catalog.txt — same, text-interpolated
- `${CLAUDE_SKILL_DIR}` references (already work)

---

## Scope

### Files with bash blocks to update (7 files, ~30 bash blocks):

| File | Bash blocks with CLAUDE_PLUGIN_ROOT | Notes |
|------|-------------------------------------|-------|
| `skills/vibes/SKILL.md` | 5 blocks | preview-server, assemble, deploy-cloudflare |
| `skills/launch/SKILL.md` | 5 blocks | preview-server, assemble-sell, deploy-cloudflare, printenv probe |
| `skills/sell/SKILL.md` | 6 blocks | assemble-sell, deploy-cloudflare |
| `skills/sell/CLERK-SETUP.md` | 2 blocks | deploy-cloudflare, assemble-sell |
| `skills/riff/SKILL.md` | 5 blocks | generate-riff (x4), assemble-all |
| `skills/exe/SKILL.md` | 8 blocks | deploy-exe (x7), cd+npm install |
| `skills/connect/SKILL.md` | 2 blocks | cd+npm install, deploy-connect |

### Special cases:

1. **launch SKILL.md line 128**: `printenv CLAUDE_PLUGIN_ROOT` probe — replace with the fallback pattern directly, remove the printenv step.
2. **Inline references** (not in code blocks): `skills/vibes/SKILL.md:311` and `skills/launch/SKILL.md:224` have `node "${CLAUDE_PLUGIN_ROOT}/..."` inside prose text. These are instructions Claude reads and turns into bash — add a note to use `VIBES_ROOT` or keep as-is since Claude will copy the nearby code block pattern.
3. **riff SKILL.md**: Multiple `&` backgrounded commands in sequence — the `VIBES_ROOT=` line goes before the first one, shared by all.

---

## Tasks

### Task 1: skills/vibes/SKILL.md

**Files:**
- Modify: `skills/vibes/SKILL.md`

**Step 1: Update editor launch blocks (lines ~59, ~63)**

Add fallback preamble before `node` commands. Change:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preview-server.js" --mode=editor --prompt "USER_PROMPT_HERE"
```
To:
```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
node "$VIBES_ROOT/scripts/preview-server.js" --mode=editor --prompt "USER_PROMPT_HERE"
```

Same pattern for the no-prompt variant.

**Step 2: Update assemble block (~line 314)**

Change `node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble.js"` to use `$VIBES_ROOT`.

**Step 3: Update deploy-cloudflare block (~line 669)**

Same pattern.

**Step 4: Update inline prose reference (~line 311)**

The prose says `run \`node "${CLAUDE_PLUGIN_ROOT}/scripts/preview-server.js"\``. Update to reference `$VIBES_ROOT` or note that the code block pattern should be followed.

**Step 5: Verify no remaining bare CLAUDE_PLUGIN_ROOT in bash blocks**

Run: `grep -n 'CLAUDE_PLUGIN_ROOT' skills/vibes/SKILL.md`
Expected: only `Read file:` directives and `design-tokens.txt`/`fireproof.txt` references remain.

**Step 6: Commit**
```bash
git add skills/vibes/SKILL.md
git commit -m "Add VIBES_ROOT fallback to vibes SKILL.md bash blocks"
```

---

### Task 2: skills/launch/SKILL.md

**Files:**
- Modify: `skills/launch/SKILL.md`

**Step 1: Remove printenv probe (line ~128)**

Change:
```
1. Resolve plugin root: `printenv CLAUDE_PLUGIN_ROOT` → store as `pluginRoot`
```
To:
```
1. Resolve plugin root — use this in all bash blocks:
   ```bash
   VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
   ```
```

**Step 2: Update editor launch blocks (~lines 50, 54)**

Same pattern as Task 1.

**Step 3: Update assemble-sell block (~line 232)**

Add `VIBES_ROOT=` preamble, replace `${CLAUDE_PLUGIN_ROOT}` with `$VIBES_ROOT`.

**Step 4: Update deploy-cloudflare block (~line 248)**

Same pattern.

**Step 5: Update inline prose reference (~line 224)**

**Step 6: Verify and commit**
```bash
git add skills/launch/SKILL.md
git commit -m "Add VIBES_ROOT fallback to launch SKILL.md bash blocks"
```

---

### Task 3: skills/sell/SKILL.md + CLERK-SETUP.md

**Files:**
- Modify: `skills/sell/SKILL.md`
- Modify: `skills/sell/CLERK-SETUP.md`

**Step 1: Update all 6 bash blocks in SKILL.md**

Lines ~51, ~52, ~398, ~452, ~480, ~564, ~575. Each gets the `VIBES_ROOT=` preamble.

**Step 2: Update 2 bash blocks in CLERK-SETUP.md**

Lines ~111, ~139.

**Step 3: Verify and commit**
```bash
git add skills/sell/SKILL.md skills/sell/CLERK-SETUP.md
git commit -m "Add VIBES_ROOT fallback to sell SKILL.md bash blocks"
```

---

### Task 4: skills/riff/SKILL.md

**Files:**
- Modify: `skills/riff/SKILL.md`

**Step 1: Update generate-riff blocks (~lines 68, 77-79)**

The template block (line 68) and example blocks (lines 77-79) are backgrounded with `&`. Add `VIBES_ROOT=` once before the group:
```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
node "$VIBES_ROOT/scripts/generate-riff.js" "${prompt}" N riff-N/app.jsx "${visual}" &
```

**Step 2: Update assemble-all block (~line 94)**

Same pattern.

**Step 3: Update prose reference (~line 176)**

Line 176 says `The plugin root is available via \`${CLAUDE_PLUGIN_ROOT}\``. Update to explain the fallback pattern.

**Step 4: Verify and commit**
```bash
git add skills/riff/SKILL.md
git commit -m "Add VIBES_ROOT fallback to riff SKILL.md bash blocks"
```

---

### Task 5: skills/exe/SKILL.md

**Files:**
- Modify: `skills/exe/SKILL.md`

**Step 1: Update cd+npm install block (~line 55)**

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
cd "$VIBES_ROOT/scripts" && [ -d node_modules ] || npm install
```

**Step 2: Update all 7 deploy-exe blocks**

Lines ~56, ~74, ~90, ~98, ~192, ~231, ~286.

**Step 3: Verify and commit**
```bash
git add skills/exe/SKILL.md
git commit -m "Add VIBES_ROOT fallback to exe SKILL.md bash blocks"
```

---

### Task 6: skills/connect/SKILL.md

**Files:**
- Modify: `skills/connect/SKILL.md`

**Step 1: Update cd+npm install block (~line 76)**

**Step 2: Update deploy-connect block (~line 77)**

**Step 3: Verify and commit**
```bash
git add skills/connect/SKILL.md
git commit -m "Add VIBES_ROOT fallback to connect SKILL.md bash blocks"
```

---

### Task 7: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add note about VIBES_ROOT pattern**

In the "Architecture at a Glance" or a new "Environment Variables" section, document:
- `CLAUDE_PLUGIN_ROOT` may not be set in dev mode or certain contexts
- All SKILL.md bash blocks use `VIBES_ROOT` with fallback to `CLAUDE_SKILL_DIR`
- `CLAUDE_SKILL_DIR` is text-interpolated (not a shell env var) so the path is baked in

**Step 2: Commit**
```bash
git add CLAUDE.md
git commit -m "Document VIBES_ROOT fallback pattern in CLAUDE.md"
```

---

### Task 8: Smoke test

**Step 1: Verify text substitution works**

From the plugin directory, invoke `/vibes:vibes` and check that the first bash block Claude sees has a literal path (not `${CLAUDE_SKILL_DIR}`).

**Step 2: Test in dev mode**

```bash
# Unset the env var and run a script through the fallback
unset CLAUDE_PLUGIN_ROOT
claude --plugin . -p "run the preview server"
```

Verify the preview server starts without the "Cannot find module" error.
