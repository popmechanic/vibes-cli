import { describe, it, expect } from 'vitest';
import {
  CONFIG_PLACEHOLDERS,
} from '../../lib/env-utils.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '../../lib/auth-constants.js';

describe('OIDC auth constants', () => {
  it('exports hardcoded OIDC authority URL', () => {
    expect(OIDC_AUTHORITY).toBe('https://vibesos.com');
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
