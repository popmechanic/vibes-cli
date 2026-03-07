import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/cli-auth.js', () => ({
  loginWithBrowser: vi.fn(),
  readCachedTokens: vi.fn(),
  isTokenExpired: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock('../../lib/auth-constants.js', () => ({
  OIDC_AUTHORITY: 'https://test-authority.example.com',
  OIDC_CLIENT_ID: 'test-client-id',
}));

import { loginWithBrowser } from '../../lib/cli-auth.js';
import { handleAuthLogin } from '../../server/handlers/editor-api.js';

describe('handleAuthLogin', () => {
  let ctx, req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = {
      wss: {
        clients: new Set(),
      },
    };
    req = {};
    res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };
  });

  it('calls loginWithBrowser and returns success', async () => {
    loginWithBrowser.mockResolvedValue({
      accessToken: 'tok',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
    });

    await handleAuthLogin(ctx, req, res);

    expect(loginWithBrowser).toHaveBeenCalledWith({
      authority: 'https://test-authority.example.com',
      clientId: 'test-client-id',
    });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });

  it('broadcasts auth_complete to WebSocket clients', async () => {
    const mockSend = vi.fn();
    const mockClient = { readyState: 1, send: mockSend };
    ctx.wss.clients.add(mockClient);

    loginWithBrowser.mockResolvedValue({
      accessToken: 'tok',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
    });

    await handleAuthLogin(ctx, req, res);

    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining('"type":"auth_complete"')
    );
  });

  it('returns 500 on login failure', async () => {
    loginWithBrowser.mockRejectedValue(new Error('Login timed out'));

    await handleAuthLogin(ctx, req, res);

    expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
  });
});
