import { readFileSync } from 'node:fs';

describe('ViewRibbon labels', () => {
  test('workbook view buttons use explicit two-line labels', () => {
    const source = readFileSync(new URL('../ViewRibbon.tsx', import.meta.url), 'utf8');

    expect(source).toContain("label={twoLineViewRibbonLabel('Page Break Preview')}");
    expect(source).toContain("label={twoLineViewRibbonLabel('Page Layout')}");
    expect(source).toContain("label={twoLineViewRibbonLabel('Custom Views')}");
  });

  test('view-ribbon multi-word vertical buttons share the two-line label helper', () => {
    const source = readFileSync(new URL('../ViewRibbon.tsx', import.meta.url), 'utf8');

    for (const label of [
      'New Window',
      'Arrange All',
      'Freeze Panes',
      'Switch Windows',
      'Formula bar',
      'Status bar',
    ]) {
      expect(source).toContain(`label={twoLineViewRibbonLabel('${label}')}`);
    }
  });
});
