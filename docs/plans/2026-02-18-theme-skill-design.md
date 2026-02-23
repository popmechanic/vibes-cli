# Theme Feature Design

> **Revision note:** Originally designed as a separate `/vibes:theme` skill. Restructured to fold into `/vibes:vibes` as an optional design preview step (Step 1.9) after determining that the feature has total dependency on the vibes skill and does not constitute an independent capability per Claude Code plugin best practices.

## Purpose

The design preview feature produces a standalone `theme.html` file — a fully styled, interactive static page that demonstrates an app's visual identity without framework dependencies. No React, no Fireproof, no Clerk.

The artifact lets users see and interact with their app's look before any infrastructure gets involved. When satisfied, the vibes skill uses the design decisions from the preview to guide `app.jsx` generation.

## How It Works (within `/vibes:vibes`)

### Step 0.5: Check for Design Reference

If the user provides a reference image (local file or URL) or a `theme.html` file alongside their app description, the vibes skill detects it and uses it to guide design reasoning and theme selection.

### Step 1.9: Generate Design Preview (Optional)

After theme selection (Step 1.75), the skill asks: "Want to preview the design as a standalone HTML page before I build the app?"

If yes, generates `theme.html` — a self-contained static page with:
- CSS custom properties using `--comp-*` token overrides
- Realistic placeholder content
- Interactive elements wired with vanilla JS
- Animations and inline SVGs
- CSS-only theme switching via `[data-theme]` (if multi-theme)
- `VIBES-THEME-META` comment block with selected themes and tokens

The user can iterate on the preview. When satisfied, the skill proceeds to Step 2 (app.jsx generation) using the design decisions from the preview.

## Output Artifact

Single self-contained `theme.html` with metadata comment:

```html
<!-- VIBES-THEME-META
  source: prompt | image
  mood: "{theme mood}"
  themes: ["{theme-id-1}", "{theme-id-2}"]
  tokens: { "--comp-bg": "oklch(...)", "--comp-accent": "oklch(...)" }
  layout: "{layout-type}"
  image-ref: "{path}"  (if image-driven)
-->
```

## File Location Changes (cache cleanup)

As part of this work, files were moved out of `cache/` directories:

| Old Location | New Location | Rationale |
|---|---|---|
| `cache/design-tokens.txt` | `build/design-tokens.txt` | Generated build artifact |
| `cache/design-tokens.css` | `build/design-tokens.css` | Generated build artifact |
| `cache/vibes-menu.js` | `build/vibes-menu.js` | Generated build artifact |
| `skills/vibes/cache/themes/*.txt` | `skills/vibes/themes/*.txt` | Authored reference content, not cache |

The `build/` directory gitignore was changed from `/build/` (ignore all) to `/build/*` with explicit `!` exceptions for the three shipped artifacts.

## Implementation

Changes made to `skills/vibes/SKILL.md`:
- Added Step 0.5 (design reference detection — image or theme.html)
- Added Step 1.9 (optional design preview generation)

All `cache/` path references updated across: SKILL.md, catalog.txt, build-design-tokens.js, design-tokens.js, merge-templates.js, pipeline.md, builder.md.
