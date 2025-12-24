---
name: riff
description: Generate multiple Vibes app variations in parallel with business models and rankings. Use when exploring different interpretations of a broad objective or loose creative prompt.
---

# Vibes Riff Generator

Generate multiple variations of a Vibes app concept using parallel subagents. Each variation is a genuinely different INTERPRETATION of the goal - not just aesthetic variations, but different IDEAS entirely.

Each riff produces:
- `index.html` - A working app prototype
- `BUSINESS.md` - A business model canvas

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

### Step 2: Get Absolute Path

```bash
pwd
```
Store as `{base_path}` - where riff outputs will be written.

### Step 3: Create Output Structure

Create numbered directories for each riff:
```bash
mkdir -p riff-1 riff-2 riff-3 ...
```

### Step 4: Launch Parallel Subagents

For each riff, launch the `vibes-gen` subagent with `run_in_background: true`.

**CRITICAL**: Use ABSOLUTE paths in the prompt:

```javascript
Task({
  prompt: `You are generating riff #${N} of ${total} variations.

The user's prompt:
"${user_prompt}"

Interpret this prompt creatively and build a complete, working Vibes app.
Come up with a UNIQUE and SPECIFIC idea - not just a different style, but a different CONCEPT.

Write files to these EXACT paths:
- ${base_path}/riff-${N}/index.html
- ${base_path}/riff-${N}/BUSINESS.md

Do NOT read any template files. Use the inline template from your instructions.`,

  subagent_type: "vibes-gen",
  run_in_background: true,
  description: `Generate riff-${N}`
})
```

**CRITICAL**:
- Send the EXACT SAME base prompt to each subagent
- Only the riff number and output path differ
- No variation seeds, no design directions
- Let the model's natural stochasticity create conceptual diversity

### Step 5: Wait for Completion

Use TaskOutput to wait for all subagents to complete.

### Step 6: Run Evaluator

After all riffs are generated, launch the `vibes-eval` agent to rank them:

```javascript
Task({
  prompt: `Evaluate all riffs in ${base_path}.

Read each riff-N/index.html and riff-N/BUSINESS.md.
Score each on: Originality, Market Potential, Feasibility, Monetization, Wow Factor.
Write rankings to ${base_path}/RANKINGS.md.

The original prompt was: "${user_prompt}"`,

  subagent_type: "vibes-eval",
  description: "Evaluate and rank riffs"
})
```

### Step 7: Generate Gallery

After evaluation, launch the `vibes-gallery` agent to create a stunning landing page:

```javascript
Task({
  prompt: `Create a gallery landing page for the riffs in ${base_path}.

Read each riff-N/BUSINESS.md to get app details (name, one-liner, target, revenue model).
Read RANKINGS.md for scores and recommendations.
Generate ${base_path}/index.html - a dark mode venture portfolio gallery.

The original prompt was: "${user_prompt}"
Generated on: ${new Date().toLocaleDateString()}
Number of riffs: ${count}`,

  subagent_type: "vibes-gallery",
  description: "Generate gallery page"
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

## Example Session

**User**: "Make me an app that could make me lots of money"
**Count**: 5

**Output**:
```
./
├── index.html          # Riff Gallery - stunning dark mode portfolio
├── RANKINGS.md         # Scored rankings with recommendations
├── riff-1/
│   ├── index.html      # Freelance invoice tracker
│   └── BUSINESS.md
├── riff-2/
│   ├── index.html      # Local services marketplace
│   └── BUSINESS.md
├── riff-3/
│   ├── index.html      # AI content generator
│   └── BUSINESS.md
├── riff-4/
│   ├── index.html      # Habit tracking with coaching
│   └── BUSINESS.md
└── riff-5/
    ├── index.html      # Team standup collector
    └── BUSINESS.md
```

---

## Why No Design Seeds?

The goal is **conceptual exploration**, not aesthetic variation.

- ❌ 5 different color schemes of a todo app
- ✅ 5 genuinely different apps that could "make money"

Model stochasticity naturally produces different interpretations. By giving identical prompts, we get emergent diversity in IDEAS, which is far more valuable than diversity in styling.

---

## After Generation

Suggest next steps:
- "Open index.html to browse your riff gallery"
- "Read RANKINGS.md for detailed analysis"
- "Which concept resonates most? I can iterate on that one"
- "Want me to generate more variations of a specific concept?"
- "Should I deploy your favorite to a live URL?"
