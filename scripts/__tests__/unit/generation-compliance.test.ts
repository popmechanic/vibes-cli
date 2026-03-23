import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const fixturesDir = join(__dirname, '..', 'fixtures');
const fixtures = readdirSync(fixturesDir)
  .filter(f => f.endsWith('.jsx'))
  .map(f => ({ name: f, content: readFileSync(join(fixturesDir, f), 'utf-8') }));

describe('generation compliance', () => {
  for (const { name, content } of fixtures) {
    describe(name, () => {
      it('has no import statements', () => {
        const imports = content.match(/^import\s+/gm);
        expect(imports).toBeNull();
      });

      it('calls useApp()', () => {
        expect(content).toContain('useApp()');
      });

      it('has no createStore or createMergeableStore', () => {
        expect(content).not.toMatch(/createStore|createMergeableStore/);
      });

      it('uses string literal table names in hook calls', () => {
        const badCalls = content.match(/use(?:RowIds|Cell|AddRowCallback|SetCellCallback|SortedRowIds|DelRowCallback|RowCount)\(\s*[a-zA-Z_$]/g);
        expect(badCalls).toBeNull();
      });
    });
  }
});
