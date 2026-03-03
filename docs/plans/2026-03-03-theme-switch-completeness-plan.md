# Theme Switch Completeness — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure all visual CSS in generated apps lives inside `@theme:*` markers so theme switching fully restyles every element.

**Architecture:** Three layers — fix generation prompts (prevent), add mechanical CSS relocation in the theme handler (catch), fix current artifact (clean up). TDD for the new function.

**Tech Stack:** Node.js, Vitest, regex-based CSS parsing

---

### Task 1: Write failing tests for `moveVisualCSSToSurfaces()`

**Files:**
- Modify: `scripts/__tests__/unit/theme-sections.test.js`

**Step 1: Add test fixtures and import**

Add these test fixtures after the existing `PARTIAL_APP` fixture (line 104) in theme-sections.test.js:

```javascript
// Fixture: app with visual CSS orphaned outside markers
const ORPHANED_VISUAL_CSS = `const STYLE = \`
/* @theme:tokens */
:root { --comp-bg: oklch(0.12 0.03 280); }
/* @theme:tokens:end */

/* @theme:typography */
@import url('https://fonts.googleapis.com/css2?family=Inter&display=swap');
/* @theme:typography:end */

/* @theme:surfaces */
.glass-card { backdrop-filter: blur(20px); }
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes drift { from { opacity: 0; } to { opacity: 1; } }
/* @theme:motion:end */

/* Layout */
.title-fancy {
  font-family: 'Cinzel Decorative', serif;
  font-weight: 700;
  color: var(--fg);
}

.pure-layout {
  display: grid;
  gap: 1rem;
  max-width: 800px;
  margin: 0 auto;
}

.nav-label {
  font-family: 'Homemade Apple', cursive;
  font-size: 0.55rem;
  color: var(--brass-dark);
  text-align: center;
}

@media (max-width: 480px) {
  .nav-item { width: 38px; height: 38px; font-size: 0.85rem; }
}
\`;

function App() {
  return <div>Content</div>;
}
export default App;`;

// Fixture: visual CSS before tokens (edge case)
const VISUAL_BEFORE_TOKENS = `const STYLE = \`
.orphan-header {
  background: linear-gradient(to right, red, blue);
  border: 2px solid black;
}

/* @theme:tokens */
:root { --comp-bg: oklch(0.12 0.03 280); }
/* @theme:tokens:end */

/* @theme:surfaces */
.card { box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
/* @theme:surfaces:end */
\`;
export default function App() { return <div />; }`;
```

Update the import at line 12-18 to also import `moveVisualCSSToSurfaces`:

```javascript
import {
  SECTION_NAMES,
  hasThemeMarkers,
  extractThemeSections,
  replaceThemeSection,
  extractNonThemeSections,
  moveVisualCSSToSurfaces
} from '../../lib/theme-sections.js';
```

**Step 2: Add the test describe block**

Add after the existing `edge cases` describe block (after line 334):

```javascript
describe('moveVisualCSSToSurfaces', () => {
  it('moves visual CSS classes into @theme:surfaces', () => {
    const result = moveVisualCSSToSurfaces(ORPHANED_VISUAL_CSS);

    // Visual classes moved into surfaces
    const sections = extractThemeSections(result);
    expect(sections.surfaces).toContain('.title-fancy');
    expect(sections.surfaces).toContain("font-family: 'Cinzel Decorative'");
    expect(sections.surfaces).toContain('.nav-label');
    expect(sections.surfaces).toContain("color: var(--brass-dark)");
  });

  it('leaves pure-layout CSS outside markers', () => {
    const result = moveVisualCSSToSurfaces(ORPHANED_VISUAL_CSS);

    // Pure layout stays outside
    const sections = extractThemeSections(result);
    expect(sections.surfaces).not.toContain('.pure-layout');
    // But it's still in the file
    expect(result).toContain('.pure-layout');
    expect(result).toContain('display: grid');
  });

  it('moves media queries containing visual properties', () => {
    const result = moveVisualCSSToSurfaces(ORPHANED_VISUAL_CSS);

    const sections = extractThemeSections(result);
    expect(sections.surfaces).toContain('@media (max-width: 480px)');
    expect(sections.surfaces).toContain('font-size: 0.85rem');
  });

  it('moves visual CSS found before @theme:tokens', () => {
    const result = moveVisualCSSToSurfaces(VISUAL_BEFORE_TOKENS);

    const sections = extractThemeSections(result);
    expect(sections.surfaces).toContain('.orphan-header');
    expect(sections.surfaces).toContain('linear-gradient');
  });

  it('preserves existing surfaces content', () => {
    const result = moveVisualCSSToSurfaces(ORPHANED_VISUAL_CSS);

    const sections = extractThemeSections(result);
    expect(sections.surfaces).toContain('.glass-card');
    expect(sections.surfaces).toContain('backdrop-filter: blur(20px)');
  });

  it('returns unchanged code when no orphaned visual CSS exists', () => {
    const result = moveVisualCSSToSurfaces(FULL_APP);
    expect(result).toBe(FULL_APP);
  });

  it('returns unchanged code for legacy apps without markers', () => {
    const result = moveVisualCSSToSurfaces(LEGACY_APP);
    expect(result).toBe(LEGACY_APP);
  });

  it('does not move JS/JSX code, only CSS rules', () => {
    const result = moveVisualCSSToSurfaces(ORPHANED_VISUAL_CSS);

    // JS code stays in place
    expect(result).toContain('function App()');
    expect(result).toContain('export default App');
    const sections = extractThemeSections(result);
    expect(sections.surfaces).not.toContain('function App');
  });

  it('logs moved classes count', () => {
    // moveVisualCSSToSurfaces returns { code, movedCount } or just string
    // Implementation decides — test the string result at minimum
    const result = moveVisualCSSToSurfaces(ORPHANED_VISUAL_CSS);
    expect(typeof result).toBe('string');
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/theme-sections.test.js`
Expected: FAIL — `moveVisualCSSToSurfaces` is not exported from theme-sections.js

---

### Task 2: Implement `moveVisualCSSToSurfaces()`

**Files:**
- Modify: `scripts/lib/theme-sections.js`

**Step 1: Add the visual property detection constants and function**

Add before the final `export` block (before line 100):

```javascript
/**
 * CSS properties that indicate visual styling (not pure layout).
 * If a CSS rule contains any of these, it belongs inside @theme:surfaces.
 */
const VISUAL_PROPERTIES = [
  'color', 'background', 'border', 'box-shadow', 'text-shadow',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'fill', 'stroke', 'opacity', 'gradient',
  'text-decoration-color', 'outline-color', 'caret-color',
  'backdrop-filter', 'filter',
];

/**
 * Check if a CSS rule body contains any visual properties.
 * @param {string} body - CSS rule body (content between { })
 * @returns {boolean}
 */
function hasVisualProperties(body) {
  const normalized = body.toLowerCase();
  return VISUAL_PROPERTIES.some(prop => {
    // Match property name at start of declaration (after newline/semicolon/brace)
    // Avoid matching inside values (e.g., "color" inside "background-color")
    const pattern = new RegExp(`(?:^|[;{\\s])${prop.replace('-', '\\-')}\\s*:`);
    return pattern.test(normalized);
  });
}

/**
 * Extract CSS rule blocks from a code string.
 * Returns array of { fullMatch, selector, body, startIndex, endIndex }.
 * Handles nested braces in @media queries.
 */
function extractCSSRules(code) {
  const rules = [];
  // Match CSS rules: .selector { ... } and @media (...) { ... { ... } }
  const ruleRegex = /(@media\s*\([^)]*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}|[.#@][a-zA-Z_][\w.:>+~\s-]*\{[^}]*\})/g;
  let match;
  while ((match = ruleRegex.exec(code)) !== null) {
    const fullMatch = match[0];
    const braceIdx = fullMatch.indexOf('{');
    rules.push({
      fullMatch,
      selector: fullMatch.slice(0, braceIdx).trim(),
      body: fullMatch.slice(braceIdx + 1, -1),
      startIndex: match.index,
      endIndex: match.index + fullMatch.length,
    });
  }
  return rules;
}

/**
 * Move visual CSS rules from outside @theme markers into @theme:surfaces.
 *
 * Scans all CSS outside marker pairs. Rules with visual properties
 * (color, background, border, font-family, etc.) get relocated into
 * the @theme:surfaces section. Pure-layout rules stay in place.
 *
 * @param {string} code - app.jsx content
 * @returns {string} updated code with visual CSS inside surfaces markers
 */
function moveVisualCSSToSurfaces(code) {
  if (!hasThemeMarkers(code)) return code;

  // Extract the "rest" (everything outside markers)
  const sections = extractThemeSections(code);
  if (!sections.surfaces && sections.surfaces !== '') {
    // No surfaces section exists — can't move into it
    return code;
  }

  // Find the style tag content boundaries
  // We only want to scan CSS inside <style> or template literal, not JSX
  const styleStart = code.indexOf('`');
  const styleEnd = code.lastIndexOf('`}');
  if (styleStart === -1 || styleEnd === -1) return code;
  const styleContent = code.slice(styleStart, styleEnd);

  // Find regions outside all markers within the style content
  let outsideRegions = styleContent;
  for (const name of SECTION_NAMES) {
    const regex = buildSectionRegex(name);
    outsideRegions = outsideRegions.replace(regex, (m) => ' '.repeat(m.length));
  }

  // Extract CSS rules from outside regions
  const outsideRules = extractCSSRules(outsideRegions);
  const toMove = [];

  for (const rule of outsideRules) {
    const bodyToCheck = rule.selector.startsWith('@media')
      ? rule.fullMatch  // Check entire media query body for visual props
      : rule.body;

    if (hasVisualProperties(bodyToCheck)) {
      // Find the actual position in original code
      const originalIdx = code.indexOf(rule.fullMatch, styleStart);
      if (originalIdx !== -1) {
        toMove.push({ text: rule.fullMatch, index: originalIdx });
      }
    }
  }

  if (toMove.length === 0) return code;

  // Remove moved rules from original positions (reverse order to preserve indices)
  let result = code;
  const sorted = [...toMove].sort((a, b) => b.index - a.index);
  for (const item of sorted) {
    const before = result.slice(0, item.index);
    const after = result.slice(item.index + item.text.length);
    // Clean up trailing newlines
    result = before.replace(/\n+$/, '\n') + after.replace(/^\n+/, '\n');
  }

  // Append moved rules to surfaces section
  const movedCSS = toMove.map(item => item.text).join('\n\n');
  const currentSurfaces = extractThemeSections(result).surfaces || '';
  const newSurfaces = currentSurfaces.trimEnd() + '\n\n' + movedCSS + '\n';
  result = replaceThemeSection(result, 'surfaces', newSurfaces);

  console.log(`[ThemeSections] Moved ${toMove.length} visual CSS rules into @theme:surfaces`);
  return result;
}
```

**Step 2: Update the export block**

Replace the existing export block (line 100-105) with:

```javascript
export {
  hasThemeMarkers,
  extractThemeSections,
  replaceThemeSection,
  extractNonThemeSections,
  moveVisualCSSToSurfaces
};
```

**Step 3: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/theme-sections.test.js`
Expected: ALL PASS (both old and new tests)

**Step 4: Commit**

```bash
git add scripts/lib/theme-sections.js scripts/__tests__/unit/theme-sections.test.js
git commit -m "Add moveVisualCSSToSurfaces() to relocate orphaned visual CSS

Scans CSS outside @theme:* markers for visual properties (color,
background, border, font-family, etc.) and moves matching rules
into @theme:surfaces. Pure-layout rules stay in place."
```

---

### Task 3: Integrate into theme handler

**Files:**
- Modify: `scripts/server/handlers/theme.js:10,111-113`

**Step 1: Add import**

At line 10, update the import from theme-sections.js:

```javascript
import { hasThemeMarkers, replaceThemeSection, extractNonThemeSections, moveVisualCSSToSurfaces } from '../../lib/theme-sections.js';
```

**Step 2: Call moveVisualCSSToSurfaces in Pass 1**

In `handleThemeSwitchMultiPass()`, add the call after `updateThemeMeta` (line 111) and before `createBackup` (line 113):

```javascript
  updatedCode = updateThemeMeta(updatedCode, themeId, themeName);

  // Move orphaned visual CSS into @theme:surfaces before Pass 2
  updatedCode = moveVisualCSSToSurfaces(updatedCode);

  createBackup(appJsxPath);
```

**Step 3: Run full test suite**

Run: `cd scripts && npx vitest run`
Expected: ALL PASS — no regressions

**Step 4: Commit**

```bash
git add scripts/server/handlers/theme.js
git commit -m "Integrate moveVisualCSSToSurfaces into theme switch Pass 1

Runs after token/typography replacement, before writing to disk
for Pass 2. Ensures Claude sees all visual CSS inside markers."
```

---

### Task 4: Update generation instructions — generate.js

**Files:**
- Modify: `scripts/server/handlers/generate.js:128-169`

**Step 1: Replace the THEME SECTION MARKERS block**

Replace lines 128-169 (from `=== THEME SECTION MARKERS ===` to `- App layout, structure, and logic stay OUTSIDE all markers`) with:

```
=== THEME SECTION MARKERS ===

Organize ALL visual CSS into marked sections. This enables fast theme switching.

In your <style> tag, wrap CSS in comment markers:

\`\`\`css
/* @theme:tokens */
:root { --comp-bg: ...; --comp-text: ...; /* all color variables */ }
/* @theme:tokens:end */

/* @theme:typography */
@import url('...');  /* Google Fonts or other font imports */
/* @theme:typography:end */

/* @theme:surfaces */
.glass-card { backdrop-filter: ...; }
.nav-button { display: flex; gap: 0.5rem; background: var(--comp-accent); border: 2px solid var(--comp-border); }
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes drift { ... } /* all @keyframes and animation definitions */
/* @theme:motion:end */

/* Pure-layout ONLY — no visual properties */
.grid-wrapper { display: grid; gap: 1rem; max-width: 800px; margin: 0 auto; }
\`\`\`

In your JSX, wrap decorative elements:

\`\`\`jsx
{/* @theme:decoration */}
<svg className="atmospheric-bg">...</svg>
<div className="scan-line" />
{/* @theme:decoration:end */}
\`\`\`

Rules:
- EVERY :root block must be inside @theme:tokens markers
- EVERY @import font URL must be inside @theme:typography markers
- EVERY @keyframes must be inside @theme:motion markers
- Decorative SVGs and atmospheric elements go in @theme:decoration
- ANY class with visual properties (color, background, border, box-shadow, font-family, font-size, font-weight, text-shadow, fill, stroke, opacity, gradients) MUST go inside @theme:surfaces — even if it also has layout properties
- ONLY pure-layout classes go outside markers: display, grid-template, gap, padding, margin, position, z-index, width, max-width, height, flex-*, align-items, justify-content, overflow, box-sizing
```

**Step 2: Run test suite**

Run: `cd scripts && npx vitest run`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add scripts/server/handlers/generate.js
git commit -m "Clarify theme marker rules: visual CSS must go inside surfaces

Replace vague 'layout goes outside' with explicit visual-property
test. Any class with color/background/border/font-family belongs
in @theme:surfaces, even if it also has display/gap."
```

---

### Task 5: Update generation instructions — style-prompt.txt

**Files:**
- Modify: `skills/vibes/defaults/style-prompt.txt:1-39`

**Step 1: Replace the THEME SECTION ORGANIZATION block**

Replace lines 4-39 (from `THEME SECTION ORGANIZATION:` through `Everything outside markers (layout, structure, logic) is preserved during theme switches.`) with:

```
THEME SECTION ORGANIZATION: Wrap ALL visual CSS in `@theme:` markers for theme switching:

```css
/* @theme:tokens */
:root {
  --comp-bg: oklch(...);           /* surfaces */
  --comp-text: oklch(...);         /* body text */
  --comp-border: oklch(...);       /* outlines */
  --comp-accent: oklch(...);       /* primary accent */
  --comp-accent-text: oklch(...);  /* text on accent */
  --comp-muted: oklch(...);        /* placeholders */
}
/* @theme:tokens:end */

/* @theme:typography */
@import url('https://fonts.googleapis.com/css2?family=...');
/* @theme:typography:end */

/* @theme:surfaces */
.glass-card { backdrop-filter: blur(20px); }
.nav-item { font-family: 'Inter', sans-serif; color: var(--comp-text); background: var(--comp-bg); border: 1px solid var(--comp-border); }
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes drift { ... }
/* @theme:motion:end */
```

In JSX, wrap decorative SVGs and atmospheric elements:
```jsx
{/* @theme:decoration */}
<svg className="bg-pattern">...</svg>
{/* @theme:decoration:end */}
```

**What goes INSIDE markers (@theme:surfaces):** Any class with color, background, border, box-shadow, font-family, font-size, font-weight, text-shadow, fill, stroke, opacity, or gradients. If a class mixes layout AND visual properties, it goes inside @theme:surfaces.

**What stays OUTSIDE markers:** Only pure-layout classes — exclusively display, grid-template, gap, padding, margin, position, z-index, width/max-width/height, flex-*, align-items, justify-content, overflow, box-sizing. No visual properties at all.

Theme switches rewrite everything inside markers. Anything outside is frozen.
```

**Step 2: Commit**

```bash
git add skills/vibes/defaults/style-prompt.txt
git commit -m "Clarify style-prompt: visual CSS belongs in @theme:surfaces

Replace 'layout/structure/logic stays outside' with explicit
visual-property test to prevent orphaned styled classes."
```

---

### Task 6: Update generation instructions — SKILL.md

**Files:**
- Modify: `skills/vibes/SKILL.md:229-281`

**Step 1: Update the code example and section rules**

Replace the example code block (lines 229-252) — change the "Non-theme layout" example:

Replace:
```
/* Non-theme layout (outside markers) */
.app-grid { display: grid; gap: 1rem; }
```

With:
```
/* Pure-layout ONLY (no visual properties) */
.app-grid { display: grid; gap: 1rem; }
```

Replace the section rules (lines 275-281):

Replace:
```markdown
**Section rules:**
- `@theme:tokens` — `:root` CSS variables (colors, spacing tokens)
- `@theme:typography` — `@import` font URLs, `font-family` rules
- `@theme:surfaces` — Shadows, borders, glass effects, gradient backgrounds
- `@theme:motion` — `@keyframes` and animation definitions
- `@theme:decoration` — SVG elements, atmospheric backgrounds (in JSX)
- Everything else (layout, structure, logic) stays **outside** markers
```

With:
```markdown
**Section rules:**
- `@theme:tokens` — `:root` CSS variables (colors, spacing tokens)
- `@theme:typography` — `@import` font URLs
- `@theme:surfaces` — ANY class with visual properties: color, background, border, box-shadow, font-family, font-size, font-weight, text-shadow, fill, stroke, opacity, gradients. Mixed layout+visual classes go here too.
- `@theme:motion` — `@keyframes` and animation definitions
- `@theme:decoration` — SVG elements, atmospheric backgrounds (in JSX)
- **Outside markers:** ONLY pure-layout classes (display, grid, gap, padding, margin, position, width/height, flex, overflow). If a class has ANY visual property, it goes in `@theme:surfaces`.
```

**Step 2: Commit**

```bash
git add skills/vibes/SKILL.md
git commit -m "Clarify SKILL.md: surfaces takes all visual CSS classes

Update section rules to make the layout-vs-visual boundary
explicit. Mixed classes go in @theme:surfaces."
```

---

### Task 7: Fix current app.jsx artifact

**Files:**
- Modify: `app.jsx:1108-1202`

**Step 1: Run `moveVisualCSSToSurfaces` on the current app.jsx**

This can be done programmatically. Create a one-off script:

```bash
node -e "
import { readFileSync, writeFileSync } from 'fs';
import { moveVisualCSSToSurfaces } from './scripts/lib/theme-sections.js';

const code = readFileSync('app.jsx', 'utf-8');
const result = moveVisualCSSToSurfaces(code);
writeFileSync('app.jsx', result, 'utf-8');
console.log('Done. Lines before:', code.split('\n').length, 'Lines after:', result.split('\n').length);
"
```

**Step 2: Verify the result**

Manually inspect app.jsx:
- `.title-cinzel`, `.text-handwriting`, `.text-typewriter`, `.nav-label`, `.nav-label.active-label`, media query should now be inside `@theme:surfaces`
- `.app-content`, `.nav-bar` (pure layout) should remain outside
- All existing surfaces content (`.glass-card`, etc.) should still be present

Run: `grep -n '@theme:' app.jsx` to verify marker structure is intact.

**Step 3: Commit**

```bash
git add app.jsx
git commit -m "Move orphaned visual CSS into @theme:surfaces in app.jsx

Relocates .title-cinzel, .text-handwriting, .nav-label and other
classes with font-family/color from outside markers into surfaces
so theme switches can fully restyle them."
```

---

### Task 8: Run full test suite and verify

**Step 1: Run all tests**

Run: `cd scripts && npx vitest run`
Expected: ALL PASS

**Step 2: Manual verification**

1. Start preview server: `node scripts/preview-server.js --mode=editor`
2. Open http://localhost:3333
3. Generate a new app — inspect app.jsx for orphaned visual CSS
4. Switch themes — verify all visual elements change

**Step 3: Final commit if any cleanup needed**

Only if manual testing reveals issues.
