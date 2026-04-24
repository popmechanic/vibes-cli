/**
 * Bun subprocess helpers — runs bun CLI scripts (assemble, deploy) as
 * short-lived child processes and returns their captured stdout/stderr.
 *
 * Kept separate from `claude-bridge.ts` so that module can focus on the
 * persistent stream-json bridge; this one has no Claude-specific logic.
 */

import { existsSync } from 'fs';

// --- Bun binary resolution ---

function resolveBunBin(): string {
  // Bun.which checks PATH
  const fromPath = Bun.which('bun');
  if (fromPath) return fromPath;
  // Common install location
  const home = process.env.HOME || '';
  const homeBun = `${home}/.bun/bin/bun`;
  if (home && existsSync(homeBun)) return homeBun;
  // Last resort — will fail with a clear error if bun truly isn't installed
  return 'bun';
}

let _cachedBunBin: string | undefined;
function getBunBin(): string {
  if (!_cachedBunBin) _cachedBunBin = resolveBunBin();
  return _cachedBunBin;
}

// --- Bun script runner ---

interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export async function runBunScript(
  script: string,
  args: string[],
  opts: SpawnOpts = {}
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: [getBunBin(), 'run', script, ...args],
    cwd: opts.cwd,
    env: (opts.env || { ...process.env }) as Record<string, string>,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout, stderr };
}
