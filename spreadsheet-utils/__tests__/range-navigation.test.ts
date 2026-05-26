import type { CellRange } from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import {
  containsRange,
  getAbsoluteResizedRange,
  getBoundingRect,
  getCellRange,
  getColumn,
  getColumnsAfter,
  getColumnsBefore,
  getEntireColumn,
  getEntireRow,
  getIntersection,
  getLastCell,
  getLastColumn,
  getLastRow,
  getOffsetRange,
  getResizedRange,
  getRow,
  getRowsAbove,
  getRowsBelow,
  rangesOverlap,
} from '@mog/spreadsheet-utils/range';

/** Helper to build a CellRange concisely. */
const r = (
  sr: number,
  sc: number,
  er: number,
  ec: number,
  opts?: Partial<CellRange>,
): CellRange => ({
  startRow: sr,
  startCol: sc,
  endRow: er,
  endCol: ec,
  ...opts,
});

// ---------------------------------------------------------------------------
// getOffsetRange
// ---------------------------------------------------------------------------
describe('getOffsetRange', () => {
  it('applies a positive offset', () => {
    expect(getOffsetRange(r(1, 1, 3, 3), 2, 3)).toEqual(r(3, 4, 5, 6));
  });

  it('applies a negative offset', () => {
    expect(getOffsetRange(r(5, 5, 8, 8), -2, -3)).toEqual(r(3, 2, 6, 5));
  });

  it('clamps to 0 when offset would go negative', () => {
    const result = getOffsetRange(r(1, 1, 3, 3), -5, -5);
    expect(result.startRow).toBeGreaterThanOrEqual(0);
    expect(result.startCol).toBeGreaterThanOrEqual(0);
  });

  it('clamps to MAX bounds', () => {
    const result = getOffsetRange(
      r(MAX_ROWS - 5, MAX_COLS - 5, MAX_ROWS - 1, MAX_COLS - 1),
      10,
      10,
    );
    expect(result.endRow).toBeLessThanOrEqual(MAX_ROWS - 1);
    expect(result.endCol).toBeLessThanOrEqual(MAX_COLS - 1);
  });

  it('returns equivalent range with zero offset', () => {
    const range = r(2, 3, 5, 7);
    expect(getOffsetRange(range, 0, 0)).toEqual(range);
  });

  it('preserves sheetId', () => {
    const result = getOffsetRange(r(0, 0, 1, 1, { sheetId: 's1' }), 1, 1);
    expect(result.sheetId).toBe('s1');
  });

  it('throws RangeError if isFullRow and rowOffset !== 0', () => {
    expect(() => getOffsetRange(r(0, 0, 0, MAX_COLS - 1, { isFullRow: true }), 1, 0)).toThrow(
      RangeError,
    );
  });

  it('throws RangeError if isFullColumn and colOffset !== 0', () => {
    expect(() => getOffsetRange(r(0, 0, MAX_ROWS - 1, 0, { isFullColumn: true }), 0, 1)).toThrow(
      RangeError,
    );
  });

  it('allows isFullRow with colOffset when rowOffset is 0', () => {
    expect(() => getOffsetRange(r(0, 0, 0, MAX_COLS - 1, { isFullRow: true }), 0, 2)).not.toThrow();
  });

  it('allows isFullColumn with rowOffset when colOffset is 0', () => {
    expect(() =>
      getOffsetRange(r(0, 0, MAX_ROWS - 1, 0, { isFullColumn: true }), 2, 0),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getResizedRange
// ---------------------------------------------------------------------------
describe('getResizedRange', () => {
  it('grows by positive delta', () => {
    const result = getResizedRange(r(1, 1, 3, 3), 2, 2);
    expect(result).toEqual(r(1, 1, 5, 5));
  });

  it('shrinks by negative delta', () => {
    const result = getResizedRange(r(1, 1, 5, 5), -2, -2);
    expect(result).toEqual(r(1, 1, 3, 3));
  });

  it('clamps to minimum 1 row and 1 col', () => {
    const result = getResizedRange(r(3, 3, 3, 3), -5, -5);
    expect(result.endRow).toBeGreaterThanOrEqual(result.startRow);
    expect(result.endCol).toBeGreaterThanOrEqual(result.startCol);
  });

  it('clamps to MAX bounds', () => {
    const result = getResizedRange(r(0, 0, MAX_ROWS - 2, MAX_COLS - 2), 100, 100);
    expect(result.endRow).toBeLessThanOrEqual(MAX_ROWS - 1);
    expect(result.endCol).toBeLessThanOrEqual(MAX_COLS - 1);
  });

  it('throws on full-row/col axis', () => {
    expect(() => getResizedRange(r(0, 0, 0, MAX_COLS - 1, { isFullRow: true }), 1, 0)).toThrow(
      RangeError,
    );
    expect(() => getResizedRange(r(0, 0, MAX_ROWS - 1, 0, { isFullColumn: true }), 0, 1)).toThrow(
      RangeError,
    );
  });

  it('preserves sheetId', () => {
    const result = getResizedRange(r(0, 0, 2, 2, { sheetId: 's1' }), 1, 1);
    expect(result.sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getAbsoluteResizedRange
// ---------------------------------------------------------------------------
describe('getAbsoluteResizedRange', () => {
  it('resizes to specific dimensions', () => {
    const result = getAbsoluteResizedRange(r(2, 3, 5, 7), 10, 8);
    expect(result.endRow - result.startRow + 1).toBe(10);
    expect(result.endCol - result.startCol + 1).toBe(8);
  });

  it('clamps endRow/endCol to MAX bounds', () => {
    const result = getAbsoluteResizedRange(
      r(MAX_ROWS - 5, MAX_COLS - 5, MAX_ROWS - 1, MAX_COLS - 1),
      100,
      100,
    );
    expect(result.endRow).toBeLessThanOrEqual(MAX_ROWS - 1);
    expect(result.endCol).toBeLessThanOrEqual(MAX_COLS - 1);
  });

  it('throws RangeError if numRows <= 0', () => {
    expect(() => getAbsoluteResizedRange(r(0, 0, 2, 2), 0, 1)).toThrow(RangeError);
    expect(() => getAbsoluteResizedRange(r(0, 0, 2, 2), -1, 1)).toThrow(RangeError);
  });

  it('throws RangeError if numCols <= 0', () => {
    expect(() => getAbsoluteResizedRange(r(0, 0, 2, 2), 1, 0)).toThrow(RangeError);
    expect(() => getAbsoluteResizedRange(r(0, 0, 2, 2), 1, -1)).toThrow(RangeError);
  });

  it('throws on full-row/col axis', () => {
    expect(() =>
      getAbsoluteResizedRange(r(0, 0, 0, MAX_COLS - 1, { isFullRow: true }), 2, 2),
    ).toThrow(RangeError);
    expect(() =>
      getAbsoluteResizedRange(r(0, 0, MAX_ROWS - 1, 0, { isFullColumn: true }), 2, 2),
    ).toThrow(RangeError);
  });

  it('preserves sheetId', () => {
    const result = getAbsoluteResizedRange(r(0, 0, 2, 2, { sheetId: 's1' }), 5, 5);
    expect(result.sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getIntersection
// ---------------------------------------------------------------------------
describe('getIntersection', () => {
  it('returns intersection of overlapping ranges', () => {
    const result = getIntersection(r(0, 0, 5, 5), r(3, 3, 8, 8));
    expect(result).toEqual(r(3, 3, 5, 5));
  });

  it('returns null for disjoint ranges', () => {
    expect(getIntersection(r(0, 0, 2, 2), r(5, 5, 8, 8))).toBeNull();
  });

  it('returns inner range when one fully contains the other', () => {
    const inner = r(2, 2, 4, 4);
    const outer = r(0, 0, 6, 6);
    expect(getIntersection(outer, inner)).toEqual(inner);
  });

  it('returns same range for identical ranges', () => {
    const range = r(1, 1, 5, 5);
    expect(getIntersection(range, range)).toEqual(range);
  });

  it('returns intersection for partial corner overlap', () => {
    const result = getIntersection(r(0, 0, 3, 3), r(3, 3, 6, 6));
    expect(result).toEqual(r(3, 3, 3, 3));
  });

  it('throws RangeError on sheetId mismatch', () => {
    expect(() =>
      getIntersection(r(0, 0, 2, 2, { sheetId: 'a' }), r(1, 1, 3, 3, { sheetId: 'b' })),
    ).toThrow(RangeError);
  });

  it('preserves sheetId when both match', () => {
    const result = getIntersection(
      r(0, 0, 5, 5, { sheetId: 's1' }),
      r(2, 2, 8, 8, { sheetId: 's1' }),
    );
    expect(result?.sheetId).toBe('s1');
  });

  it('works when only one range has sheetId', () => {
    const result = getIntersection(r(0, 0, 5, 5, { sheetId: 's1' }), r(2, 2, 8, 8));
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getBoundingRect
// ---------------------------------------------------------------------------
describe('getBoundingRect', () => {
  it('computes bounding rect of two separate ranges', () => {
    const result = getBoundingRect(r(1, 1, 3, 3), r(6, 6, 8, 8));
    expect(result).toEqual(r(1, 1, 8, 8));
  });

  it('computes bounding rect of overlapping ranges', () => {
    const result = getBoundingRect(r(0, 0, 5, 5), r(3, 3, 8, 8));
    expect(result).toEqual(r(0, 0, 8, 8));
  });

  it('returns outer when one contains the other', () => {
    const outer = r(0, 0, 10, 10);
    expect(getBoundingRect(outer, r(2, 2, 5, 5))).toEqual(outer);
  });

  it('returns same range for identical ranges', () => {
    const range = r(3, 3, 7, 7);
    expect(getBoundingRect(range, range)).toEqual(range);
  });

  it('throws on sheetId mismatch', () => {
    expect(() =>
      getBoundingRect(r(0, 0, 1, 1, { sheetId: 'a' }), r(0, 0, 1, 1, { sheetId: 'b' })),
    ).toThrow(RangeError);
  });

  it('preserves sheetId', () => {
    const result = getBoundingRect(
      r(0, 0, 2, 2, { sheetId: 's1' }),
      r(3, 3, 5, 5, { sheetId: 's1' }),
    );
    expect(result.sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getEntireRow
// ---------------------------------------------------------------------------
describe('getEntireRow', () => {
  it('expands range to full row', () => {
    const result = getEntireRow(r(2, 3, 5, 7));
    expect(result.startCol).toBe(0);
    expect(result.endCol).toBe(MAX_COLS - 1);
  });

  it('sets isFullRow to true', () => {
    expect(getEntireRow(r(2, 3, 5, 7)).isFullRow).toBe(true);
  });

  it('preserves startRow and endRow', () => {
    const result = getEntireRow(r(2, 3, 5, 7));
    expect(result.startRow).toBe(2);
    expect(result.endRow).toBe(5);
  });

  it('preserves sheetId', () => {
    expect(getEntireRow(r(0, 0, 1, 1, { sheetId: 's1' })).sheetId).toBe('s1');
  });

  it('sets cols to 0 through MAX_COLS-1', () => {
    const result = getEntireRow(r(10, 5, 12, 8));
    expect(result.startCol).toBe(0);
    expect(result.endCol).toBe(MAX_COLS - 1);
  });
});

// ---------------------------------------------------------------------------
// getEntireColumn
// ---------------------------------------------------------------------------
describe('getEntireColumn', () => {
  it('expands range to full column', () => {
    const result = getEntireColumn(r(2, 3, 5, 7));
    expect(result.startRow).toBe(0);
    expect(result.endRow).toBe(MAX_ROWS - 1);
  });

  it('sets isFullColumn to true', () => {
    expect(getEntireColumn(r(2, 3, 5, 7)).isFullColumn).toBe(true);
  });

  it('preserves startCol and endCol', () => {
    const result = getEntireColumn(r(2, 3, 5, 7));
    expect(result.startCol).toBe(3);
    expect(result.endCol).toBe(7);
  });

  it('preserves sheetId', () => {
    expect(getEntireColumn(r(0, 0, 1, 1, { sheetId: 's1' })).sheetId).toBe('s1');
  });

  it('sets rows to 0 through MAX_ROWS-1', () => {
    const result = getEntireColumn(r(10, 5, 12, 8));
    expect(result.startRow).toBe(0);
    expect(result.endRow).toBe(MAX_ROWS - 1);
  });
});

// ---------------------------------------------------------------------------
// getRow
// ---------------------------------------------------------------------------
describe('getRow', () => {
  it('gets the first row (index 0)', () => {
    const result = getRow(r(2, 3, 5, 7), 0);
    expect(result).toEqual(r(2, 3, 2, 7));
  });

  it('gets the last row', () => {
    const result = getRow(r(2, 3, 5, 7), 3);
    expect(result).toEqual(r(5, 3, 5, 7));
  });

  it('gets a middle row', () => {
    const result = getRow(r(2, 3, 5, 7), 1);
    expect(result).toEqual(r(3, 3, 3, 7));
  });

  it('throws on negative index', () => {
    expect(() => getRow(r(0, 0, 5, 5), -1)).toThrow(RangeError);
  });

  it('throws on index >= row count', () => {
    expect(() => getRow(r(0, 0, 2, 2), 3)).toThrow(RangeError);
  });

  it('works with index 0 on single-row range', () => {
    const result = getRow(r(4, 1, 4, 6), 0);
    expect(result).toEqual(r(4, 1, 4, 6));
  });

  it('preserves sheetId', () => {
    expect(getRow(r(0, 0, 5, 5, { sheetId: 's1' }), 0).sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getColumn
// ---------------------------------------------------------------------------
describe('getColumn', () => {
  it('gets the first column (index 0)', () => {
    const result = getColumn(r(2, 3, 5, 7), 0);
    expect(result).toEqual(r(2, 3, 5, 3));
  });

  it('gets the last column', () => {
    const result = getColumn(r(2, 3, 5, 7), 4);
    expect(result).toEqual(r(2, 7, 5, 7));
  });

  it('throws on out-of-bounds index', () => {
    expect(() => getColumn(r(0, 0, 2, 2), 3)).toThrow(RangeError);
    expect(() => getColumn(r(0, 0, 2, 2), -1)).toThrow(RangeError);
  });

  it('preserves sheetId', () => {
    expect(getColumn(r(0, 0, 5, 5, { sheetId: 's1' }), 0).sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getLastRow
// ---------------------------------------------------------------------------
describe('getLastRow', () => {
  it('returns the last row as a single-row range', () => {
    const result = getLastRow(r(2, 3, 5, 7));
    expect(result).toEqual(r(5, 3, 5, 7));
  });

  it('works on a single-row range', () => {
    const result = getLastRow(r(4, 1, 4, 6));
    expect(result).toEqual(r(4, 1, 4, 6));
  });

  it('preserves sheetId', () => {
    expect(getLastRow(r(0, 0, 5, 5, { sheetId: 's1' })).sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getLastColumn
// ---------------------------------------------------------------------------
describe('getLastColumn', () => {
  it('returns the last column as a single-column range', () => {
    const result = getLastColumn(r(2, 3, 5, 7));
    expect(result).toEqual(r(2, 7, 5, 7));
  });

  it('preserves sheetId', () => {
    expect(getLastColumn(r(0, 0, 5, 5, { sheetId: 's1' })).sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getLastCell
// ---------------------------------------------------------------------------
describe('getLastCell', () => {
  it('returns bottom-right as 1x1 range', () => {
    const result = getLastCell(r(2, 3, 5, 7));
    expect(result).toEqual(r(5, 7, 5, 7));
  });

  it('works on a single-cell range', () => {
    const result = getLastCell(r(4, 4, 4, 4));
    expect(result).toEqual(r(4, 4, 4, 4));
  });

  it('preserves sheetId', () => {
    expect(getLastCell(r(0, 0, 5, 5, { sheetId: 's1' })).sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getCellRange
// ---------------------------------------------------------------------------
describe('getCellRange', () => {
  it('gets (0,0) as the top-left cell', () => {
    const result = getCellRange(r(2, 3, 5, 7), 0, 0);
    expect(result).toEqual(r(2, 3, 2, 3));
  });

  it('gets a valid interior cell', () => {
    const result = getCellRange(r(2, 3, 5, 7), 2, 3);
    expect(result).toEqual(r(4, 6, 4, 6));
  });

  it('throws on negative indices', () => {
    expect(() => getCellRange(r(0, 0, 5, 5), -1, 0)).toThrow(RangeError);
    expect(() => getCellRange(r(0, 0, 5, 5), 0, -1)).toThrow(RangeError);
  });

  it('throws on out-of-bounds indices', () => {
    expect(() => getCellRange(r(0, 0, 2, 2), 3, 0)).toThrow(RangeError);
    expect(() => getCellRange(r(0, 0, 2, 2), 0, 3)).toThrow(RangeError);
  });

  it('preserves sheetId', () => {
    expect(getCellRange(r(0, 0, 5, 5, { sheetId: 's1' }), 0, 0).sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getRowsAbove
// ---------------------------------------------------------------------------
describe('getRowsAbove', () => {
  it('returns 1 row above by default', () => {
    const result = getRowsAbove(r(5, 2, 8, 6));
    expect(result).toEqual(r(4, 2, 4, 6));
  });

  it('returns n rows above', () => {
    const result = getRowsAbove(r(5, 2, 8, 6), 3);
    expect(result).toEqual(r(2, 2, 4, 6));
  });

  it('returns null when range starts at row 0', () => {
    expect(getRowsAbove(r(0, 0, 3, 3))).toBeNull();
  });

  it('clamps count to available rows', () => {
    const result = getRowsAbove(r(2, 0, 5, 3), 10);
    expect(result).not.toBeNull();
    expect(result!.startRow).toBe(0);
    expect(result!.endRow).toBe(1);
  });

  it('throws on isFullRow input', () => {
    expect(() => getRowsAbove(r(2, 0, 5, MAX_COLS - 1, { isFullRow: true }))).toThrow(RangeError);
  });

  it('preserves sheetId and col bounds', () => {
    const result = getRowsAbove(r(5, 2, 8, 6, { sheetId: 's1' }));
    expect(result?.sheetId).toBe('s1');
    expect(result?.startCol).toBe(2);
    expect(result?.endCol).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// getRowsBelow
// ---------------------------------------------------------------------------
describe('getRowsBelow', () => {
  it('returns 1 row below by default', () => {
    const result = getRowsBelow(r(5, 2, 8, 6));
    expect(result).toEqual(r(9, 2, 9, 6));
  });

  it('returns n rows below', () => {
    const result = getRowsBelow(r(5, 2, 8, 6), 3);
    expect(result).toEqual(r(9, 2, 11, 6));
  });

  it('returns null when range ends at MAX_ROWS-1', () => {
    expect(getRowsBelow(r(MAX_ROWS - 5, 0, MAX_ROWS - 1, 3))).toBeNull();
  });

  it('clamps count to available rows', () => {
    const result = getRowsBelow(r(MAX_ROWS - 5, 0, MAX_ROWS - 3, 3), 10);
    expect(result).not.toBeNull();
    expect(result!.startRow).toBe(MAX_ROWS - 2);
    expect(result!.endRow).toBe(MAX_ROWS - 1);
  });

  it('throws on isFullRow input', () => {
    expect(() => getRowsBelow(r(2, 0, 5, MAX_COLS - 1, { isFullRow: true }))).toThrow(RangeError);
  });

  it('preserves sheetId', () => {
    expect(getRowsBelow(r(0, 0, 2, 2, { sheetId: 's1' }))?.sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getColumnsBefore
// ---------------------------------------------------------------------------
describe('getColumnsBefore', () => {
  it('returns 1 column before by default', () => {
    const result = getColumnsBefore(r(2, 5, 6, 8));
    expect(result).toEqual(r(2, 4, 6, 4));
  });

  it('returns null when range starts at col 0', () => {
    expect(getColumnsBefore(r(0, 0, 3, 3))).toBeNull();
  });

  it('clamps count to available columns', () => {
    const result = getColumnsBefore(r(0, 2, 3, 5), 10);
    expect(result).not.toBeNull();
    expect(result!.startCol).toBe(0);
    expect(result!.endCol).toBe(1);
  });

  it('throws on isFullColumn input', () => {
    expect(() => getColumnsBefore(r(0, 2, MAX_ROWS - 1, 5, { isFullColumn: true }))).toThrow(
      RangeError,
    );
  });

  it('preserves sheetId', () => {
    expect(getColumnsBefore(r(0, 5, 3, 8, { sheetId: 's1' }))?.sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// getColumnsAfter
// ---------------------------------------------------------------------------
describe('getColumnsAfter', () => {
  it('returns 1 column after by default', () => {
    const result = getColumnsAfter(r(2, 5, 6, 8));
    expect(result).toEqual(r(2, 9, 6, 9));
  });

  it('returns null when range ends at MAX_COLS-1', () => {
    expect(getColumnsAfter(r(0, MAX_COLS - 5, 3, MAX_COLS - 1))).toBeNull();
  });

  it('throws on isFullColumn input', () => {
    expect(() => getColumnsAfter(r(0, 2, MAX_ROWS - 1, 5, { isFullColumn: true }))).toThrow(
      RangeError,
    );
  });

  it('preserves sheetId', () => {
    expect(getColumnsAfter(r(0, 0, 3, 3, { sheetId: 's1' }))?.sheetId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// containsRange
// ---------------------------------------------------------------------------
describe('containsRange', () => {
  it('returns true when outer fully contains inner', () => {
    expect(containsRange(r(0, 0, 10, 10), r(2, 2, 5, 5))).toBe(true);
  });

  it('returns false for partial overlap', () => {
    expect(containsRange(r(0, 0, 5, 5), r(3, 3, 8, 8))).toBe(false);
  });

  it('returns true for identical ranges', () => {
    const range = r(1, 1, 4, 4);
    expect(containsRange(range, range)).toBe(true);
  });

  it('returns false for disjoint ranges', () => {
    expect(containsRange(r(0, 0, 2, 2), r(5, 5, 8, 8))).toBe(false);
  });

  it('throws on sheetId mismatch', () => {
    expect(() =>
      containsRange(r(0, 0, 10, 10, { sheetId: 'a' }), r(1, 1, 2, 2, { sheetId: 'b' })),
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// rangesOverlap
// ---------------------------------------------------------------------------
describe('rangesOverlap', () => {
  it('returns true for overlapping ranges', () => {
    expect(rangesOverlap(r(0, 0, 5, 5), r(3, 3, 8, 8))).toBe(true);
  });

  it('returns false for disjoint ranges', () => {
    expect(rangesOverlap(r(0, 0, 2, 2), r(5, 5, 8, 8))).toBe(false);
  });

  it('returns false for adjacent but non-overlapping ranges', () => {
    expect(rangesOverlap(r(0, 0, 2, 2), r(3, 0, 5, 2))).toBe(false);
    expect(rangesOverlap(r(0, 0, 2, 2), r(0, 3, 2, 5))).toBe(false);
  });

  it('returns true for identical ranges', () => {
    const range = r(1, 1, 4, 4);
    expect(rangesOverlap(range, range)).toBe(true);
  });

  it('throws on sheetId mismatch', () => {
    expect(() =>
      rangesOverlap(r(0, 0, 5, 5, { sheetId: 'a' }), r(0, 0, 5, 5, { sheetId: 'b' })),
    ).toThrow(RangeError);
  });
});
