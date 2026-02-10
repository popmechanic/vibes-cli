/**
 * Shared deployment utilities for exe.dev deploy scripts.
 *
 * Extracts common patterns from deploy-exe.js and deploy-connect.js:
 * - SSH pre-flight checks (key discovery, connection test)
 * - VM creation + host key setup
 * - Bun installation on remote hosts
 * - File upload via tmp + sudo pattern
 * - HTTP deployment verification
 */

import { execSync } from 'child_process';
import {
  findSSHKey,
  testConnection,
  createVM as sshCreateVM,
  connect,
  runCommand,
  uploadFile,
} from './exe-ssh.js';

/**
 * Run SSH pre-flight checks: find key + test connection.
 *
 * @param {{ dryRun?: boolean }} options
 * @returns {Promise<string>} Path to SSH key
 * @throws {Error} If no key found or connection fails
 */
export async function preFlightSSH(options = {}) {
  const sshKey = findSSHKey();
  if (!sshKey) {
    throw new Error('No SSH key found in ~/.ssh/. Please create an SSH key first.');
  }
  console.log(`  \u2713 SSH key found: ${sshKey}`);

  console.log('  Testing exe.dev connection...');
  if (options.dryRun) {
    console.log('  [DRY RUN] Would test SSH connection to exe.dev');
  } else {
    const connected = await testConnection();
    if (!connected) {
      throw new Error(`Cannot connect to exe.dev.

Before deploying, please:
1. Run: ssh exe.dev (to create account if needed, verify email)
2. Then retry this deployment`);
    }
    console.log('  \u2713 exe.dev connection OK');
  }

  return sshKey;
}

/**
 * Create a VM on exe.dev and add host key to known_hosts.
 *
 * @param {string} name - VM name
 * @param {{ dryRun?: boolean }} options
 * @throws {Error} If VM creation fails
 */
export async function createAndSetupVM(name, options = {}) {
  if (options.dryRun) {
    console.log(`  [DRY RUN] Would create VM: ${name}`);
    return;
  }

  console.log(`  Creating VM: ${name}...`);
  const result = await sshCreateVM(name);

  if (result.success) {
    console.log(`  \u2713 ${result.message}`);
  } else {
    throw new Error(`Failed to create VM: ${result.message}`);
  }

  // Add VM host key to known_hosts to avoid interactive prompt
  const vmHost = `${name}.exe.xyz`;
  console.log(`  Adding ${vmHost} to known_hosts...`);
  try {
    execSync(`ssh-keyscan -H ${vmHost} >> ~/.ssh/known_hosts 2>/dev/null`, { timeout: 30000 });
    console.log('  \u2713 Host key added');
  } catch {
    console.log(`  Warning: Could not add host key automatically. You may need to run: ssh ${vmHost}`);
  }
}

/**
 * Ensure Bun is installed on a remote host.
 * Installs to ~/.bun/bin/bun and copies to /usr/local/bin for system-wide access.
 *
 * @param {string} host - Remote hostname (e.g., "myapp.exe.xyz")
 * @returns {Promise<void>}
 */
export async function ensureBun(host) {
  console.log('  Checking/installing Bun...');
  const client = await connect(host);
  const bunCheck = await runCommand(client, 'which bun || test -f /usr/local/bin/bun && echo "/usr/local/bin/bun" || echo "NOT_FOUND"');
  if (bunCheck.stdout.includes('NOT_FOUND')) {
    console.log('  Installing Bun...');
    await runCommand(client, 'curl -fsSL https://bun.sh/install | bash');
    // Copy to /usr/local/bin so all users (including www-data) can access it
    await runCommand(client, 'sudo cp ~/.bun/bin/bun /usr/local/bin/bun && sudo chmod +x /usr/local/bin/bun');
  }
  client.end();
  console.log('  \u2713 Bun installed');
}

/**
 * Upload files to a remote host using the scp-to-tmp + sudo-mv pattern.
 *
 * @param {string} host - Remote hostname
 * @param {{ localPath: string, remotePath: string }[]} files - Files to upload
 * @param {{ owner?: string }} options - Options (owner defaults to www-data:www-data)
 * @returns {Promise<void>}
 */
export async function uploadFilesWithSudo(host, files, options = {}) {
  const owner = options.owner || 'www-data:www-data';

  for (const { localPath, remotePath } of files) {
    const filename = localPath.split('/').pop();
    const tmpPath = `/home/exedev/${filename}`;

    await uploadFile(localPath, host, tmpPath);

    const client = await connect(host);
    await runCommand(client, `sudo mv ${tmpPath} ${remotePath}`);
    await runCommand(client, `sudo chown ${owner} ${remotePath}`);
    client.end();
  }
}

/**
 * Verify a deployment URL returns an HTTP response.
 *
 * @param {string} url - URL to check
 * @param {{ timeoutMs?: number, userAgent?: string, acceptStatus?: number[] }} options
 * @returns {Promise<boolean>}
 */
export async function verifyDeployment(url, options = {}) {
  const timeoutMs = options.timeoutMs || 10000;
  const userAgent = options.userAgent || 'vibes-deploy/1.0';
  const acceptStatus = options.acceptStatus || null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent }
    });

    clearTimeout(timeout);

    if (acceptStatus) {
      // Caller specifies which status codes are acceptable
      if (acceptStatus.includes(response.status)) {
        console.log(`  \u2713 ${url} is responding (HTTP ${response.status})`);
        return true;
      }
    } else {
      // Default: check for OK + text/html
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.includes('text/html')) {
        console.log(`  \u2713 ${url} is responding (HTTP ${response.status})`);
        return true;
      }
    }

    console.log(`  \u26a0 ${url} returned unexpected response: ${response.status}`);
    return false;
  } catch (err) {
    console.log(`  \u2717 ${url} is not responding: ${err.message}`);
    console.log('  This may be due to DNS propagation. Try again in a few minutes.');
    return false;
  }
}
