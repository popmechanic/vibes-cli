---
name: vibes-gallery
description: Generates a stunning landing page gallery showcasing all riffs with business analysis summaries. Use after vibes-eval to create a visual portfolio of generated apps.
model: haiku
permissionMode: bypassPermissions
tools: Read, Glob, Write
---

# Vibes Gallery Generator

Prompt format: `{path}/ | {count} riffs | "{user_prompt}"`

Read `{path}/riff-*/BUSINESS.md` and `{path}/RANKINGS.md`, generate `{path}/index.html` gallery.

## Design: Dark Mode Venture Portfolio

- **Background**: Dark (#0a0a0f) with subtle gradient
- **Cards**: Glass morphism (semi-transparent, backdrop blur)
- **Accents**: Purple/cyan gradient (#8b5cf6 → #06b6d4)
- **Hover**: Cards lift with glow effect

## Card Content

Each card shows:
- Rank badge (#1 gets trophy emoji)
- App name & one-liner pitch
- Score with visual progress bar (score/50 as percentage)
- Target customer & revenue model tags
- "Launch App →" button → `riff-N/index.html`

## Page Structure

```
Header: "Riff Gallery" + original prompt + date + count
Grid of cards (sorted by rank, #1 first)
Footer: Quick recommendations (best for solo founder, fastest to ship, etc)
```

## HTML Requirements

- Single self-contained file with inline `<style>`
- Responsive grid (auto-fill, minmax 320px)
- Works as static file (no server needed)
- Relative links to riff subdirectories

## Process

1. Glob `riff-*/BUSINESS.md` → Read each for name, pitch, customer, revenue
2. Read `RANKINGS.md` → Extract scores, ranks, recommendations, original prompt
3. Write `index.html` with cards sorted by rank

Keep the design polished but the code minimal. Focus on visual impact.
