import { readFileSync } from 'node:fs';

describe('DataRibbon outline wiring', () => {
  test('group and ungroup open row/column choosers while detail buttons dispatch unified handlers', () => {
    const source = readFileSync(new URL('../DataRibbon.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onClick={handleGroupClick}');
    expect(source).toContain('onClick={handleGroupRows}');
    expect(source).toContain('onClick={handleGroupColumns}');
    expect(source).toContain('onClick={handleUngroupClick}');
    expect(source).toContain('onClick={handleUngroupRows}');
    expect(source).toContain('onClick={handleUngroupColumns}');
    expect(source).toContain('Rows');
    expect(source).toContain('Columns');
    expect(source).not.toContain("onClick={() => dispatch('GROUP')}");
    expect(source).not.toContain("dispatch('UNGROUP')");
    expect(source).toContain("onClick={() => dispatch('SHOW_DETAIL')}");
    expect(source).toContain("onClick={() => dispatch('HIDE_DETAIL')}");

    expect(source).not.toContain('onClick={showDetail}');
    expect(source).not.toContain('onClick={hideDetail}');
  });
});
