/**
 * Shared row/column structure operations.
 *
 * Kept outside structure.ts so dialog handlers can directly execute whole
 * row/column shortcuts without importing another dispatcher-registered handler.
 */

import type { ActionDependencies, ActionResult } from '@mog-sdk/contracts/actions';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { CellData, Worksheet } from '@mog-sdk/contracts/api';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import {
  handled,
  isProtectionRejection,
  notHandled,
  showProtectionFeedback,
} from './handler-utils';

function getTargetSheetIds(deps: ActionDependencies): SheetId[] {
  return [deps.getActiveSheetId()];
}

function getSelectionContext(deps: ActionDependencies): {
  activeCell: { row: number; col: number };
  ranges: CellRange[];
} {
  return {
    activeCell: deps.accessors.selection.getActiveCell(),
    ranges: deps.accessors.selection.getRanges(),
  };
}

function getSelectedRows(ranges: CellRange[]): number[] {
  const rowsSet = new Set<number>();
  for (const range of ranges) {
    for (let row = range.startRow; row <= range.endRow; row++) {
      rowsSet.add(row);
    }
  }
  return Array.from(rowsSet).sort((a, b) => a - b);
}

function getSelectedRowsOrActive(
  ranges: CellRange[],
  activeCell: { row: number; col: number },
): number[] {
  const rows = getSelectedRows(ranges);
  return rows.length > 0 ? rows : [activeCell.row];
}

function getSelectedCols(ranges: CellRange[]): number[] {
  const colsSet = new Set<number>();
  for (const range of ranges) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      colsSet.add(col);
    }
  }
  return Array.from(colsSet).sort((a, b) => a - b);
}

function getSelectedColsOrActive(
  ranges: CellRange[],
  activeCell: { row: number; col: number },
): number[] {
  const cols = getSelectedCols(ranges);
  return cols.length > 0 ? cols : [activeCell.col];
}

function singleCellRange(cell: { row: number; col: number }): CellRange {
  return {
    startRow: cell.row,
    startCol: cell.col,
    endRow: cell.row,
    endCol: cell.col,
  };
}

type FormulaSpan = {
  startCol: number;
  endCol: number;
};

function cellHasFormula(cell: CellData | undefined): boolean {
  return typeof cell?.formula === 'string' && cell.formula.length > 0;
}

function cellIsEmpty(cell: CellData | undefined): boolean {
  return cell?.value == null && !cellHasFormula(cell);
}

function formulaSpansForRow(cells: CellData[], firstCol: number): FormulaSpan[] {
  const spans: FormulaSpan[] = [];
  let startCol: number | null = null;

  cells.forEach((cell, offset) => {
    const col = firstCol + offset;
    if (cellHasFormula(cell)) {
      if (startCol == null) startCol = col;
      return;
    }

    if (startCol != null) {
      spans.push({ startCol, endCol: col - 1 });
      startCol = null;
    }
  });

  if (startCol != null) {
    spans.push({ startCol, endCol: firstCol + cells.length - 1 });
  }

  return spans;
}

function rangeA1(row: number, startCol: number, endCol: number): string {
  const start = toA1(row, startCol);
  const end = toA1(row, endCol);
  return start === end ? start : `${start}:${end}`;
}

async function fillInsertedRowFormulaSpans(
  ws: Worksheet,
  insertAt: number,
  sourceDirection: 'above' | 'below',
): Promise<void> {
  const usedRange = await ws.getUsedRange().catch(() => null);
  if (!usedRange) return;

  const startCol = usedRange.startCol;
  const endCol = usedRange.endCol;
  if (startCol > endCol) return;

  const sourceRow = sourceDirection === 'below' ? insertAt + 1 : insertAt - 1;
  if (sourceRow < usedRange.startRow || sourceRow > usedRange.endRow) return;

  const [sourceCells] = await ws
    .getRange({ startRow: sourceRow, startCol, endRow: sourceRow, endCol })
    .catch(() => [[] as CellData[]]);
  const spans = formulaSpansForRow(sourceCells ?? [], startCol);
  if (spans.length === 0) return;

  const [targetCells] = await ws
    .getRange({ startRow: insertAt, startCol, endRow: insertAt, endCol })
    .catch(() => [[] as CellData[]]);

  for (const span of spans) {
    const targetStartOffset = span.startCol - startCol;
    const targetEndOffset = span.endCol - startCol;
    const targetSpanCells = (targetCells ?? []).slice(targetStartOffset, targetEndOffset + 1);
    if (!targetSpanCells.every(cellIsEmpty)) continue;

    await ws.autoFill(
      rangeA1(sourceRow, span.startCol, span.endCol),
      rangeA1(insertAt, span.startCol, span.endCol),
      'withoutFormats',
    );
  }
}

export async function insertRowAboveSelection(deps: ActionDependencies): Promise<ActionResult> {
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);
  const rows = getSelectedRowsOrActive(ranges, activeCell);
  const insertAt = rows[0];

  try {
    for (const sheetId of targetSheetIds) {
      const ws = deps.workbook.getSheetById(sheetId);
      await ws.structure.insertRows(insertAt, 1);
      await fillInsertedRowFormulaSpans(ws, insertAt, 'below');
    }
  } catch (err) {
    if (isProtectionRejection(err)) {
      showProtectionFeedback(deps, (err as Error).message);
      return notHandled('disabled');
    }
    throw err;
  }

  const nextActiveCell = { row: insertAt, col: activeCell.col };
  deps.commands.selection.setSelection([singleCellRange(nextActiveCell)], nextActiveCell);

  return handled();
}

export async function insertColumnLeftSelection(deps: ActionDependencies): Promise<ActionResult> {
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);
  const cols = getSelectedColsOrActive(ranges, activeCell);
  const insertAt = cols[0];

  try {
    for (const sheetId of targetSheetIds) {
      const ws = deps.workbook.getSheetById(sheetId);
      await ws.structure.insertColumns(insertAt, 1);
    }
  } catch (err) {
    if (isProtectionRejection(err)) {
      showProtectionFeedback(deps, (err as Error).message);
      return notHandled('disabled');
    }
    throw err;
  }

  const nextActiveCell = { row: activeCell.row, col: insertAt };
  deps.commands.selection.setSelection([singleCellRange(nextActiveCell)], nextActiveCell);

  return handled();
}

export async function deleteSelectedRows(deps: ActionDependencies): Promise<ActionResult> {
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);
  const rows = getSelectedRowsOrActive(ranges, activeCell);
  const sortedDesc = [...rows].sort((a, b) => b - a);

  try {
    for (const sheetId of targetSheetIds) {
      const ws = deps.workbook.getSheetById(sheetId);
      let i = 0;
      while (i < sortedDesc.length) {
        const startRow = sortedDesc[i];
        let count = 1;

        while (i + count < sortedDesc.length && sortedDesc[i + count] === startRow - count) {
          count++;
        }

        const actualStartRow = startRow - count + 1;
        await ws.structure.deleteRows(actualStartRow, count);

        i += count;
      }
    }
  } catch (err) {
    if (isProtectionRejection(err)) {
      showProtectionFeedback(deps, (err as Error).message);
      return notHandled('disabled');
    }
    throw err;
  }

  const nextActiveCell = { row: rows[0], col: activeCell.col };
  deps.commands.selection.setSelection([singleCellRange(nextActiveCell)], nextActiveCell);

  return handled();
}

export async function deleteSelectedColumns(deps: ActionDependencies): Promise<ActionResult> {
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);
  const cols = getSelectedColsOrActive(ranges, activeCell);
  const sortedDesc = [...cols].sort((a, b) => b - a);

  try {
    for (const sheetId of targetSheetIds) {
      const ws = deps.workbook.getSheetById(sheetId);
      let i = 0;
      while (i < sortedDesc.length) {
        const startCol = sortedDesc[i];
        let count = 1;

        while (i + count < sortedDesc.length && sortedDesc[i + count] === startCol - count) {
          count++;
        }

        const actualStartCol = startCol - count + 1;
        await ws.structure.deleteColumns(actualStartCol, count);

        i += count;
      }
    }
  } catch (err) {
    if (isProtectionRejection(err)) {
      showProtectionFeedback(deps, (err as Error).message);
      return notHandled('disabled');
    }
    throw err;
  }

  const nextActiveCell = { row: activeCell.row, col: cols[0] };
  deps.commands.selection.setSelection([singleCellRange(nextActiveCell)], nextActiveCell);

  return handled();
}
