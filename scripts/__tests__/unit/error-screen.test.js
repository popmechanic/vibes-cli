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
