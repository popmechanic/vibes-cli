/**
 * Process lifecycle utilities — port management and graceful takeover.
 * Bun-native version using Bun.spawn instead of execSync.
 */

/**
 * Kill any existing process on the given port (except ourselves).
 * @returns true if a process was killed
 */
export async function killProcessOnPort(port: number): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: ['lsof', '-ti', `:${port}`],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const pids = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    if (pids) {
      for (const pid of pids.split('\n')) {
        const pidNum = parseInt(pid);
        if (pidNum && pidNum !== process.pid) {
          process.kill(pidNum, 'SIGTERM');
        }
      }
      return true;
    }
  } catch {
    // lsof returns non-zero when no process found — that's fine
  }
  return false;
}

/**
 * Wait for a port to become free.
 */
export async function waitForPort(port: number, attempts = 10): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const proc = Bun.spawn({
        cmd: ['lsof', '-ti', `:${port}`],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const pids = (await new Response(proc.stdout).text()).trim();
      await proc.exited;
      if (!pids) return; // port is free
    } catch {
      return; // lsof error = no process = port is free
    }
    await Bun.sleep(300);
  }
  throw new Error(`Port ${port} still in use after ${attempts} attempts`);
}
