/**
 * Structural tests for the fireproof-vibes-bridge module.
 *
 * Validates that the bridge exports the required symbols and that
 * generated templates contain the supporting import map entries.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const BRIDGE_PATH = resolve(ROOT, 'bundles/fireproof-vibes-bridge.js');
const BASE_TEMPLATE_PATH = resolve(ROOT, 'source-templates/base/template.html');

const bridgeSource = readFileSync(BRIDGE_PATH, 'utf8');
const baseTemplate = readFileSync(BASE_TEMPLATE_PATH, 'utf8');

describe('fireproof-vibes-bridge exports', () => {
  it('exports useFireproofClerk function', () => {
    expect(bridgeSource).toContain('export function useFireproofClerk');
  });

  it('exports useFireproof function (local-only fallback)', () => {
    expect(bridgeSource).toContain('export function useFireproof');
  });

  it('imports from use-fireproof-core to avoid circular resolution', () => {
    expect(bridgeSource).toContain('from "use-fireproof-core"');
  });

  it('re-exports all @fireproof/clerk symbols', () => {
    expect(bridgeSource).toContain('export * from "@fireproof/clerk"');
  });
});

describe('import map entries', () => {
  it('maps use-fireproof to the bridge module', () => {
    expect(baseTemplate).toContain('"use-fireproof": "/fireproof-vibes-bridge.js"');
  });

  it('has use-fireproof-core entry pointing to esm.sh', () => {
    expect(baseTemplate).toMatch(/"use-fireproof-core":\s*"https:\/\/esm\.sh\/stable\/use-fireproof@/);
  });

  it('uses ?external=react,react-dom on use-fireproof-core', () => {
    const match = baseTemplate.match(/"use-fireproof-core":\s*"([^"]+)"/);
    expect(match).toBeTruthy();
    expect(match[1]).toContain('?external=react,react-dom');
  });
});

describe('generated templates contain import map entries', () => {
  const templatePaths = [
    'skills/vibes/templates/index.html',
    'skills/riff/templates/index.html',
    'skills/sell/templates/unified.html',
  ];

  for (const relPath of templatePaths) {
    const name = relPath.split('/')[1]; // vibes, riff, sell

    it(`${name} template has use-fireproof-core entry`, () => {
      const html = readFileSync(resolve(ROOT, relPath), 'utf8');
      expect(html).toContain('use-fireproof-core');
    });

    it(`${name} template maps use-fireproof to bridge`, () => {
      const html = readFileSync(resolve(ROOT, relPath), 'utf8');
      expect(html).toContain('"use-fireproof": "/fireproof-vibes-bridge.js"');
    });

    it(`${name} template initApp imports through bridge, not raw @fireproof/clerk`, () => {
      const html = readFileSync(resolve(ROOT, relPath), 'utf8');
      expect(html).toContain('await import("use-fireproof")');
      expect(html).not.toContain('await import("@fireproof/clerk")');
    });

    it(`${name} template does not contain duplicate sync wrapper code`, () => {
      const html = readFileSync(resolve(ROOT, relPath), 'utf8');
      // The bridge handles onTock kick — templates should not duplicate it
      expect(html).not.toContain('noPayloadWatchers');
    });
  }
});
