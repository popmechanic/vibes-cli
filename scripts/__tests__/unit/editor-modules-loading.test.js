/**
 * Structural tests verifying all editor modules exist and export expected interfaces.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const MODULES_DIR = resolve(__dirname, '../../../skills/vibes/modules');

const MODULES = {
  'editor-color-utils.js': ['hexToRgb', 'rgbToHex', 'hexToOklch', 'oklchToHex', 'contrastRatio', 'generateHarmony'],
  'editor-animations.js': ['init', 'load', 'open', 'close', 'select', 'clear', 'getActiveId'],
  'editor-skills.js': ['init', 'load', 'open', 'close', 'toggle', 'select', 'clear', 'getActiveId'],
  'editor-reference.js': ['init', 'pick', 'handleFile', 'clear', 'getFile', 'setFile'],
  'editor-imggen.js': ['init', 'initContext', 'toggle', 'close', 'generate', 'onResult', 'accept'],
  'editor-themes.js': ['init', 'open', 'close', 'select', 'reload', 'openPalette', 'closePalette', 'savePalette'],
};

describe('Editor module files', () => {
  for (const [file, expectedExports] of Object.entries(MODULES)) {
    describe(file, () => {
      const filePath = resolve(MODULES_DIR, file);

      it('exists', () => {
        expect(existsSync(filePath)).toBe(true);
      });

      it('is a valid IIFE', () => {
        const src = readFileSync(filePath, 'utf-8');
        // Allow an optional leading JSDoc comment block before the IIFE
        expect(src.trim()).toMatch(/^(\/\*[\s\S]*?\*\/)?\s*\(function\(\)/);
        expect(src.trim()).toMatch(/\}\)\(\);?\s*$/);
      });

      it(`exports ${expectedExports.join(', ')}`, () => {
        const src = readFileSync(filePath, 'utf-8');
        for (const name of expectedExports) {
          expect(src).toContain(name);
        }
      });

      it('registers on window.*', () => {
        const src = readFileSync(filePath, 'utf-8');
        expect(src).toMatch(/window\.Editor\w+\s*=/);
      });
    });
  }
});

describe('editor.html loads all modules', () => {
  it('has script src tags for all modules', () => {
    const html = readFileSync(
      resolve(__dirname, '../../../skills/vibes/templates/editor.html'),
      'utf-8'
    );
    for (const file of Object.keys(MODULES)) {
      expect(html).toContain(`/editor/modules/${file}`);
    }
  });

  it('has window.escapeHtml registered before modules', () => {
    const html = readFileSync(
      resolve(__dirname, '../../../skills/vibes/templates/editor.html'),
      'utf-8'
    );
    const escapePos = html.indexOf('window.escapeHtml');
    const firstModulePos = html.indexOf('/editor/modules/');
    expect(escapePos).toBeLessThan(firstModulePos);
  });
});
