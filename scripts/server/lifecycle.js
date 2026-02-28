/**
 * Process lifecycle utilities — port management and graceful takeover.
 */

import { execSync } from 'child_process';

/**
 * Kill any existing process on the given port (except ourselves).
 * @returns {boolean} true if a process was killed
 */
export function killProcessOnPort(port) {
  try {
    const pids = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
    if (pids) {
      for (const pid of pids.split('\n')) {
        if (pid && parseInt(pid) !== process.pid) {
          process.kill(parseInt(pid), 'SIGTERM');
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
export function waitForPort(port, attempts = 10) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    function check() {
      try {
        const pids = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
        if (pids) {
          tries++;
          if (tries >= attempts) {
            reject(new Error(`Port ${port} still in use after ${attempts} attempts`));
          } else {
            setTimeout(check, 300);
          }
        } else {
          resolve();
        }
      } catch {
        resolve(); // no process found — port is free
      }
    }
    check();
  });
}
