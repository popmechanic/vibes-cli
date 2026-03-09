/**
 * Tests for env-utils validation helpers
 */

import { describe, it, expect } from 'vitest';
import { validateOpenRouterKey, validateConnectUrl, deriveStudioUrls } from '../../lib/env-utils.js';

describe('validateOpenRouterKey', () => {
  it('accepts valid OpenRouter keys', () => {
    expect(validateOpenRouterKey('sk-or-v1-abc123')).toBe(true);
    expect(validateOpenRouterKey('sk-or-something-else')).toBe(true);
  });

  it('rejects keys without sk-or- prefix', () => {
    expect(validateOpenRouterKey('sk-abc123')).toBe(false);
    expect(validateOpenRouterKey('pk_test_abc')).toBe(false);
    expect(validateOpenRouterKey('openrouter-key')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(validateOpenRouterKey(null)).toBe(false);
    expect(validateOpenRouterKey(undefined)).toBe(false);
    expect(validateOpenRouterKey(123)).toBe(false);
    expect(validateOpenRouterKey('')).toBe(false);
  });
});


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

describe('deriveStudioUrls', () => {
  it('derives URLs from simple studio name', () => {
    const urls = deriveStudioUrls('my-studio');
    expect(urls.apiUrl).toBe('https://my-studio.exe.xyz/api/');
    expect(urls.cloudUrl).toBe('fpcloud://my-studio.exe.xyz?protocol=wss');
  });
  it('handles full hostnames (with dots)', () => {
    const urls = deriveStudioUrls('custom.example.com');
    expect(urls.apiUrl).toBe('https://custom.example.com/api/');
    expect(urls.cloudUrl).toBe('fpcloud://custom.example.com?protocol=wss');
  });
  it('trims whitespace', () => {
    const urls = deriveStudioUrls('  my-studio  ');
    expect(urls.apiUrl).toBe('https://my-studio.exe.xyz/api/');
  });
  it('throws on empty input', () => {
    expect(() => deriveStudioUrls('')).toThrow();
    expect(() => deriveStudioUrls(null)).toThrow();
    expect(() => deriveStudioUrls(undefined)).toThrow();
  });
});

