import type { CellRange } from '@mog-sdk/contracts/core';

export interface FillHandleDragAnchor {
  point: { x: number; y: number };
  handleCell: { row: number; col: number };
  sourceRowHasZeroHeight: boolean;
  sourceColHasZeroWidth: boolean;
}

export function getRangeBottomRightCell(range: CellRange): { row: number; col: number } {
  return {
    row: Math.max(range.startRow, range.endRow),
    col: Math.max(range.startCol, range.endCol),
  };
}

export function createFillHandleDragAnchor(
  range: CellRange,
  point: { x: number; y: number },
  rangeRect: { width: number; height: number },
  cellRect: { width: number; height: number } | null,
): FillHandleDragAnchor {
  const handleCell = getRangeBottomRightCell(range);
  const width = cellRect?.width ?? rangeRect.width;
  const height = cellRect?.height ?? rangeRect.height;

  return {
    point,
    handleCell,
    sourceRowHasZeroHeight: height <= 0,
    sourceColHasZeroWidth: width <= 0,
  };
}

export function resolveFillHandleDragCell(
  rawCell: { row: number; col: number },
  anchor: FillHandleDragAnchor | null,
  point: { x: number; y: number },
): { row: number; col: number } {
  if (!anchor) return rawCell;

  const dx = Math.abs(point.x - anchor.point.x);
  const dy = Math.abs(point.y - anchor.point.y);
  const horizontalIntent = dx >= dy;

  return {
    row: anchor.sourceRowHasZeroHeight && horizontalIntent ? anchor.handleCell.row : rawCell.row,
    col: anchor.sourceColHasZeroWidth && !horizontalIntent ? anchor.handleCell.col : rawCell.col,
  };
}
