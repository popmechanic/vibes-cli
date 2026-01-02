/**
 * SSH automation library for exe.dev deployment
 *
 * Provides helpers for connecting to exe.dev VMs, running commands,
 * and uploading files via SCP.
 */

import { Client } from 'ssh2';
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
      privateKey: readFileSync(privateKeyPath)
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
 * Run an interactive session with the exe.dev CLI
 * This handles the interactive prompts from `ssh exe.dev`
 * @param {string} command - Command to run (e.g., 'new myvm')
 * @param {object} [options] - Options
 * @param {number} [options.timeout] - Timeout in ms (default: 30000)
 * @returns {Promise<string>} Command output
 */
export function runExeCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timeout = options.timeout || 30000;

    const privateKeyPath = findSSHKey();
    if (!privateKeyPath) {
      reject(new Error('No SSH key found'));
      return;
    }

    let output = '';
    let timeoutId;

    const config = {
      host: 'exe.dev',
      port: 22,
      username: process.env.USER || 'user',
      privateKey: readFileSync(privateKeyPath)
    };

    client.on('ready', () => {
      // exe.dev uses a shell session for its CLI
      client.shell((err, stream) => {
        if (err) {
          client.end();
          reject(err);
          return;
        }

        timeoutId = setTimeout(() => {
          stream.end();
          client.end();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);

        stream.on('close', () => {
          clearTimeout(timeoutId);
          client.end();
          resolve(output);
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
      clearTimeout(timeoutId);
      reject(err);
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
      privateKey: readFileSync(privateKeyPath)
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
 * Test SSH connectivity to exe.dev
 * @returns {Promise<boolean>} True if connection successful
 */
export async function testConnection() {
  try {
    const output = await runExeCommand('help', { timeout: 10000 });
    return output.includes('exe.dev') || output.includes('help');
  } catch {
    return false;
  }
}

/**
 * Create a new VM on exe.dev
 * @param {string} vmName - Name for the new VM
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function createVM(vmName) {
  try {
    const output = await runExeCommand(`new ${vmName}`, { timeout: 60000 });

    if (output.includes('created') || output.includes('ready')) {
      return { success: true, message: `VM ${vmName} created successfully` };
    }

    if (output.includes('already exists')) {
      return { success: true, message: `VM ${vmName} already exists` };
    }

    return { success: false, message: output };
  } catch (err) {
    return { success: false, message: err.message };
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
