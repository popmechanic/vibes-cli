import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/cli-auth.js', () => ({
  startLoginFlow: vi.fn(),
  readCachedTokens: vi.fn(),
  isTokenExpired: vi.fn(),
  getAccessToken: vi.fn(),
  removeCachedTokens: vi.fn(),
}));

vi.mock('../../lib/auth-constants.js', () => ({
  OIDC_AUTHORITY: 'https://test-authority.example.com',
  OIDC_CLIENT_ID: 'test-client-id',
}));

import { startLoginFlow } from '../../lib/cli-auth.js';
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

  it('calls startLoginFlow and returns authorizeUrl', async () => {
    const tokenPromise = Promise.resolve({
      accessToken: 'tok',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
    });
    startLoginFlow.mockResolvedValue({
      authorizeUrl: 'https://test-authority.example.com/authorize?...',
      tokenPromise,
    });

    await handleAuthLogin(ctx, req, res);

    expect(startLoginFlow).toHaveBeenCalledWith({
      authority: 'https://test-authority.example.com',
      clientId: 'test-client-id',
    });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    const body = JSON.parse(res.end.mock.calls[0][0]);
    expect(body.ok).toBe(true);
    expect(body.authorizeUrl).toContain('https://test-authority.example.com');
  });

  it('broadcasts auth_complete to WebSocket clients after token resolves', async () => {
    const mockSend = vi.fn();
    const mockClient = { readyState: 1, send: mockSend };
    ctx.wss.clients.add(mockClient);

    const tokenPromise = Promise.resolve({
      accessToken: 'tok',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
    });
    startLoginFlow.mockResolvedValue({
      authorizeUrl: 'https://test-authority.example.com/authorize',
      tokenPromise,
    });

    await handleAuthLogin(ctx, req, res);
    // Wait for the background tokenPromise to resolve
    await tokenPromise;
    // Allow microtasks to flush
    await new Promise(r => setTimeout(r, 10));

    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining('"type":"auth_complete"')
    );
  });

  it('returns 500 on startLoginFlow failure', async () => {
    startLoginFlow.mockRejectedValue(new Error('Could not start server'));

    await handleAuthLogin(ctx, req, res);

    expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
  });
});
