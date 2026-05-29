import { readFileSync } from 'node:fs';

describe('DataRibbon outline wiring', () => {
  test('group opens a row/column chooser while remaining outline buttons dispatch unified handlers', () => {
    const source = readFileSync(new URL('../DataRibbon.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onClick={handleGroupClick}');
    expect(source).toContain('onClick={handleGroupRows}');
    expect(source).toContain('onClick={handleGroupColumns}');
    expect(source).toContain('Rows');
    expect(source).toContain('Columns');
    expect(source).not.toContain("onClick={() => dispatch('GROUP')}");
    expect(source).toContain("onClick={() => dispatch('UNGROUP')}");
    expect(source).toContain("onClick={() => dispatch('SHOW_DETAIL')}");
    expect(source).toContain("onClick={() => dispatch('HIDE_DETAIL')}");

    expect(source).not.toContain('onClick={ungroupRows}');
    expect(source).not.toContain('onClick={showDetail}');
    expect(source).not.toContain('onClick={hideDetail}');
  });
});
