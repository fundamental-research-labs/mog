import { readFileSync } from 'node:fs';
import nodePath from 'node:path';

const APP_ROOT = process.cwd().endsWith(`${nodePath.sep}apps${nodePath.sep}spreadsheet`)
  ? process.cwd()
  : nodePath.resolve(process.cwd(), 'apps/spreadsheet');

describe('AlignmentGroup merge control', () => {
  test('keeps Merge & Center as a direct-action split button', () => {
    const source = readFileSync(
      nodePath.resolve(APP_ROOT, 'src/chrome/toolbar/groups/AlignmentGroup.tsx'),
      'utf8',
    );

    expect(source).toContain('<SplitButton');
    expect(source).toContain('id="merge-center"');
    expect(source).toContain('setMergeDropdownOpen(false)');
    expect(source).toContain("dispatch('MERGE_AND_CENTER')");
    expect(source).toContain('onDropdownClick={() => setMergeDropdownOpen(!mergeDropdownOpen)}');
  });
});
