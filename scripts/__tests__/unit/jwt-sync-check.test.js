/**
 * JWT Sync Check Tests
 *
 * Catches drift between the canonical jwt-validation.js and its intentional
 * duplication in ai-proxy.js.
 *
 * ai-proxy.js runs on a remote Bun VM and can't import from lib/ at
 * runtime, so the logic is duplicated. This test ensures the copy stays
 * in sync.
 *
 * Note: registry-server.ts was retired — registry logic now lives in the
 * Cloudflare Worker (skills/cloudflare/worker/).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { matchAzp, parsePermittedOrigins } from '../../lib/jwt-validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read source files as strings
const canonicalSrc = readFileSync(
  resolve(__dirname, '../../lib/jwt-validation.js'), 'utf8'
);
const aiProxySrc = readFileSync(
  resolve(__dirname, '../../deployables/ai-proxy.js'), 'utf8'
);

// ---------------------------------------------------------------------------
// Helpers: extract key algorithmic fragments from source
// ---------------------------------------------------------------------------

/**
 * Extract all lines containing the regex escape pattern for wildcard matching.
 * Returns the raw source line (trimmed), e.g.:
 *   const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
 * We strip variable names and normalize quotes so we can compare the regex itself.
 */
function extractEscapeLines(src) {
  const lines = src.split('\n');
  return lines
    .filter(l => l.includes('pattern.replace(') && l.includes('\\$&'))
    .map(l => l.trim());
}

/**
 * Extract the wildcard replacement line (escaped.replace with wildcard glob).
 */
function extractWildcardLines(src) {
  const lines = src.split('\n');
  return lines
    .filter(l => l.includes('escaped.replace(') && l.includes('[^.]+'))
    .map(l => l.trim());
}

/**
 * Extract the core algorithmic structure of the .some() callback:
 * - exact match check
 * - includes('*') guard
 * - regex escape pattern
 * - RegExp construction
 * - regex.test() call
 *
 * We normalize by removing variable-name differences (azp, requestOrigin,
 * decoded.azp) and quote style differences.
 */
function extractNormalizedMatchBlock(src) {
  const match = src.match(/\.some\(pattern\s*=>\s*\{([\s\S]*?)return false;\s*\}\)/);
  if (!match) return null;

  return match[1]
    // Remove comments first (while newlines still exist)
    .replace(/\/\/[^\n]*/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Normalize quotes
    .replace(/"/g, "'")
    // Normalize the comparison variable: pattern === X → pattern === VALUE
    .replace(/pattern === \S+/g, 'pattern === VALUE')
    // Normalize regex.test(X) → regex.test(VALUE)
    .replace(/regex\.test\([^)]+\)/g, 'regex.test(VALUE)')
    // Collapse whitespace again after removals
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Pattern extraction tests — assert key patterns are identical
// ---------------------------------------------------------------------------

describe('JWT sync check — pattern extraction', () => {
  describe('regex escape pattern', () => {
    const canonical = extractEscapeLines(canonicalSrc);
    const aiProxy = extractEscapeLines(aiProxySrc);

    it('canonical has a regex escape pattern', () => {
      expect(canonical.length).toBeGreaterThan(0);
    });

    it('ai-proxy uses the same escape regex', () => {
      expect(aiProxy.length).toBeGreaterThan(0);
      // Both should contain the same regex character class
      for (const line of aiProxy) {
        expect(line).toContain('[.+?^${}()|[\\]\\\\]');
      }
      for (const line of canonical) {
        expect(line).toContain('[.+?^${}()|[\\]\\\\]');
      }
    });
  });

  describe('wildcard replacement', () => {
    const canonical = extractWildcardLines(canonicalSrc);
    const aiProxy = extractWildcardLines(aiProxySrc);

    it('canonical has a wildcard replacement', () => {
      expect(canonical.length).toBeGreaterThan(0);
    });

    it('all files replace * with [^.]+', () => {
      for (const lines of [canonical, aiProxy]) {
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line).toContain('[^.]+');
        }
      }
    });
  });

  describe('normalized matching block', () => {
    const canonical = extractNormalizedMatchBlock(canonicalSrc);
    const aiProxy = extractNormalizedMatchBlock(aiProxySrc);

    it('canonical has a matching block', () => {
      expect(canonical).not.toBeNull();
    });

    it('ai-proxy matching logic matches canonical', () => {
      expect(aiProxy).toBe(canonical);
    });
  });

  describe('CORS_ORIGINS / PERMITTED_ORIGINS parsing', () => {
    it('ai-proxy parses origins with split-filter', () => {
      expect(aiProxySrc).toContain('.split(",").filter(Boolean)');
    });

    it('canonical parsePermittedOrigins uses split-map-filter', () => {
      expect(canonicalSrc).toContain(".split(',').map(s => s.trim()).filter(Boolean)");
    });
  });

  describe('getCorsOrigin fallback behavior', () => {
    it('ai-proxy returns CORS_ORIGINS[0] when no match', () => {
      expect(aiProxySrc).toContain('CORS_ORIGINS[0]');
    });

    it('ai-proxy returns "*" when no origins configured', () => {
      expect(aiProxySrc).toMatch(/length\s*===\s*0\)\s*return\s*["']\*["']/);
    });
  });
});

// ---------------------------------------------------------------------------
// Behavioral tests — run the same inputs against canonical + reconstructed
// ---------------------------------------------------------------------------

describe('JWT sync check — behavioral equivalence', () => {
  // Reconstruct the matching function using the same algorithm the
  // deployables use. If someone changes the algorithm in one place,
  // the structural tests above catch the source drift; these behavioral
  // tests verify the algorithm itself works correctly.
  function reconstructedMatch(value, patterns) {
    if (!value || !patterns || patterns.length === 0) return true;
    return patterns.some(pattern => {
      if (pattern === value) return true;
      if (pattern.includes('*')) {
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp('^' + escaped.replace(/\*/g, '[^.]+') + '$');
        return regex.test(value);
      }
      return false;
    });
  }

  const testCases = [
    ['exact match', 'https://example.com', ['https://example.com'], true],
    ['no match', 'https://other.com', ['https://example.com'], false],
    ['wildcard subdomain', 'https://app.example.com', ['https://*.example.com'], true],
    ['wildcard no match root', 'https://example.com', ['https://*.example.com'], false],
    ['wildcard no nested', 'https://a.b.example.com', ['https://*.example.com'], false],
    ['multiple patterns', 'https://b.com', ['https://a.com', 'https://b.com'], true],
    ['wildcard + exact combined', 'https://test.cronos.computer', ['https://cronos.computer', 'https://*.cronos.computer'], true],
    ['port in URL', 'https://app.example.com:3000', ['https://*.example.com:3000'], true],
    ['case sensitive', 'https://Example.com', ['https://example.com'], false],
    ['empty patterns', 'https://any.com', [], true],
    ['null azp', null, [], true],
    ['empty string azp', '', ['https://example.com'], true],
    ['different TLD', 'https://app.cronos.net', ['https://*.cronos.computer'], false],
    ['special chars in domain', 'https://testXexample.com', ['https://*.example.com'], false],
  ];

  describe('canonical matchAzp vs reconstructed', () => {
    for (const [desc, azp, patterns, expected] of testCases) {
      it(desc, () => {
        expect(matchAzp(azp, patterns)).toBe(expected);
        expect(reconstructedMatch(azp, patterns)).toBe(expected);
      });
    }
  });

  describe('parsePermittedOrigins equivalence', () => {
    // The deployables use a simpler inline form (.split(",").filter(Boolean))
    // without .trim(). Verify the canonical version handles the same inputs.
    const inlineParser = (s) => {
      if (!s) return [];
      return s.split(',').filter(Boolean);
    };

    const cases = [
      ['single origin', 'https://a.com'],
      ['multiple origins', 'https://a.com,https://b.com,https://c.com'],
      ['with wildcards', 'https://example.com,https://*.example.com'],
      ['empty string', ''],
      ['null', null],
      ['trailing comma', 'https://a.com,https://b.com,'],
      ['double comma', 'https://a.com,,https://b.com'],
    ];

    for (const [desc, input] of cases) {
      it(`${desc} — results match (no whitespace)`, () => {
        const canonical = parsePermittedOrigins(input);
        const inline = inlineParser(input);
        // Without whitespace in the input, results should be identical
        expect(canonical).toEqual(inline);
      });
    }

    it('diverges on whitespace (expected difference)', () => {
      // Documents the known difference: canonical trims, inline doesn't.
      // Deployables receive env vars without whitespace so this is safe.
      const input = ' https://a.com , https://b.com ';
      const canonical = parsePermittedOrigins(input);
      const inline = input.split(',').filter(Boolean);
      expect(canonical).toEqual(['https://a.com', 'https://b.com']);
      expect(inline).toEqual([' https://a.com ', ' https://b.com ']);
    });
  });
});

// ---------------------------------------------------------------------------
// Sync-check comments — verify the files have "keep in sync" annotations
// ---------------------------------------------------------------------------

describe('JWT sync check — annotations present', () => {
  it('ai-proxy.js references canonical source', () => {
    expect(aiProxySrc).toContain('lib/jwt-validation.js');
    expect(aiProxySrc).toContain('keep in sync');
  });
});
