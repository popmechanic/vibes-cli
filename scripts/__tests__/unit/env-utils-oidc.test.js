import { describe, it, expect } from 'vitest';
import {
  CONFIG_PLACEHOLDERS,
  validateOIDCAuthority,
  validateOIDCClientId,
} from '../../lib/env-utils.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '../../lib/auth-constants.js';

describe('OIDC auth constants', () => {
  it('exports hardcoded OIDC authority URL', () => {
    expect(OIDC_AUTHORITY).toBe('https://pocket-id.marcus-e.workers.dev');
  });

  it('exports hardcoded OIDC client ID', () => {
    expect(OIDC_CLIENT_ID).toBe('6c154be6-e6fa-47f3-ad2b-31740cedc1f1');
  });
});

describe('OIDC config placeholders', () => {
  it('does NOT include OIDC placeholders (now hardcoded constants)', () => {
    expect(CONFIG_PLACEHOLDERS['__VITE_OIDC_AUTHORITY__']).toBeUndefined();
    expect(CONFIG_PLACEHOLDERS['__VITE_OIDC_CLIENT_ID__']).toBeUndefined();
  });

  it('does NOT include legacy Clerk publishable key placeholder', () => {
    expect(CONFIG_PLACEHOLDERS['__VITE_CLERK_PUBLISHABLE_KEY__']).toBeUndefined();
  });

  it('still includes Connect URL placeholders', () => {
    expect(CONFIG_PLACEHOLDERS['__VITE_API_URL__']).toBe('VITE_API_URL');
    expect(CONFIG_PLACEHOLDERS['__VITE_CLOUD_URL__']).toBe('VITE_CLOUD_URL');
  });
});

describe('validateOIDCAuthority', () => {
  it('accepts valid HTTPS authority URL', () => {
    expect(validateOIDCAuthority('https://studio.exe.xyz/auth')).toBe(true);
  });

  it('accepts HTTPS URL without path', () => {
    expect(validateOIDCAuthority('https://auth.example.com')).toBe(true);
  });

  it('rejects non-HTTPS URLs', () => {
    expect(validateOIDCAuthority('http://studio.exe.xyz/auth')).toBe(false);
  });

  it('rejects empty/null', () => {
    expect(validateOIDCAuthority('')).toBe(false);
    expect(validateOIDCAuthority(null)).toBe(false);
    expect(validateOIDCAuthority(undefined)).toBe(false);
  });
});

describe('validateOIDCClientId', () => {
  it('accepts non-empty string', () => {
    expect(validateOIDCClientId('abc-123-def')).toBe(true);
  });

  it('accepts UUID format', () => {
    expect(validateOIDCClientId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects empty/null', () => {
    expect(validateOIDCClientId('')).toBe(false);
    expect(validateOIDCClientId(null)).toBe(false);
    expect(validateOIDCClientId(undefined)).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(validateOIDCClientId(123)).toBe(false);
  });
});
