/**
 * Tests for claude-subprocess.js utilities
 *
 * Validates CLI arg construction for spawning claude -p subprocesses,
 * including output format rules, optional flags, and environment cleaning.
 */

import { describe, it, expect } from 'vitest';
import { buildClaudeArgs, cleanEnv, TASK_PROFILES } from '../../lib/claude-subprocess.js';

describe('buildClaudeArgs', () => {
  describe('default config', () => {
    it('includes -p - for stdin piping', () => {
      const args = buildClaudeArgs();
      expect(args[0]).toBe('-p');
      expect(args[1]).toBe('-');
    });

    it('defaults to stream-json output format', () => {
      const args = buildClaudeArgs();
      const idx = args.indexOf('--output-format');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('stream-json');
    });

    it('includes --verbose for stream-json', () => {
      const args = buildClaudeArgs();
      expect(args).toContain('--verbose');
    });

    it('includes --no-session-persistence', () => {
      const args = buildClaudeArgs();
      expect(args).toContain('--no-session-persistence');
    });

    it('includes --permission-mode dontAsk', () => {
      const args = buildClaudeArgs();
      const idx = args.indexOf('--permission-mode');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('dontAsk');
    });
  });

  describe('output format and --verbose', () => {
    it('stream-json ALWAYS includes --verbose', () => {
      const args = buildClaudeArgs({ outputFormat: 'stream-json' });
      expect(args).toContain('--verbose');
      expect(args).toContain('stream-json');
    });

    it('json does NOT include --verbose', () => {
      const args = buildClaudeArgs({ outputFormat: 'json' });
      expect(args).not.toContain('--verbose');
      const idx = args.indexOf('--output-format');
      expect(args[idx + 1]).toBe('json');
    });

    it('text does NOT include --verbose', () => {
      const args = buildClaudeArgs({ outputFormat: 'text' });
      expect(args).not.toContain('--verbose');
      const idx = args.indexOf('--output-format');
      expect(args[idx + 1]).toBe('text');
    });
  });

  describe('optional flags', () => {
    it('includes --max-turns when maxTurns is provided', () => {
      const args = buildClaudeArgs({ maxTurns: 5 });
      const idx = args.indexOf('--max-turns');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('5');
    });

    it('omits --max-turns when maxTurns is not provided', () => {
      const args = buildClaudeArgs();
      expect(args).not.toContain('--max-turns');
    });

    it('includes --model when model is provided', () => {
      const args = buildClaudeArgs({ model: 'haiku' });
      const idx = args.indexOf('--model');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('haiku');
    });

    it('omits --model when model is not provided', () => {
      const args = buildClaudeArgs();
      expect(args).not.toContain('--model');
    });

    it('includes --tools when tools is provided', () => {
      const args = buildClaudeArgs({ tools: 'Write,Edit' });
      const idx = args.indexOf('--tools');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('Write,Edit');
    });

    it('adds --disable-slash-commands and --disallowed-tools when tools is provided', () => {
      const args = buildClaudeArgs({ tools: 'Write,Edit' });
      expect(args).toContain('--disable-slash-commands');
      const idx = args.indexOf('--disallowed-tools');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('ToolSearch,Skill');
    });

    it('omits --tools when tools is not provided', () => {
      const args = buildClaudeArgs();
      expect(args).not.toContain('--tools');
    });
  });

  describe('addDirs', () => {
    it('adds multiple --add-dir flags', () => {
      const args = buildClaudeArgs({ addDirs: ['/path/a', '/path/b', '/path/c'] });
      const dirIndices = args.reduce((acc, arg, i) => {
        if (arg === '--add-dir') acc.push(i);
        return acc;
      }, []);
      expect(dirIndices).toHaveLength(3);
      expect(args[dirIndices[0] + 1]).toBe('/path/a');
      expect(args[dirIndices[1] + 1]).toBe('/path/b');
      expect(args[dirIndices[2] + 1]).toBe('/path/c');
    });

    it('adds a single --add-dir flag', () => {
      const args = buildClaudeArgs({ addDirs: ['/only/one'] });
      const idx = args.indexOf('--add-dir');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('/only/one');
    });

    it('omits --add-dir when addDirs is not provided', () => {
      const args = buildClaudeArgs();
      expect(args).not.toContain('--add-dir');
    });
  });

  describe('sessionPersistence', () => {
    it('omits --no-session-persistence when sessionPersistence is true', () => {
      const args = buildClaudeArgs({ sessionPersistence: true });
      expect(args).not.toContain('--no-session-persistence');
    });

    it('includes --no-session-persistence when sessionPersistence is false', () => {
      const args = buildClaudeArgs({ sessionPersistence: false });
      expect(args).toContain('--no-session-persistence');
    });

    it('includes --no-session-persistence when sessionPersistence is omitted', () => {
      const args = buildClaudeArgs({});
      expect(args).toContain('--no-session-persistence');
    });
  });

  describe('permission mode', () => {
    it('defaults to dontAsk when permissionMode is omitted', () => {
      const args = buildClaudeArgs({});
      const idx = args.indexOf('--permission-mode');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('dontAsk');
    });

    it('uses specified permissionMode', () => {
      const args = buildClaudeArgs({ permissionMode: 'bypassPermissions' });
      const idx = args.indexOf('--permission-mode');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('bypassPermissions');
    });

    it('omits --permission-mode when permissionMode is false', () => {
      const args = buildClaudeArgs({ permissionMode: false });
      expect(args).not.toContain('--permission-mode');
    });

    it('backward compat: bypassPermissions true maps to bypassPermissions mode', () => {
      const args = buildClaudeArgs({ bypassPermissions: true });
      const idx = args.indexOf('--permission-mode');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('bypassPermissions');
    });

    it('backward compat: bypassPermissions false omits --permission-mode', () => {
      const args = buildClaudeArgs({ bypassPermissions: false });
      expect(args).not.toContain('--permission-mode');
    });
  });
});

describe('TASK_PROFILES', () => {
  it('all profiles produce valid args via buildClaudeArgs', () => {
    for (const [name, profile] of Object.entries(TASK_PROFILES)) {
      const args = buildClaudeArgs(profile);

      // Every profile must include -p - and --output-format
      expect(args).toContain('-p');
      expect(args).toContain('-');
      expect(args).toContain('--output-format');

      // stream-json profiles must have --verbose, others must not
      if (profile.outputFormat === 'stream-json') {
        expect(args, `${name} should include --verbose for stream-json`).toContain('--verbose');
      } else {
        expect(args, `${name} should not include --verbose for ${profile.outputFormat}`).not.toContain('--verbose');
      }

      // maxTurns must appear as a string when set
      if (profile.maxTurns) {
        const idx = args.indexOf('--max-turns');
        expect(idx, `${name} should include --max-turns`).toBeGreaterThan(-1);
        expect(args[idx + 1]).toBe(String(profile.maxTurns));
      }
    }
  });

  it('has at least one stream-json profile and one non-stream-json profile', () => {
    const formats = Object.values(TASK_PROFILES).map(p => p.outputFormat);
    expect(formats).toContain('stream-json');
    expect(formats.some(f => f !== 'stream-json')).toBe(true);
  });
});

describe('cleanEnv', () => {
  it('removes CLAUDECODE from environment', () => {
    const original = process.env.CLAUDECODE;
    process.env.CLAUDECODE = 'true';
    const env = cleanEnv();
    expect(env).not.toHaveProperty('CLAUDECODE');
    // Restore
    if (original !== undefined) process.env.CLAUDECODE = original;
    else delete process.env.CLAUDECODE;
  });

  it('removes CLAUDE_CODE_ENTRYPOINT from environment', () => {
    const original = process.env.CLAUDE_CODE_ENTRYPOINT;
    process.env.CLAUDE_CODE_ENTRYPOINT = '/some/path';
    const env = cleanEnv();
    expect(env).not.toHaveProperty('CLAUDE_CODE_ENTRYPOINT');
    // Restore
    if (original !== undefined) process.env.CLAUDE_CODE_ENTRYPOINT = original;
    else delete process.env.CLAUDE_CODE_ENTRYPOINT;
  });

  it('preserves other environment variables', () => {
    const original = process.env.__TEST_PRESERVE_VAR__;
    process.env.__TEST_PRESERVE_VAR__ = 'keep-me';
    const env = cleanEnv();
    expect(env.__TEST_PRESERVE_VAR__).toBe('keep-me');
    // Restore
    if (original !== undefined) process.env.__TEST_PRESERVE_VAR__ = original;
    else delete process.env.__TEST_PRESERVE_VAR__;
  });

  it('does not modify the original process.env', () => {
    process.env.CLAUDECODE = 'true';
    process.env.CLAUDE_CODE_ENTRYPOINT = '/path';
    cleanEnv();
    expect(process.env.CLAUDECODE).toBe('true');
    expect(process.env.CLAUDE_CODE_ENTRYPOINT).toBe('/path');
    // Cleanup
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
  });

  it('removes CMUX nesting vars when CMUX_SURFACE_ID is present', () => {
    process.env.CMUX_SURFACE_ID = 'surface-1';
    process.env.CMUX_PANEL_ID = 'panel-1';
    process.env.CMUX_TAB_ID = 'tab-1';
    process.env.CMUX_WORKSPACE_ID = 'ws-1';
    process.env.CMUX_SOCKET_PATH = '/tmp/cmux.sock';
    const env = cleanEnv();
    expect(env).not.toHaveProperty('CMUX_SURFACE_ID');
    expect(env).not.toHaveProperty('CMUX_PANEL_ID');
    expect(env).not.toHaveProperty('CMUX_TAB_ID');
    expect(env).not.toHaveProperty('CMUX_WORKSPACE_ID');
    expect(env).not.toHaveProperty('CMUX_SOCKET_PATH');
    // Cleanup
    delete process.env.CMUX_SURFACE_ID;
    delete process.env.CMUX_PANEL_ID;
    delete process.env.CMUX_TAB_ID;
    delete process.env.CMUX_WORKSPACE_ID;
    delete process.env.CMUX_SOCKET_PATH;
  });

  it('does not touch CMUX vars when CMUX_SURFACE_ID is absent', () => {
    delete process.env.CMUX_SURFACE_ID;
    process.env.CMUX_PANEL_ID = 'panel-stale';
    const env = cleanEnv();
    expect(env).toHaveProperty('CMUX_PANEL_ID', 'panel-stale');
    delete process.env.CMUX_PANEL_ID;
  });
});
