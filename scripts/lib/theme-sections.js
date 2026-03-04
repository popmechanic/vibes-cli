/**
 * Theme section parsing and replacement utilities.
 *
 * Sections are delimited by comment markers in app.jsx:
 *   CSS:  /* @theme:tokens *\/ ... /* @theme:tokens:end *\/
 *   JSX:  {/* @theme:decoration *\/} ... {/* @theme:decoration:end *\/}
 *
 * Five layers: tokens, typography, surfaces, motion, decoration
 */

export const SECTION_NAMES = ['tokens', 'typography', 'surfaces', 'motion', 'decoration'];

// Matches both CSS /* @theme:X */ and JSX {/* @theme:X */} markers.
// Each section is expected to appear at most once per file.
function buildSectionRegex(name) {
  return new RegExp(
    `(\\{?\\/\\*\\s*@theme:${name}\\s*\\*\\/\\}?)` +  // opening marker (captured for preservation)
    `([\\s\\S]*?)` +                                     // content (captured, non-greedy)
    `(\\{?\\/\\*\\s*@theme:${name}:end\\s*\\*\\/\\}?)`  // closing marker (captured for preservation)
  );
}

/**
 * Check if code contains any @theme: markers.
 * @param {string} code - app.jsx content
 * @returns {boolean}
 */
function hasThemeMarkers(code) {
  return /@theme:(tokens|typography|surfaces|motion|decoration)/.test(code);
}

/**
 * Extract all theme sections from code.
 * @param {string} code - app.jsx content
 * @returns {{ tokens: string|null, typography: string|null, surfaces: string|null, motion: string|null, decoration: string|null, rest: string }}
 *   Each section value is the content between markers (trimmed), or null if not found.
 *   `rest` is everything outside the markers.
 */
function extractThemeSections(code) {
  const result = {
    tokens: null,
    typography: null,
    surfaces: null,
    motion: null,
    decoration: null,
    rest: code
  };

  for (const name of SECTION_NAMES) {
    const match = buildSectionRegex(name).exec(code);
    if (match) {
      result[name] = match[2]; // content between markers (preserves whitespace)
      // rest keeps empty marker pairs (useful for round-tripping with replaceThemeSection)
      result.rest = result.rest.replace(
        buildSectionRegex(name),
        (_, open, _mid, close) => `${open}\n${close}`
      );
    }
  }

  return result;
}

/**
 * Replace a single theme section's content.
 * @param {string} code - app.jsx content
 * @param {string} name - section name (tokens, typography, surfaces, motion, decoration)
 * @param {string} content - new content to place between markers
 * @returns {string} updated code
 */
function replaceThemeSection(code, name, content) {
  if (!SECTION_NAMES.includes(name)) {
    throw new Error(`Invalid theme section: ${name}. Must be one of: ${SECTION_NAMES.join(', ')}`);
  }
  const regex = buildSectionRegex(name);
  if (!regex.test(code)) {
    return code; // section not found, return unchanged
  }
  return code.replace(buildSectionRegex(name), (_, open, _mid, close) => `${open}\n${content}\n${close}`);
}

/**
 * Extract everything outside theme markers for validation.
 * Used to verify Claude didn't modify non-theme code.
 *
 * Unlike extractThemeSections().rest (which keeps empty marker pairs for round-tripping),
 * this replaces markers+content with stable placeholders for string equality comparison.
 *
 * @param {string} code - app.jsx content
 * @returns {string} code with all theme section contents removed
 */
function extractNonThemeSections(code) {
  let result = code;
  for (const name of SECTION_NAMES) {
    result = result.replace(buildSectionRegex(name), `@theme:${name}:placeholder`);
  }
  return result;
}

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
    const escaped = prop.replace(/-/g, '\\-');
    const pattern = new RegExp(`(?:^|[;{\\s])${escaped}\\s*:`);
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

  // Find the style tag content boundaries (template literal: const STYLE = `...`)
  // We only want to scan CSS inside a template literal, not JSX
  const styleStart = code.indexOf('`');
  if (styleStart === -1) return code;
  const styleEnd = code.indexOf('`', styleStart + 1);
  if (styleEnd === -1) return code;
  const styleContent = code.slice(styleStart, styleEnd + 1);

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

export {
  hasThemeMarkers,
  extractThemeSections,
  replaceThemeSection,
  extractNonThemeSections,
  moveVisualCSSToSurfaces
};
