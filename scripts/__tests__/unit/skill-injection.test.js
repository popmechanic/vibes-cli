import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseSkillFrontmatter } from '../../server/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '..', '..');
const PLUGIN_ROOT = join(SCRIPTS_DIR, '..');

describe('extract-import-map.js', () => {
  it('exits with code 0', () => {
    const result = execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
    expect(result).toBeTruthy();
  });

  it('produces valid JSON', () => {
    const result = execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result.trim());
    expect(parsed).toBeDefined();
  });

  it('contains the authoritative import map entries', () => {
    const result = execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result.trim());

    // Verify key entries exist
    expect(parsed).toHaveProperty('react');
    expect(parsed).toHaveProperty('react-dom');
    expect(parsed).toHaveProperty('@fireproof/core');
    expect(parsed).toHaveProperty('oauth4webapi');
    expect(parsed).toHaveProperty('use-fireproof');

    // Verify React entries use ?external pattern for Fireproof
    expect(parsed['@fireproof/core']).toContain('?external=react,react-dom');
  });

  it('matches the base template import map exactly', () => {
    // Read import map from base template directly
    const templatePath = join(PLUGIN_ROOT, 'source-templates', 'base', 'template.html');
    const templateHtml = readFileSync(templatePath, 'utf8');
    const match = templateHtml.match(/<script\s+type="importmap">\s*([\s\S]*?)\s*<\/script>/);
    expect(match).toBeTruthy();
    const templateImports = JSON.parse(match[1]).imports;

    // Get output from the extraction script
    const result = execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
    const scriptImports = JSON.parse(result.trim());

    // They must be identical
    expect(scriptImports).toEqual(templateImports);
  });

  it('completes in under 500ms', () => {
    const start = performance.now();
    execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

describe('sell SKILL.md import map consistency', () => {
  it('uses dynamic injection instead of hardcoded import map', () => {
    const skillPath = join(PLUGIN_ROOT, 'skills', 'sell', 'SKILL.md');
    const content = readFileSync(skillPath, 'utf8');

    // Should contain the !`command` injection placeholder
    expect(content).toContain('!`');
    expect(content).toContain('extract-import-map.js');

    // Should NOT contain hardcoded version strings from the import map
    // (Version strings in prose text like "React 19" are fine;
    //  hardcoded esm.sh URLs in the import map section are not)
    const importMapSection = content.split('## Import Map')[1]?.split('##')[0] || '';
    expect(importMapSection).not.toMatch(/esm\.sh\/stable\/react@[\d.]+/);
  });
});

const ALL_SKILLS = ['vibes', 'cloudflare', 'sell', 'launch', 'test', 'upload-dmg', 'design', 'riff'];

describe('SKILL.md frontmatter integrity', () => {
  for (const skill of ALL_SKILLS) {
    it(`${skill}/SKILL.md has valid frontmatter with name field`, () => {
      const skillPath = join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md');
      const content = readFileSync(skillPath, 'utf8');
      const frontmatter = parseSkillFrontmatter(content);
      expect(frontmatter.name).toBe(skill);
    });

    it(`${skill}/SKILL.md has a non-empty description`, () => {
      const skillPath = join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md');
      const content = readFileSync(skillPath, 'utf8');
      const frontmatter = parseSkillFrontmatter(content);
      expect(frontmatter.description).toBeTruthy();
      expect(frontmatter.description.length).toBeGreaterThan(10);
    });
  }
});
