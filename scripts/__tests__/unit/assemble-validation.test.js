/**
 * Unit tests for assembly validation logic
 *
 * Tests the validation functions that catch errors before assembly completes.
 * validateAssembly/checkForbiddenPatterns live in assembly-utils; the factory
 * validators live in factory-assembly-validation. This test imports both real
 * sources — do NOT re-declare local copies (historically this file had its
 * own SAFE_PLACEHOLDER_PATTERNS that drifted behind the real one).
 */

import { describe, it, expect } from 'vitest';
import { APP_PLACEHOLDER, injectCode, validateAssembly, checkForbiddenPatterns } from '../../lib/assembly-utils.js';
import {
  SAFE_PLACEHOLDER_PATTERNS,
  validateFactoryTemplate,
  validateFactoryAssembly
} from '../../lib/factory-assembly-validation.js';

const PLACEHOLDER = APP_PLACEHOLDER;

// ============== Tests ==============

describe('validateAssembly', () => {
  it('returns no errors for valid assembly', () => {
    const html = '<script>export default function App() { return <div>Hello</div>; }</script>';
    const code = 'export default function App() { return <div>Hello</div>; }';
    expect(validateAssembly(html, code)).toEqual([]);
  });

  it('detects empty app code', () => {
    const html = '<script></script>';
    const errors = validateAssembly(html, '');
    expect(errors).toContain('App code is empty');
  });

  it('detects whitespace-only app code', () => {
    const html = '<script>   </script>';
    const errors = validateAssembly(html, '   \n\t  ');
    expect(errors).toContain('App code is empty');
  });

  it('detects unreplaced placeholder', () => {
    const html = `<script>${PLACEHOLDER}</script>`;
    const errors = validateAssembly(html, 'some code');
    expect(errors).toContain('Placeholder was not replaced');
  });

  it('detects missing App component - no function', () => {
    const html = '<script>const x = 1;</script>';
    const errors = validateAssembly(html, 'const x = 1;');
    expect(errors).toContain('No App component found');
  });

  it('accepts function App syntax', () => {
    const html = '<script>function App() { return null; }</script>';
    const code = 'function App() { return null; }';
    expect(validateAssembly(html, code)).toEqual([]);
  });

  it('accepts export default function syntax', () => {
    const html = '<script>export default function MyComponent() { return null; }</script>';
    const code = 'export default function MyComponent() { return null; }';
    expect(validateAssembly(html, code)).toEqual([]);
  });

  it('detects mismatched script tags - more opens', () => {
    const html = '<script><script>export default function App() {}</script>';
    const errors = validateAssembly(html, 'export default function App() {}');
    expect(errors.some(e => e.includes('Mismatched script tags'))).toBe(true);
  });

  it('detects mismatched script tags - more closes', () => {
    const html = '<script>export default function App() {}</script></script>';
    const errors = validateAssembly(html, 'export default function App() {}');
    expect(errors.some(e => e.includes('Mismatched script tags'))).toBe(true);
  });

  it('reports multiple errors at once', () => {
    const html = `<script>${PLACEHOLDER}</script></script>`;
    const errors = validateAssembly(html, '');
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors).toContain('App code is empty');
  });
});

describe('injectCode', () => {
  // `String.prototype.replace(str, str)` treats $', $&, $`, $1–$9 as special
  // patterns. A raw-string replacement would expand them — e.g. `$'` becomes the
  // substring after the match. `injectCode` passes a function callback instead,
  // which receives the code verbatim. Regression: currency `prefix: '$'`
  // literals in KMUN-translator/app.jsx produced 10k-line garbled output.

  const template = `HEAD ${PLACEHOLDER} TAIL`;

  it('substitutes plain code at the placeholder', () => {
    const code = 'const x = 1;';
    expect(injectCode(template, PLACEHOLDER, code)).toBe(`HEAD ${code} TAIL`);
  });

  it("does not expand $' (after-match pattern) in code", () => {
    const code = "const currency = { prefix: '$' };";
    const result = injectCode(template, PLACEHOLDER, code);
    expect(result).toBe(`HEAD ${code} TAIL`);
    expect(result).not.toContain(" TAIL TAIL");
  });

  it('does not expand $& (whole-match pattern) in code', () => {
    const code = "const s = 'A $& B';";
    const result = injectCode(template, PLACEHOLDER, code);
    expect(result).toBe(`HEAD ${code} TAIL`);
    expect(result).not.toContain(PLACEHOLDER + ' B');
  });

  it('does not expand $` (before-match pattern) in code', () => {
    const code = "const s = 'A $` B';";
    const result = injectCode(template, PLACEHOLDER, code);
    expect(result).toBe(`HEAD ${code} TAIL`);
    expect(result).not.toContain("A HEAD  B");
  });

  it('does not expand $1–$9 (capture-group patterns) in code', () => {
    const code = 'const s = "price: $1 to $9";';
    const result = injectCode(template, PLACEHOLDER, code);
    expect(result).toBe(`HEAD ${code} TAIL`);
  });

  it("does not duplicate template tail when code has multiple $' sequences", () => {
    // Simulates the KMUN bug: 20+ currency prefix literals
    const code = Array(20).fill("prefix: '$'").join('; ') + ';';
    const result = injectCode(template, PLACEHOLDER, code);
    // Output length = HEAD + code + TAIL. No expansion means no extra TAILs.
    expect((result.match(/TAIL/g) || []).length).toBe(1);
  });
});

describe('assembly preserves imports/exports', () => {
  it('keeps imports and export default in app code (module script)', () => {
    const appWithImports = `import React, { useState } from "react";
import { useFireproofClerk } from "use-fireproof";

export default function App() {
  return <div>Hello</div>;
}`;
    // vibes template uses data-type="module", so imports resolve via import map
    expect(appWithImports).toContain('import React');
    expect(appWithImports).toContain('export default function App()');
  });
});

describe('validateFactoryTemplate (pre-injection)', () => {
  it('returns no errors for clean template', () => {
    const html = '<html>// __VIBES_APP_CODE__ __ADMIN_CODE__</html>';
    expect(validateFactoryTemplate(html)).toEqual([]);
  });

  it('allows safe placeholder patterns', () => {
    const html = '<html>/*#__PURE__*/ __esModule __APP_CONFIG__ __OIDC_LOAD_ERROR__</html>';
    expect(validateFactoryTemplate(html)).toEqual([]);
  });

  it('detects unreplaced config placeholders', () => {
    const html = '<html>__OIDC_KEY__ and __APP_NAME__</html>';
    const errors = validateFactoryTemplate(html);
    expect(errors.some(e => e.includes('Unreplaced placeholders'))).toBe(true);
    expect(errors.some(e => e.includes('__OIDC_KEY__'))).toBe(true);
  });

  it('deduplicates repeated placeholders', () => {
    const html = '<html>__TEST__ __TEST__ __TEST__</html>';
    const errors = validateFactoryTemplate(html);
    const placeholderError = errors.find(e => e.includes('Unreplaced'));
    // Should only list __TEST__ once
    expect(placeholderError.match(/__TEST__/g).length).toBe(1);
  });

  it('does not flag dunder patterns in app code (post-injection scenario)', () => {
    // This is the key fix: validation runs on the template BEFORE app code injection,
    // so user code like window.__SELL_HOOKS__ never triggers false positives
    const templateBeforeInjection = '<html>// __VIBES_APP_CODE__</html>';
    expect(validateFactoryTemplate(templateBeforeInjection)).toEqual([]);
  });
});

describe('forbidden pattern warnings', () => {
  it('warns on import statements', () => {
    const warnings = checkForbiddenPatterns('import React from "react";\nfunction App() {}');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('import');
  });

  it('warns on createStore calls', () => {
    const warnings = checkForbiddenPatterns('const s = createMergeableStore()');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('store');
  });

  it('warns on direct store method calls', () => {
    const warnings = checkForbiddenPatterns('store.setCell("t", "r", "c", 1)');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('returns empty array for clean code', () => {
    const warnings = checkForbiddenPatterns('export default function App() { return <div>Hi</div>; }');
    expect(warnings).toEqual([]);
  });
});

describe('validateFactoryAssembly (post-injection)', () => {
  it('returns no errors for valid factory assembly', () => {
    const html = '<script>export default function App() { return null; }</script>';
    const app = 'export default function App() {}';
    expect(validateFactoryAssembly(html, app)).toEqual([]);
  });

  it('detects empty app code', () => {
    const errors = validateFactoryAssembly('<html></html>', '');
    expect(errors).toContain('App code is empty');
  });

  it('detects missing App component', () => {
    const html = '<html>const x = 1;</html>';
    const errors = validateFactoryAssembly(html, 'const x = 1;');
    expect(errors).toContain('No App component found');
  });

  it('does not check for unreplaced placeholders (that is pre-injection)', () => {
    // Post-injection validation only checks for app code and App component
    const html = '<html>window.__SELL_HOOKS__ export default function App() {}</html>';
    const errors = validateFactoryAssembly(html, 'export default function App() {}');
    expect(errors).toEqual([]);
  });

  it('reports multiple errors at once', () => {
    const html = '<html></html>';
    const errors = validateFactoryAssembly(html, '');
    expect(errors).toContain('App code is empty');
    expect(errors).toContain('No App component found');
  });
});
