// scripts/__tests__/integration/registry-permissions.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `vibes-reg-perms-${process.pid}-${Date.now()}`);

describe('registry file permissions', () => {
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

  it('writes registry file with 0o600 permissions', () => {
    registry.saveRegistry({ version: 1, cloudflare: {}, apps: {} });
    const regPath = join(TEST_DIR, '.vibes', 'deployments.json');
    const stat = statSync(regPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('preserves 0o600 when updating existing registry', () => {
    registry.saveRegistry({ version: 1, cloudflare: {}, apps: {} });
    registry.setCloudflareConfig({ apiKey: 'test', email: 'test@test.com' });
    const regPath = join(TEST_DIR, '.vibes', 'deployments.json');
    const stat = statSync(regPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('stores apiKey and email in cloudflare config', () => {
    registry.setCloudflareConfig({ apiKey: 'key123', email: 'user@test.com' });
    const config = registry.getCloudflareConfig();
    expect(config.apiKey).toBe('key123');
    expect(config.email).toBe('user@test.com');
  });

  it('preserves existing cloudflare fields when adding new ones', () => {
    registry.setCloudflareConfig({ accountId: 'acct-123' });
    registry.setCloudflareConfig({ apiKey: 'key123', email: 'user@test.com' });
    const config = registry.getCloudflareConfig();
    expect(config.accountId).toBe('acct-123');
    expect(config.apiKey).toBe('key123');
    expect(config.email).toBe('user@test.com');
  });
});
