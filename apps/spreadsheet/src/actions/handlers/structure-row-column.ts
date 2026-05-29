/**
 * Shared row/column structure operations.
 *
 * Kept outside structure.ts so dialog handlers can directly execute whole
 * row/column shortcuts without importing another dispatcher-registered handler.
 */

import type { ActionDependencies, ActionResult } from '@mog-sdk/contracts/actions';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

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

export async function insertRowAboveSelection(deps: ActionDependencies): Promise<ActionResult> {
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);
  const rows = getSelectedRowsOrActive(ranges, activeCell);
  const insertAt = rows[0];

  try {
    for (const sheetId of targetSheetIds) {
      const ws = deps.workbook.getSheetById(sheetId);
      await ws.structure.insertRows(insertAt, 1);
    }
  } catch (err) {
    if (isProtectionRejection(err)) {
      showProtectionFeedback(deps, (err as Error).message);
      return notHandled('disabled');
    }
    throw err;
  }

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

  return handled();
}
