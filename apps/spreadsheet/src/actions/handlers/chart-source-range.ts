import type { Worksheet } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';

import { expandToDataRegion } from './expand-to-data-region';

type HiddenBitmapMethod = 'getHiddenRowsBitmap' | 'getHiddenColumnsBitmap';
type HiddenPointMethod = 'isRowHidden' | 'isColumnHidden';

async function getHiddenBitmap(ws: Worksheet, method: HiddenBitmapMethod): Promise<Set<number>> {
  const read = ws.layout?.[method];
  if (typeof read !== 'function') {
    return new Set();
  }

  try {
    return await read.call(ws.layout);
  } catch {
    return new Set();
  }
}

function hasHiddenInSpan(hidden: Set<number>, start: number, end: number): boolean {
  for (let index = start; index <= end; index += 1) {
    if (hidden.has(index)) return true;
  }
  return false;
}

async function getHiddenInSpan(
  ws: Worksheet,
  bitmapMethod: HiddenBitmapMethod,
  pointMethod: HiddenPointMethod,
  start: number,
  end: number,
): Promise<Set<number>> {
  const hidden = await getHiddenBitmap(ws, bitmapMethod);
  if (hasHiddenInSpan(hidden, start, end)) {
    return hidden;
  }

  const isHidden = ws.layout?.[pointMethod];
  if (typeof isHidden !== 'function') {
    return hidden;
  }

  try {
    for (let index = start; index <= end; index += 1) {
      if (await isHidden.call(ws.layout, index)) {
        hidden.add(index);
      }
    }
  } catch {
    return hidden;
  }

  return hidden;
}

function leadingVisibleSpan(
  start: number,
  end: number,
  hidden: Set<number>,
): { start: number; end: number } | null {
  let visibleStart = start;
  while (visibleStart <= end && hidden.has(visibleStart)) {
    visibleStart += 1;
  }
  if (visibleStart > end) return null;

  let visibleEnd = visibleStart;
  while (visibleEnd + 1 <= end && !hidden.has(visibleEnd + 1)) {
    visibleEnd += 1;
  }
  return { start: visibleStart, end: visibleEnd };
}

function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

async function trimTrailingBlankEdges(ws: Worksheet, range: CellRange): Promise<CellRange> {
  try {
    let endCol = range.endCol;
    while (endCol > range.startCol) {
      let columnBlank = true;
      for (let row = range.startRow; row <= range.endRow; row += 1) {
        if (!isBlankValue(await ws.getValue(row, endCol))) {
          columnBlank = false;
          break;
        }
      }
      if (!columnBlank) break;
      endCol -= 1;
    }

    let endRow = range.endRow;
    while (endRow > range.startRow) {
      let rowBlank = true;
      for (let col = range.startCol; col <= endCol; col += 1) {
        if (!isBlankValue(await ws.getValue(endRow, col))) {
          rowBlank = false;
          break;
        }
      }
      if (!rowBlank) break;
      endRow -= 1;
    }

    return { ...range, endRow, endCol };
  } catch {
    return range;
  }
}

/**
 * Resolve the source range used by chart creation commands.
 *
 * Single-cell and single-row chart inputs first follow Excel current-region
 * expansion. When collapsed outline detail splits that expanded region with
 * hidden rows/columns, chart creation should use the leading visible summary
 * block instead of charting hidden detail cells or trailing visible totals.
 */
export async function resolveChartSourceRange(
  ws: Worksheet,
  sourceRange: CellRange,
  options: { trimHiddenDetail?: boolean } = {},
): Promise<CellRange> {
  const expanded = await expandToDataRegion(ws, sourceRange);
  const range = expanded ?? sourceRange;
  if (!expanded) {
    return range;
  }

  if (!options.trimHiddenDetail) {
    return range;
  }

  if (sourceRange.startRow !== sourceRange.endRow) {
    return range;
  }

  const [hiddenRows, hiddenCols] = await Promise.all([
    getHiddenInSpan(ws, 'getHiddenRowsBitmap', 'isRowHidden', range.startRow, range.endRow),
    getHiddenInSpan(ws, 'getHiddenColumnsBitmap', 'isColumnHidden', range.startCol, range.endCol),
  ]);

  const hasHiddenRows = hasHiddenInSpan(hiddenRows, range.startRow, range.endRow);
  const hasHiddenCols = hasHiddenInSpan(hiddenCols, range.startCol, range.endCol);
  if (!hasHiddenRows && !hasHiddenCols) {
    return range;
  }

  const rowSpan = hasHiddenRows
    ? leadingVisibleSpan(range.startRow, range.endRow, hiddenRows)
    : { start: range.startRow, end: range.endRow };
  const colSpan = hasHiddenCols
    ? leadingVisibleSpan(range.startCol, range.endCol, hiddenCols)
    : { start: range.startCol, end: range.endCol };
  if (!rowSpan || !colSpan) {
    return range;
  }

  return trimTrailingBlankEdges(ws, {
    startRow: rowSpan.start,
    endRow: rowSpan.end,
    startCol: colSpan.start,
    endCol: colSpan.end,
  });
}
