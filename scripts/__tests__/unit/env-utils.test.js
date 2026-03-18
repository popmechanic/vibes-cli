/**
 * Tests for env-utils validation helpers
 */

import { describe, it, expect } from 'vitest';
import { validateConnectUrl } from '../../lib/env-utils.js';


describe('validateConnectUrl', () => {
  it('accepts valid API URLs', () => {
    expect(validateConnectUrl('https://studio.exe.xyz/api/', 'api')).toBe(true);
    expect(validateConnectUrl('https://example.com', 'api')).toBe(true);
  });
  it('rejects invalid API URLs', () => {
    expect(validateConnectUrl('http://example.com', 'api')).toBe(false);
    expect(validateConnectUrl('fpcloud://example.com', 'api')).toBe(false);
    expect(validateConnectUrl('', 'api')).toBe(false);
    expect(validateConnectUrl(null, 'api')).toBe(false);
  });
  it('accepts valid Cloud URLs', () => {
    expect(validateConnectUrl('fpcloud://studio.exe.xyz?protocol=wss', 'cloud')).toBe(true);
  });
  it('rejects invalid Cloud URLs', () => {
    expect(validateConnectUrl('https://studio.exe.xyz', 'cloud')).toBe(false);
    expect(validateConnectUrl('', 'cloud')).toBe(false);
    expect(validateConnectUrl(null, 'cloud')).toBe(false);
  });
});
