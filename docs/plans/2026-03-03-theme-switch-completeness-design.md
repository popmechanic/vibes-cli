# Theme Switch Completeness Fix

## Problem

When users switch themes in the editor, CSS classes defined outside `@theme:*` markers never get restyled. In one observed case, 76% of app.jsx (966 of 1279 lines) sat outside markers — including classes with colors, borders, fonts, and backgrounds that are clearly visual. The theme switch rewrote tokens and surfaces but left these orphaned classes frozen in the old theme's style.

## Root Cause

Three instruction sources all use the same vague rule:

| File | Line | The problematic instruction |
|------|------|---------------------------|
| `generate.js` | 151 | `/* Non-theme layout styles go OUTSIDE markers */` |
| `style-prompt.txt` | 39 | `Everything outside markers (layout, structure, logic) is preserved during theme switches.` |
| `SKILL.md` | 250-281 | `/* Non-theme layout (outside markers) */` |

Claude interprets "layout" broadly — any class with positioning or structural properties gets placed outside markers, even when it also has colors, borders, and font-family declarations.

## Design

### Part 1: Fix generation instructions

Replace the vague "layout goes outside" rule with a visual-property test:

**New rule:** Only pure-layout CSS goes outside markers. Pure-layout means exclusively `display`, `grid-template-*`, `gap`, `padding`, `margin`, `position`, `z-index`, `width`/`max-width`/`height`, `flex-*`, `align-items`, `justify-content`, `overflow`, `box-sizing`. If a class has ANY visual property — `color`, `background`, `border`, `box-shadow`, `font-family`, `text-shadow`, `opacity`, `fill`, `stroke`, or gradients — it belongs inside `@theme:surfaces`.

**Files to update:**
- `scripts/server/handlers/generate.js` (lines 143-169)
- `skills/vibes/defaults/style-prompt.txt` (lines 1-39)
- `skills/vibes/SKILL.md` (lines 229-281)

Each gets the updated rule plus a wrong/right example:

```
WRONG — mixed class outside markers:
.nav-button {
  display: flex;
  gap: 0.5rem;
  background: var(--comp-accent);
  border: 2px solid var(--comp-border);
}

RIGHT — visual class inside @theme:surfaces:
/* @theme:surfaces */
.nav-button {
  display: flex;
  gap: 0.5rem;
  background: var(--comp-accent);
  border: 2px solid var(--comp-border);
}
/* @theme:surfaces:end */
```

### Part 2: Harden the theme handler

Add a `moveVisualCSSToSurfaces(code)` function that mechanically detects and relocates orphaned visual CSS during theme switches.

**Location:** `scripts/lib/theme-sections.js` (new export)

**Algorithm:**
1. Find CSS rules between `@theme:motion:end` and the closing style tag (the "orphan zone")
2. Parse each rule block (`.class { ... }`)
3. Check if any property matches the visual property set: `color`, `background`, `border`, `box-shadow`, `font-family`, `font-weight`, `font-size`, `text-shadow`, `fill`, `stroke`, `opacity`, `gradient`, `text-decoration-color`
4. Move matching rules to the end of `@theme:surfaces` content (before the end marker)
5. Leave pure-layout rules in place

**Integration:** Call in `handleThemeSwitchMultiPass()` (theme.js) during Pass 1, after token/typography replacement, before writing to disk for Pass 2. This ensures Pass 2 Claude sees all visual CSS inside markers and can restyle it.

**Also scan before `@theme:tokens`:** Visual CSS can appear anywhere outside markers, not just after `@theme:motion:end`. The function should scan all code outside any marker pair.

**Edge cases:**
- Media queries wrapping visual rules: move the entire `@media` block if it contains visual properties
- Pseudo-selectors (`:hover`, `::before`): check the parent rule
- CSS custom properties in orphaned rules: if they reference `--comp-*` tokens, that's visual

### Part 3: Fix current artifact

Move the CSS classes from lines 1152-1202 of `app.jsx` (`.title-cinzel`, `.text-handwriting`, `.text-typewriter`, `.app-content`, `.nav-bar`, `.nav-label`, `.nav-label.active-label`, media queries) into the `@theme:surfaces` section.

Split by visual vs pure-layout:
- Visual (move to surfaces): `.title-cinzel` (has font-family, color), `.text-handwriting` (font-family), `.text-typewriter` (font-family), `.nav-label` (font-family, color), `.nav-label.active-label` (color)
- Pure layout (keep outside): `.app-content` (only position, z-index, padding, max-width, margin), `.nav-bar` (only position, z-index, display, flex properties)
- Mixed: `.nav-medallion` media query (has font-size which is visual) — move to surfaces

## Testing

1. Generate a new app via the editor — verify all visual CSS lands inside markers
2. Switch themes — verify no orphaned visual CSS remains
3. Run `scripts/__tests__/` — ensure no regressions in assembly/template tests
4. Add a unit test for `moveVisualCSSToSurfaces()` in `scripts/__tests__/unit/`
