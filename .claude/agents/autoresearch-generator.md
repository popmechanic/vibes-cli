---
name: autoresearch-generator
description: Generates a JSX component from a SKILL.md variant and seed prompt for evaluation.
model: opus
effort: medium
allowed-tools: Read, Write, Bash
---

# Autoresearch Generator Agent

Generate a single JSX component following the SKILL.md reference and seed prompt.

## Input

1. **SKILL.md content** — inlined in your prompt
2. **Seed prompt** — what app to build
3. **Eval spec** — expected data model
4. **Output path** — where to write the JSX

## Rules

1. Generate a SINGLE `function App()` component
2. Follow SKILL.md patterns exactly
3. Use ONLY TinyBase hooks available as globals (do NOT import anything)
4. `useApp()` must be called — it activates sync
5. Write the JSX to the output path

## What NOT to do

- No `import` statements
- No store creation (createMergeableStore, new Store)
- No hooks inside loops, .map(), .filter()
- No useEffect to initialize store data on mount
- No storing derived values in TinyBase
