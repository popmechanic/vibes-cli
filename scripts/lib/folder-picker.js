import { execFile } from 'child_process';

/**
 * Open a native OS folder picker dialog.
 *
 * @returns {Promise<string|null>} Absolute path to the selected folder, or null if cancelled.
 * @throws {Error} On non-macOS platforms (not yet supported).
 */
export async function pickFolder() {
  if (process.platform !== 'darwin') {
    throw new Error(
      `Native folder picker is not supported on platform: ${process.platform}. Only macOS (darwin) is currently supported.`
    );
  }

  // Focus the currently-frontmost app before showing the picker so the
  // dialog surfaces above the calling window (Electrobun desktop or
  // browser) instead of opening behind it.
  const script = [
    'tell application (path to frontmost application as text) to activate',
    'POSIX path of (choose folder with prompt "Choose a project folder")',
  ].join('\n');

  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-e', script],
      { timeout: 120_000 },
      (err, stdout) => {
        if (err) {
          resolve(null); // User cancelled or error
          return;
        }
        const result = stdout.toString().trim().replace(/\/$/, '');
        resolve(result || null);
      }
    );
  });
}
