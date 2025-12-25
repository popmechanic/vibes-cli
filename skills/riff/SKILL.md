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

Launch `general-purpose` subagents (NOT plugin agents - they can't write files):

```javascript
Task({
  subagent_type: "general-purpose",
  run_in_background: true,
  description: `Generate riff-${N}`,
  prompt: `
    # Riff ${N}/${total}: ${user_prompt}

    ## Your Task
    Generate a Vibes app and USE BASH to write it to: riff-${N}/app.jsx

    Use this Bash command pattern:
    cat > riff-${N}/app.jsx << 'ENDOFJSX'
    ...your jsx code here...
    ENDOFJSX

    ## Interpretation Lens
    ${N}=1: Minimalist | 2: Social | 3: Gamified | 4: Professional
    5: Personal | 6: Marketplace | 7: Educational | 8: Creative | 9+: Wildcard

    ## JSX Format
    /*BUSINESS
    name: App Name
    pitch: One sentence
    customer: Target user
    revenue: Pricing model
    */
    import React, { useState } from "react";
    import { useFireproof } from "use-fireproof";

    export default function App() {
      const { useLiveQuery, useDocument } = useFireproof("app-db");
      return <div className="min-h-screen bg-[#f1f5f9] p-4">...</div>;
    }

    Style: Tailwind neo-brutalist. NO: HTML tags, script tags, version numbers.
  `
})
```

### Step 4: Wait & Assemble
```bash
node ${plugin_dir}/scripts/assemble-all.js riff-1 riff-2 ...
```

### Step 5: Evaluate

```javascript
Task({
  subagent_type: "general-purpose",
  prompt: `
    Evaluate riffs in ${base_path}/

    Read each riff-*/index.html (business model in <!--BUSINESS--> comment).
    Score each 1-10 on: Originality, Market Potential, Feasibility, Monetization, Wow Factor.

    USE BASH to create RANKINGS.md:
    cat > RANKINGS.md << 'ENDOFMD'
    ...your markdown content...
    ENDOFMD

    Include:
    - Summary table (rank, name, score/50)
    - Detailed scores per riff
    - Recommendations: best for solo founder, fastest to ship, most innovative
  `
})
```

### Step 6: Generate Gallery

```javascript
Task({
  subagent_type: "general-purpose",
  prompt: `
    USE BASH to create: ${base_path}/index.html

    cat > index.html << 'ENDOFHTML'
    ...your html content...
    ENDOFHTML

    Read RANKINGS.md and riff-*/index.html files.
    Dark theme (#0a0a0f), glass cards, purple/cyan accents.
    Each card: rank badge, name, pitch, score bar, "Launch →" link.
    Responsive grid, self-contained HTML with inline styles.
  `
})
```

### Step 7: Present Results
```
Generated ${count} riffs for "${prompt}":
#1: riff-X - Name (XX/50)
...
Open index.html for gallery, RANKINGS.md for analysis.
```
