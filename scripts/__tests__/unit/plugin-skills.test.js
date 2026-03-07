import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// Import the functions under test
import { parseSkillFrontmatter, resolveSkillsDir, discoverPluginSkills } from '../../server/config.js';

// --- parseSkillFrontmatter ---

describe('parseSkillFrontmatter', () => {
  it('returns empty object when no frontmatter delimiters', () => {
    expect(parseSkillFrontmatter('# Just a heading\nSome content')).toEqual({});
  });

  it('returns empty object for empty frontmatter block', () => {
    expect(parseSkillFrontmatter('---\n---\nContent')).toEqual({});
  });

  it('parses simple single-line name and description', () => {
    const content = `---
name: systematic-debugging
description: Use when encountering any bug or test failure
---
# Skill content`;
    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('systematic-debugging');
    expect(result.description).toBe('Use when encountering any bug or test failure');
  });

  it('parses quoted values (double quotes)', () => {
    const content = `---
name: "my-skill"
description: "A skill with special: characters"
---`;
    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('A skill with special: characters');
  });

  it('parses quoted values (single quotes)', () => {
    const content = `---
name: 'test-skill'
description: 'Single quoted description'
---`;
    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('test-skill');
    expect(result.description).toBe('Single quoted description');
  });

  it('parses argument-hint as argumentHint', () => {
    const content = `---
name: my-skill
description: A skill
argument-hint: "[file path]"
---`;
    const result = parseSkillFrontmatter(content);
    expect(result.argumentHint).toBe('[file path]');
  });

  it('handles missing fields gracefully', () => {
    const content = `---
name: only-name
---`;
    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('only-name');
    expect(result.description).toBeUndefined();
    expect(result.argumentHint).toBeUndefined();
  });

  it('parses multiline description with indented continuation', () => {
    const content = `---
name: complex-skill
description: First line of a long description
  that continues on the next line
  and even a third line
argument-hint: hint
---`;
    const result = parseSkillFrontmatter(content);
    expect(result.description).toBe('First line of a long description that continues on the next line and even a third line');
    expect(result.argumentHint).toBe('hint');
  });

  it('parses YAML folded block scalar (>)', () => {
    const content = `---
name: folded-skill
description: >
  This is a folded
  block scalar that
  joins lines with spaces
argument-hint: hint
---`;
    const result = parseSkillFrontmatter(content);
    expect(result.description).toBe('This is a folded block scalar that joins lines with spaces');
  });

  it('parses YAML literal block scalar (|)', () => {
    const content = `---
name: literal-skill
description: |
  Line one
  Line two
  Line three
argument-hint: hint
---`;
    const result = parseSkillFrontmatter(content);
    expect(result.description).toBe('Line one\nLine two\nLine three');
  });

  it('handles block scalar with chomping indicator (>-)', () => {
    const content = `---
name: chomp-skill
description: >-
  Folded with strip
  chomping indicator
argument-hint: hint
---`;
    const result = parseSkillFrontmatter(content);
    expect(result.description).toBe('Folded with strip chomping indicator');
  });

  it('handles frontmatter with extra whitespace around values', () => {
    const content = `---
name:   spaced-skill
description:   spaced description
---`;
    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('spaced-skill');
    expect(result.description).toBe('spaced description');
  });
});

// --- resolveSkillsDir ---

describe('resolveSkillsDir', () => {
  let tmpBase;

  beforeEach(() => {
    tmpBase = join(tmpdir(), `vibes-test-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('defaults to skills/ when no plugin.json exists', () => {
    const result = resolveSkillsDir(tmpBase);
    expect(result).toBe(join(tmpBase, 'skills'));
  });

  it('defaults to skills/ when plugin.json has no skills field', () => {
    const pluginDir = join(tmpBase, '.claude-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'test' }));
    const result = resolveSkillsDir(tmpBase);
    expect(result).toBe(join(tmpBase, 'skills'));
  });

  it('resolves custom skills path from plugin.json', () => {
    const pluginDir = join(tmpBase, '.claude-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ skills: './.claude/skills' }));
    const result = resolveSkillsDir(tmpBase);
    expect(result).toBe(join(tmpBase, '.claude/skills'));
  });

  it('defaults to skills/ when plugin.json is invalid JSON', () => {
    const pluginDir = join(tmpBase, '.claude-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), 'not json');
    const result = resolveSkillsDir(tmpBase);
    expect(result).toBe(join(tmpBase, 'skills'));
  });
});

// --- discoverPluginSkills ---

describe('discoverPluginSkills', () => {
  let tmpBase;

  beforeEach(() => {
    tmpBase = join(tmpdir(), `vibes-test-discover-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('returns empty array when installed_plugins.json does not exist', () => {
    const result = discoverPluginSkills(tmpBase);
    expect(result).toEqual([]);
  });

  it('returns empty array when installed_plugins.json is invalid JSON', () => {
    const pluginsDir = join(tmpBase, '.claude', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), '{{bad json');
    const result = discoverPluginSkills(tmpBase);
    expect(result).toEqual([]);
  });

  it('discovers skills from v1 format (flat object)', () => {
    // Set up a fake plugin with a skill
    const pluginInstall = join(tmpBase, 'plugins', 'test-plugin');
    const skillDir = join(pluginInstall, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: my-skill
description: A test skill
---
# Content`);

    const pluginsDir = join(tmpBase, '.claude', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
      'test-plugin@test-marketplace': { installPath: pluginInstall }
    }));

    const result = discoverPluginSkills(tmpBase);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('test-plugin/my-skill');
    expect(result[0].name).toBe('my-skill');
    expect(result[0].description).toBe('A test skill');
    expect(result[0].pluginName).toBe('test-plugin');
    expect(result[0].marketplace).toBe('test-marketplace');
  });

  it('discovers skills from v2 format (plugins wrapper with arrays)', () => {
    const pluginInstall = join(tmpBase, 'plugins', 'v2-plugin');
    const skillDir = join(pluginInstall, 'skills', 'debug');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: debug
description: Debug stuff
---
# Content`);

    const pluginsDir = join(tmpBase, '.claude', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: {
        'v2-plugin@v2-market': [{ installPath: pluginInstall, version: '1.0.0' }]
      }
    }));

    const result = discoverPluginSkills(tmpBase);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('v2-plugin/debug');
    expect(result[0].marketplace).toBe('v2-market');
  });

  it('excludes vibes plugin skills', () => {
    const vibesInstall = join(tmpBase, 'plugins', 'vibes');
    const skillDir = join(vibesInstall, 'skills', 'vibes-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: vibes-skill
---
# Content`);

    const pluginsDir = join(tmpBase, '.claude', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
      'vibes@vibes-cli': { installPath: vibesInstall }
    }));

    const result = discoverPluginSkills(tmpBase);
    expect(result).toEqual([]);
  });

  it('uses directory name as fallback when SKILL.md has no frontmatter', () => {
    const pluginInstall = join(tmpBase, 'plugins', 'bare-plugin');
    const skillDir = join(pluginInstall, 'skills', 'bare-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# No frontmatter here\nJust content.');

    const pluginsDir = join(tmpBase, '.claude', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
      'bare-plugin@market': { installPath: pluginInstall }
    }));

    const result = discoverPluginSkills(tmpBase);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bare-skill');
    expect(result[0].description).toBe('');
  });

  it('skips plugins with missing install paths', () => {
    const pluginsDir = join(tmpBase, '.claude', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
      'ghost-plugin@market': { installPath: '/nonexistent/path/12345' }
    }));

    const result = discoverPluginSkills(tmpBase);
    expect(result).toEqual([]);
  });

  it('generates compound IDs that prevent cross-plugin collisions', () => {
    // Two plugins with same skill directory name
    const plugin1 = join(tmpBase, 'plugins', 'alpha');
    const plugin2 = join(tmpBase, 'plugins', 'beta');
    for (const p of [plugin1, plugin2]) {
      const skillDir = join(p, 'skills', 'debug');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: debug\n---\n# Content`);
    }

    const pluginsDir = join(tmpBase, '.claude', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
      'alpha@market': { installPath: plugin1 },
      'beta@market': { installPath: plugin2 },
    }));

    const result = discoverPluginSkills(tmpBase);
    expect(result).toHaveLength(2);
    const ids = result.map(s => s.id);
    expect(ids).toContain('alpha/debug');
    expect(ids).toContain('beta/debug');
  });

  it('handles plugin key with no @ separator', () => {
    const pluginInstall = join(tmpBase, 'plugins', 'local');
    const skillDir = join(pluginInstall, 'skills', 'local-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: local-skill\n---\n# Content`);

    const pluginsDir = join(tmpBase, '.claude', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
      'local': { installPath: pluginInstall }
    }));

    const result = discoverPluginSkills(tmpBase);
    expect(result).toHaveLength(1);
    expect(result[0].pluginName).toBe('local');
    expect(result[0].marketplace).toBe('');
  });

  it('resolves custom skills directory from plugin.json', () => {
    const pluginInstall = join(tmpBase, 'plugins', 'custom-paths');
    const customSkillDir = join(pluginInstall, '.claude', 'skills', 'design');
    mkdirSync(customSkillDir, { recursive: true });
    writeFileSync(join(customSkillDir, 'SKILL.md'), `---\nname: design\ndescription: Design skill\n---\n# Content`);
    // Write plugin.json with custom skills path
    const pluginJsonDir = join(pluginInstall, '.claude-plugin');
    mkdirSync(pluginJsonDir, { recursive: true });
    writeFileSync(join(pluginJsonDir, 'plugin.json'), JSON.stringify({ skills: './.claude/skills' }));

    const pluginsDir = join(tmpBase, '.claude', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
      'custom-paths@market': { installPath: pluginInstall }
    }));

    const result = discoverPluginSkills(tmpBase);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('custom-paths/design');
    expect(result[0].name).toBe('design');
  });
});

// --- serveSkills route handler ---

describe('serveSkills route (via /skills endpoint)', () => {
  it('strips skillMdPath from response', async () => {
    // Dynamically import routes to get serveSkills behavior
    // We test it indirectly via handleRequest
    const { handleRequest } = await import('../../server/routes.js');

    const ctx = {
      port: 3333,
      projectRoot: '/tmp/fake',
      pluginSkills: [{
        id: 'test/skill',
        name: 'Test Skill',
        description: 'A test',
        pluginName: 'test',
        marketplace: 'market',
        skillMdPath: '/secret/path/SKILL.md',
      }],
    };

    let responseBody = '';
    let responseCode = 0;
    let responseHeaders = {};

    const req = { method: 'GET', url: '/skills' };
    const res = {
      setHeader: (k, v) => { responseHeaders[k] = v; },
      writeHead: (code, headers) => { responseCode = code; Object.assign(responseHeaders, headers || {}); },
      end: (body) => { responseBody = body; },
    };

    await handleRequest(ctx, req, res);

    expect(responseCode).toBe(200);
    const parsed = JSON.parse(responseBody);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('test/skill');
    expect(parsed[0].name).toBe('Test Skill');
    expect(parsed[0]).not.toHaveProperty('skillMdPath');
  });

  it('returns empty array when no skills', async () => {
    const { handleRequest } = await import('../../server/routes.js');

    const ctx = { port: 3333, projectRoot: '/tmp/fake', pluginSkills: [] };
    let responseBody = '';
    const req = { method: 'GET', url: '/skills' };
    const res = {
      setHeader: () => {},
      writeHead: () => {},
      end: (body) => { responseBody = body; },
    };

    await handleRequest(ctx, req, res);
    expect(JSON.parse(responseBody)).toEqual([]);
  });

  it('handles missing pluginSkills gracefully', async () => {
    const { handleRequest } = await import('../../server/routes.js');

    const ctx = { port: 3333, projectRoot: '/tmp/fake' };
    let responseBody = '';
    const req = { method: 'GET', url: '/skills' };
    const res = {
      setHeader: () => {},
      writeHead: () => {},
      end: (body) => { responseBody = body; },
    };

    await handleRequest(ctx, req, res);
    expect(JSON.parse(responseBody)).toEqual([]);
  });
});
