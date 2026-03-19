import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
