/**
 * Shared claude -p subprocess configuration.
 *
 * Enforces correct flag combinations (e.g. --verbose with stream-json)
 * and provides per-task default profiles.
 */

const CORE_REFS = ['generation-rules.md', 'data-api.md', 'style-guide.md'];

const EDITOR_ENVIRONMENT = `
EDITOR ENVIRONMENT CONSTRAINTS:
You are running inside the Vibes web editor.
Available tools: Read, Edit, Write, Glob, Grep. No Bash, no terminal, no Agent spawning.
Working directory is the app project root. You are editing app.jsx.
Prioritize Edit calls over analysis — turns are limited.`;

export function buildSkillAppendix(pluginRoot) {
  const loaded = [];
  for (const f of CORE_REFS) {
    const path = join(pluginRoot, 'skills/vibes/references', f);
    if (existsSync(path)) {
      loaded.push(readFileSync(path, 'utf-8'));
    } else {
      console.warn(`[skill-inject] WARNING: Core reference missing: ${path}`);
    }
  }
  if (loaded.length === 0) {
    console.error('[skill-inject] FATAL: No core reference files found. Agent will lack framework guidance.');
  }
  return [EDITOR_ENVIRONMENT, ...loaded].join('\n\n---\n\n');
}

/**
 * Write skill appendix to a temp file and return the path.
 * Uses --append-system-prompt-file instead of --append-system-prompt
 * to avoid shell argument length limits with 30KB+ payloads.
 */
let _skillAppendixPath = null;
export function writeSkillAppendixFile(pluginRoot) {
  const content = buildSkillAppendix(pluginRoot);
  if (!content) return null;
  const dir = join(tmpdir(), 'vibes-inject');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'system-prompt-appendix.md');
  writeFileSync(filePath, content, 'utf-8');
  console.log(`[skill-inject] Wrote ${(content.length / 1024).toFixed(1)}KB to ${filePath}`);
  _skillAppendixPath = filePath;
  return filePath;
}

/**
 * Per-task default configurations.
 * All tasks get unrestricted tool access (no --tools flag).
 */
export const TASK_PROFILES = {
  riffGenerate:     { outputFormat: 'json', maxTurns: 1 },
};

/**
 * Build CLI args array for `claude -p`.
 *
 * Enforces:
 * - `--verbose` when outputFormat is `stream-json` (required by Claude CLI)
 * - `--no-session-persistence` by default (opt out with sessionPersistence: true)
 * - `--permission-mode dontAsk` by default (override with permissionMode: 'bypassPermissions')
 * - `-p -` always present (stdin piping)
 *
 * @param {object} config
 * @param {string} [config.outputFormat='stream-json'] - 'stream-json' | 'json' | 'text'
 * @param {number} [config.maxTurns] - --max-turns value
 * @param {string} [config.model] - --model value (e.g. 'haiku', 'sonnet')
 * @param {string[]} [config.addDirs] - additional --add-dir paths
 * @param {string} [config.tools] - --tools value restricting available built-in tools (omit for all)
 * @param {boolean} [config.sessionPersistence=false] - set true to allow session persistence
 * @param {string|false} [config.permissionMode='dontAsk'] - permission mode string, or false to omit flag
 * @param {boolean} [config.bypassPermissions] - deprecated: use permissionMode instead
 * @returns {string[]} CLI args array
 */
export function buildClaudeArgs(config = {}) {
  const args = ['-p', '-'];

  const format = config.outputFormat || 'stream-json';
  args.push('--output-format', format);

  // --verbose is required when using stream-json output
  // --include-partial-messages gives granular events during thinking
  if (format === 'stream-json') {
    args.push('--verbose', '--include-partial-messages');
  }

  if (config.tools) {
    args.push('--tools', config.tools);
    // When restricting built-in tools, also block plugin tools from hijacking
    args.push('--disable-slash-commands');
    args.push('--disallowed-tools', 'ToolSearch,Skill');
  }

  if (config.maxTurns) {
    args.push('--max-turns', String(config.maxTurns));
  }

  if (config.model) {
    args.push('--model', config.model);
  }

  if (config.pluginRoot) {
    const filePath = writeSkillAppendixFile(config.pluginRoot);
    if (filePath) {
      args.push('--append-system-prompt-file', filePath);
    }
  }

  if (config.addDirs) {
    for (const dir of config.addDirs) {
      args.push('--add-dir', dir);
    }
  }

  if (config.sessionPersistence !== true) {
    args.push('--no-session-persistence');
  }

  // Permission mode: when --tools restricts available tools, default to
  // bypassPermissions since the tool set is already explicitly scoped.
  // Otherwise default to dontAsk (auto-deny unallowed tools).
  // Pass permissionMode: false to omit the flag entirely.
  const mode = config.permissionMode !== undefined
    ? config.permissionMode
    : (config.tools ? 'bypassPermissions' : 'dontAsk');
  if (mode) {
    args.push('--permission-mode', mode);
  }

  return args;
}

/**
 * Build CLI args for a persistent bidirectional claude session.
 *
 * Unlike buildClaudeArgs (one-shot `-p -`), this uses stream-json for
 * both input and output, keeps stdin open for multi-turn conversation,
 * and has no max-turns or session-persistence restrictions.
 *
 * @param {object} [config]
 * @param {string} [config.model] - --model value (e.g. 'haiku', 'sonnet')
 * @returns {string[]} CLI args array
 */
export function buildPersistentArgs(config = {}) {
  const args = ['-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--verbose',
  ];
  if (config.model) args.push('--model', config.model);
  if (config.pluginRoot) {
    const filePath = writeSkillAppendixFile(config.pluginRoot);
    if (filePath) {
      args.push('--append-system-prompt-file', filePath);
    }
  }
  // No --tools restriction, no --max-turns, no --no-session-persistence
  return args;
}

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Resolve the full path to the claude binary.
 *
 * Priority:
 * 1. CLAUDE_BIN env var (set by desktop app to ~/.vibes/bin/claude)
 * 2. ~/.vibes/bin/claude (our managed installation)
 * 3. Shell/system fallbacks (for CLI-mode development only)
 *
 * Never returns bare "claude" — always an explicit path to prevent
 * accidentally invoking the user's own Claude installation.
 */
let _cachedClaudeBin;
export function resolveClaudeBin() {
  if (_cachedClaudeBin) return _cachedClaudeBin;

  // Desktop app sets this to the managed binary path
  if (process.env.CLAUDE_BIN) { _cachedClaudeBin = process.env.CLAUDE_BIN; return _cachedClaudeBin; }

  const home = process.env.HOME || '';

  // Check our managed installation first
  const vibesBin = `${home}/.vibes/bin/claude`;
  if (existsSync(vibesBin)) { _cachedClaudeBin = vibesBin; return vibesBin; }

  // Fallback for CLI development (not desktop): try login shell and system paths
  for (const flags of ['-lic', '-lc', '-ic']) {
    try {
      const r = spawnSync('zsh', [flags, 'which claude'], { timeout: 5000 });
      const p = r.stdout?.toString().trim();
      if (p && r.status === 0 && !p.includes('not found') && existsSync(p)) {
        _cachedClaudeBin = p; return p;
      }
    } catch {}
  }

  for (const p of [
    `${home}/.claude/local/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    `${home}/.local/bin/claude`,
    `${home}/.npm-global/bin/claude`,
  ]) {
    if (existsSync(p)) { _cachedClaudeBin = p; return p; }
  }

  // Last resort — throw rather than returning bare "claude" which could
  // resolve to the user's own installation via PATH
  throw new Error(
    'Claude binary not found. Expected at ~/.vibes/bin/claude. ' +
    'Run the VibesOS desktop app to install, or set CLAUDE_BIN env var.'
  );
}

/**
 * Clean environment for spawning claude subprocesses.
 * Removes nesting guard variables that prevent claude from running inside itself.
 */
export function cleanEnv() {
  const env = { ...process.env };
  // Override nesting guard to empty string — delete may not prevent
  // Bun.spawn() from re-inheriting from the parent process env.
  // See: https://github.com/anthropics/claude-agent-sdk-python/issues/573
  env.CLAUDECODE = '';
  env.CLAUDE_CODE_ENTRYPOINT = '';
  // cmux terminal sets CMUX_* vars that trigger nesting detection.
  // These are terminal-state identifiers, not auth tokens — safe to remove.
  env.CMUX_SURFACE_ID = '';
  env.CMUX_PANEL_ID = '';
  env.CMUX_TAB_ID = '';
  env.CMUX_WORKSPACE_ID = '';
  env.CMUX_SOCKET_PATH = '';
  // Isolate credentials to ~/.vibes/claude-config/ so the vibes-managed
  // binary never reads/writes the user's own ~/.claude/ config.
  env.CLAUDE_CONFIG_DIR = join(homedir(), '.vibes', 'claude-config');
  // Raise the output-token floor for generation. Vibes apps are typically
  // produced in a single Write tool call; a 4000-line JSX file easily exceeds
  // the model default (16K Sonnet / 32K Opus 4.6). Respect a higher user value.
  const userMaxTokens = parseInt(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || '0', 10);
  if (!Number.isFinite(userMaxTokens) || userMaxTokens < 64000) {
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '64000';
  }
  return env;
}
