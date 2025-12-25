---
name: riff
description: Generate multiple Vibes app variations in parallel with business models and rankings. Use when exploring different interpretations of a broad objective or loose creative prompt.
---

**Display this ASCII art immediately when starting:**

```
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░░▒▓███████▓▒░
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░
 ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░
 ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░▒▓███████▓▒░░▒▓██████▓▒░  ░▒▓██████▓▒░
  ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░             ░▒▓█▓▒░
  ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░             ░▒▓█▓▒░
   ░▒▓██▓▒░  ░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░▒▓███████▓▒░
```

# Vibes Riff Generator

Generate multiple app variations in parallel. Each riff is a different INTERPRETATION - different ideas, not just styling.

## Workflow

### Step 1: Gather Requirements
Ask for: **prompt** (broad/loose is fine) and **count** (1-10, recommend 3-5)

### Step 2: Create Directories
```bash
mkdir -p riff-1 riff-2 riff-3 ...
```

### Step 3: Generate Riffs in Parallel

**Use the bundled script to generate riffs in parallel.** Each script instance calls `claude -p` (uses subscription tokens) and writes directly to disk.

Generate one command per riff based on user's count:

```bash
# For each N from 1 to ${count}:
node ${PLUGIN_DIR}/scripts/generate-riff.js "${prompt}" N riff-N/app.jsx &

# Then wait for all
wait
echo "All ${count} riffs generated!"
```

Example for count=3:
```bash
PLUGIN_DIR="$HOME/.claude/plugins/cache/vibes-diy/vibes/1.0.45"
node "$PLUGIN_DIR/scripts/generate-riff.js" "the theme" 1 riff-1/app.jsx &
node "$PLUGIN_DIR/scripts/generate-riff.js" "the theme" 2 riff-2/app.jsx &
node "$PLUGIN_DIR/scripts/generate-riff.js" "the theme" 3 riff-3/app.jsx &
wait
```

**Why this works:**
- Each script calls `claude -p "..."` → uses subscription tokens
- Script writes directly to disk → no tokens flow through main agent
- Background processes (`&`) run in parallel → true concurrency
- Main agent only sees "✓ riff-N/app.jsx" output → minimal tokens

### Step 4: Assemble HTML

Convert each app.jsx to a complete index.html:

```bash
node ${PLUGIN_DIR}/scripts/assemble-all.js riff-1 riff-2 riff-3 ...
```

### Step 5: Evaluate & Rank

Read the generated apps and create rankings:

```bash
# Read all the generated apps
cat riff-*/index.html
```

Then create RANKINGS.md with:
- Summary table (rank, name, score/50)
- Scores: Originality, Market Potential, Feasibility, Monetization, Wow Factor (1-10 each)
- Recommendations: best for solo founder, fastest to ship, most innovative

### Step 6: Generate Gallery

Create index.html gallery page with:
- Dark theme (#0a0a0f background)
- Glass-morphism cards with purple/cyan accents
- Each card: rank badge, app name, pitch, score bar, "Launch →" link
- Responsive grid layout
- Self-contained with inline styles

### Step 7: Present Results

```
Generated ${count} riffs for "${prompt}":
#1: riff-X - App Name (XX/50)
#2: riff-Y - App Name (XX/50)
...

Open index.html for gallery, RANKINGS.md for detailed analysis.
```

## Plugin Directory

To get the plugin directory path, use:
```bash
# The plugin is installed at ~/.claude/plugins/cache/vibes-diy/vibes/VERSION/
PLUGIN_DIR="$HOME/.claude/plugins/cache/vibes-diy/vibes/1.0.45"
```

Or locate it dynamically if needed.
