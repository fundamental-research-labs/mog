import type { WorksheetWithInternals } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';

function normalizeRange(range: CellRange): CellRange {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

function isMissingCommentTarget(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'COMMENT_NOT_FOUND'
  );
}

/**
 * Remove every comment at one known-occupied cell.
 *
 * Callers establish presence first, but a collaborative peer can remove the
 * target between that read and this mutation. Treat only that typed race as an
 * idempotent success; transport, admission, and other compute failures still
 * propagate to the dispatcher.
 */
export async function removeCommentsForCellIfPresent(
  worksheet: WorksheetWithInternals,
  row: number,
  col: number,
): Promise<void> {
  try {
    await worksheet.comments.removeForCell(row, col);
  } catch (error) {
    if (!isMissingCommentTarget(error)) throw error;
  }
}

/**
 * Remove every comment type from comment-backed cells inside the selected ranges.
 *
 * Comment cell references are stable identities, so resolve their current positions
 * before matching the selection. Cells are deduplicated across replies and overlapping
 * ranges, and blank selected cells are never submitted to the strict removal API.
 */
export async function clearCommentsInRanges(
  worksheet: WorksheetWithInternals,
  ranges: readonly CellRange[],
): Promise<void> {
  if (ranges.length === 0) return;

  const comments = await worksheet.comments.list();
  if (comments.length === 0) return;

  const cellRefs = [...new Set(comments.map((comment) => comment.cellRef))];
  const positions = await worksheet._internal.batchGetCellPositions(cellRefs);
  const normalizedRanges = ranges.map(normalizeRange);
  const removals: Promise<void>[] = [];
  const seenCells = new Set<string>();

  for (const cellRef of cellRefs) {
    const position = positions.get(cellRef);
    if (!position) continue;

    const isSelected = normalizedRanges.some(
      (range) =>
        position.row >= range.startRow &&
        position.row <= range.endRow &&
        position.col >= range.startCol &&
        position.col <= range.endCol,
    );
    if (!isSelected) continue;

    const key = `${position.row},${position.col}`;
    if (seenCells.has(key)) continue;
    seenCells.add(key);
    removals.push(removeCommentsForCellIfPresent(worksheet, position.row, position.col));
  }

  await Promise.all(removals);
}
