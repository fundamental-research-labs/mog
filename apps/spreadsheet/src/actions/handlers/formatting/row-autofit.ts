import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellRange } from '@mog-sdk/contracts/core';

/**
 * Auto-fit row heights affected by a bounded formatting change on the active sheet.
 *
 * Full-column selections are intentionally skipped because they can cover every
 * worksheet row; renderer/layout paths recompute those heights lazily.
 */
export async function autoFitRowsForBoundedRanges(
  deps: ActionDependencies,
  ranges: CellRange[],
): Promise<void> {
  const boundedRanges = ranges.filter((r) => !r.isFullColumn);
  if (boundedRanges.length === 0) return;

  const rowSet = new Set<number>();
  for (const range of boundedRanges) {
    const startRow = Math.min(range.startRow, range.endRow);
    const endRow = Math.max(range.startRow, range.endRow);
    for (let row = startRow; row <= endRow; row++) {
      rowSet.add(row);
    }
  }

  if (rowSet.size === 0) return;
  await deps.workbook.activeSheet.layout.autoFitRows(Array.from(rowSet));
}
