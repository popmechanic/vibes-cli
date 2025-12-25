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
    # CRITICAL: File Writing Instructions

    DO NOT use the Write tool - it will fail with permission denied.
    You MUST use Bash with a heredoc to write the file:

    cat > riff-${N}/app.jsx << 'ENDOFJSX'
    ...your complete jsx code...
    ENDOFJSX

    This is your ONLY task. Generate the JSX and write it using the Bash command above.

    # Riff ${N}/${total}: ${user_prompt}

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
    # CRITICAL: File Writing Instructions

    DO NOT use the Write tool - it will fail with permission denied.
    You MUST use Bash with a heredoc to write RANKINGS.md:

    cat > RANKINGS.md << 'ENDOFMD'
    ...your markdown content...
    ENDOFMD

    # Your Task

    Evaluate riffs in ${base_path}/

    Read each riff-*/index.html (business model in <!--BUSINESS--> comment).
    Score each 1-10 on: Originality, Market Potential, Feasibility, Monetization, Wow Factor.

    Include in RANKINGS.md:
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
    # CRITICAL: File Writing Instructions

    DO NOT use the Write tool - it will fail with permission denied.
    You MUST use Bash with a heredoc to write index.html:

    cat > index.html << 'ENDOFHTML'
    ...your html content...
    ENDOFHTML

    # Your Task

    Create a gallery page at ${base_path}/index.html

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
