import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../..');
const TMP_DIR = join(__dirname, '../fixtures/eval-tmp');

describe('assemble.js --eval-mode', () => {
  const appCode = `
function App() {
  const { email } = useUser();
  return <div>Hello {email}</div>;
}
export default App;
`;

  it('should inject eval-shim code into assembled output', () => {
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
    const appPath = join(TMP_DIR, 'eval-test-app.jsx');
    const outPath = join(TMP_DIR, 'eval-test-output.html');
    writeFileSync(appPath, appCode);

    execSync(`bun ${join(ROOT, 'scripts/assemble.js')} ${appPath} ${outPath} --eval-mode`, {
      cwd: ROOT,
    });

    const output = readFileSync(outPath, 'utf8');

    // Should contain shim code
    expect(output).toContain('testUser');
    expect(output).toContain('window.useUser');

    // Should NOT contain OIDC bridge import
    expect(output).not.toContain('import("/oidc-bridge.js")');

    // Should set wsUrl to localhost sync server
    expect(output).toContain('ws://localhost:3334');
  });

  it('should produce valid HTML without --eval-mode (regression)', () => {
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
    const appPath = join(TMP_DIR, 'eval-test-app.jsx');
    const outPath = join(TMP_DIR, 'eval-test-normal.html');
    writeFileSync(appPath, appCode);

    execSync(`bun ${join(ROOT, 'scripts/assemble.js')} ${appPath} ${outPath}`, {
      cwd: ROOT,
    });

    const output = readFileSync(outPath, 'utf8');
    expect(output).not.toContain('testUser');
  });
});
