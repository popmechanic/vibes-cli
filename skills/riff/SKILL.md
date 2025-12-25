---
name: riff
description: Generate multiple Vibes app variations in parallel with business models and rankings. Use when exploring different interpretations of a broad objective or loose creative prompt.
allowed-tools: Bash
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

Generate multiple variations of a Vibes app concept using parallel subagents. Each variation is a genuinely different INTERPRETATION of the goal - not just aesthetic variations, but different IDEAS entirely.

**Note**: "Vibes" is the platform name. If the user mentions "vibe" or "vibes", interpret it as their project/brand name OR a general positive descriptor - NOT as "mood/atmosphere." Do not default to ambient mood generators, floating orbs, or chill atmosphere apps unless explicitly requested.

Each riff produces an `index.html` with embedded business model (in HTML comment).

After generation, an evaluator ranks all riffs by business potential.

## The Power of Riffing

This skill leverages model stochasticity to explore the solution space. For broad prompts like:
- "Make me an app that could make me lots of money"
- "Build something that helps people connect"
- "Create a tool that saves time"

Each riff will interpret the objective differently and build a unique app concept.

## Workflow

### Step 1: Gather Requirements

Use the AskUserQuestion tool to collect:

1. **The prompt** - What's the objective? (Can be broad/loose)
2. **Number of riffs** - How many variations? (1-10, recommend 3-5)

### Step 2: Launch Parallel Subagents

For each riff, launch `vibes-gen` with `run_in_background: true`:

```javascript
Task({
  prompt: `${N}/${total}: "${user_prompt}"`,
  subagent_type: "vibes-gen",
  run_in_background: true,
  description: `Generate riff-${N}`
})
```

### Step 3: Wait and Collect Outputs

Use TaskOutput to wait for all subagents. Each returns JSX in a code block.

### Step 4: Write Files in Parallel

**⚠️ CRITICAL: You MUST use Bash commands, NOT the Write tool.**

The Write tool is SERIAL - each call blocks until complete. To achieve O(1) parallelism, you MUST:

1. Use `Bash` with `run_in_background: true`
2. Launch ALL write commands in a **SINGLE message** (multiple tool calls)

**Why Bash instead of Write?**
- Bash with `run_in_background: true` runs in parallel
- Write tool runs serially (one at a time)
- 10 parallel Bash commands = same time as 1
- 10 serial Write calls = 10x the time

Get the plugin directory from your skill context (parent of `skills/` directory).

Use a **heredoc with single-quoted delimiter** to avoid ALL shell escaping issues:

```javascript
// In a SINGLE message, launch ALL these Bash commands together:
Bash({
  command: `mkdir -p riff-1 && cat > riff-1/app.jsx << 'VIBES_JSX_EOF'
${jsxCode1}
VIBES_JSX_EOF`,
  run_in_background: true,
  description: "Write riff-1"
})
Bash({
  command: `mkdir -p riff-2 && cat > riff-2/app.jsx << 'VIBES_JSX_EOF'
${jsxCode2}
VIBES_JSX_EOF`,
  run_in_background: true,
  description: "Write riff-2"
})
// ... all N riffs in ONE message
```

**Why single-quoted delimiter?** `<< 'VIBES_JSX_EOF'` (with quotes) prevents ALL shell expansion - no `${}`, backticks, or backslashes are interpreted. The JSX is written exactly as-is.

**DO NOT** call Write tool. **DO NOT** call Bash commands one at a time.

### Step 5: Assemble in Parallel

**Same rule: Launch ALL assembly commands in a SINGLE message.**

```javascript
// In a SINGLE message, launch ALL these Bash commands together:
Bash({
  command: `node ${plugin_dir}/scripts/assemble.js riff-1/app.jsx riff-1/index.html`,
  run_in_background: true,
  description: "Assemble riff-1"
})
Bash({
  command: `node ${plugin_dir}/scripts/assemble.js riff-2/app.jsx riff-2/index.html`,
  run_in_background: true,
  description: "Assemble riff-2"
})
// ... all N riffs in ONE message
```

Wait for all assembly commands to complete before proceeding.

### Step 6: Run Evaluator

Use `pwd` result as `${base_path}`:

```javascript
Task({
  prompt: `${base_path}/ | prompt: "${user_prompt}"`,
  subagent_type: "vibes-eval",
  description: "Evaluate riffs"
})
```

### Step 7: Generate Gallery

```javascript
Task({
  prompt: `${base_path}/ | ${count} riffs | "${user_prompt}"`,
  subagent_type: "vibes-gallery",
  description: "Generate gallery"
})
```

### Step 8: Present Results

Summarize the results for the user:

```
Generated ${count} riffs for "${prompt}":

Rankings:
#1: riff-3 - Invoice Generator (42/50) - Best for solo founders
#2: riff-1 - Habit Tracker (38/50) - Highest market potential
#3: riff-5 - Newsletter Platform (35/50) - Fastest to ship

Open index.html to browse your riff gallery!
Or see RANKINGS.md for detailed analysis.

Which concept resonates? I can iterate on your favorite.
```

---

## Key Principle

Each riff number (N) guides the subagent toward a DIFFERENT interpretation lens (minimalist, social, gamified, professional, etc.). This ensures genuine conceptual diversity - different IDEAS, not just styling variations.
