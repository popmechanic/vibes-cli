import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cli-auth before importing the module under test
vi.mock('../../lib/cli-auth.js', () => ({
  readCachedTokens: vi.fn(),
  isTokenExpired: vi.fn(),
  getAccessToken: vi.fn(),
  loginWithBrowser: vi.fn(),
  removeCachedTokens: vi.fn(),
}));

// Mock auth-constants
vi.mock('../../lib/auth-constants.js', () => ({
  OIDC_AUTHORITY: 'https://test-authority.example.com',
  OIDC_CLIENT_ID: 'test-client-id',
}));

import { readCachedTokens, isTokenExpired, getAccessToken } from '../../lib/cli-auth.js';
import { checkAuthStatus } from '../../server/handlers/editor-api.js';

describe('checkAuthStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns state "none" when no cached tokens', async () => {
    readCachedTokens.mockReturnValue(null);
    const result = await checkAuthStatus();
    expect(result.auth.state).toBe('none');
    expect(result.auth.user).toBe(null);
  });

  it('returns state "valid" with user info when token is not expired', async () => {
    readCachedTokens.mockReturnValue({
      accessToken: 'tok',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    isTokenExpired.mockReturnValue(false);
    const result = await checkAuthStatus();
    expect(result.auth.state).toBe('valid');
    expect(result.auth.user.name).toBe('Marcus');
  });

  it('returns state "valid" after successful silent refresh', async () => {
    readCachedTokens.mockReturnValue({
      accessToken: 'old',
      refreshToken: 'refresh',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
      expiresAt: Math.floor(Date.now() / 1000) - 100,
    });
    isTokenExpired.mockReturnValue(true);
    getAccessToken.mockResolvedValue({
      accessToken: 'new',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await checkAuthStatus();
    expect(result.auth.state).toBe('valid');
  });

  it('returns state "expired" when refresh fails', async () => {
    readCachedTokens.mockReturnValue({
      accessToken: 'old',
      refreshToken: 'refresh',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
      expiresAt: Math.floor(Date.now() / 1000) - 100,
    });
    isTokenExpired.mockReturnValue(true);
    getAccessToken.mockResolvedValue(null);
    const result = await checkAuthStatus();
    expect(result.auth.state).toBe('expired');
  });
});
