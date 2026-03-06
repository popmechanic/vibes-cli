// scripts/__tests__/integration/wizard-flow.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `vibes-wizard-flow-${process.pid}-${Date.now()}`);

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
