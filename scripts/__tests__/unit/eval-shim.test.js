import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('eval-shim.js', () => {
  it('should export valid JavaScript', () => {
    const shimPath = join(__dirname, '../../../eval/eval-shim.js');
    const content = readFileSync(shimPath, 'utf8');
    expect(() => new Function(content)).not.toThrow();
  });

  it('should define a useUser function that reads testUser param', () => {
    const shimPath = join(__dirname, '../../../eval/eval-shim.js');
    const content = readFileSync(shimPath, 'utf8');
    expect(content).toContain('window.useUser');
    expect(content).toContain('testUser');
  });

  it('should provide useOIDCContext stub', () => {
    const shimPath = join(__dirname, '../../../eval/eval-shim.js');
    const content = readFileSync(shimPath, 'utf8');
    expect(content).toContain('window.useOIDCContext');
  });
});
