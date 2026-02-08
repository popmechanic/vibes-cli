/**
 * Unit tests for backup.js
 *
 * Tests timestamped backup creation, discovery, and restoration.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createBackup, findLatestBackup, restoreFromBackup } from '../../lib/backup.js';

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'backup-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
  tempDirs.length = 0;
});

describe('createBackup', () => {
  it('returns null when file does not exist', () => {
    const dir = makeTempDir();
    const result = createBackup(join(dir, 'nonexistent.html'));
    expect(result).toBeNull();
  });

  it('creates backup file with timestamp pattern', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'index.html');
    writeFileSync(filePath, '<html>original</html>');

    const backupPath = createBackup(filePath);
    expect(backupPath).toMatch(/index\.\d{8}-\d{6}\.bak\.html$/);
    expect(existsSync(backupPath)).toBe(true);
  });

  it('backup file has same content as original', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'index.html');
    const content = '<html><body>Hello World</body></html>';
    writeFileSync(filePath, content);

    const backupPath = createBackup(filePath);
    expect(readFileSync(backupPath, 'utf-8')).toBe(content);
  });

  it('returns the backup path', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'index.html');
    writeFileSync(filePath, 'content');

    const backupPath = createBackup(filePath);
    expect(typeof backupPath).toBe('string');
    expect(backupPath).not.toBe(filePath);
  });
});

describe('createBackup (non-HTML files)', () => {
  it('creates backup for .jsx files with correct pattern', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'app.jsx');
    writeFileSync(filePath, 'const App = () => <div/>;');

    const backupPath = createBackup(filePath);
    expect(backupPath).toMatch(/app\.\d{8}-\d{6}\.bak\.jsx$/);
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, 'utf-8')).toBe('const App = () => <div/>;');
  });

  it('creates backup for .json files', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, '{"key":"value"}');

    const backupPath = createBackup(filePath);
    expect(backupPath).toMatch(/config\.\d{8}-\d{6}\.bak\.json$/);
    expect(existsSync(backupPath)).toBe(true);
  });

  it('creates backup for extensionless files using .bak extension', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'Makefile');
    writeFileSync(filePath, 'all: build');

    const backupPath = createBackup(filePath);
    expect(backupPath).toMatch(/Makefile\.\d{8}-\d{6}\.bak\.bak$/);
    expect(existsSync(backupPath)).toBe(true);
  });
});

describe('findLatestBackup', () => {
  it('returns null when no backups exist', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'index.html');
    writeFileSync(filePath, 'content');

    const result = findLatestBackup(filePath);
    expect(result).toBeNull();
  });

  it('finds the most recent backup when multiple exist', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'index.html');
    writeFileSync(filePath, 'content');

    // Create backups with different timestamps (earlier first)
    const older = join(dir, 'index.20250101-100000.bak.html');
    const newer = join(dir, 'index.20250201-120000.bak.html');
    writeFileSync(older, 'old');
    writeFileSync(newer, 'new');

    const result = findLatestBackup(filePath);
    expect(result).toBe(newer);
  });

  it('falls back to legacy .bak.html format', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'index.html');
    writeFileSync(filePath, 'content');

    const legacy = join(dir, 'index.bak.html');
    writeFileSync(legacy, 'legacy backup');

    const result = findLatestBackup(filePath);
    expect(result).toBe(legacy);
  });

  it('prefers timestamped backup over legacy format', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'index.html');
    writeFileSync(filePath, 'content');

    const legacy = join(dir, 'index.bak.html');
    const timestamped = join(dir, 'index.20250101-100000.bak.html');
    writeFileSync(legacy, 'legacy');
    writeFileSync(timestamped, 'timestamped');

    const result = findLatestBackup(filePath);
    expect(result).toBe(timestamped);
  });

  it('returns null for non-existent directory', () => {
    const result = findLatestBackup('/nonexistent/dir/index.html');
    expect(result).toBeNull();
  });
});

describe('findLatestBackup (non-HTML files)', () => {
  it('finds the most recent .jsx backup', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'app.jsx');
    writeFileSync(filePath, 'content');

    const older = join(dir, 'app.20250101-100000.bak.jsx');
    const newer = join(dir, 'app.20250201-120000.bak.jsx');
    writeFileSync(older, 'old');
    writeFileSync(newer, 'new');

    const result = findLatestBackup(filePath);
    expect(result).toBe(newer);
  });

  it('falls back to legacy .bak.jsx format', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'app.jsx');
    writeFileSync(filePath, 'content');

    const legacy = join(dir, 'app.bak.jsx');
    writeFileSync(legacy, 'legacy backup');

    const result = findLatestBackup(filePath);
    expect(result).toBe(legacy);
  });
});

describe('restoreFromBackup', () => {
  it('returns failure when no backup exists', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'index.html');
    writeFileSync(filePath, 'content');

    const result = restoreFromBackup(filePath);
    expect(result.success).toBe(false);
    expect(result).toHaveProperty('error');
    expect(result.error).toContain(filePath);
  });

  it('restores file content from latest backup', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'index.html');
    writeFileSync(filePath, 'current content');

    const backup = join(dir, 'index.20250115-143000.bak.html');
    const backupContent = '<html>backed up version</html>';
    writeFileSync(backup, backupContent);

    const result = restoreFromBackup(filePath);
    expect(result.success).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe(backupContent);
  });

  it('returns success with backupPath on restore', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'index.html');
    writeFileSync(filePath, 'content');

    const backup = join(dir, 'index.20250115-143000.bak.html');
    writeFileSync(backup, 'backup');

    const result = restoreFromBackup(filePath);
    expect(result.success).toBe(true);
    expect(result.backupPath).toBe(backup);
  });

  it('restores non-HTML files from backup', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'app.jsx');
    writeFileSync(filePath, 'current content');

    const backup = join(dir, 'app.20250115-143000.bak.jsx');
    const backupContent = 'const App = () => <div>restored</div>;';
    writeFileSync(backup, backupContent);

    const result = restoreFromBackup(filePath);
    expect(result.success).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe(backupContent);
  });
});
