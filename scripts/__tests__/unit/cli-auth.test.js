import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('cli-auth token cache', () => {
  let testDir;
  let authFile;

  beforeEach(() => {
    testDir = join(tmpdir(), `cli-auth-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    authFile = join(testDir, 'auth.json');
  });

  it('reads cached tokens from auth.json', async () => {
    const tokens = {
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      idToken: 'test-id',
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    };
    writeFileSync(authFile, JSON.stringify(tokens));
    const { readCachedTokens } = await import('../../lib/cli-auth.js');
    const result = readCachedTokens(authFile);
    expect(result.accessToken).toBe('test-access');
    expect(result.refreshToken).toBe('test-refresh');
  });

  it('returns null for missing auth file', async () => {
    const { readCachedTokens } = await import('../../lib/cli-auth.js');
    const result = readCachedTokens(join(testDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  it('detects expired tokens', async () => {
    const { isTokenExpired } = await import('../../lib/cli-auth.js');
    const past = Math.floor(Date.now() / 1000) - 100;
    expect(isTokenExpired(past)).toBe(true);
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenExpired(future)).toBe(false);
  });

  it('writes tokens to auth file', async () => {
    const { writeCachedTokens } = await import('../../lib/cli-auth.js');
    writeCachedTokens(authFile, {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      idToken: 'new-id',
      expiresAt: 99999999
    });
    const stored = JSON.parse(readFileSync(authFile, 'utf8'));
    expect(stored.accessToken).toBe('new-access');
  });

  it('creates parent directory if it does not exist', async () => {
    const { writeCachedTokens, readCachedTokens } = await import('../../lib/cli-auth.js');
    const nested = join(testDir, 'nested', 'deep', 'auth.json');
    writeCachedTokens(nested, {
      accessToken: 'nested-access',
      refreshToken: 'nested-refresh',
      idToken: 'nested-id',
      expiresAt: 99999999
    });
    const result = readCachedTokens(nested);
    expect(result.accessToken).toBe('nested-access');
  });

  it('generates valid PKCE code verifier and challenge', async () => {
    const { generateCodeVerifier, generateCodeChallenge } = await import('../../lib/cli-auth.js');
    const verifier = generateCodeVerifier();
    expect(typeof verifier).toBe('string');
    expect(verifier.length).toBeGreaterThan(0);

    const challenge = generateCodeChallenge(verifier);
    expect(typeof challenge).toBe('string');
    expect(challenge).not.toBe(verifier);
  });

  it('treats tokens expiring within 60s as expired', async () => {
    const { isTokenExpired } = await import('../../lib/cli-auth.js');
    // Token expires in 30s — should be treated as expired (within 60s buffer)
    const soon = Math.floor(Date.now() / 1000) + 30;
    expect(isTokenExpired(soon)).toBe(true);

    // Token expires in 120s — should NOT be treated as expired
    const later = Math.floor(Date.now() / 1000) + 120;
    expect(isTokenExpired(later)).toBe(false);
  });

  it('getAccessToken({ silent: true }) returns null when no cache exists', async () => {
    const { getAccessToken } = await import('../../lib/cli-auth.js');
    const result = await getAccessToken({
      authority: 'https://example.com',
      clientId: 'test-client',
      authFile: join(testDir, 'nonexistent.json'),
      silent: true,
    });
    expect(result).toBeNull();
  });

  it('getAccessToken({ silent: true }) returns cached token if valid', async () => {
    const tokens = {
      accessToken: 'cached-access',
      refreshToken: 'cached-refresh',
      idToken: 'cached-id',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    writeFileSync(authFile, JSON.stringify(tokens));
    const { getAccessToken } = await import('../../lib/cli-auth.js');
    const result = await getAccessToken({
      authority: 'https://example.com',
      clientId: 'test-client',
      authFile,
      silent: true,
    });
    expect(result).not.toBeNull();
    expect(result.accessToken).toBe('cached-access');
  });
});
