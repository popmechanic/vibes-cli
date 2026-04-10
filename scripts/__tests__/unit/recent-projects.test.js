/**
 * Unit tests for recent projects functionality in registry.js
 *
 * Tests add, get, remove, and prune operations for recentProjects,
 * plus v1→v2 migration.
 *
 * Uses VIBES_HOME env var override + vi.resetModules() for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, readFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';

describe('recent projects (registry v2)', () => {
  let registry;
  let TEST_DIR;

  beforeEach(async () => {
    TEST_DIR = join(tmpdir(), `vibes-recent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    vi.resetModules();
    registry = await import('../../lib/registry.js');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  describe('addRecentProject', () => {
    it('adds a project with path, name, displayName, and lastOpened', async () => {
      const projectDir = join(TEST_DIR, 'my-project');
      mkdirSync(projectDir, { recursive: true });

      await registry.addRecentProject({ path: projectDir, name: 'my-project', displayName: 'My Project' });

      const projects = await registry.getRecentProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].path).toBe(projectDir);
      expect(projects[0].name).toBe('my-project');
      expect(projects[0].displayName).toBe('My Project');
      expect(projects[0].lastOpened).toBeDefined();
      expect(new Date(projects[0].lastOpened).getTime()).toBeGreaterThan(0);
    });

    it('moves an existing project to the front when re-added (dedup by path)', async () => {
      const dirA = join(TEST_DIR, 'project-a');
      const dirB = join(TEST_DIR, 'project-b');
      mkdirSync(dirA, { recursive: true });
      mkdirSync(dirB, { recursive: true });

      await registry.addRecentProject({ path: dirA, name: 'project-a' });
      await registry.addRecentProject({ path: dirB, name: 'project-b' });
      // Re-add project-a — it should move to front
      await registry.addRecentProject({ path: dirA, name: 'project-a' });

      const projects = await registry.getRecentProjects();
      expect(projects[0].path).toBe(dirA);
      expect(projects[1].path).toBe(dirB);
      expect(projects).toHaveLength(2);
    });

    it('caps the list at 20 entries', async () => {
      for (let i = 0; i < 25; i++) {
        const dir = join(TEST_DIR, `proj-${i}`);
        mkdirSync(dir, { recursive: true });
        await registry.addRecentProject({ path: dir, name: `proj-${i}` });
      }

      const reg = registry.loadRegistry();
      expect(reg.recentProjects).toHaveLength(20);
      // Most recently added should be at the front
      expect(reg.recentProjects[0].name).toBe('proj-24');
    });

    it('updates displayName when re-adding an existing path', async () => {
      const projectDir = join(TEST_DIR, 'my-project');
      mkdirSync(projectDir, { recursive: true });

      await registry.addRecentProject({ path: projectDir, name: 'my-project', displayName: 'Old Name' });
      await registry.addRecentProject({ path: projectDir, name: 'my-project', displayName: 'New Name' });

      const reg = registry.loadRegistry();
      expect(reg.recentProjects[0].displayName).toBe('New Name');
      expect(reg.recentProjects).toHaveLength(1);
    });
  });

  describe('getRecentProjects', () => {
    it('returns empty array when no projects exist', async () => {
      const projects = await registry.getRecentProjects();
      expect(projects).toEqual([]);
    });

    it('prunes entries whose paths no longer exist on disk', async () => {
      const validDir = join(TEST_DIR, 'valid-project');
      const invalidDir = join(TEST_DIR, 'nonexistent-project');
      mkdirSync(validDir, { recursive: true });

      // Add valid project
      await registry.addRecentProject({ path: validDir, name: 'valid-project' });

      // Manually inject an invalid path into the registry
      const reg = registry.loadRegistry();
      reg.recentProjects.unshift({ path: invalidDir, name: 'nonexistent', lastOpened: new Date().toISOString() });
      registry.saveRegistry(reg);

      // Reset modules to get fresh import
      vi.resetModules();
      const freshRegistry = await import('../../lib/registry.js');

      const projects = await freshRegistry.getRecentProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].path).toBe(validDir);

      // Pruned entry should also be removed from disk
      const savedReg = freshRegistry.loadRegistry();
      expect(savedReg.recentProjects).toHaveLength(1);
    });
  });

  describe('removeRecentProject', () => {
    it('removes a project by path', async () => {
      const dirA = join(TEST_DIR, 'project-a');
      const dirB = join(TEST_DIR, 'project-b');
      mkdirSync(dirA, { recursive: true });
      mkdirSync(dirB, { recursive: true });

      await registry.addRecentProject({ path: dirA, name: 'project-a' });
      await registry.addRecentProject({ path: dirB, name: 'project-b' });

      await registry.removeRecentProject(dirA);

      const reg = registry.loadRegistry();
      expect(reg.recentProjects).toHaveLength(1);
      expect(reg.recentProjects[0].path).toBe(dirB);
    });
  });

  describe('populateLegacyApps', () => {
    it('populates recents from apps dir sorted by mtime (newest first)', async () => {
      const appsDir = join(TEST_DIR, 'apps');
      mkdirSync(appsDir, { recursive: true });

      // Create two app directories with app.jsx files
      const app1Dir = join(appsDir, 'app-older');
      const app2Dir = join(appsDir, 'app-newer');
      mkdirSync(app1Dir, { recursive: true });
      mkdirSync(app2Dir, { recursive: true });
      writeFileSync(join(app1Dir, 'app.jsx'), '// app1');
      writeFileSync(join(app2Dir, 'app.jsx'), '// app2');

      // Set app2 to a future mtime so it's clearly "newer"
      const future = new Date(Date.now() + 1000);
      utimesSync(join(app2Dir, 'app.jsx'), future, future);

      await registry.populateLegacyApps(appsDir);

      const projects = registry.getRecentProjects();
      expect(projects).toHaveLength(2);
      expect(projects[0].path).toBe(app2Dir);
      expect(projects[1].path).toBe(app1Dir);
    });

    it('skips directories without app.jsx', async () => {
      const appsDir = join(TEST_DIR, 'apps');
      mkdirSync(appsDir, { recursive: true });

      // One dir with app.jsx, one without
      const goodDir = join(appsDir, 'good-app');
      const badDir = join(appsDir, 'no-jsx-app');
      mkdirSync(goodDir, { recursive: true });
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(goodDir, 'app.jsx'), '// good');
      // badDir has no app.jsx

      await registry.populateLegacyApps(appsDir);

      const projects = registry.getRecentProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].path).toBe(goodDir);
    });

    it('does not duplicate if already populated', async () => {
      const appsDir = join(TEST_DIR, 'apps');
      mkdirSync(appsDir, { recursive: true });

      const appDir = join(appsDir, 'my-app');
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, 'app.jsx'), '// app');

      // Call twice
      await registry.populateLegacyApps(appsDir);
      await registry.populateLegacyApps(appsDir);

      const reg = registry.loadRegistry();
      expect(reg.recentProjects).toHaveLength(1);
    });

    it('does nothing when appsDir does not exist', async () => {
      const nonexistentDir = join(TEST_DIR, 'does-not-exist');

      // Should not throw
      await registry.populateLegacyApps(nonexistentDir);

      const projects = registry.getRecentProjects();
      expect(projects).toHaveLength(0);
    });
  });

  describe('v1→v2 migration', () => {
    it('adds recentProjects and bumps version when calling setApp on a v1 registry', async () => {
      // Write a v1 registry to disk
      mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
      const v1 = { version: 1, cloudflare: {}, apps: {} };
      writeFileSync(join(TEST_DIR, '.vibes', 'deployments.json'), JSON.stringify(v1));

      // Reset modules to get fresh import that reads the existing file
      vi.resetModules();
      const freshRegistry = await import('../../lib/registry.js');

      // Trigger a write operation
      freshRegistry.setApp('my-app', { name: 'my-app' });

      const reg = freshRegistry.loadRegistry();
      expect(reg.version).toBe(2);
      expect(Array.isArray(reg.recentProjects)).toBe(true);
    });
  });
});
