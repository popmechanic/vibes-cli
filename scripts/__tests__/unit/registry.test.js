/**
 * Unit tests for registry.js — Global Deployment Registry
 *
 * Tests CRUD operations for ~/.vibes/deployments.json:
 * - loadRegistry / saveRegistry
 * - getApp / setApp
 * - getCloudflareConfig / setCloudflareConfig
 * - isFirstDeploy
 * - deriveConnectUrls
 * - migrateFromLegacy
 *
 * Uses VIBES_HOME env var override + vi.resetModules() for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

describe('registry', () => {
  let registry;
  let TEST_DIR;

  beforeEach(async () => {
    TEST_DIR = join(tmpdir(), `vibes-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    // Reset module cache so each test gets a fresh import that reads the new VIBES_HOME
    vi.resetModules();
    registry = await import('../../lib/registry.js');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  describe('loadRegistry', () => {
    it('returns empty registry when no file exists', () => {
      const reg = registry.loadRegistry();
      expect(reg.version).toBe(1);
      expect(reg.apps).toEqual({});
      expect(reg.cloudflare).toEqual({});
    });

    it('reads existing registry file', () => {
      const data = { version: 1, cloudflare: { accountId: 'abc' }, apps: {} };
      mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
      writeFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), JSON.stringify(data));
      const reg = registry.loadRegistry();
      expect(reg.cloudflare.accountId).toBe('abc');
    });

    it('returns empty registry for malformed JSON', () => {
      mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
      writeFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), 'not json{{{');
      const reg = registry.loadRegistry();
      expect(reg.version).toBe(1);
      expect(reg.apps).toEqual({});
    });

    it('returns empty registry if file is missing version field', () => {
      mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
      writeFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), JSON.stringify({ random: 'data' }));
      const reg = registry.loadRegistry();
      expect(reg.version).toBe(1);
      expect(reg.apps).toEqual({});
    });

    it('returns empty registry if file has version but no apps field', () => {
      mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
      writeFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), JSON.stringify({ version: 1, cloudflare: {} }));
      const reg = registry.loadRegistry();
      expect(reg.version).toBe(1);
      expect(reg.apps).toEqual({});
    });
  });

  describe('saveRegistry', () => {
    it('creates .vibes directory if missing', () => {
      const reg = { version: 1, cloudflare: {}, apps: {} };
      registry.saveRegistry(reg);
      expect(existsSync(join(TEST_DIR, '.vibes', 'deployments.json'))).toBe(true);
    });

    it('writes valid JSON', () => {
      const reg = { version: 1, cloudflare: { accountId: 'test' }, apps: {} };
      registry.saveRegistry(reg);
      const raw = readFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.cloudflare.accountId).toBe('test');
    });
  });

  describe('getApp / setApp', () => {
    it('returns null for unknown app', () => {
      expect(registry.getApp('nonexistent')).toBeNull();
    });

    it('round-trips an app entry', () => {
      const entry = {
        name: 'test-app',
        createdAt: '2025-01-01T00:00:00.000Z',
        clerk: { publishableKey: 'pk_test_abc', secretKey: 'sk_test_xyz' },
        app: { workerName: 'test-app', url: 'https://test-app.workers.dev' },
        connect: { stage: 'test-app', apiUrl: 'https://dashboard.workers.dev' }
      };
      registry.setApp('test-app', entry);
      const loaded = registry.getApp('test-app');
      expect(loaded.name).toBe('test-app');
      expect(loaded.clerk.publishableKey).toBe('pk_test_abc');
      expect(loaded.clerk.secretKey).toBe('sk_test_xyz');
      expect(loaded.app.url).toBe('https://test-app.workers.dev');
      expect(loaded.connect.apiUrl).toBe('https://dashboard.workers.dev');
    });

    it('adds updatedAt on save', () => {
      registry.setApp('my-app', { name: 'my-app' });
      const loaded = registry.getApp('my-app');
      expect(loaded.updatedAt).toBeDefined();
      expect(new Date(loaded.updatedAt).getTime()).toBeGreaterThan(0);
    });

    it('adds createdAt when not provided', () => {
      registry.setApp('new-app', { name: 'new-app' });
      const loaded = registry.getApp('new-app');
      expect(loaded.createdAt).toBeDefined();
    });

    it('preserves provided createdAt', () => {
      const timestamp = '2024-06-15T12:00:00.000Z';
      registry.setApp('old-app', { name: 'old-app', createdAt: timestamp });
      const loaded = registry.getApp('old-app');
      expect(loaded.createdAt).toBe(timestamp);
    });

    it('can update an existing app entry', () => {
      registry.setApp('my-app', { name: 'my-app', clerk: { publishableKey: 'pk_test_old' } });
      registry.setApp('my-app', { name: 'my-app', clerk: { publishableKey: 'pk_test_new' } });
      const loaded = registry.getApp('my-app');
      expect(loaded.clerk.publishableKey).toBe('pk_test_new');
    });

    it('preserves createdAt across partial updates', () => {
      registry.setApp('my-app', { name: 'my-app', createdAt: '2024-01-01T00:00:00Z', clerk: { publishableKey: 'pk_test_old' } });
      registry.setApp('my-app', { name: 'my-app', clerk: { publishableKey: 'pk_test_new' } });
      const loaded = registry.getApp('my-app');
      expect(loaded.createdAt).toBe('2024-01-01T00:00:00Z');
      expect(loaded.clerk.publishableKey).toBe('pk_test_new');
    });

    it('merges with existing fields on partial update', () => {
      registry.setApp('my-app', { name: 'my-app', clerk: { publishableKey: 'pk_test_x' }, connect: { apiUrl: 'https://api.test' } });
      registry.setApp('my-app', { name: 'my-app', app: { workerName: 'my-app', url: 'https://my-app.workers.dev' } });
      const loaded = registry.getApp('my-app');
      expect(loaded.connect.apiUrl).toBe('https://api.test');
      expect(loaded.app.url).toBe('https://my-app.workers.dev');
    });

    it('does not clobber other apps when setting one', () => {
      registry.setApp('app-a', { name: 'app-a' });
      registry.setApp('app-b', { name: 'app-b' });
      expect(registry.getApp('app-a')).not.toBeNull();
      expect(registry.getApp('app-b')).not.toBeNull();
    });
  });

  describe('getCloudflareConfig / setCloudflareConfig', () => {
    it('returns empty object when no config set', () => {
      const config = registry.getCloudflareConfig();
      expect(config).toEqual({});
    });

    it('stores and retrieves Cloudflare account info', () => {
      registry.setCloudflareConfig({ accountId: 'cf-123', workersSubdomain: 'my-sub' });
      const config = registry.getCloudflareConfig();
      expect(config.accountId).toBe('cf-123');
      expect(config.workersSubdomain).toBe('my-sub');
    });

    it('merges new config with existing', () => {
      registry.setCloudflareConfig({ accountId: 'cf-123' });
      registry.setCloudflareConfig({ workersSubdomain: 'my-sub' });
      const config = registry.getCloudflareConfig();
      expect(config.accountId).toBe('cf-123');
      expect(config.workersSubdomain).toBe('my-sub');
    });
  });

  describe('isFirstDeploy', () => {
    it('returns true for unknown app', () => {
      expect(registry.isFirstDeploy('new-app')).toBe(true);
    });

    it('returns true for app without connect config', () => {
      registry.setApp('partial', { name: 'partial', clerk: { publishableKey: 'pk_test_x' } });
      expect(registry.isFirstDeploy('partial')).toBe(true);
    });

    it('returns true for app with empty connect', () => {
      registry.setApp('empty-connect', { name: 'empty-connect', connect: {} });
      expect(registry.isFirstDeploy('empty-connect')).toBe(true);
    });

    it('returns false for registered app with connect apiUrl', () => {
      registry.setApp('existing', {
        name: 'existing',
        connect: { stage: 'existing', apiUrl: 'https://existing.workers.dev' }
      });
      expect(registry.isFirstDeploy('existing')).toBe(false);
    });
  });

  describe('validateName', () => {
    it('accepts valid names', () => {
      expect(registry.validateName('my-app')).toBe('my-app');
      expect(registry.validateName('a')).toBe('a');
      expect(registry.validateName('app123')).toBe('app123');
    });

    it('rejects invalid names', () => {
      expect(() => registry.validateName('')).toThrow();
      expect(() => registry.validateName('-bad')).toThrow();
      expect(() => registry.validateName('bad-')).toThrow();
      expect(() => registry.validateName('Has Caps')).toThrow();
      expect(() => registry.validateName(null)).toThrow();
    });
  });

  describe('deriveConnectUrls', () => {
    it('transforms HTTPS cloud backend URL to fpcloud:// protocol', () => {
      const urls = registry.deriveConnectUrls('https://fireproof-cloud-myapp.acct.workers.dev');
      expect(urls.cloudUrl).toBe('fpcloud://fireproof-cloud-myapp.acct.workers.dev?protocol=wss');
      expect(urls.apiUrl).toBe('https://fireproof-cloud-myapp.acct.workers.dev');
    });

    it('handles URL with path', () => {
      const urls = registry.deriveConnectUrls('https://example.com/api');
      expect(urls.cloudUrl).toBe('fpcloud://example.com?protocol=wss');
      expect(urls.apiUrl).toBe('https://example.com/api');
    });

    it('handles URL with port', () => {
      const urls = registry.deriveConnectUrls('https://localhost:8787');
      expect(urls.cloudUrl).toBe('fpcloud://localhost:8787?protocol=wss');
    });
  });

  describe('migrateFromLegacy', () => {
    it('creates app entry from legacy env vars and connect data', () => {
      const envVars = {
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_legacy',
        CLERK_SECRET_KEY: 'sk_test_legacy',
        VITE_API_URL: 'https://studio.exe.xyz/api/',
        VITE_CLOUD_URL: 'fpcloud://studio.exe.xyz?protocol=wss'
      };
      const connectData = {
        studio: 'my-legacy-app',
        clerk_publishable_key: 'pk_test_legacy',
        api_url: 'https://studio.exe.xyz/api/',
        cloud_url: 'fpcloud://studio.exe.xyz?protocol=wss'
      };

      const entry = registry.migrateFromLegacy(envVars, connectData);
      expect(entry.name).toBe('my-legacy-app');
      expect(entry.clerk.publishableKey).toBe('pk_test_legacy');
      expect(entry.clerk.secretKey).toBe('sk_test_legacy');
      expect(entry.connect.apiUrl).toBe('https://studio.exe.xyz/api/');
      expect(entry.connect.cloudUrl).toBe('fpcloud://studio.exe.xyz?protocol=wss');

      // Verify persisted
      const loaded = registry.getApp('my-legacy-app');
      expect(loaded.name).toBe('my-legacy-app');
    });

    it('falls back to connectData keys when envVars are missing', () => {
      const envVars = {};
      const connectData = {
        studio: 'fallback-app',
        clerk_publishable_key: 'pk_test_fb',
        api_url: 'https://fb.exe.xyz/api/',
        cloud_url: 'fpcloud://fb.exe.xyz?protocol=wss'
      };

      const entry = registry.migrateFromLegacy(envVars, connectData);
      expect(entry.clerk.publishableKey).toBe('pk_test_fb');
      expect(entry.connect.apiUrl).toBe('https://fb.exe.xyz/api/');
    });

    it('defaults app name to "legacy" when no studio name', () => {
      const entry = registry.migrateFromLegacy({}, {});
      expect(entry.name).toBe('legacy');
    });
  });
});
