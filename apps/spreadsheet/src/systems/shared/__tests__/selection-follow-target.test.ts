import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import { getSelectionViewportFollowCell } from '../types';

describe('getSelectionViewportFollowCell', () => {
  it('follows the moving edge for extended selections', () => {
    expect(
      getSelectionViewportFollowCell(
        { startRow: 0, startCol: 0, endRow: 4, endCol: 2 },
        { row: 0, col: 0 },
        { row: 0, col: 0 },
      ),
    ).toEqual({ row: 4, col: 2 });
  });

  it('keeps select-all viewport follow at the active cell instead of XFD1048576', () => {
    expect(
      getSelectionViewportFollowCell(
        {
          startRow: 0,
          startCol: 0,
          endRow: MAX_ROWS - 1,
          endCol: MAX_COLS - 1,
          isFullRow: true,
          isFullColumn: true,
        },
        { row: 0, col: 0 },
        { row: 0, col: 0 },
      ),
    ).toEqual({ row: 0, col: 0 });
  });

  it('follows the moving row edge for full-row selections without jumping to XFD', () => {
    expect(
      getSelectionViewportFollowCell(
        {
          startRow: 2,
          startCol: 0,
          endRow: 5,
          endCol: MAX_COLS - 1,
          isFullRow: true,
        },
        { row: 2, col: 0 },
        { row: 2, col: 0 },
      ),
    ).toEqual({ row: 5, col: 0 });
  });

  it('follows the moving column edge for full-column selections without jumping to row 1048576', () => {
    expect(
      getSelectionViewportFollowCell(
        {
          startRow: 0,
          startCol: 1,
          endRow: MAX_ROWS - 1,
          endCol: 3,
          isFullColumn: true,
        },
        { row: 0, col: 1 },
        { row: 0, col: 1 },
      ),
    ).toEqual({ row: 0, col: 3 });
  });
});
