import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock exe-ssh.js before importing deploy-utils
vi.mock('../../lib/exe-ssh.js', () => ({
  findSSHKey: vi.fn(),
  testConnection: vi.fn(),
  createVM: vi.fn(),
  connect: vi.fn(),
  runCommand: vi.fn(),
  uploadFile: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { preFlightSSH, createAndSetupVM, ensureBun, uploadFilesWithSudo, verifyDeployment } from '../../lib/deploy-utils.js';
import { findSSHKey, testConnection, createVM, connect, runCommand, uploadFile } from '../../lib/exe-ssh.js';
import { execSync } from 'child_process';

describe('deploy-utils', () => {
  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('preFlightSSH', () => {
    it('throws when no SSH key found', async () => {
      findSSHKey.mockReturnValue(null);
      await expect(preFlightSSH()).rejects.toThrow('No SSH key found');
    });

    it('returns key path when key exists and connection succeeds', async () => {
      findSSHKey.mockReturnValue('/home/user/.ssh/id_ed25519');
      testConnection.mockResolvedValue(true);

      const key = await preFlightSSH();
      expect(key).toBe('/home/user/.ssh/id_ed25519');
      expect(testConnection).toHaveBeenCalled();
    });

    it('throws when connection test fails', async () => {
      findSSHKey.mockReturnValue('/home/user/.ssh/id_ed25519');
      testConnection.mockResolvedValue(false);

      await expect(preFlightSSH()).rejects.toThrow('Cannot connect to exe.dev');
    });

    it('skips connection test in dry-run mode', async () => {
      findSSHKey.mockReturnValue('/home/user/.ssh/id_ed25519');

      const key = await preFlightSSH({ dryRun: true });
      expect(key).toBe('/home/user/.ssh/id_ed25519');
      expect(testConnection).not.toHaveBeenCalled();
    });

    it('logs SSH key path', async () => {
      findSSHKey.mockReturnValue('/home/user/.ssh/id_rsa');
      testConnection.mockResolvedValue(true);

      await preFlightSSH();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('id_rsa'));
    });
  });

  describe('createAndSetupVM', () => {
    it('skips creation in dry-run mode', async () => {
      await createAndSetupVM('testvm', { dryRun: true });
      expect(createVM).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DRY RUN'));
    });

    it('creates VM and adds host key on success', async () => {
      createVM.mockResolvedValue({ success: true, message: 'VM testvm created' });
      execSync.mockReturnValue('');

      await createAndSetupVM('testvm');
      expect(createVM).toHaveBeenCalledWith('testvm');
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('ssh-keyscan -H testvm.exe.xyz'),
        expect.any(Object)
      );
    });

    it('throws when VM creation fails', async () => {
      createVM.mockResolvedValue({ success: false, message: 'quota exceeded' });

      await expect(createAndSetupVM('testvm')).rejects.toThrow('Failed to create VM: quota exceeded');
    });

    it('warns but continues when ssh-keyscan fails', async () => {
      createVM.mockResolvedValue({ success: true, message: 'VM created' });
      execSync.mockImplementation(() => { throw new Error('timeout'); });

      // Should not throw
      await createAndSetupVM('testvm');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Warning'));
    });
  });

  describe('ensureBun', () => {
    it('installs bun when not found', async () => {
      const mockClient = { host: 'test.exe.xyz', username: 'exedev', end: vi.fn() };
      connect.mockResolvedValue(mockClient);
      runCommand
        .mockResolvedValueOnce({ stdout: 'NOT_FOUND', stderr: '', code: 0 })  // which bun
        .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })            // curl install
        .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 });           // sudo cp

      await ensureBun('test.exe.xyz');
      expect(runCommand).toHaveBeenCalledTimes(3);
      expect(mockClient.end).toHaveBeenCalled();
    });

    it('skips install when bun already present', async () => {
      const mockClient = { host: 'test.exe.xyz', username: 'exedev', end: vi.fn() };
      connect.mockResolvedValue(mockClient);
      runCommand.mockResolvedValueOnce({ stdout: '/usr/local/bin/bun', stderr: '', code: 0 });

      await ensureBun('test.exe.xyz');
      // Only the check command, no install commands
      expect(runCommand).toHaveBeenCalledTimes(1);
      expect(mockClient.end).toHaveBeenCalled();
    });
  });

  describe('uploadFilesWithSudo', () => {
    it('uploads files via tmp + sudo mv pattern', async () => {
      const mockClient = { host: 'test.exe.xyz', username: 'exedev', end: vi.fn() };
      connect.mockResolvedValue(mockClient);
      uploadFile.mockResolvedValue(undefined);
      runCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 });

      await uploadFilesWithSudo('test.exe.xyz', [
        { localPath: '/local/app.html', remotePath: '/var/www/html/index.html' }
      ]);

      expect(uploadFile).toHaveBeenCalledWith(
        '/local/app.html',
        'test.exe.xyz',
        '/home/exedev/app.html'
      );
      // sudo mv + sudo chown
      expect(runCommand).toHaveBeenCalledWith(mockClient, expect.stringContaining('sudo mv'));
      expect(runCommand).toHaveBeenCalledWith(mockClient, expect.stringContaining('sudo chown www-data:www-data'));
    });

    it('uses custom owner when specified', async () => {
      const mockClient = { host: 'test.exe.xyz', username: 'exedev', end: vi.fn() };
      connect.mockResolvedValue(mockClient);
      uploadFile.mockResolvedValue(undefined);
      runCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 });

      await uploadFilesWithSudo('test.exe.xyz', [
        { localPath: '/local/file.js', remotePath: '/opt/vibes/file.js' }
      ], { owner: 'exedev:exedev' });

      expect(runCommand).toHaveBeenCalledWith(mockClient, expect.stringContaining('sudo chown exedev:exedev'));
    });

    it('handles multiple files', async () => {
      const mockClient = { host: 'test.exe.xyz', username: 'exedev', end: vi.fn() };
      connect.mockResolvedValue(mockClient);
      uploadFile.mockResolvedValue(undefined);
      runCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 });

      await uploadFilesWithSudo('test.exe.xyz', [
        { localPath: '/local/a.html', remotePath: '/var/www/html/a.html' },
        { localPath: '/local/b.js', remotePath: '/var/www/html/b.js' },
      ]);

      expect(uploadFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('verifyDeployment', () => {
    let fetchSpy;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('returns true for OK HTML response', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      });

      const result = await verifyDeployment('https://test.exe.xyz');
      expect(result).toBe(true);
    });

    it('returns false for non-HTML response', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      });

      const result = await verifyDeployment('https://test.exe.xyz');
      expect(result).toBe(false);
    });

    it('returns true for accepted status codes', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({}),
      });

      const result = await verifyDeployment('https://test.exe.xyz', {
        acceptStatus: [200, 404]
      });
      expect(result).toBe(true);
    });

    it('returns false on network error', async () => {
      fetchSpy.mockRejectedValue(new Error('fetch failed'));

      const result = await verifyDeployment('https://test.exe.xyz');
      expect(result).toBe(false);
    });

    it('uses custom user agent', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      await verifyDeployment('https://test.exe.xyz', { userAgent: 'custom/2.0' });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://test.exe.xyz',
        expect.objectContaining({
          headers: { 'User-Agent': 'custom/2.0' }
        })
      );
    });
  });
});
