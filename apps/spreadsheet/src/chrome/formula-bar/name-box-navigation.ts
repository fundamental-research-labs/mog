import type { CellRange } from '@mog-sdk/contracts/core';
import type { ParsedCellRange } from '@mog-sdk/contracts/utils';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { getSelectionViewportFollowCell } from '../../systems/shared/types';

export interface NameBoxRangeSelection {
  range: CellRange;
  activeCell: CellCoord;
  anchor: CellCoord;
  viewportFollowCell: CellCoord;
}

function rangeFromParsedCellRange(parsedRange: ParsedCellRange): CellRange {
  return {
    startRow: parsedRange.startRow,
    startCol: parsedRange.startCol,
    endRow: parsedRange.endRow,
    endCol: parsedRange.endCol,
    ...(parsedRange.isFullColumn ? { isFullColumn: true } : {}),
    ...(parsedRange.isFullRow ? { isFullRow: true } : {}),
  };
}

export function createNameBoxRangeSelection(parsedRange: ParsedCellRange): NameBoxRangeSelection {
  const activeCell = {
    row: parsedRange.startRow,
    col: parsedRange.startCol,
  };
  const anchor = activeCell;
  const range = rangeFromParsedCellRange(parsedRange);

  return {
    range,
    activeCell,
    anchor,
    viewportFollowCell: getSelectionViewportFollowCell(range, activeCell, anchor),
  };
}
