import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractImportMapFromHtml, extractImportMap, IMPORTMAP_REGEX } from '../../lib/extract-import-map.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '..', '..');
const PLUGIN_ROOT = join(SCRIPTS_DIR, '..');

describe('extract-import-map.js', () => {
  it('produces valid JSON matching the base template', () => {
    const result = execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result.trim());

    // Key entries exist
    expect(parsed).toHaveProperty('react');
    expect(parsed).toHaveProperty('@fireproof/core');
    expect(parsed['@fireproof/core']).toContain('?external=react,react-dom');

    // Matches the template exactly
    const templatePath = join(PLUGIN_ROOT, 'source-templates', 'base', 'template.html');
    const templateImports = extractImportMapFromHtml(readFileSync(templatePath, 'utf8'));
    expect(parsed).toEqual(templateImports);
  });

  it('module export matches CLI output', () => {
    const fnResult = extractImportMap();
    const cliResult = JSON.parse(
      execSync(`bun ${join(SCRIPTS_DIR, 'lib', 'extract-import-map.js')}`, {
        cwd: PLUGIN_ROOT,
        encoding: 'utf8',
      }).trim()
    );
    expect(fnResult).toEqual(cliResult);
  });

  it('throws on HTML without importmap', () => {
    expect(() => extractImportMapFromHtml('<html></html>')).toThrow('No <script type="importmap"> found');
  });

  it('regex handles script tags with extra attributes', () => {
    const html = '<script type="importmap" data-foo="bar">{"imports":{"react":"https://esm.sh/react"}}</script>';
    const match = html.match(IMPORTMAP_REGEX);
    expect(match).toBeTruthy();
    expect(JSON.parse(match[1]).imports).toHaveProperty('react');
  });
});

describe('sell SKILL.md', () => {
  const content = readFileSync(join(PLUGIN_ROOT, 'skills', 'sell', 'SKILL.md'), 'utf8');
  const importMapSection = content.split('## Import Map')[1]?.split('##')[0] || '';

  it('uses dynamic injection, not hardcoded URLs', () => {
    expect(content).toContain('extract-import-map.js');
    expect(importMapSection).not.toMatch(/esm\.sh\/stable\/react@[\d.]+/);
  });

  it('injection placeholder is outside code fences', () => {
    const lines = importMapSection.split('\n');
    let inFence = false;
    for (const line of lines) {
      if (line.trim().startsWith('```')) inFence = !inFence;
      if (inFence && line.includes('!`')) {
        throw new Error('!`command` found inside a code fence — Claude Code may not process it there');
      }
    }
  });
});
