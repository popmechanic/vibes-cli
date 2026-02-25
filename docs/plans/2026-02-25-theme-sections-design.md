# Theme Sections: Structural Separation for Fast Theme Switching

**Date:** 2026-02-25
**Status:** Design approved, ready for implementation
**Author:** Marcus + Claude

## Problem

Theme switching spawns `claude -p` with `--allowedTools Edit,Read` to restyle app.jsx. For large apps (38KB+), Claude reads the entire file, reasons about how to apply the theme's personality, then emits a massive Edit — all in one text generation turn with no intermediate tool calls. This takes 3-10+ minutes and produces no progress signal beyond "Reading & analyzing..."

## Design Principle

Amber's theme system creates design coherence — themes are holistic transformations, not CSS variable swaps. Users value the deep restyle. The problem is the wait, not the depth. We solve this by making the transformation **targeted** rather than **shallow**.

## Solution: Comment-Delimited Theme Sections

### Section Convention

app.jsx organizes theme-sensitive code into marked regions within the existing single-file Babel architecture:

```jsx
const STYLE = `
/* @theme:tokens */
:root {
  --comp-bg: oklch(0.12 0.03 280);
  --comp-text: oklch(0.93 0.02 80);
  --comp-accent: oklch(0.72 0.15 75);
}
/* @theme:tokens:end */

/* @theme:typography */
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap');
/* @theme:typography:end */

/* @theme:surfaces */
.glass-card { backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); }
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes drift { 0% { transform: translate(0,0) } 100% { transform: translate(30px,-20px) } }
/* @theme:motion:end */

/* App layout styles (not theme-sensitive) */
.audio-controls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
`;
```

JSX decoration markers:

```jsx
{/* @theme:decoration */}
<svg className="circuit-corner left">...</svg>
<div className="scan-line" />
{/* @theme:decoration:end */}

{/* App content (not theme-sensitive) */}
<div className="audio-controls">
```

### Five Theme Layers

| Layer | Marker | What It Contains | Swap Method |
|-------|--------|-----------------|-------------|
| Tokens | `@theme:tokens` | `:root` CSS variables | Mechanical (no AI) |
| Typography | `@theme:typography` | `@import` font URLs, `font-family` | Mechanical (no AI) |
| Surfaces | `@theme:surfaces` | Shadows, borders, glass, gradients | Claude (creative) |
| Motion | `@theme:motion` | `@keyframes`, animation defs | Claude (creative) |
| Decoration | `@theme:decoration` | SVG elements, atmospheric backgrounds | Claude (creative) |

### Multi-Pass Theme Switch

**Pass 1 — Tokens + Typography (mechanical, <100ms, no Claude):**

The server already extracts `:root` CSS from theme files at startup. We extend `parseThemeColors()` to extract the full `:root` block and font imports. String replacement between markers — pure JavaScript.

This delivers the color and font transformation instantly.

**Pass 2 — Surfaces + Motion + Decoration (Claude, ~30-90s):**

Claude's prompt targets only the marked sections:

```
Read app.jsx. Replace ONLY the content between these markers:
- @theme:surfaces (CSS classes for shadows, borders, backgrounds)
- @theme:motion (@keyframes and animation definitions)
- @theme:decoration (SVG elements and atmospheric backgrounds)

Here is the theme personality to guide your choices:
{themeContent}

Do NOT modify anything outside these markers.
```

Claude reads 38KB but only emits ~50-150 lines of replacement across three small Edit calls. Text generation is ~1/10th the size of today's full-file rewrite.

**User experience:** Colors and fonts appear instantly. Shadows, animations, and SVG decorations arrive 30-90 seconds later. No layout shift since structure is untouched.

If the user switches themes again before Pass 2 finishes, cancel the subprocess and start fresh.

### Guardrails

**Layer 1 — Prompt constraint:**

The theme switch prompt explicitly references the markers: "You MUST only edit content between `@theme:` and `@theme:*:end` comment pairs. If you need to change anything outside a marker, stop and explain why instead of editing."

**Layer 2 — Post-edit validation:**

After Claude finishes, the server extracts all content outside `@theme:` markers from both the before and after versions of app.jsx. If they differ, the edit is rejected, app.jsx is restored from backup, and the user is notified.

```javascript
const after = readFileSync('app.jsx', 'utf-8');
const beforeNonTheme = extractNonThemeSections(beforeContent);
const afterNonTheme = extractNonThemeSections(after);
if (beforeNonTheme !== afterNonTheme) {
  writeFileSync('app.jsx', beforeContent); // restore
  // retry with stricter prompt or report error
}
```

Uses the existing backup pattern from `scripts/lib/backup.js`.

### Backwards Compatibility

Apps generated before this change won't have `@theme:` markers. Theme switching detects this and falls back to the current full-file restyle behavior. No existing apps break.

## Files to Modify

### Generation (add markers to new apps)

| File | Change |
|------|--------|
| `scripts/preview-server.js` — `handleGenerate()` | Add marker convention to generation prompt |
| `skills/vibes/SKILL.md` — Step 2 | Add marker convention to output code boilerplate |
| `skills/vibes/defaults/style-prompt.txt` | Add section organization guidance |

### Theme Switching (multi-pass with guardrails)

| File | Change |
|------|--------|
| `scripts/preview-server.js` — `handleThemeSwitch()` | Detect markers → multi-pass (mechanical + Claude). Fallback to current behavior if no markers. Add post-edit validation. |
| `scripts/preview-server.js` — `parseThemeColors()` | Extend to extract full `:root` block + font imports (not just swatch colors) |
| `skills/vibes/templates/preview.html` | Add "enhancing theme..." indicator for Pass 2 async phase. Handle instant `:root` injection via iframe postMessage. |

### Utility (new)

| File | Change |
|------|--------|
| `scripts/lib/theme-sections.js` | `extractThemeSections(code)` — parse markers, return { tokens, typography, surfaces, motion, decoration, rest }. `replaceThemeSection(code, name, content)` — swap one section. `extractNonThemeSections(code)` — return everything outside markers for validation. |

## Implementation Order

1. **theme-sections.js utility** — pure functions, easy to test
2. **Generation prompt update** — new apps get markers
3. **parseThemeColors() extension** — extract full `:root` + fonts
4. **handleThemeSwitch() rewrite** — multi-pass with fallback
5. **Post-edit validation** — Layer 2 guardrail
6. **Client-side instant preview** — iframe `:root` injection
7. **Tests** — unit tests for theme-sections.js, integration test for theme switch

## Open Questions

- Should the marker convention be documented in theme .txt files so theme authors know what sections their content maps to?
- Do we need a migration command to add markers to existing app.jsx files, or is the fallback sufficient?
- Should Pass 2 (Claude creative restyle) be opt-in? Some users might prefer tokens-only switching for speed.
