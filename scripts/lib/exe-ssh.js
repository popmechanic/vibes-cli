/**
 * SSH automation library for exe.dev deployment
 *
 * Provides helpers for connecting to exe.dev VMs, running commands,
 * and uploading files via SCP.
 *
 * IMPORTANT: exe.dev VMs
 * - Home directory is /home/exedev (not ~ expansion)
 * - Use explicit paths or /tmp for staging files
 * - Default user is 'exedev'
 */

import { Client } from 'ssh2';

/**
 * Host key verifier that auto-accepts exe.dev domains
 * Mimics StrictHostKeyChecking=accept-new behavior for trusted domains
 * @param {string} host - Hostname being connected to
 * @returns {function} Verifier function for ssh2 Client
 */
function createHostVerifier(host) {
  // Auto-accept host keys for exe.dev domains (trusted)
  if (host === 'exe.dev' || host.endsWith('.exe.xyz') || host.endsWith('.exe.dev')) {
    return () => true;
  }
  // For other hosts, use default verification (will reject unknown)
  return undefined;
}

// exe.dev VM constants
export const EXE_HOME_DIR = '/home/exedev';
export const EXE_DEFAULT_USER = 'exedev';
import { readFileSync, createReadStream, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Find the user's SSH private key
 * @returns {string|null} Path to private key or null if not found
 */
export function findSSHKey() {
  const sshDir = join(homedir(), '.ssh');
  const keyNames = ['id_ed25519', 'id_rsa', 'id_ecdsa'];

  for (const name of keyNames) {
    const keyPath = join(sshDir, name);
    try {
      statSync(keyPath);
      return keyPath;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Create an SSH connection to a host
 * @param {string} host - Hostname to connect to
 * @param {object} [options] - Connection options
 * @param {string} [options.username] - SSH username (default: current user)
 * @param {string} [options.privateKeyPath] - Path to private key
 * @returns {Promise<Client>} Connected SSH client
 */
export function connect(host, options = {}) {
  return new Promise((resolve, reject) => {
    const client = new Client();

    const privateKeyPath = options.privateKeyPath || findSSHKey();
    if (!privateKeyPath) {
      reject(new Error('No SSH key found. Please ensure you have an SSH key in ~/.ssh/'));
      return;
    }

    const config = {
      host,
      port: 22,
      username: options.username || process.env.USER || 'user',
      privateKey: readFileSync(privateKeyPath),
      hostVerifier: createHostVerifier(host)
    };

    client.on('ready', () => resolve(client));
    client.on('error', reject);
    client.connect(config);
  });
}

/**
 * Run a command on an SSH connection
 * @param {Client} client - Connected SSH client
 * @param {string} command - Command to execute
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
export function runCommand(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      let stdout = '';
      let stderr = '';

      stream.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });

      stream.on('data', (data) => {
        stdout += data.toString();
      });

      stream.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    });
  });
}

/**
 * Create an error with a code for programmatic handling
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @returns {Error}
 */
function createError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Run an interactive session with the exe.dev CLI
 * This handles the interactive prompts from `ssh exe.dev`
 * @param {string} command - Command to run (e.g., 'new myvm')
 * @param {object} [options] - Options
 * @param {number} [options.timeout] - Timeout in ms (default: 30000)
 * @returns {Promise<string>} Command output
 * @throws {Error} With code property: NO_SSH_KEY, CONNECTION_REFUSED, TIMEOUT, AUTH_FAILED, SSH_ERROR
 */
export function runExeCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timeout = options.timeout || 30000;

    const privateKeyPath = findSSHKey();
    if (!privateKeyPath) {
      reject(createError('No SSH key found. Create one with: ssh-keygen -t ed25519', 'NO_SSH_KEY'));
      return;
    }

    let output = '';
    let timeoutId;
    let resolved = false;

    const config = {
      host: 'exe.dev',
      port: 22,
      username: process.env.USER || 'user',
      privateKey: readFileSync(privateKeyPath),
      hostVerifier: createHostVerifier('exe.dev')
    };

    client.on('ready', () => {
      // exe.dev uses a shell session for its CLI
      client.shell((err, stream) => {
        if (err) {
          client.end();
          reject(createError(`SSH shell failed: ${err.message}`, 'SSH_ERROR'));
          return;
        }

        timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            stream.end();
            client.end();
            reject(createError(`Command timed out after ${timeout / 1000}s. Check network or try: ssh exe.dev`, 'TIMEOUT'));
          }
        }, timeout);

        stream.on('close', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            client.end();
            resolve(output);
          }
        });

        stream.on('data', (data) => {
          output += data.toString();

          // Look for the prompt indicating command completion
          // exe.dev CLI typically returns to prompt after command
          if (output.includes('exe>') && output.includes(command)) {
            setTimeout(() => {
              stream.write('exit\n');
            }, 500);
          }
        });

        // Send the command
        stream.write(command + '\n');
      });
    });

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);

        // Map common SSH errors to user-friendly messages
        let message = err.message;
        let code = 'SSH_ERROR';

        if (err.message.includes('ECONNREFUSED')) {
          message = 'Connection refused. Is exe.dev reachable?';
          code = 'CONNECTION_REFUSED';
        } else if (err.message.includes('ETIMEDOUT')) {
          message = 'Connection timed out. Check your network.';
          code = 'CONNECTION_TIMEOUT';
        } else if (err.message.includes('authentication') || err.message.includes('publickey')) {
          message = 'SSH authentication failed. Run: ssh exe.dev';
          code = 'AUTH_FAILED';
        }

        reject(createError(message, code));
      }
    });

    client.connect(config);
  });
}

/**
 * Upload a file via SCP
 * @param {string} localPath - Local file path
 * @param {string} host - Remote hostname
 * @param {string} remotePath - Remote file path
 * @param {object} [options] - Options
 * @returns {Promise<void>}
 */
export function uploadFile(localPath, host, remotePath, options = {}) {
  return new Promise((resolve, reject) => {
    const client = new Client();

    const privateKeyPath = options.privateKeyPath || findSSHKey();
    if (!privateKeyPath) {
      reject(new Error('No SSH key found'));
      return;
    }

    const config = {
      host,
      port: 22,
      username: options.username || process.env.USER || 'user',
      privateKey: readFileSync(privateKeyPath),
      hostVerifier: createHostVerifier(host)
    };

    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) {
          client.end();
          reject(err);
          return;
        }

        const readStream = createReadStream(localPath);
        const writeStream = sftp.createWriteStream(remotePath);

        writeStream.on('close', () => {
          client.end();
          resolve();
        });

        writeStream.on('error', (err) => {
          client.end();
          reject(err);
        });

        readStream.pipe(writeStream);
      });
    });

    client.on('error', reject);
    client.connect(config);
  });
}

/**
 * Upload a file via SCP to a privileged location (uses temp + sudo)
 * @param {string} localPath - Local file path
 * @param {string} host - Remote hostname
 * @param {string} remotePath - Remote file path (e.g., /var/www/html/index.html)
 * @param {object} [options] - Options
 * @returns {Promise<void>}
 */
export async function uploadFileWithSudo(localPath, host, remotePath, options = {}) {
  const filename = require('path').basename(localPath);
  const tempPath = `/home/exedev/${filename}`;

  // Upload to home directory first (guaranteed writable)
  await uploadFile(localPath, host, tempPath, options);

  // Move to final location with sudo (requires SSH connection)
  const client = await connect(host, options);
  try {
    await runCommand(client, `sudo cp ${tempPath} ${remotePath} && sudo chown www-data:www-data ${remotePath} && rm ${tempPath}`);
  } finally {
    client.end();
  }
}

/**
 * Test SSH connectivity to exe.dev
 * Simply verifies we can establish an SSH connection, without relying on
 * the exe.dev CLI's interactive shell output (which is fragile).
 * @returns {Promise<boolean>} True if connection successful
 */
export async function testConnection() {
  return new Promise((resolve) => {
    const privateKeyPath = findSSHKey();
    if (!privateKeyPath) {
      resolve(false);
      return;
    }

    const client = new Client();
    const timeout = setTimeout(() => {
      client.end();
      resolve(false);
    }, 10000);

    client.on('ready', () => {
      clearTimeout(timeout);
      client.end();
      resolve(true);
    });

    client.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });

    client.connect({
      host: 'exe.dev',
      port: 22,
      username: process.env.USER || 'user',
      privateKey: readFileSync(privateKeyPath),
      hostVerifier: createHostVerifier('exe.dev')
    });
  });
}

/**
 * Create a new VM on exe.dev
 * @param {string} vmName - Name for the new VM
 * @returns {Promise<{success: boolean, message: string, code?: string}>}
 */
export async function createVM(vmName) {
  try {
    const output = await runExeCommand(`new ${vmName}`, { timeout: 60000 });
    const lowerOutput = output.toLowerCase();

    // Success patterns
    if (lowerOutput.includes('created') || lowerOutput.includes('ready')) {
      return { success: true, message: `VM ${vmName} created` };
    }

    if (lowerOutput.includes('already exists')) {
      return { success: true, message: `VM ${vmName} already exists` };
    }

    // Error patterns - detect specific issues
    if (lowerOutput.includes('quota') || lowerOutput.includes('limit')) {
      return {
        success: false,
        message: `VM quota exceeded. Delete unused VMs with: ssh exe.dev rm <vmname>`,
        code: 'QUOTA_EXCEEDED'
      };
    }

    if (lowerOutput.includes('invalid') || lowerOutput.includes('not allowed')) {
      return {
        success: false,
        message: `Invalid VM name "${vmName}". Use lowercase letters, numbers, hyphens only.`,
        code: 'INVALID_NAME'
      };
    }

    // Unknown response
    return {
      success: false,
      message: `Unexpected response. Run manually: ssh exe.dev new ${vmName}`,
      code: 'UNKNOWN'
    };
  } catch (err) {
    return { success: false, message: err.message, code: err.code || 'SSH_ERROR' };
  }
}

/**
 * Set a VM to public access
 * @param {string} vmName - VM name
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function setPublic(vmName) {
  try {
    const output = await runExeCommand(`share set-public ${vmName}`, { timeout: 30000 });

    // Check for success indicators in output
    const lowerOutput = output.toLowerCase();
    if (lowerOutput.includes('public') || lowerOutput.includes('success') || lowerOutput.includes('ok')) {
      return { success: true, message: output };
    }

    // Check for error indicators
    if (lowerOutput.includes('error') || lowerOutput.includes('fail') || lowerOutput.includes('not found')) {
      return { success: false, message: output.trim() };
    }

    // If no clear indicator, assume success (command completed without error)
    return { success: true, message: output };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * List VMs on exe.dev
 * @returns {Promise<string[]>} List of VM names
 */
export async function listVMs() {
  try {
    const output = await runExeCommand('ls', { timeout: 15000 });
    // Parse the ls output to extract VM names
    const lines = output.split('\n').filter(line => line.trim() && !line.includes('exe>'));
    return lines;
  } catch {
    return [];
  }
}
