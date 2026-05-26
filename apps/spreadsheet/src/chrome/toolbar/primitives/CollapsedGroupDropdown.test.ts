import { readFileSync } from 'node:fs';
import nodePath from 'node:path';

const APP_ROOT = process.cwd().endsWith(`${nodePath.sep}apps${nodePath.sep}spreadsheet`)
  ? process.cwd()
  : nodePath.resolve(process.cwd(), 'apps/spreadsheet');

describe('CollapsedGroupDropdown dense layout', () => {
  it('keeps compact labels visible on collapsed group buttons at narrow collapse levels', () => {
    const source = readFileSync(
      nodePath.resolve(APP_ROOT, 'src/chrome/toolbar/primitives/CollapsedGroupDropdown.tsx'),
      'utf8',
    );

    expect(source).toContain('const isDense = level >= 3');
    expect(source).toContain("isDense ? 'px-1' : 'px-[var(--ribbon-group-padding-x)]'");
    expect(source).toContain('text-ribbon-compact text-ss-text-secondary');
    expect(source).toContain('<span className={labelClassName}>{label}</span>');
  });
});
