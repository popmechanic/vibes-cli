/**
 * Shared claude -p subprocess configuration.
 *
 * Enforces correct flag combinations (e.g. --verbose with stream-json)
 * and provides per-task default profiles.
 */

/**
 * Per-task default configurations.
 * All tasks get unrestricted tool access (no --allowedTools flag).
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
 * - `--permission-mode bypassPermissions` by default (opt out with bypassPermissions: false)
 * - `-p -` always present (stdin piping)
 *
 * @param {object} config
 * @param {string} [config.outputFormat='stream-json'] - 'stream-json' | 'json' | 'text'
 * @param {number} [config.maxTurns] - --max-turns value
 * @param {string} [config.model] - --model value (e.g. 'haiku', 'sonnet')
 * @param {string[]} [config.addDirs] - additional --add-dir paths
 * @param {string} [config.tools] - --allowedTools value (omit for unrestricted)
 * @param {boolean} [config.sessionPersistence=false] - set true to allow session persistence
 * @param {boolean} [config.bypassPermissions=true] - set false to use default permission mode
 * @returns {string[]} CLI args array
 */
export function buildClaudeArgs(config = {}) {
  const args = ['-p', '-'];

  const format = config.outputFormat || 'stream-json';
  args.push('--output-format', format);

  // --verbose is required when using stream-json output
  if (format === 'stream-json') {
    args.push('--verbose');
  }

  if (config.tools) {
    args.push('--allowedTools', config.tools);
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

  if (config.bypassPermissions !== false) {
    args.push('--permission-mode', 'bypassPermissions');
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
  return env;
}
