import { describe, it, expect, vi } from 'vitest';
import { join } from 'path';

describe('buildSkillAppendix', () => {
  // Import will fail until Task 6 implements it — that's expected
  it('reads all three core reference files and concatenates them', async () => {
    const { buildSkillAppendix } = await import('../../lib/claude-subprocess.js');
    const pluginRoot = join(__dirname, '..', '..', '..');
    const result = buildSkillAppendix(pluginRoot);

    expect(result).toContain('EDITOR ENVIRONMENT CONSTRAINTS');
    expect(result).toContain('Generation Rules');
    expect(result).toContain('useRowIds');
    expect(result).toMatch(/oklch/i);
  });

  it('warns when a core reference file is missing', async () => {
    const { buildSkillAppendix } = await import('../../lib/claude-subprocess.js');
    const spy = vi.spyOn(console, 'warn');
    buildSkillAppendix('/nonexistent/path');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('WARNING: Core reference missing'));
    spy.mockRestore();
  });

  it('logs FATAL when no core files found', async () => {
    const { buildSkillAppendix } = await import('../../lib/claude-subprocess.js');
    const spy = vi.spyOn(console, 'error');
    buildSkillAppendix('/nonexistent/path');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('FATAL'));
    spy.mockRestore();
  });
});
