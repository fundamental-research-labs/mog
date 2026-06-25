import { readFileSync } from 'node:fs';
import nodePath from 'node:path';

import { STYLES_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';

const APP_ROOT = process.cwd().endsWith(`${nodePath.sep}apps${nodePath.sep}spreadsheet`)
  ? process.cwd()
  : nodePath.resolve(process.cwd(), 'apps/spreadsheet');

describe('StylesGroup responsive layout', () => {
  test('keeps Styles expanded at level 1 so large labels do not collapse into rows', () => {
    expect(STYLES_COLLAPSE_CONFIG.levels[1]).toBe('full');
    expect(STYLES_COLLAPSE_CONFIG.levels[2]).toBe('dropdown');
  });

  test('stacked commands keep stable keytip and test anchors', () => {
    const source = readFileSync(
      nodePath.resolve(APP_ROOT, 'src/chrome/toolbar/groups/StylesGroup.tsx'),
      'utf8',
    );
    const conditionalSource = readFileSync(
      nodePath.resolve(APP_ROOT, 'src/chrome/toolbar/galleries/ConditionalFormattingMenu.tsx'),
      'utf8',
    );

    expect(source).toContain('<ConditionalFormattingMenu variant="stacked" />');
    expect(conditionalSource).toContain('id="conditional-formatting"');
    expect(conditionalSource).toContain('testId="ribbon-dropdown-conditional-formatting"');
    expect(conditionalSource).toContain('visibilityKey="conditionalFormatting"');
    expect(conditionalSource).toContain('<RibbonVisibilityItem item="conditionalFormatting">');
    expect(source).toContain('id="format-as-table"');
    expect(source).toContain('testId="ribbon-dropdown-format-as-table"');
    expect(source).toContain('visibilityKey="formatAsTable"');
    expect(source).toContain('<RibbonVisibilityItem item="formatAsTable">');
    expect(source).toContain('id="cell-styles"');
    expect(source).toContain('testId="ribbon-dropdown-cell-styles"');
    expect(source).toContain('visibilityKey="cellStyles"');
    expect(source).toContain('<RibbonVisibilityItem item="cellStyles">');
  });

  test('stacked command primitive preserves compact non-wrapping rows', () => {
    const source = readFileSync(
      nodePath.resolve(APP_ROOT, 'src/chrome/toolbar/primitives/StackedRibbonMenuButton.tsx'),
      'utf8',
    );

    expect(source).toContain('h-5 min-w-[132px]');
    expect(source).toContain('whitespace-nowrap');
    expect(source).toContain('useRibbonButtonVisible');
  });
});
