// scripts/__tests__/integration/editor-api-cloudflare.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('validateCloudflareCredentials', () => {
  let validateCloudflareCredentials;
  let originalFetch;

  beforeEach(async () => {
    vi.resetModules();
    originalFetch = globalThis.fetch;
    const mod = await import('../../server/handlers/editor-api.js');
    validateCloudflareCredentials = mod.validateCloudflareCredentials;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // --- Global API Key tests ---

  it('returns valid with account ID for Global API Key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        result: [{ id: 'abc123def456789012345678abcdef00', name: 'My Account' }],
      }),
    });

    const result = await validateCloudflareCredentials({ apiKey: 'testkey', email: 'user@test.com' });
    expect(result.valid).toBe(true);
    expect(result.accountId).toBe('abc123def456789012345678abcdef00');
    expect(result.authMode).toBe('global-api-key');
  });

  it('returns invalid when Global API Key auth fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({
        success: false,
        errors: [{ code: 9103, message: 'Unknown X-Auth-Key or X-Auth-Email' }],
      }),
    });

    const result = await validateCloudflareCredentials({ apiKey: 'badkey', email: 'bad@test.com' });
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('sends correct auth headers and signal for Global API Key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, result: [{ id: 'abc123' }] }),
    });

    await validateCloudflareCredentials({ apiKey: 'mykey', email: 'me@test.com' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Auth-Key': 'mykey',
          'X-Auth-Email': 'me@test.com',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  // --- API Token tests ---

  it('returns valid with account ID for API Token', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, result: { status: 'active' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, result: [{ id: 'acct-from-token' }] }),
      });

    const result = await validateCloudflareCredentials({ apiToken: 'cf-token-abc' });
    expect(result.valid).toBe(true);
    expect(result.accountId).toBe('acct-from-token');
    expect(result.authMode).toBe('api-token');
  });

  it('sends Bearer header and signal for API Token', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, result: { status: 'active' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, result: [{ id: 'acct123' }] }),
      });

    await validateCloudflareCredentials({ apiToken: 'my-token' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/user/tokens/verify',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer my-token',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('returns invalid when API Token verification fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({
        success: false,
        errors: [{ message: 'Invalid API Token' }],
      }),
    });

    const result = await validateCloudflareCredentials({ apiToken: 'bad-token' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/token/i);
  });

  it('returns invalid when API Token is valid but no accounts accessible', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, result: { status: 'active' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, result: [] }),
      });

    const result = await validateCloudflareCredentials({ apiToken: 'valid-but-no-accounts' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/no accounts/i);
  });

  // --- Edge cases ---

  it('returns invalid when no credentials provided', async () => {
    const result = await validateCloudflareCredentials({});
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/provide/i);
  });

  it('returns invalid when fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await validateCloudflareCredentials({ apiKey: 'key', email: 'email@test.com' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/network|failed/i);
  });

  it('returns timeout message when fetch is aborted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const result = await validateCloudflareCredentials({ apiKey: 'key', email: 'email@test.com' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });
});
