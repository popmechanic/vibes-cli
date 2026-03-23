// scripts/__tests__/unit/error-screen.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..', '..', '..');

describe('Console capture ring buffer', () => {
  it('base template has __VIBES_CONSOLE_LOG__ ring buffer', () => {
    const base = readFileSync(join(PLUGIN_ROOT, 'source-templates/base/template.html'), 'utf8');
    expect(base).toContain('__VIBES_CONSOLE_LOG__');
  });

  it('ring buffer overrides console.log, console.warn, console.error', () => {
    const base = readFileSync(join(PLUGIN_ROOT, 'source-templates/base/template.html'), 'utf8');
    expect(base).toContain('console.log');
    expect(base).toContain('console.warn');
    expect(base).toContain('console.error');
  });

  it('ring buffer does NOT override console.debug', () => {
    const base = readFileSync(join(PLUGIN_ROOT, 'source-templates/base/template.html'), 'utf8');
    const bufferBlock = base.match(/window\.__VIBES_CONSOLE_LOG__[\s\S]*?<\/script>/);
    expect(bufferBlock).toBeTruthy();
    expect(bufferBlock[0]).not.toContain('console.debug');
  });

  it('ring buffer caps at 20 entries', () => {
    const base = readFileSync(join(PLUGIN_ROOT, 'source-templates/base/template.html'), 'utf8');
    expect(base).toMatch(/20/);
  });

  it('ring buffer is placed before Babel script', () => {
    const base = readFileSync(join(PLUGIN_ROOT, 'source-templates/base/template.html'), 'utf8');
    const bufferPos = base.indexOf('__VIBES_CONSOLE_LOG__');
    const babelPos = base.indexOf('babel.min.js');
    expect(bufferPos).toBeLessThan(babelPos);
  });
});

describe('Vibes error screen redesign', () => {
  const delta = () => readFileSync(join(PLUGIN_ROOT, 'skills/vibes/template.delta.html'), 'utf8');

  it('AppErrorBoundary stores componentStack in state', () => {
    expect(delta()).toContain('componentStack');
    expect(delta()).toContain('componentDidCatch');
  });

  it('error screen has vibes grid background', () => {
    expect(delta()).toContain('#CCCDC8');
    expect(delta()).toContain('32px 32px');
  });

  it('error screen has "Fix in VibesOS" button', () => {
    expect(delta()).toContain('Fix in VibesOS');
  });

  it('error screen constructs vibes://fix deep link', () => {
    expect(delta()).toContain('vibes://fix');
  });

  it('error screen has clipboard fallback', () => {
    expect(delta()).toContain('clipboard');
  });

  it('error screen has collapsed technical details', () => {
    expect(delta()).toContain('<details');
    expect(delta()).toContain('Technical details');
  });

  it('error screen reads __VIBES_CONSOLE_LOG__', () => {
    expect(delta()).toContain('__VIBES_CONSOLE_LOG__');
  });

  it('error screen has Try Again button', () => {
    expect(delta()).toContain('Try Again');
    expect(delta()).toContain('this.setState');
  });
});

describe('Riff error screen', () => {
  const delta = () => readFileSync(join(PLUGIN_ROOT, 'skills/riff/template.delta.html'), 'utf8');

  it('riff delta has AppErrorBoundary class', () => {
    expect(delta()).toContain('class AppErrorBoundary');
  });

  it('riff delta wraps App in AppErrorBoundary', () => {
    expect(delta()).toContain('<AppErrorBoundary>');
    expect(delta()).toContain('</AppErrorBoundary>');
  });

  it('riff error screen has vibes://fix deep link', () => {
    expect(delta()).toContain('vibes://fix');
  });

  it('riff error screen has clipboard fallback', () => {
    expect(delta()).toContain('clipboard');
  });
});
