import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { displayStringOrNull, type CellRange } from '@mog-sdk/contracts/core';

/**
 * Auto-fit row heights affected by a bounded formatting change on the active sheet.
 *
 * Full-column selections are intentionally skipped because they can cover every
 * worksheet row; renderer/layout paths recompute those heights lazily.
 *
 * For finite visible ranges, rows are only affected when at least one changed
 * cell has displayable content. Formatting an empty cell cannot change row
 * height, so avoid a no-op layout mutation on that path. If a range is outside
 * the viewport or spans a full row, keep the conservative existing behavior.
 */
export async function autoFitRowsForBoundedRanges(
  deps: ActionDependencies,
  ranges: CellRange[],
): Promise<void> {
  const boundedRanges = ranges.filter((r) => !r.isFullColumn);
  if (boundedRanges.length === 0) return;

  const rowSet = new Set<number>();
  const viewport = deps.workbook.activeSheet.viewport;
  const viewportBounds = viewport.getBounds();

  for (const range of boundedRanges) {
    const startRow = Math.min(range.startRow, range.endRow);
    const endRow = Math.max(range.startRow, range.endRow);

    if (range.isFullRow || !viewportBounds) {
      addRows(rowSet, startRow, endRow);
      continue;
    }

    const startCol = Math.min(range.startCol, range.endCol);
    const endCol = Math.max(range.startCol, range.endCol);

    const rangeIsVisible =
      startRow >= viewportBounds.startRow &&
      endRow <= viewportBounds.endRow &&
      startCol >= viewportBounds.startCol &&
      endCol <= viewportBounds.endCol;

    if (!rangeIsVisible) {
      addRows(rowSet, startRow, endRow);
      continue;
    }

    for (let row = startRow; row <= endRow; row++) {
      if (rowHasDisplayableContentInRange(viewport, row, startCol, endCol)) {
        rowSet.add(row);
      }
    }
  }

  if (rowSet.size === 0) return;
  await deps.workbook.activeSheet.layout.autoFitRows(Array.from(rowSet));
}

function addRows(rowSet: Set<number>, startRow: number, endRow: number): void {
  for (let row = startRow; row <= endRow; row++) {
    rowSet.add(row);
  }
}

function rowHasDisplayableContentInRange(
  viewport: ActionDependencies['workbook']['activeSheet']['viewport'],
  row: number,
  startCol: number,
  endCol: number,
): boolean {
  for (let col = startCol; col <= endCol; col++) {
    const displayText = displayStringOrNull(viewport.getCellData(row, col)?.displayText ?? null);
    if (displayText && displayText.length > 0) {
      return true;
    }
  }
  return false;
}
