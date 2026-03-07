/**
 * Post-processing utilities for app.jsx sanitization.
 *
 * CSS `content: '\2192'` is valid CSS but invalid JS inside a template literal.
 * These utilities replace CSS unicode escapes with actual Unicode characters.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const CSS_UNICODE_MAP = {
  '2192': '\u2192', // →
  '2190': '\u2190', // ←
  '2191': '\u2191', // ↑
  '2193': '\u2193', // ↓
  '2022': '\u2022', // •
  '25CF': '\u25CF', // ●
  '00BB': '\u00BB', // »
  '00AB': '\u00AB', // «
  '2014': '\u2014', // —
  '2013': '\u2013', // –
  '2026': '\u2026', // …
  '00D7': '\u00D7', // ×
  '2715': '\u2715', // ✕
  '2713': '\u2713', // ✓
  '2717': '\u2717', // ✗
  '25B6': '\u25B6', // ▶
  '25C0': '\u25C0', // ◀
  '25B2': '\u25B2', // ▲
  '25BC': '\u25BC', // ▼
  '2605': '\u2605', // ★
  '2606': '\u2606', // ☆
  '2764': '\u2764', // ❤
  '2716': '\u2716', // ✖
};

/**
 * Replace CSS unicode escapes in content: properties with actual Unicode chars.
 */
export function sanitizeCssEscapes(code) {
  return code.replace(/(content\s*:\s*['"])([^'"]*\\[0-9a-fA-F]{2,6}[^'"]*?)(['"])/g, (full, pre, inner, post) => {
    const replaced = inner.replace(/\\([0-9a-fA-F]{2,6})/g, (esc, hex) => {
      const upper = hex.toUpperCase().replace(/^0+/, '') || '0';
      const padded = upper.padStart(4, '0');
      if (CSS_UNICODE_MAP[padded]) return CSS_UNICODE_MAP[padded];
      const cp = parseInt(hex, 16);
      return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : esc;
    });
    return pre + replaced + post;
  });
}

/**
 * Strip redeclared globals that collide with template-provided identifiers.
 * Common builder mistake: subprocess creates a mock useFireproofClerk fallback
 * that shadows the real global from the import map.
 */
export function stripRedeclaredGlobals(code) {
  // Remove `const { useFireproofClerk } = React.useMemo(...)` blocks
  // These are mock fallback wrappers that collide with the real global
  const pattern = /const\s*\{\s*useFireproofClerk\s*\}\s*=\s*React\.useMemo\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[\s*\]\s*\);\s*\n?/g;
  return code.replace(pattern, '');
}

/**
 * Sanitize app.jsx: fix CSS unicode escapes and strip redeclared globals.
 * Shared post-processing step used by multiple handlers.
 */
export function sanitizeAppJsx(projectRoot) {
  const appPath = join(projectRoot, 'app.jsx');
  if (!existsSync(appPath)) return;
  let code = readFileSync(appPath, 'utf-8');
  let changed = false;

  const cssClean = sanitizeCssEscapes(code);
  if (cssClean !== code) { code = cssClean; changed = true; console.log('[PostProcess] Sanitized CSS unicode escapes'); }

  const globalClean = stripRedeclaredGlobals(code);
  if (globalClean !== code) { code = globalClean; changed = true; console.log('[PostProcess] Stripped redeclared useFireproofClerk fallback'); }

  if (changed) writeFileSync(appPath, code, 'utf-8');
}
