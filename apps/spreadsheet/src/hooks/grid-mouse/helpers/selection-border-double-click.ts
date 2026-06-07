import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';

export type SelectionBorderEdge = 'left' | 'right' | 'up' | 'down';

export interface SelectionBorderCellCoord {
  row: number;
  col: number;
}

export interface SelectionBorderCellData {
  value?: unknown;
  formula?: unknown;
  formatted?: unknown;
}

export interface SelectionBorderWorksheet {
  findDataEdge(
    row: number,
    col: number,
    direction: SelectionBorderEdge,
  ): Promise<SelectionBorderCellCoord>;
  getCell(row: number, col: number): Promise<SelectionBorderCellData>;
}

export interface SelectionBorderSheetBounds {
  maxRows: number;
  maxCols: number;
}

const DEFAULT_SHEET_BOUNDS: SelectionBorderSheetBounds = {
  maxRows: MAX_ROWS,
  maxCols: MAX_COLS,
};

function cellDataHasAuthoredContent(cellData: SelectionBorderCellData): boolean {
  if (typeof cellData.formula === 'string' && cellData.formula.length > 0) return true;
  if (cellData.value !== null && cellData.value !== undefined && cellData.value !== '') return true;
  return typeof cellData.formatted === 'string' && cellData.formatted.length > 0;
}

function isTerminalRightOrDownTarget(
  edge: SelectionBorderEdge,
  targetCell: SelectionBorderCellCoord,
  bounds: SelectionBorderSheetBounds,
): boolean {
  return (
    (edge === 'right' && targetCell.col === bounds.maxCols - 1) ||
    (edge === 'down' && targetCell.row === bounds.maxRows - 1)
  );
}

export async function resolveSelectionBorderDoubleClickTarget(
  ws: SelectionBorderWorksheet,
  activeCell: SelectionBorderCellCoord,
  edge: SelectionBorderEdge,
  bounds: SelectionBorderSheetBounds = DEFAULT_SHEET_BOUNDS,
): Promise<SelectionBorderCellCoord | null> {
  const targetCell = await ws.findDataEdge(activeCell.row, activeCell.col, edge);

  // Excel keeps selected-border right/bottom double-clicks in place for a
  // wholly empty region. Ctrl+Arrow data-edge search resolves those regions to
  // the sheet terminal cell, so suppress only that empty terminal case.
  if (isTerminalRightOrDownTarget(edge, targetCell, bounds)) {
    const boundaryCell = await ws.getCell(targetCell.row, targetCell.col).catch(() => null);
    if (!boundaryCell || !cellDataHasAuthoredContent(boundaryCell)) {
      return null;
    }
  }

  return targetCell;
}
