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

export {
  hasThemeMarkers,
  extractThemeSections,
  replaceThemeSection,
  extractNonThemeSections
};
