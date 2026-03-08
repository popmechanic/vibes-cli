/**
 * Shared claude -p subprocess configuration.
 *
 * Enforces correct flag combinations (e.g. --verbose with stream-json)
 * and provides per-task default profiles.
 */

/**
 * Per-task default configurations.
 * All tasks get unrestricted tool access (no --tools flag).
 */
export const TASK_PROFILES = {
  chatEdit:         { outputFormat: 'stream-json', maxTurns: 8 },
  chatEditAnimated: { outputFormat: 'stream-json', maxTurns: 12 },
  themeCreative:    { outputFormat: 'stream-json', maxTurns: 5 },
  themeLegacy:      { outputFormat: 'stream-json', maxTurns: 8 },
  generate:         { outputFormat: 'stream-json', maxTurns: 5 },
  themeExtract:     { outputFormat: 'stream-json', maxTurns: 5, timeoutMs: 120_000 },
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
    : (config.bypassPermissions === true ? 'bypassPermissions'
       : config.bypassPermissions === false ? false
       : config.tools ? 'bypassPermissions'
       : 'dontAsk');
  if (mode) {
    args.push('--permission-mode', mode);
  }

  return args;
}

/**
 * Clean environment for spawning claude subprocesses.
 * Removes nesting guard variables that prevent claude from running inside itself.
 */
export function cleanEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // cmux terminal sets CMUX_* vars that trigger nesting detection.
  // These are terminal-state identifiers, not auth tokens — safe to remove.
  if (env.CMUX_SURFACE_ID) {
    delete env.CMUX_SURFACE_ID;
    delete env.CMUX_PANEL_ID;
    delete env.CMUX_TAB_ID;
    delete env.CMUX_WORKSPACE_ID;
    delete env.CMUX_SOCKET_PATH;
  }
  return env;
}
