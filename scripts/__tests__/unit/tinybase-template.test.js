import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..', '..', '..');

describe('TinyBase template', () => {
  it('base template has TinyBase import map entries', () => {
    const base = readFileSync(join(PLUGIN_ROOT, 'source-templates/base/template.html'), 'utf8');
    expect(base).toContain('"tinybase"');
    expect(base).toContain('"tinybase/mergeable-store"');
    expect(base).toContain('"tinybase/ui-react"');
    expect(base).not.toContain('"use-fireproof"');
    expect(base).not.toContain('"@fireproof/core"');
  });

  it('base template has __APP_CONFIG__ instead of __VIBES_CONFIG__', () => {
    const base = readFileSync(join(PLUGIN_ROOT, 'source-templates/base/template.html'), 'utf8');
    expect(base).toContain('__APP_CONFIG__');
    expect(base).not.toContain('__VIBES_CONFIG__');
  });

  it('vibes delta uses TinyBase hooks not Fireproof', () => {
    const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
    expect(delta).toContain('createMergeableStore');
    expect(delta).toContain('createWsSynchronizer');
    expect(delta).toContain('useApp');
    expect(delta).not.toContain('useFireproof');
    expect(delta).not.toContain('useFireproofClerk');
  });

  it('vibes delta exposes TinyBase hooks as globals', () => {
    const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
    expect(delta).toContain('window.useTable');
    expect(delta).toContain('window.useRow');
    expect(delta).toContain('window.useCell');
    expect(delta).toContain('window.useRowIds');
    expect(delta).toContain('window.useSortedRowIds');
    expect(delta).toContain('window.useAddRowCallback');
  });

  it('vibes delta has AppErrorBoundary class', () => {
    const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
    expect(delta).toContain('class AppErrorBoundary');
    expect(delta).toContain('getDerivedStateFromError');
    expect(delta).toContain('componentDidCatch');
  });

  it('vibes delta wraps App in AppErrorBoundary', () => {
    const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
    expect(delta).toContain('<AppErrorBoundary>');
    expect(delta).toContain('</AppErrorBoundary>');
  });

  it('vibes delta error boundary captures componentStack', () => {
    const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
    expect(delta).toContain('componentStack');
  });

  it('vibes delta error boundary has vibes://fix deep link', () => {
    const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
    expect(delta).toContain('vibes://fix');
  });

  it('riff delta has AppErrorBoundary wrapping App', () => {
    const delta = readFileSync(join(PLUGIN_ROOT, 'skills/riff/template.delta.html'), 'utf8');
    expect(delta).toContain('class AppErrorBoundary');
    expect(delta).toContain('<AppErrorBoundary>');
  });

  it('vibes delta has template-level isReady gate', () => {
    const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
    expect(delta).toMatch(/if\s*\(\s*!isReady\s*\)/);
  });

  it('vibes delta has useTable warning wrapper assigned to window', () => {
    const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
    expect(delta).toMatch(/window\.useTable\s*=\s*function useTableWithWarning/);
  });

  it('base template SharingBridge is not a stub', () => {
    const base = readFileSync(join(PLUGIN_ROOT, 'source-templates/base/template.html'), 'utf8');
    // Should contain the working SharingBridge, not the stub
    expect(base).toContain('SharingBridge');
    expect(base).toContain('vibes-share-request');
    expect(base).toContain('vibes-public-link-request');
    expect(base).toContain('vibes-share-success');
    expect(base).toContain('vibes-public-link-success');
    // Should NOT contain the stub comment
    expect(base).not.toContain('Stub — sharing will be redesigned');
  });

  it('vibes delta renders SharingBridge inside SignedIn', () => {
    const delta = readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');
    expect(delta).toContain('<SharingBridge />');
    // Must be inside SignedIn, before AppContext.Provider
    const sharingIdx = delta.indexOf('<SharingBridge />');
    const signedInIdx = delta.indexOf('<SignedIn>');
    const appCtxIdx = delta.indexOf('<AppContext.Provider', sharingIdx);
    expect(sharingIdx).toBeGreaterThan(signedInIdx);
    expect(sharingIdx).toBeLessThan(appCtxIdx);
  });
});
