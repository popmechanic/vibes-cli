/**
 * Unit tests for assembly validation logic
 *
 * Tests the validation functions that catch errors before assembly completes.
 * These mirror the logic in assemble.js and assemble-sell.js.
 */

import { describe, it, expect } from 'vitest';
import { APP_PLACEHOLDER, validateAssembly } from '../../lib/assembly-utils.js';
import { stripForTemplate } from '../../lib/strip-code.js';

const PLACEHOLDER = APP_PLACEHOLDER;

/**
 * Validate sell template BEFORE app code injection
 * Mirrors the pre-injection validation in assemble-sell.js
 */
const SAFE_PLACEHOLDER_PATTERNS = [
  '__PURE__',
  '__esModule',
  '__VIBES_CONFIG__',
  '__CLERK_LOAD_ERROR__',
  '__VIBES_SYNC_STATUS__',
  '__VIBES_APP_CODE__',
  '__ADMIN_CODE__'
];

function validateSellTemplate(html) {
  const errors = [];

  const allMatches = html.match(/__[A-Z_]+__/g) || [];
  const unreplaced = allMatches.filter(m => !SAFE_PLACEHOLDER_PATTERNS.includes(m));
  if (unreplaced.length > 0) {
    errors.push(`Unreplaced placeholders: ${[...new Set(unreplaced)].join(', ')}`);
  }

  return errors;
}

/**
 * Validate sell assembly output (post-injection)
 * Mirrors the post-injection validation in assemble-sell.js
 */
function validateSellAssembly(html, app) {
  const errors = [];

  if (!app || app.trim().length === 0) {
    errors.push('App code is empty');
  }

  if (!html.includes('export default function') && !html.includes('function App')) {
    errors.push('No App component found');
  }

  return errors;
}

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

describe('assembly with imports/exports', () => {
  it('strips imports and export default from app code', () => {
    const appWithImports = `import React, { useState } from "react";
import { useFireproofClerk } from "use-fireproof";

export default function App() {
  return <div>Hello</div>;
}`;
    const stripped = stripForTemplate(appWithImports);
    expect(stripped).not.toContain('import ');
    expect(stripped).not.toContain('export default');
    expect(stripped).toContain('function App()');
  });
});

describe('validateSellTemplate (pre-injection)', () => {
  it('returns no errors for clean template', () => {
    const html = '<html>// __VIBES_APP_CODE__ __ADMIN_CODE__</html>';
    expect(validateSellTemplate(html)).toEqual([]);
  });

  it('allows safe placeholder patterns', () => {
    const html = '<html>/*#__PURE__*/ __esModule __VIBES_CONFIG__ __CLERK_LOAD_ERROR__</html>';
    expect(validateSellTemplate(html)).toEqual([]);
  });

  it('detects unreplaced config placeholders', () => {
    const html = '<html>__CLERK_KEY__ and __APP_NAME__</html>';
    const errors = validateSellTemplate(html);
    expect(errors.some(e => e.includes('Unreplaced placeholders'))).toBe(true);
    expect(errors.some(e => e.includes('__CLERK_KEY__'))).toBe(true);
  });

  it('deduplicates repeated placeholders', () => {
    const html = '<html>__TEST__ __TEST__ __TEST__</html>';
    const errors = validateSellTemplate(html);
    const placeholderError = errors.find(e => e.includes('Unreplaced'));
    // Should only list __TEST__ once
    expect(placeholderError.match(/__TEST__/g).length).toBe(1);
  });

  it('does not flag dunder patterns in app code (post-injection scenario)', () => {
    // This is the key fix: validation runs on the template BEFORE app code injection,
    // so user code like window.__SELL_HOOKS__ never triggers false positives
    const templateBeforeInjection = '<html>// __VIBES_APP_CODE__</html>';
    expect(validateSellTemplate(templateBeforeInjection)).toEqual([]);
  });
});

describe('validateSellAssembly (post-injection)', () => {
  it('returns no errors for valid sell assembly', () => {
    const html = '<script>export default function App() { return null; }</script>';
    const app = 'export default function App() {}';
    expect(validateSellAssembly(html, app)).toEqual([]);
  });

  it('detects empty app code', () => {
    const errors = validateSellAssembly('<html></html>', '');
    expect(errors).toContain('App code is empty');
  });

  it('detects missing App component', () => {
    const html = '<html>const x = 1;</html>';
    const errors = validateSellAssembly(html, 'const x = 1;');
    expect(errors).toContain('No App component found');
  });

  it('does not check for unreplaced placeholders (that is pre-injection)', () => {
    // Post-injection validation only checks for app code and App component
    const html = '<html>window.__SELL_HOOKS__ export default function App() {}</html>';
    const errors = validateSellAssembly(html, 'export default function App() {}');
    expect(errors).toEqual([]);
  });

  it('reports multiple errors at once', () => {
    const html = '<html></html>';
    const errors = validateSellAssembly(html, '');
    expect(errors).toContain('App code is empty');
    expect(errors).toContain('No App component found');
  });
});
