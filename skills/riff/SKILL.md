---
name: riff
description: Generate multiple Vibes app variations in parallel with business models and rankings. Use when exploring different interpretations of a broad objective or loose creative prompt.
---

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

    Write a Vibes app to: riff-${N}/app.jsx

    ## Interpretation Lens
    ${N}=1: Minimalist | 2: Social | 3: Gamified | 4: Professional
    5: Personal | 6: Marketplace | 7: Educational | 8: Creative | 9+: Wildcard

    ## Output Format
    \`\`\`jsx
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
      // Use useDocument for forms (NOT useState)
      // Use useLiveQuery for lists
      return <div className="min-h-screen bg-[#f1f5f9] p-4">...</div>;
    }
    \`\`\`

    Style: Tailwind neo-brutalist (border-4, shadow-[6px_6px_0px_#0f172a])
    NO: HTML tags, script tags, version numbers, ReactDOM
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

    Write RANKINGS.md with:
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
    Create gallery at ${base_path}/index.html

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
