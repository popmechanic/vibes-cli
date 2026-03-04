/**
 * Tests for theme section parsing and replacement utilities
 *
 * These tests ensure theme-sections.js correctly:
 * - Detects presence of @theme: markers
 * - Extracts theme sections from CSS and JSX
 * - Replaces individual sections while preserving markers
 * - Extracts non-theme content for validation
 */

import { describe, it, expect } from 'vitest';
import {
  SECTION_NAMES,
  hasThemeMarkers,
  extractThemeSections,
  replaceThemeSection,
  extractNonThemeSections,
  moveVisualCSSToSurfaces
} from '../../lib/theme-sections.js';

// Fixture: app.jsx with all 5 theme layers
const FULL_APP = `window.__VIBES_THEMES__ = [{ id: "neon", name: "Neon" }];

const STYLE = \`
/* @theme:tokens */
:root {
  --comp-bg: oklch(0.12 0.03 280);
  --comp-text: oklch(0.93 0.02 80);
  --comp-accent: oklch(0.72 0.15 75);
}
/* @theme:tokens:end */

/* @theme:typography */
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap');
body { font-family: 'Orbitron', sans-serif; }
/* @theme:typography:end */

/* @theme:surfaces */
.glass-card { backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); }
.shadow-neon { box-shadow: 0 0 20px rgba(0,255,255,0.3); }
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes drift { 0% { transform: translate(0,0) } 100% { transform: translate(30px,-20px) } }
@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }
/* @theme:motion:end */

/* App layout (not theme-sensitive) */
.audio-controls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
.main-container { max-width: 1200px; margin: 0 auto; }
\`;

function App() {
  return (
    <>
      <style>{STYLE}</style>
      <div className="main-container">
        {/* @theme:decoration */}
        <svg className="circuit-corner left" viewBox="0 0 100 100">
          <path d="M0,0 L100,0 L100,100" stroke="cyan" fill="none" />
        </svg>
        <div className="scan-line" />
        {/* @theme:decoration:end */}

        <div className="audio-controls">
          <button>Play</button>
        </div>
      </div>
    </>
  );
}

export default App;`;

// Fixture: app without markers (legacy)
const LEGACY_APP = `const STYLE = \`
:root { --comp-bg: #111; --comp-text: #eee; }
.card { border: 2px solid black; }
\`;

function App() {
  return <div className="card">Hello</div>;
}
export default App;`;

// Fixture: partial markers (only tokens + decoration)
const PARTIAL_APP = `const STYLE = \`
/* @theme:tokens */
:root { --comp-bg: oklch(0.15 0.02 200); }
/* @theme:tokens:end */

.layout { display: flex; }
\`;

function App() {
  return (
    <div>
      {/* @theme:decoration */}
      <svg><circle r="10" /></svg>
      {/* @theme:decoration:end */}
      <p>Content</p>
    </div>
  );
}
export default App;`;

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

describe('SECTION_NAMES', () => {
  it('contains all five theme layers', () => {
    expect(SECTION_NAMES).toEqual(['tokens', 'typography', 'surfaces', 'motion', 'decoration']);
  });
});

describe('hasThemeMarkers', () => {
  it('returns true when markers are present', () => {
    expect(hasThemeMarkers(FULL_APP)).toBe(true);
  });

  it('returns true with partial markers', () => {
    expect(hasThemeMarkers(PARTIAL_APP)).toBe(true);
  });

  it('returns false for legacy apps without markers', () => {
    expect(hasThemeMarkers(LEGACY_APP)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasThemeMarkers('')).toBe(false);
  });

  it('does not match invalid section names', () => {
    expect(hasThemeMarkers('/* @theme:colors */')).toBe(false);
    expect(hasThemeMarkers('/* @theme:layout */')).toBe(false);
  });
});

describe('extractThemeSections', () => {
  it('extracts all 5 sections from full app', () => {
    const result = extractThemeSections(FULL_APP);

    expect(result.tokens).toContain('--comp-bg: oklch(0.12 0.03 280)');
    expect(result.typography).toContain("@import url('https://fonts.googleapis.com");
    expect(result.typography).toContain("font-family: 'Orbitron'");
    expect(result.surfaces).toContain('backdrop-filter: blur(20px)');
    expect(result.surfaces).toContain('box-shadow: 0 0 20px');
    expect(result.motion).toContain('@keyframes drift');
    expect(result.motion).toContain('@keyframes pulse');
    expect(result.decoration).toContain('<svg className="circuit-corner');
    expect(result.decoration).toContain('scan-line');
  });

  it('returns null for missing sections', () => {
    const result = extractThemeSections(PARTIAL_APP);

    expect(result.tokens).toContain('--comp-bg');
    expect(result.decoration).toContain('<svg>');
    expect(result.typography).toBeNull();
    expect(result.surfaces).toBeNull();
    expect(result.motion).toBeNull();
  });

  it('rest excludes section content but preserves non-theme code', () => {
    const result = extractThemeSections(FULL_APP);

    // Non-theme code preserved in rest
    expect(result.rest).toContain('.audio-controls { display: grid;');
    expect(result.rest).toContain('.main-container { max-width: 1200px;');
    expect(result.rest).toContain('<button>Play</button>');
    expect(result.rest).toContain('export default App');

    // Theme content removed from rest
    expect(result.rest).not.toContain('oklch(0.12 0.03 280)');
    expect(result.rest).not.toContain('backdrop-filter: blur(20px)');
    expect(result.rest).not.toContain('@keyframes drift');
  });

  it('handles legacy app gracefully (all null, rest = full code)', () => {
    const result = extractThemeSections(LEGACY_APP);

    expect(result.tokens).toBeNull();
    expect(result.typography).toBeNull();
    expect(result.surfaces).toBeNull();
    expect(result.motion).toBeNull();
    expect(result.decoration).toBeNull();
    expect(result.rest).toBe(LEGACY_APP);
  });
});

describe('replaceThemeSection', () => {
  it('replaces tokens section content', () => {
    const newTokens = ':root { --comp-bg: red; --comp-text: blue; }';
    const result = replaceThemeSection(FULL_APP, 'tokens', newTokens);

    expect(result).toContain('/* @theme:tokens */');
    expect(result).toContain(newTokens);
    expect(result).toContain('/* @theme:tokens:end */');
    // Old tokens gone
    expect(result).not.toContain('oklch(0.12 0.03 280)');
  });

  it('replaces decoration section (JSX markers)', () => {
    const newDecoration = '<div className="new-bg" />';
    const result = replaceThemeSection(FULL_APP, 'decoration', newDecoration);

    expect(result).toContain('{/* @theme:decoration */}');
    expect(result).toContain(newDecoration);
    expect(result).toContain('{/* @theme:decoration:end */}');
    // Old decoration gone
    expect(result).not.toContain('circuit-corner');
  });

  it('preserves non-theme content when replacing', () => {
    const result = replaceThemeSection(FULL_APP, 'motion', '@keyframes spin { to { transform: rotate(360deg) } }');

    expect(result).toContain('.audio-controls { display: grid;');
    expect(result).toContain('<button>Play</button>');
    expect(result).toContain('export default App');
  });

  it('returns unchanged code when section not found', () => {
    const result = replaceThemeSection(PARTIAL_APP, 'surfaces', '.new-surface {}');
    expect(result).toBe(PARTIAL_APP);
  });

  it('throws for invalid section names', () => {
    expect(() => replaceThemeSection(FULL_APP, 'colors', ':root {}')).toThrow('Invalid theme section');
    expect(() => replaceThemeSection(FULL_APP, 'layout', '.grid {}')).toThrow('Invalid theme section');
  });

  it('can replace multiple sections independently', () => {
    let result = FULL_APP;
    result = replaceThemeSection(result, 'tokens', ':root { --comp-bg: green; }');
    result = replaceThemeSection(result, 'typography', '@import url("new-font.css");');
    result = replaceThemeSection(result, 'surfaces', '.new-surface { opacity: 0.5; }');

    expect(result).toContain('--comp-bg: green');
    expect(result).toContain('new-font.css');
    expect(result).toContain('.new-surface { opacity: 0.5; }');
    // Other sections untouched
    expect(result).toContain('@keyframes drift');
    expect(result).toContain('circuit-corner');
  });
});

describe('extractNonThemeSections', () => {
  it('removes theme content, preserves everything else', () => {
    const result = extractNonThemeSections(FULL_APP);

    // Non-theme preserved
    expect(result).toContain('.audio-controls');
    expect(result).toContain('.main-container');
    expect(result).toContain('<button>Play</button>');
    expect(result).toContain('export default App');
    expect(result).toContain('__VIBES_THEMES__');

    // Theme content removed
    expect(result).not.toContain('oklch(0.12 0.03 280)');
    expect(result).not.toContain('backdrop-filter');
    expect(result).not.toContain('@keyframes drift');
    expect(result).not.toContain('circuit-corner');
  });

  it('is stable across theme changes (same non-theme = same output)', () => {
    const before = extractNonThemeSections(FULL_APP);

    // Simulate theme switch: replace tokens and surfaces
    let modified = replaceThemeSection(FULL_APP, 'tokens', ':root { --comp-bg: red; }');
    modified = replaceThemeSection(modified, 'surfaces', '.new { color: blue; }');

    const after = extractNonThemeSections(modified);

    expect(before).toBe(after);
  });

  it('detects when non-theme content was modified', () => {
    const before = extractNonThemeSections(FULL_APP);

    // Simulate Claude modifying layout (outside markers)
    const tampered = FULL_APP.replace('.audio-controls { display: grid;', '.audio-controls { display: flex;');
    const after = extractNonThemeSections(tampered);

    expect(before).not.toBe(after);
  });

  it('returns full code for legacy apps without markers', () => {
    const result = extractNonThemeSections(LEGACY_APP);
    expect(result).toBe(LEGACY_APP);
  });
});

describe('edge cases', () => {
  it('handles empty sections', () => {
    const code = `/* @theme:tokens */\n/* @theme:tokens:end */`;
    const result = extractThemeSections(code);
    expect(result.tokens).toBe('\n');
  });

  it('handles sections with extra whitespace in markers', () => {
    const code = `/*  @theme:tokens  */\n:root { --x: 1; }\n/*  @theme:tokens:end  */`;
    const result = extractThemeSections(code);
    expect(result.tokens).toContain('--x: 1');
  });

  it('handles CSS and JSX markers in same file', () => {
    const result = extractThemeSections(FULL_APP);
    // CSS markers
    expect(result.tokens).not.toBeNull();
    expect(result.surfaces).not.toBeNull();
    // JSX markers
    expect(result.decoration).not.toBeNull();
  });

  it('handles regex-special characters in section content', () => {
    const code = `/* @theme:surfaces */
.card { background: url("data:image/svg+xml,%3Csvg%3E"); }
.price::after { content: "$99.00 (50% off)"; }
.escaped { border: 1px solid rgba(0,0,0,0.1); }
/* @theme:surfaces:end */`;

    const sections = extractThemeSections(code);
    expect(sections.surfaces).toContain('$99.00 (50% off)');
    expect(sections.surfaces).toContain('url("data:image/svg+xml');

    const replaced = replaceThemeSection(code, 'surfaces', '.new { color: red; }');
    expect(replaced).toContain('.new { color: red; }');
    expect(replaced).not.toContain('$99.00');
  });

  it('handles $ in replacement content without backreference issues', () => {
    const code = `/* @theme:tokens */\n:root { --x: 1; }\n/* @theme:tokens:end */`;
    const newContent = ':root { --price: "$100"; --sale: "$50 (half off)"; }';
    const result = replaceThemeSection(code, 'tokens', newContent);
    expect(result).toContain('$100');
    expect(result).toContain('$50 (half off)');
  });
});

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
