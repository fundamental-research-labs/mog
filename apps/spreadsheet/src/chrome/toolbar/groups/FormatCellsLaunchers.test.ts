import { readFileSync } from 'node:fs';
import nodePath from 'node:path';

const APP_ROOT = process.cwd().endsWith(`${nodePath.sep}apps${nodePath.sep}spreadsheet`)
  ? process.cwd()
  : nodePath.resolve(process.cwd(), 'apps/spreadsheet');

function readGroupSource(fileName: string): string {
  return readFileSync(
    nodePath.resolve(APP_ROOT, 'src/chrome/toolbar/groups', fileName),
    'utf8',
  );
}

describe('Home ribbon Format Cells launchers', () => {
  test('Font group opens Format Cells on the Font tab', () => {
    const source = readGroupSource('FontGroup.tsx');

    expect(source).toContain("testId: 'ribbon-button-font-settings'");
    expect(source).toContain("ariaLabel: 'Font Settings'");
    expect(source).toContain("dispatch('OPEN_FONT_DIALOG')");
  });

  test('Alignment group opens Format Cells on the Alignment tab', () => {
    const source = readGroupSource('AlignmentGroup.tsx');

    expect(source).toContain("testId: 'ribbon-button-alignment-settings'");
    expect(source).toContain("ariaLabel: 'Alignment Settings'");
    expect(source).toContain("dispatch('OPEN_FORMAT_CELLS_DIALOG', { initialTab: 'alignment' })");
  });

  test('Number group opens Format Cells on the Number tab', () => {
    const source = readGroupSource('NumberGroup.tsx');

    expect(source).toContain("testId: 'ribbon-button-number-format-settings'");
    expect(source).toContain("ariaLabel: 'Number Format Settings'");
    expect(source).toContain("dispatch('OPEN_FORMAT_CELLS_DIALOG', { initialTab: 'number' })");
  });
});
