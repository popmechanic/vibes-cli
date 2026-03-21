/**
 * Integration tests for deploy-cloudflare.js registry behavior
 *
 * Tests the first-deploy detection logic and registry metadata storage
 * used by the Deploy API flow.
 *
 * Uses VIBES_HOME env var override + vi.resetModules() for test isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('deploy-cloudflare sync integration', () => {
  let registry;
  let TEST_DIR;

  beforeEach(async () => {
    TEST_DIR = join(tmpdir(), `vibes-deploy-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    vi.resetModules();
    registry = await import('../../lib/registry.js');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  describe('registry update after deploy', () => {
    it('stores sync metadata on first deploy', () => {
      const syncResult = {
        wsUrl: 'wss://sync-my-app.acct.workers.dev',
      };

      registry.setApp('my-app', {
        name: 'my-app',
        oidc: {
          authority: 'https://auth.example.com',
          clientId: 'test-client-id'
        },
        sync: {
          ...syncResult,
          deployedAt: new Date().toISOString()
        }
      });

      const loaded = registry.getApp('my-app');
      expect(loaded.sync.wsUrl).toBe(syncResult.wsUrl);
      expect(loaded.sync.deployedAt).toBeDefined();
      expect(loaded.oidc.authority).toBe('https://auth.example.com');
    });

    it('stores app metadata after Deploy API call', () => {
      // Simulate first-deploy sync metadata
      registry.setApp('my-app', {
        name: 'my-app',
        sync: { wsUrl: 'wss://sync.workers.dev' }
      });

      // Simulate post-deploy app metadata update
      const appEntry = registry.getApp('my-app') || { name: 'my-app' };
      registry.setApp('my-app', {
        ...appEntry,
        app: {
          workerName: 'my-app',
          url: 'https://my-app.vibesos.com'
        }
      });

      const loaded = registry.getApp('my-app');
      expect(loaded.app.workerName).toBe('my-app');
      expect(loaded.app.url).toBe('https://my-app.vibesos.com');
      // Sync metadata should still be present
      expect(loaded.sync.wsUrl).toBe('wss://sync.workers.dev');
    });

    it('preserves sync metadata across update deploys', () => {
      // First deploy: set sync + app
      registry.setApp('my-app', {
        name: 'my-app',
        sync: {
          wsUrl: 'wss://sync.workers.dev',
          deployedAt: '2025-01-01T00:00:00.000Z'
        },
        app: {
          workerName: 'my-app',
          kvNamespaceId: 'kv-abc',
          url: 'https://my-app.v1.workers.dev'
        }
      });

      // Update deploy: only update app metadata
      const appEntry = registry.getApp('my-app') || { name: 'my-app' };
      registry.setApp('my-app', {
        ...appEntry,
        app: {
          workerName: 'my-app',
          kvNamespaceId: 'kv-abc',
          url: 'https://my-app.v2.workers.dev'
        }
      });

      const loaded = registry.getApp('my-app');
      // App URL updated
      expect(loaded.app.url).toBe('https://my-app.v2.workers.dev');
      // Sync metadata preserved (not overwritten)
      expect(loaded.sync.wsUrl).toBe('wss://sync.workers.dev');
      expect(loaded.sync.deployedAt).toBe('2025-01-01T00:00:00.000Z');
    });

    it('retrieves existing sync info on update deploy', () => {
      registry.setApp('existing', {
        name: 'existing',
        sync: {
          wsUrl: 'wss://sync-existing.acct.workers.dev',
        }
      });

      // Simulate the update-deploy path: get existing app for logging
      const existing = registry.getApp('existing');
      expect(existing.sync).toBeDefined();
      expect(existing.sync.wsUrl).toBe('wss://sync-existing.acct.workers.dev');
    });
  });
});
