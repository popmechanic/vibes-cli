/**
 * Structural tests for the fireproof-oidc-bridge module.
 *
 * Validates that the bridge exports the required symbols and that
 * generated templates contain the supporting import map entries.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const BRIDGE_PATH = resolve(ROOT, 'bundles/fireproof-oidc-bridge.js');
const BASE_TEMPLATE_PATH = resolve(ROOT, 'source-templates/base/template.html');

const bridgeSource = readFileSync(BRIDGE_PATH, 'utf8');
const baseTemplate = readFileSync(BASE_TEMPLATE_PATH, 'utf8');

describe('fireproof-oidc-bridge exports', () => {
  it('exports useFireproofOIDC function', () => {
    expect(bridgeSource).toContain('export function useFireproofOIDC');
  });

  it('exports useFireproofClerk as backward-compat alias', () => {
    expect(bridgeSource).toContain('useFireproofOIDC as useFireproofClerk');
  });

  it('exports useFireproof (re-exported from @fireproof/core)', () => {
    expect(bridgeSource).toMatch(/export\s*\{.*useFireproof.*\}\s*from\s*"@fireproof\/core"/);
  });

  it('exports OIDCProvider component', () => {
    expect(bridgeSource).toContain('export function OIDCProvider');
  });

  it('exports SignedIn component', () => {
    expect(bridgeSource).toContain('export function SignedIn');
  });

  it('exports SignedOut component', () => {
    expect(bridgeSource).toContain('export function SignedOut');
  });

  it('exports SignInButton component', () => {
    expect(bridgeSource).toContain('export function SignInButton');
  });

  it('exports UserButton component', () => {
    expect(bridgeSource).toContain('export function UserButton');
  });

  it('exports useUser hook', () => {
    expect(bridgeSource).toContain('export function useUser');
  });

  it('exports useOIDCContext hook', () => {
    expect(bridgeSource).toContain('export function useOIDCContext');
  });

  it('imports from @fireproof/core (not use-fireproof-core)', () => {
    expect(bridgeSource).toContain('from "@fireproof/core"');
  });

  it('does not re-export from @fireproof/clerk (legacy)', () => {
    expect(bridgeSource).not.toContain('from "@fireproof/clerk"');
  });
});

describe('import map entries', () => {
  it('maps use-fireproof to the OIDC bridge module', () => {
    expect(baseTemplate).toContain('"use-fireproof": "/fireproof-oidc-bridge.js"');
  });

  it('has @fireproof/core entry pointing to esm.sh', () => {
    expect(baseTemplate).toMatch(/"@fireproof\/core":\s*"https:\/\/esm\.sh\/stable\/use-fireproof@/);
  });

  it('uses ?external=react,react-dom on @fireproof/core', () => {
    const match = baseTemplate.match(/"@fireproof\/core":\s*"([^"]+)"/);
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

    it(`${name} template has @fireproof/core entry`, () => {
      const html = readFileSync(resolve(ROOT, relPath), 'utf8');
      expect(html).toContain('@fireproof/core');
    });

    it(`${name} template maps use-fireproof to OIDC bridge`, () => {
      const html = readFileSync(resolve(ROOT, relPath), 'utf8');
      expect(html).toContain('"use-fireproof": "/fireproof-oidc-bridge.js"');
    });
  }
});
