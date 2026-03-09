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

describe('deploy-cloudflare connect integration', () => {
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

  describe('first-deploy detection', () => {
    it('detects first deploy for unknown app', () => {
      expect(registry.isFirstDeploy('brand-new-app')).toBe(true);
    });

    it('detects first deploy for app without connect config', () => {
      registry.setApp('partial-app', {
        name: 'partial-app',
        oidc: { authority: 'https://auth.example.com', clientId: 'test-id' }
      });
      expect(registry.isFirstDeploy('partial-app')).toBe(true);
    });

    it('detects first deploy for app with empty connect object', () => {
      registry.setApp('empty-connect', {
        name: 'empty-connect',
        connect: {}
      });
      expect(registry.isFirstDeploy('empty-connect')).toBe(true);
    });

    it('skips connect provisioning on update deploy', () => {
      registry.setApp('existing-app', {
        name: 'existing-app',
        connect: {
          stage: 'existing-app',
          apiUrl: 'https://fireproof-dashboard-existing-app.acct.workers.dev',
          cloudUrl: 'fpcloud://fireproof-cloud-existing-app.acct.workers.dev?protocol=wss'
        }
      });
      expect(registry.isFirstDeploy('existing-app')).toBe(false);
    });
  });

  describe('registry update after deploy', () => {
    it('stores connect metadata on first deploy', () => {
      const connectResult = {
        apiUrl: 'https://fireproof-dashboard-my-app.acct.workers.dev',
        cloudUrl: 'fpcloud://fireproof-cloud-my-app.acct.workers.dev?protocol=wss',
        stage: 'my-app'
      };

      registry.setApp('my-app', {
        name: 'my-app',
        oidc: {
          authority: 'https://auth.example.com',
          clientId: 'test-client-id'
        },
        connect: {
          ...connectResult,
          deployedAt: new Date().toISOString()
        }
      });

      const loaded = registry.getApp('my-app');
      expect(loaded.connect.apiUrl).toBe(connectResult.apiUrl);
      expect(loaded.connect.cloudUrl).toBe(connectResult.cloudUrl);
      expect(loaded.connect.stage).toBe('my-app');
      expect(loaded.connect.deployedAt).toBeDefined();
      expect(loaded.oidc.authority).toBe('https://auth.example.com');
    });

    it('stores app metadata after Deploy API call', () => {
      // Simulate first-deploy connect metadata
      registry.setApp('my-app', {
        name: 'my-app',
        connect: { stage: 'my-app', apiUrl: 'https://dash.workers.dev' }
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
      // Connect metadata should still be present
      expect(loaded.connect.apiUrl).toBe('https://dash.workers.dev');
    });

    it('preserves connect metadata across update deploys', () => {
      // First deploy: set connect + app
      registry.setApp('my-app', {
        name: 'my-app',
        connect: {
          stage: 'my-app',
          apiUrl: 'https://dash.workers.dev',
          cloudUrl: 'fpcloud://cloud.workers.dev?protocol=wss',
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
      // Connect metadata preserved (not overwritten)
      expect(loaded.connect.apiUrl).toBe('https://dash.workers.dev');
      expect(loaded.connect.deployedAt).toBe('2025-01-01T00:00:00.000Z');
    });

    it('retrieves existing connect info on update deploy', () => {
      registry.setApp('existing', {
        name: 'existing',
        connect: {
          stage: 'existing',
          apiUrl: 'https://fireproof-dashboard-existing.acct.workers.dev',
          cloudUrl: 'fpcloud://fireproof-cloud-existing.acct.workers.dev?protocol=wss'
        }
      });

      // Simulate the update-deploy path: get existing app for logging
      const existing = registry.getApp('existing');
      expect(existing.connect).toBeDefined();
      expect(existing.connect.apiUrl).toBe('https://fireproof-dashboard-existing.acct.workers.dev');
    });
  });
});
