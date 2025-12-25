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

Launch subagents to generate code (they return it, main agent writes):

```javascript
// Launch ALL subagents in parallel (single message with multiple Task calls)
Task({
  subagent_type: "general-purpose",
  run_in_background: true,
  description: `Generate riff-${N}`,
  prompt: `
    Generate a Vibes app. Return ONLY the complete JSX code, nothing else.

    /*BUSINESS
    name: [Creative App Name]
    pitch: [One sentence value prop]
    customer: [Target user]
    revenue: [Pricing model]
    */
    import React, { useState } from "react";
    import { useFireproof } from "use-fireproof";

    export default function App() {
      const { useLiveQuery, useDocument } = useFireproof("riff-${N}-db");
      return <div className="min-h-screen bg-[#f1f5f9] p-4">...</div>;
    }

    Theme: ${user_prompt}
    Lens: ${N}=1: Minimalist | 2: Social | 3: Gamified | 4: Professional | 5: Personal | 6: Marketplace | 7: Educational | 8: Creative | 9+: Wildcard
    Style: Tailwind neo-brutalist
  `
})
// Repeat for each riff in a SINGLE message to run in parallel
```

### Step 4: Collect Results & Write Files

```javascript
// Wait for each subagent to complete
TaskOutput({ task_id: agent_id_1, block: true })
TaskOutput({ task_id: agent_id_2, block: true })
// ... for each agent
```

**CRITICAL: Write ALL files in ONE message with PARALLEL Bash calls.**

These writes have NO dependencies - invoke ALL Bash tools in a SINGLE response.
Do NOT wait for one write to finish before starting the next.
Send one message containing N parallel Bash tool invocations.

Example for 3 riffs - all in ONE message:
- Bash: `cat > riff-1/app.jsx << 'EOF' ... EOF`
- Bash: `cat > riff-2/app.jsx << 'EOF' ... EOF`
- Bash: `cat > riff-3/app.jsx << 'EOF' ... EOF`

### Step 5: Assemble HTML
```bash
node ${plugin_dir}/scripts/assemble-all.js riff-1 riff-2 ...
```

### Step 6: Evaluate & Rank

```javascript
// Subagent analyzes and returns markdown
Task({
  subagent_type: "general-purpose",
  prompt: `
    Read each riff-*/index.html in ${base_path}/.
    Score each 1-10 on: Originality, Market Potential, Feasibility, Monetization, Wow Factor.

    Return ONLY the markdown content for RANKINGS.md:
    # Riff Rankings
    | Rank | Name | Score |
    |------|------|-------|
    ...

    Include: summary table, detailed scores, recommendations.
  `
})

// Main agent writes the file
Bash: cat > RANKINGS.md << 'EOF'
${result_markdown}
EOF
```

### Step 7: Generate Gallery

```javascript
// Subagent generates gallery HTML
Task({
  subagent_type: "general-purpose",
  prompt: `
    Read RANKINGS.md and riff-*/index.html files in ${base_path}/.

    Return ONLY the complete HTML for a gallery page.
    Style: Dark theme (#0a0a0f), glass cards, purple/cyan accents.
    Each card: rank badge, name, pitch, score bar, "Launch →" link to riff-N/index.html.
    Responsive grid, self-contained with inline styles.
  `
})

// Main agent writes the file
Bash: cat > index.html << 'EOF'
${result_html}
EOF
```

### Step 8: Present Results
```
Generated ${count} riffs for "${prompt}":
#1: riff-X - Name (XX/50)
...
Open index.html for gallery, RANKINGS.md for analysis.
```
