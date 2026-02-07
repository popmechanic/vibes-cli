/**
 * Tests for version extraction from CDN URLs
 */

import { describe, it, expect } from 'vitest';
import { extractVersion } from '../../lib/parsers.js';

describe('extractVersion', () => {
  it('extracts version from esm.sh URL', () => {
    expect(extractVersion('https://esm.sh/react@19.2.1')).toBe('19.2.1');
  });

  it('extracts version with query params', () => {
    expect(extractVersion('https://esm.sh/use-vibes@0.24.3-dev?external=react')).toBe('0.24.3-dev');
  });

  it('extracts version with path segments', () => {
    expect(extractVersion('https://esm.sh/react@19.2.1/jsx-runtime')).toBe('19.2.1');
  });

  it('returns null for missing version', () => {
    expect(extractVersion('https://esm.sh/react')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractVersion(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractVersion('')).toBeNull();
  });
});
