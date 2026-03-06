// scripts/__tests__/unit/editor-api-cloudflare.test.js
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

  it('returns valid with account ID when API responds with success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        result: [{ id: 'abc123def456789012345678abcdef00', name: 'My Account' }],
      }),
    });

    const result = await validateCloudflareCredentials('testkey', 'user@test.com');
    expect(result.valid).toBe(true);
    expect(result.accountId).toBe('abc123def456789012345678abcdef00');
  });

  it('returns invalid when API responds with auth error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({
        success: false,
        errors: [{ code: 9103, message: 'Unknown X-Auth-Key or X-Auth-Email' }],
      }),
    });

    const result = await validateCloudflareCredentials('badkey', 'bad@test.com');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('sends correct auth headers', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, result: [{ id: 'abc123' }] }),
    });

    await validateCloudflareCredentials('mykey', 'me@test.com');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Auth-Key': 'mykey',
          'X-Auth-Email': 'me@test.com',
        }),
      }),
    );
  });

  it('returns invalid when fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await validateCloudflareCredentials('key', 'email@test.com');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/network|failed/i);
  });
});
