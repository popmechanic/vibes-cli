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
    Run this Bash command with a complete Vibes app:

    cat > riff-${N}/app.jsx << 'ENDOFJSX'
    /*BUSINESS
    name: [App Name]
    pitch: [One sentence]
    customer: [Target user]
    revenue: [Pricing model]
    */
    import React, { useState } from "react";
    import { useFireproof } from "use-fireproof";

    export default function App() {
      const { useLiveQuery, useDocument } = useFireproof("riff-${N}-db");
      // Your implementation here
      return <div className="min-h-screen bg-[#f1f5f9] p-4">...</div>;
    }
    ENDOFJSX

    Theme: ${user_prompt}
    Lens: ${N}=1: Minimalist | 2: Social | 3: Gamified | 4: Professional | 5: Personal | 6: Marketplace | 7: Educational | 8: Creative | 9+: Wildcard
    Style: Tailwind neo-brutalist
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
    Read each riff-*/index.html in ${base_path}/ and score the business models.

    Then run this Bash command with your analysis:

    cat > RANKINGS.md << 'ENDOFMD'
    # Riff Rankings
    | Rank | Name | Score |
    |------|------|-------|
    ...
    ENDOFMD

    Score 1-10 on: Originality, Market Potential, Feasibility, Monetization, Wow Factor.
    Include: summary table, detailed scores, recommendations (solo founder, fastest to ship, most innovative).
  `
})
```

### Step 6: Generate Gallery

```javascript
Task({
  subagent_type: "general-purpose",
  prompt: `
    Read RANKINGS.md and riff-*/index.html files in ${base_path}/.

    Then run this Bash command with a gallery page:

    cat > index.html << 'ENDOFHTML'
    <!DOCTYPE html>
    <html>
    <head><title>Riff Gallery</title></head>
    <body style="background:#0a0a0f;color:#fff;font-family:system-ui">
    ...your gallery cards here...
    </body>
    </html>
    ENDOFHTML

    Style: Dark theme, glass cards, purple/cyan accents.
    Each card: rank badge, name, pitch, score bar, "Launch →" link to riff-N/index.html.
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
