import { readFileSync } from 'node:fs';

describe('DataRibbon outline dispatch wiring', () => {
  test('outline buttons dispatch the unified action handlers', () => {
    const source = readFileSync(new URL('../DataRibbon.tsx', import.meta.url), 'utf8');

    expect(source).toContain("onClick={() => dispatch('GROUP')}");
    expect(source).toContain("onClick={() => dispatch('UNGROUP')}");
    expect(source).toContain("onClick={() => dispatch('SHOW_DETAIL')}");
    expect(source).toContain("onClick={() => dispatch('HIDE_DETAIL')}");

    expect(source).not.toContain('onClick={groupRows}');
    expect(source).not.toContain('onClick={ungroupRows}');
    expect(source).not.toContain('onClick={showDetail}');
    expect(source).not.toContain('onClick={hideDetail}');
  });
});
