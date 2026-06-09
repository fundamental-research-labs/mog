import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';

export function isValidRestoredSelection(selection: {
  activeCell: { row: number; col: number };
  ranges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
}): boolean {
  const activeInBounds =
    selection.activeCell.row >= 0 &&
    selection.activeCell.row < MAX_ROWS &&
    selection.activeCell.col >= 0 &&
    selection.activeCell.col < MAX_COLS;
  return (
    activeInBounds &&
    selection.ranges.length > 0 &&
    selection.ranges.every(
      (range) =>
        range.startRow >= 0 &&
        range.startCol >= 0 &&
        range.endRow >= range.startRow &&
        range.endCol >= range.startCol &&
        range.endRow < MAX_ROWS &&
        range.endCol < MAX_COLS,
    )
  );
}
