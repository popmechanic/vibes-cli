// scripts/__tests__/integration/wizard-flow.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'stream';
import { mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `vibes-wizard-flow-${process.pid}-${Date.now()}`);

// Shared mock helpers
function mockReq(body) {
  const req = new Readable({ read() {} });
  req.push(JSON.stringify(body));
  req.push(null);
  return req;
}

function mockRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(code, h) { res.statusCode = code; res.headers = h; },
    end(data) { res.body = data; },
    get writableEnded() { return !!res.body; },
  };
  return res;
}

describe('wizard credential flow', () => {
  let registry;

  beforeEach(async () => {
    vi.resetModules();
    mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    registry = await import('../../lib/registry.js');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  it('full lifecycle: empty -> save clerk -> save cloudflare -> verify', () => {
    // Start empty
    const initialConfig = registry.getCloudflareConfig();
    expect(initialConfig.apiKey).toBeFalsy();

    // Save Clerk credentials
    registry.setApp('_default', {
      name: '_default',
      clerk: { publishableKey: 'pk_test_abc123', secretKey: 'sk_test_xyz789' },
    });

    const app = registry.getApp('_default');
    expect(app.clerk.publishableKey).toBe('pk_test_abc123');
    expect(app.clerk.secretKey).toBe('sk_test_xyz789');

    // Save Cloudflare credentials
    registry.setCloudflareConfig({
      apiKey: 'cf-global-api-key-123',
      email: 'user@example.com',
      accountId: 'acct-456',
    });

    const cfConfig = registry.getCloudflareConfig();
    expect(cfConfig.apiKey).toBe('cf-global-api-key-123');
    expect(cfConfig.email).toBe('user@example.com');
    expect(cfConfig.accountId).toBe('acct-456');

    // Verify file permissions
    const regPath = join(TEST_DIR, '.vibes', 'deployments.json');
    const stat = statSync(regPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('preserves existing app data when adding cloudflare config', () => {
    registry.setApp('my-app', {
      name: 'my-app',
      clerk: { publishableKey: 'pk_test_abc', secretKey: 'sk_test_xyz' },
    });

    registry.setCloudflareConfig({ apiKey: 'key123', email: 'test@test.com' });

    const app = registry.getApp('my-app');
    expect(app.clerk.publishableKey).toBe('pk_test_abc');

    const cf = registry.getCloudflareConfig();
    expect(cf.apiKey).toBe('key123');
  });

  it('partial saves merge into _default without clobbering', () => {
    // Save pk first
    registry.setApp('_default', {
      name: '_default',
      clerk: { publishableKey: 'pk_test_first', secretKey: '' },
    });

    // Save sk second — deep merge preserves pk automatically
    registry.setApp('_default', {
      name: '_default',
      clerk: { secretKey: 'sk_test_second' },
    });

    const app = registry.getApp('_default');
    expect(app.clerk.publishableKey).toBe('pk_test_first');
    expect(app.clerk.secretKey).toBe('sk_test_second');
  });

  it('setApp deep-merges clerk, connect, and app nested objects', () => {
    registry.setApp('deep-test', {
      name: 'deep-test',
      clerk: { publishableKey: 'pk_test_abc' },
      connect: { apiUrl: 'https://api.example.com' },
      app: { workerName: 'deep-test', kvNamespaceId: 'kv-123' },
    });

    // Update only some nested fields — others should be preserved
    registry.setApp('deep-test', {
      clerk: { secretKey: 'sk_test_xyz' },
      connect: { cloudUrl: 'fpcloud://example.com' },
      app: { url: 'https://deep-test.workers.dev' },
    });

    const result = registry.getApp('deep-test');
    // clerk: pk preserved, sk added
    expect(result.clerk.publishableKey).toBe('pk_test_abc');
    expect(result.clerk.secretKey).toBe('sk_test_xyz');
    // connect: apiUrl preserved, cloudUrl added
    expect(result.connect.apiUrl).toBe('https://api.example.com');
    expect(result.connect.cloudUrl).toBe('fpcloud://example.com');
    // app: workerName + kvNamespaceId preserved, url added
    expect(result.app.workerName).toBe('deep-test');
    expect(result.app.kvNamespaceId).toBe('kv-123');
    expect(result.app.url).toBe('https://deep-test.workers.dev');
  });

  it('isFirstDeploy returns true for apps without connect URLs', () => {
    registry.setApp('new-app', {
      name: 'new-app',
      clerk: { publishableKey: 'pk_test_abc' },
    });

    expect(registry.isFirstDeploy('new-app')).toBe(true);
    expect(registry.isFirstDeploy('nonexistent')).toBe(true);
  });
});

describe('validateClerkCredentials', () => {
  let editorApi;
  let originalFetch;

  beforeEach(async () => {
    vi.resetModules();
    mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    originalFetch = global.fetch;
    editorApi = await import('../../server/handlers/editor-api.js');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  // Helper: encode a domain into a pk_test_ key
  function makePk(domain) {
    return 'pk_test_' + Buffer.from(domain + '$').toString('base64');
  }

  it('returns valid:true when Clerk FAPI responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('example.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(true);
    expect(global.fetch).toHaveBeenCalledOnce();
    // Verify it hit the correct FAPI domain
    const url = global.fetch.mock.calls[0][0];
    expect(url).toBe('https://example.clerk.accounts.dev/v1/environment');
  });

  it('returns valid:false with helpful message on 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('bad.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('rejected by Clerk');
  });

  it('returns valid:false with helpful message on 403', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('paused.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('rejected by Clerk');
  });

  it('returns valid:false with status code for other HTTP errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('error.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('status 500');
  });

  it('returns valid:false on DNS resolution failure (ENOTFOUND)', async () => {
    const err = new Error('getaddrinfo ENOTFOUND nonexistent.clerk.accounts.dev');
    err.cause = { code: 'ENOTFOUND' };
    global.fetch = vi.fn().mockRejectedValue(err);

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('nonexistent.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('domain encoded in this key does not exist');
  });

  it('returns valid:false on timeout (AbortError)', async () => {
    const err = new DOMException('The operation was aborted', 'AbortError');
    global.fetch = vi.fn().mockRejectedValue(err);

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('slow.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('returns valid:false when no publishable key provided', async () => {
    const result = await editorApi.validateClerkCredentials({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No publishable key');
  });

  it('returns valid:false when key cannot be decoded', async () => {
    const result = await editorApi.validateClerkCredentials({
      publishableKey: 'not_a_valid_key',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('decode domain');
  });

  it('rejects keys with non-Clerk domains (SSRF guard)', async () => {
    global.fetch = vi.fn();
    // Craft a key that encodes an internal IP address
    const maliciousDomain = '169.254.169.254';
    const crafted = 'pk_test_' + Buffer.from(maliciousDomain + '$').toString('base64');
    const result = await editorApi.validateClerkCredentials({
      publishableKey: crafted,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('*.clerk.accounts.dev');
    // fetch should never have been called
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('editor-api saveCredentials swap detection', () => {
  let editorApi;

  beforeEach(async () => {
    vi.resetModules();
    mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    editorApi = await import('../../server/handlers/editor-api.js');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  it('returns descriptive error when pk and sk keys are swapped', async () => {
    const req = mockReq({
      clerkPublishableKey: 'sk_test_abc123',  // Swapped!
      clerkSecretKey: 'pk_test_xyz789',       // Swapped!
    });
    const res = mockRes();
    const ctx = { projectRoot: TEST_DIR };

    await editorApi.saveCredentials(ctx, req, res);
    const data = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.errors.clerkPublishableKey).toContain('secret key');
    expect(data.errors.clerkSecretKey).toContain('publishable key');
  });
});
