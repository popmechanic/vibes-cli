/**
 * Unit tests for configuration parsing in deploy-sell.js
 *
 * Tests CLI argument parsing and config file load/save operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_CONFIG_PATH = join(__dirname, '../../.test-vibes-deploy.json');

// ============== Argument Parsing (extracted from deploy-sell.js) ==============

function parseArgs(argv) {
  const args = {
    project: null,
    skipDns: false,
    skipRoutes: false,
    skipPages: false,
    skipVerify: false,
    verifyOnly: false,
    dryRun: false,
    reset: false,
    help: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project' && argv[i + 1]) {
      args.project = argv[++i];
    } else if (arg === '--skip-dns') {
      args.skipDns = true;
    } else if (arg === '--skip-routes') {
      args.skipRoutes = true;
    } else if (arg === '--skip-pages') {
      args.skipPages = true;
    } else if (arg === '--skip-verify') {
      args.skipVerify = true;
    } else if (arg === '--verify-only') {
      args.verifyOnly = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--reset') {
      args.reset = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

// ============== Config Management (extracted from deploy-sell.js) ==============

function loadConfig(configPath = TEST_CONFIG_PATH) {
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      return { projects: {} };
    }
  }
  return { projects: {} };
}

function saveConfig(config, configPath = TEST_CONFIG_PATH) {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function getProjectConfig(projectName, configPath = TEST_CONFIG_PATH) {
  const config = loadConfig(configPath);
  return config.projects?.[projectName] || null;
}

function saveProjectConfig(projectName, projectConfig, configPath = TEST_CONFIG_PATH) {
  const config = loadConfig(configPath);
  config.projects = config.projects || {};
  config.projects[projectName] = projectConfig;
  saveConfig(config, configPath);
}

// ============== Tests ==============

describe('parseArgs', () => {
  it('returns defaults when no arguments provided', () => {
    const args = parseArgs(['node', 'deploy-sell.js']);

    expect(args.project).toBeNull();
    expect(args.skipDns).toBe(false);
    expect(args.skipRoutes).toBe(false);
    expect(args.skipPages).toBe(false);
    expect(args.skipVerify).toBe(false);
    expect(args.verifyOnly).toBe(false);
    expect(args.dryRun).toBe(false);
    expect(args.reset).toBe(false);
    expect(args.help).toBe(false);
  });

  it('parses --project with value', () => {
    const args = parseArgs(['node', 'deploy-sell.js', '--project', 'my-app']);
    expect(args.project).toBe('my-app');
  });

  it('parses --project without value (stays null)', () => {
    const args = parseArgs(['node', 'deploy-sell.js', '--project']);
    expect(args.project).toBeNull();
  });

  it('parses boolean flags', () => {
    const args = parseArgs([
      'node', 'deploy-sell.js',
      '--skip-dns',
      '--skip-routes',
      '--skip-pages',
      '--skip-verify'
    ]);

    expect(args.skipDns).toBe(true);
    expect(args.skipRoutes).toBe(true);
    expect(args.skipPages).toBe(true);
    expect(args.skipVerify).toBe(true);
  });

  it('parses --verify-only', () => {
    const args = parseArgs(['node', 'deploy-sell.js', '--verify-only']);
    expect(args.verifyOnly).toBe(true);
  });

  it('parses --dry-run', () => {
    const args = parseArgs(['node', 'deploy-sell.js', '--dry-run']);
    expect(args.dryRun).toBe(true);
  });

  it('parses --reset', () => {
    const args = parseArgs(['node', 'deploy-sell.js', '--reset']);
    expect(args.reset).toBe(true);
  });

  it('parses --help', () => {
    const args = parseArgs(['node', 'deploy-sell.js', '--help']);
    expect(args.help).toBe(true);
  });

  it('parses -h as help', () => {
    const args = parseArgs(['node', 'deploy-sell.js', '-h']);
    expect(args.help).toBe(true);
  });

  it('handles combined arguments', () => {
    const args = parseArgs([
      'node', 'deploy-sell.js',
      '--project', 'fantasy-wedding',
      '--skip-dns',
      '--dry-run'
    ]);

    expect(args.project).toBe('fantasy-wedding');
    expect(args.skipDns).toBe(true);
    expect(args.dryRun).toBe(true);
    expect(args.skipRoutes).toBe(false);
  });
});

describe('loadConfig', () => {
  afterEach(() => {
    // Clean up test config file
    if (existsSync(TEST_CONFIG_PATH)) {
      unlinkSync(TEST_CONFIG_PATH);
    }
  });

  it('returns empty projects when file does not exist', () => {
    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config).toEqual({ projects: {} });
  });

  it('returns parsed JSON when file exists', () => {
    const testConfig = {
      projects: {
        'my-app': { domain: 'example.com', workerName: 'my-app-worker' }
      }
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(testConfig));

    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config).toEqual(testConfig);
  });

  it('returns empty projects for malformed JSON', () => {
    writeFileSync(TEST_CONFIG_PATH, 'not valid json {{{');

    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config).toEqual({ projects: {} });
  });
});

describe('saveConfig', () => {
  afterEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      unlinkSync(TEST_CONFIG_PATH);
    }
  });

  it('writes config to file', () => {
    const testConfig = {
      projects: {
        'test-app': { domain: 'test.com' }
      }
    };

    saveConfig(testConfig, TEST_CONFIG_PATH);

    const saved = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    expect(saved).toEqual(testConfig);
  });

  it('overwrites existing config', () => {
    saveConfig({ projects: { old: {} } }, TEST_CONFIG_PATH);
    saveConfig({ projects: { new: {} } }, TEST_CONFIG_PATH);

    const saved = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    expect(saved.projects).toHaveProperty('new');
    expect(saved.projects).not.toHaveProperty('old');
  });
});

describe('getProjectConfig', () => {
  afterEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      unlinkSync(TEST_CONFIG_PATH);
    }
  });

  it('returns null for non-existent project', () => {
    const config = getProjectConfig('does-not-exist', TEST_CONFIG_PATH);
    expect(config).toBeNull();
  });

  it('returns project config when it exists', () => {
    const projectConfig = { domain: 'example.com', workerName: 'my-worker' };
    saveConfig({
      projects: { 'my-project': projectConfig }
    }, TEST_CONFIG_PATH);

    const config = getProjectConfig('my-project', TEST_CONFIG_PATH);
    expect(config).toEqual(projectConfig);
  });
});

describe('saveProjectConfig', () => {
  afterEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      unlinkSync(TEST_CONFIG_PATH);
    }
  });

  it('adds new project to empty config', () => {
    const projectConfig = { domain: 'new.com' };
    saveProjectConfig('new-project', projectConfig, TEST_CONFIG_PATH);

    const saved = loadConfig(TEST_CONFIG_PATH);
    expect(saved.projects['new-project']).toEqual(projectConfig);
  });

  it('updates existing project', () => {
    saveProjectConfig('proj', { domain: 'old.com' }, TEST_CONFIG_PATH);
    saveProjectConfig('proj', { domain: 'new.com' }, TEST_CONFIG_PATH);

    const saved = loadConfig(TEST_CONFIG_PATH);
    expect(saved.projects['proj'].domain).toBe('new.com');
  });

  it('preserves other projects when updating', () => {
    saveProjectConfig('proj1', { domain: 'one.com' }, TEST_CONFIG_PATH);
    saveProjectConfig('proj2', { domain: 'two.com' }, TEST_CONFIG_PATH);

    const saved = loadConfig(TEST_CONFIG_PATH);
    expect(saved.projects['proj1'].domain).toBe('one.com');
    expect(saved.projects['proj2'].domain).toBe('two.com');
  });
});
