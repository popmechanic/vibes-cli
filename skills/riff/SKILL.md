---
name: riff
description: Generate multiple Vibes app variations in parallel with business models and rankings. Use when exploring different interpretations of a broad objective or loose creative prompt.
---

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

Get the plugin directory from your skill context (the base directory path). For each riff, launch `vibes-gen` with `run_in_background: true`:

```javascript
Task({
  prompt: `${N}/${total}: "${user_prompt}" | output_dir: riff-${N} | plugin_dir: ${plugin_base_dir}`,
  subagent_type: "vibes-gen",
  run_in_background: true,
  description: `Generate riff-${N}`
})
```

The `plugin_dir` should be the parent of the `skills/` directory (e.g., if your skill base is `.../vibes/1.0.0/skills/riff`, use `.../vibes/1.0.0`).

### Step 3: Wait for Completion

Use TaskOutput to wait for all subagents. Each agent writes its own files:
- `riff-N/app.jsx` - The JSX source
- `riff-N/index.html` - The assembled HTML with Vibes menu

### Step 4: Run Evaluator

Use `pwd` result as `${base_path}`:

```javascript
Task({
  prompt: `${base_path}/ | prompt: "${user_prompt}"`,
  subagent_type: "vibes-eval",
  description: "Evaluate riffs"
})
```

### Step 5: Generate Gallery

```javascript
Task({
  prompt: `${base_path}/ | ${count} riffs | "${user_prompt}"`,
  subagent_type: "vibes-gallery",
  description: "Generate gallery"
})
```

### Step 6: Present Results

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
