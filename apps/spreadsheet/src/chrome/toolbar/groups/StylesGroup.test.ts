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

  test('style preview chips include horizontal padding and stable text wrapping', () => {
    const source = readFileSync(
      nodePath.resolve(APP_ROOT, 'src/chrome/toolbar/groups/StylesGroup.tsx'),
      'utf8',
    );

    expect(source).toContain('min-w-[36px] h-[20px] px-1.5');
    expect(source).toContain('flex flex-wrap content-start gap-0.5 w-[92px]');
    expect(source).toContain('whitespace-nowrap');
  });
});
