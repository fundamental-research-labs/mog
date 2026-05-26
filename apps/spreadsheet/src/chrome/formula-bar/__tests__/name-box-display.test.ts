import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';
import { formatNameBoxSelection } from '../name-box-display';

describe('formatNameBoxSelection', () => {
  it('shows the active cell for the select-all corner sheet-wide range', () => {
    const range: CellRange = {
      startRow: 0,
      startCol: 0,
      endRow: MAX_ROWS - 1,
      endCol: MAX_COLS - 1,
      isFullRow: true,
      isFullColumn: true,
    };

    expect(formatNameBoxSelection([range], { row: 0, col: 0 })).toBe('A1');
  });

  it('uses compact full-column and full-row notation instead of max-bound cell ranges', () => {
    expect(
      formatNameBoxSelection(
        [{ startRow: 0, startCol: 1, endRow: MAX_ROWS - 1, endCol: 1, isFullColumn: true }],
        { row: 0, col: 1 },
      ),
    ).toBe('B:B');

    expect(
      formatNameBoxSelection(
        [{ startRow: 2, startCol: 0, endRow: 2, endCol: MAX_COLS - 1, isFullRow: true }],
        { row: 2, col: 0 },
      ),
    ).toBe('3:3');
  });

  it('preserves ordinary single-cell, rectangular, and multi-range display', () => {
    expect(
      formatNameBoxSelection([{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }], {
        row: 0,
        col: 0,
      }),
    ).toBe('A1');

    expect(
      formatNameBoxSelection([{ startRow: 0, startCol: 0, endRow: 4, endCol: 2 }], {
        row: 0,
        col: 0,
      }),
    ).toBe('A1:C5');

    expect(
      formatNameBoxSelection(
        [
          { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
          { startRow: 3, startCol: 3, endRow: 4, endCol: 4 },
        ],
        { row: 0, col: 0 },
      ),
    ).toBe('A1:B2,D4:E5');
  });
});
