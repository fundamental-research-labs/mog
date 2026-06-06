import type { CellRange } from '@mog-sdk/contracts/core';

import {
  getPendingTableClickActiveCell,
  getPendingTableClickRange,
  resolvePendingTableClickSelection,
  type PendingTableClickSelection,
} from '../table-click-selection';

const tableRange: CellRange = {
  startRow: 0,
  startCol: 3,
  endRow: 2,
  endCol: 4,
};

describe('table click selection helpers', () => {
  it('keeps the clicked table header as active cell when selecting column data', () => {
    const pending: PendingTableClickSelection = {
      kind: 'column',
      sheetId: 'sheet1',
      row: 0,
      col: 3,
      tableId: 'Table1',
      tableRange,
      hasHeaderRow: true,
      hasTotalsRow: false,
    };

    const selectedRange = getPendingTableClickRange(pending, 0);

    expect(selectedRange).toEqual({
      startRow: 1,
      startCol: 3,
      endRow: 2,
      endCol: 3,
    });
    expect(getPendingTableClickActiveCell(pending, selectedRange!)).toEqual({
      row: 0,
      col: 3,
    });
    expect(
      resolvePendingTableClickSelection(pending, {
        handleHeaderClick: () => 0,
        handleCornerClick: () => 0,
      }),
    ).toEqual({
      range: selectedRange,
      activeCell: { row: 0, col: 3 },
    });
  });

  it('uses the selected range start once the table header is included', () => {
    const pending: PendingTableClickSelection = {
      kind: 'column',
      sheetId: 'sheet1',
      row: 0,
      col: 3,
      tableId: 'Table1',
      tableRange,
      hasHeaderRow: true,
      hasTotalsRow: false,
    };

    const selectedRange = getPendingTableClickRange(pending, 1);

    expect(selectedRange).toEqual({
      startRow: 0,
      startCol: 3,
      endRow: 2,
      endCol: 3,
    });
    expect(getPendingTableClickActiveCell(pending, selectedRange!)).toEqual({
      row: 0,
      col: 3,
    });
  });

  it('uses the selected range start for table corner clicks', () => {
    const pending: PendingTableClickSelection = {
      kind: 'table-data-or-full',
      sheetId: 'sheet1',
      row: 0,
      col: 3,
      tableId: 'Table1',
      tableRange,
      hasHeaderRow: true,
      hasTotalsRow: false,
    };

    const selectedRange = getPendingTableClickRange(pending, 0);

    expect(selectedRange).toEqual({
      startRow: 1,
      startCol: 3,
      endRow: 2,
      endCol: 4,
    });
    expect(getPendingTableClickActiveCell(pending, selectedRange!)).toEqual({
      row: 1,
      col: 3,
    });
  });
});
