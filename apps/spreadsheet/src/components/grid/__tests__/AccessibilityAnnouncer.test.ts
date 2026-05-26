import type { CellRange } from '@mog-sdk/contracts/core';

import { buildBaseSelectionAnnouncement } from '../accessibility-announcements';

describe('buildBaseSelectionAnnouncement', () => {
  it('announces a single active cell with its content summary', () => {
    const range: CellRange = { startRow: 1, startCol: 1, endRow: 1, endCol: 1 };

    expect(buildBaseSelectionAnnouncement([range], { row: 1, col: 1 }, 'empty')).toBe(
      'Cell B2 selected, empty',
    );
  });

  it('announces a contiguous range with canonical A1 range notation', () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 2, endCol: 2 };

    expect(buildBaseSelectionAnnouncement([range], { row: 0, col: 0 }, '')).toBe(
      'Selected A1:C3, 9 cells',
    );
  });

  it('announces multi-range selections with total cell count', () => {
    const ranges: CellRange[] = [
      { startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
      { startRow: 2, startCol: 2, endRow: 3, endCol: 3 },
    ];

    expect(buildBaseSelectionAnnouncement(ranges, { row: 0, col: 0 }, '')).toBe(
      '2 ranges selected, 6 cells total',
    );
  });
});
