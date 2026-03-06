/**
 * Unit tests for alchemy-deploy.js — Connect Provisioning Module
 *
 * Tests the three pure functions:
 * - ensureSparseCheckout: manages shallow sparse git checkout
 * - buildAlchemyEnv: prepares environment variables for alchemy
 * - parseAlchemyOutput: extracts URLs from alchemy deploy stdout
 *
 * Mocks child_process and fs to avoid real I/O.
 * Does NOT test deployConnect (async, uses crypto-utils).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn()
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, existsSync: vi.fn(() => false), mkdirSync: vi.fn() };
});

describe('alchemy-deploy', () => {
  let alchemyDeploy;
  let execSync;
  let existsSync;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const cp = await import('child_process');
    execSync = cp.execSync;
    const fs = await import('fs');
    existsSync = fs.existsSync;
    alchemyDeploy = await import('../../lib/alchemy-deploy.js');
  });

  describe('ensureSparseCheckout', () => {
    it('clones repo when cache dir does not exist', () => {
      existsSync.mockReturnValue(false);
      execSync.mockReturnValue('');

      alchemyDeploy.ensureSparseCheckout('/tmp/test-cache');

      const cloneCall = execSync.mock.calls.find(c => c[0].includes('git clone'));
      expect(cloneCall).toBeTruthy();
      expect(cloneCall[0]).toContain('--depth 1');
      expect(cloneCall[0]).toContain('--sparse');
      expect(cloneCall[0]).toContain('--filter=blob:none');
    });

    it('sets up sparse-checkout after cloning', () => {
      existsSync.mockReturnValue(false);
      execSync.mockReturnValue('');

      alchemyDeploy.ensureSparseCheckout('/tmp/test-cache');

      const sparseCall = execSync.mock.calls.find(c => c[0].includes('sparse-checkout'));
      expect(sparseCall).toBeTruthy();
      expect(sparseCall[0]).toContain('alchemy/');
    });

    it('does git pull when cache exists', () => {
      // .git subdir exists => repo already cloned
      existsSync.mockReturnValue(true);
      execSync.mockReturnValue('');

      alchemyDeploy.ensureSparseCheckout('/tmp/test-cache');

      const pullCall = execSync.mock.calls.find(c => c[0].includes('git pull'));
      expect(pullCall).toBeTruthy();
    });

    it('does not clone when cache exists', () => {
      existsSync.mockReturnValue(true);
      execSync.mockReturnValue('');

      alchemyDeploy.ensureSparseCheckout('/tmp/test-cache');

      const cloneCall = execSync.mock.calls.find(c => c[0].includes('git clone'));
      expect(cloneCall).toBeUndefined();
    });

    it('returns the repo directory path', () => {
      existsSync.mockReturnValue(true);
      execSync.mockReturnValue('');

      const result = alchemyDeploy.ensureSparseCheckout('/tmp/test-cache');
      expect(result).toBe('/tmp/test-cache');
    });

    it('clones from the correct upstream repo', () => {
      existsSync.mockReturnValue(false);
      execSync.mockReturnValue('');

      alchemyDeploy.ensureSparseCheckout('/tmp/test-cache');

      const cloneCall = execSync.mock.calls.find(c => c[0].includes('git clone'));
      expect(cloneCall[0]).toContain('fireproof-storage/fireproof.git');
    });
  });

  describe('buildAlchemyEnv', () => {
    it('generates required environment variables', () => {
      const env = alchemyDeploy.buildAlchemyEnv({
        oidcAuthority: 'https://auth.example.com',
        sessionTokenPublic: 'token-pub',
        sessionTokenSecret: 'token-sec',
        deviceCaPrivKey: 'ca-priv',
        deviceCaCert: 'ca-cert',
        alchemyPassword: 'pass123'
      });

      expect(env.OIDC_AUTHORITY).toBe('https://auth.example.com');
      expect(env.CLOUD_SESSION_TOKEN_PUBLIC).toBe('token-pub');
      expect(env.CLOUD_SESSION_TOKEN_SECRET).toBe('token-sec');
      expect(env.ALCHEMY_PASSWORD).toBe('pass123');
    });

    it('includes device CA keys', () => {
      const env = alchemyDeploy.buildAlchemyEnv({
        oidcAuthority: 'https://auth.example.com',
        sessionTokenPublic: 'token-pub',
        sessionTokenSecret: 'token-sec',
        deviceCaPrivKey: 'ca-priv',
        deviceCaCert: 'ca-cert',
        alchemyPassword: 'pass123'
      });

      expect(env.DEVICE_ID_CA_PRIV_KEY).toBe('ca-priv');
      expect(env.DEVICE_ID_CA_CERT).toBe('ca-cert');
    });

    it('passes OIDC authority URL directly', () => {
      const env = alchemyDeploy.buildAlchemyEnv({
        oidcAuthority: 'https://pocket-id.example.com',
        sessionTokenPublic: 'tp',
        sessionTokenSecret: 'ts',
        deviceCaPrivKey: 'dp',
        deviceCaCert: 'dc',
        alchemyPassword: 'pw'
      });

      expect(env.OIDC_AUTHORITY).toBe('https://pocket-id.example.com');
    });

    it('includes quota defaults', () => {
      const env = alchemyDeploy.buildAlchemyEnv({
        oidcAuthority: 'https://auth.example.com',
        sessionTokenPublic: 'tp',
        sessionTokenSecret: 'ts',
        deviceCaPrivKey: 'dp',
        deviceCaCert: 'dc',
        alchemyPassword: 'pw'
      });

      expect(env.MAX_TENANTS).toBe('100');
      expect(env.MAX_ADMIN_USERS).toBe('10');
      expect(env.MAX_MEMBER_USERS).toBe('50');
      expect(env.MAX_INVITES).toBe('100');
      expect(env.MAX_LEDGERS).toBe('50');
    });
  });

  describe('parseAlchemyOutput', () => {
    it('extracts cloud backend and dashboard URLs from stdout', () => {
      const stdout = `
--- Deployed URLs ---
Stage: my-app
Cloud Backend: https://fireproof-cloud-my-app.acct123.workers.dev
Dashboard: https://fireproof-dashboard-my-app.acct123.workers.dev

VITE_OIDC_AUTHORITY=https://auth.example.com
VITE_API_URL=https://fireproof-dashboard-my-app.acct123.workers.dev
VITE_CLOUD_URL=https://fireproof-cloud-my-app.acct123.workers.dev
`;
      const result = alchemyDeploy.parseAlchemyOutput(stdout);
      expect(result.cloudBackendUrl).toContain('fireproof-cloud-my-app');
      expect(result.dashboardUrl).toContain('fireproof-dashboard-my-app');
    });

    it('extracts exact URLs', () => {
      const stdout = 'Cloud Backend: https://cloud.example.dev\nDashboard: https://dash.example.dev\n';
      const result = alchemyDeploy.parseAlchemyOutput(stdout);
      expect(result.cloudBackendUrl).toBe('https://cloud.example.dev');
      expect(result.dashboardUrl).toBe('https://dash.example.dev');
    });

    it('throws on missing URLs', () => {
      expect(() => alchemyDeploy.parseAlchemyOutput('no urls here')).toThrow();
    });

    it('throws when only cloud backend is present', () => {
      const stdout = 'Cloud Backend: https://cloud.example.dev\n';
      expect(() => alchemyDeploy.parseAlchemyOutput(stdout)).toThrow();
    });

    it('throws when only dashboard is present', () => {
      const stdout = 'Dashboard: https://dash.example.dev\n';
      expect(() => alchemyDeploy.parseAlchemyOutput(stdout)).toThrow();
    });

    it('error message includes truncated output for debugging', () => {
      try {
        alchemyDeploy.parseAlchemyOutput('unexpected output');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e.message).toContain('unexpected output');
      }
    });
  });
});
