/**
 * Sorting Domain Module
 *
 * Delegates all sorting operations to the Rust compute core via ComputeBridge.
 * The Rust side handles sort computation, row reordering, formula updates,
 * and returns a MutationResult that MutationResultHandler processes for events.
 *
 * This module provides:
 * - sortByColumn(): Convenience wrapper for column-index-based sorting
 * - checkSortRangeMerges(): Validation helper (reads merges from CB)
 */

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

import type { ResolvedMergedRegion } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context/types';

// =============================================================================
// Helper: Check for Merges in Sort Range
// =============================================================================

/**
 * Helper: Check if two ranges overlap
 */
function rangesOverlap(
  r1StartRow: number,
  r1StartCol: number,
  r1EndRow: number,
  r1EndCol: number,
  r2StartRow: number,
  r2StartCol: number,
  r2EndRow: number,
  r2EndCol: number,
): boolean {
  return (
    r1StartRow <= r2EndRow &&
    r1EndRow >= r2StartRow &&
    r1StartCol <= r2EndCol &&
    r1EndCol >= r2StartCol
  );
}

/**
 * Check if a range contains any merged cells.
 *
 * Excel refuses to sort ranges that contain merged cells.
 * This function checks for merges and returns validation result.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - Range to check
 * @returns Object with hasMerges and optional error message
 */
export async function checkSortRangeMerges(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<{ hasMerges: boolean; message?: string }> {
  const merges: ResolvedMergedRegion[] = await ctx.computeBridge.getAllMergesInSheet(sheetId);

  // Check all merges for overlap with range
  const hasMerges = merges.some((merge) =>
    rangesOverlap(
      merge.startRow,
      merge.startCol,
      merge.endRow,
      merge.endCol,
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
    ),
  );

  if (hasMerges) {
    return {
      hasMerges: true,
      message:
        'This operation requires the merged cells to be identically sized. ' +
        'To sort or filter a range with merged cells, you must unmerge them first.',
    };
  }

  return { hasMerges: false };
}

// =============================================================================
// Public API: Sort Range
// =============================================================================

// NOTE: The old CellId-based sortRange() function has been removed.
// It was unused — all callers go through sort-operations.ts which already
// uses the column-index-based BridgeSortOptions interface.
// If a CellId-based entry point is needed in the future, callers should
// resolve CellId -> column index before calling computeBridge.sortRange().

// =============================================================================
// Simple Sort: Position-Based API
// =============================================================================

/**
 * Simple sort by column index (position-based API).
 *
 * Convenience function for the existing UI that uses column indices.
 * Delegates to ComputeBridge.sortRange with a single sort key using
 * column position instead of CellId.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - Range to sort
 * @param sortColumn - Column index to sort by (absolute)
 * @param direction - Sort direction
 * @param hasHeaders - Whether range has headers
 */
export function sortByColumn(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  sortColumn: number,
  direction: 'asc' | 'desc',
  hasHeaders: boolean = false,
): void {
  const bridgeOptions = {
    criteria: [
      {
        column: sortColumn,
        direction,
        caseSensitive: false,
        mode: { kind: 'value' as const },
      },
    ],
    hasHeaders,
    visibleRowsOnly: false,
  };

  // Fire-and-forget: MutationResultHandler emits range:sorted from sorting_changes
  void ctx.computeBridge.sortRange(
    sheetId,
    range.startRow,
    range.startCol,
    range.endRow,
    range.endCol,
    bridgeOptions,
  );
}
