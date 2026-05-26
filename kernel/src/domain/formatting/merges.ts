/**
 * Merges Domain Module
 *
 * Delegates all merge operations to ComputeBridge (Rust compute core).
 * Pure functions that take DocumentContext as first parameter.
 *
 * Architecture:
 * - WRITE operations: delegate to ctx.computeBridge.mergeRange/unmergeRange
 * - READ operations: delegate to ctx.computeBridge.getAllMergesInSheet/getMergeAtCell
 * - Events are emitted by MutationResultHandler (not here)
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { StructureChangeSource } from '@mog-sdk/contracts/event-base';

import type { DocumentContext } from '../../context/types';

// =============================================================================
// Types — re-exported from generated compute-types
// =============================================================================

export type { CellMergeInfo, ResolvedMergedRegion } from '../../bridges/compute/compute-types.gen';

import type { CellMergeInfo, ResolvedMergedRegion } from '../../bridges/compute/compute-types.gen';

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Check if two ranges overlap.
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
  return !(
    r1EndRow < r2StartRow ||
    r1StartRow > r2EndRow ||
    r1EndCol < r2StartCol ||
    r1StartCol > r2EndCol
  );
}

// =============================================================================
// Merge Range
// =============================================================================

/**
 * Merge a range of cells.
 *
 * Delegates to ComputeBridge.mergeCells(). The Rust compute core handles
 * validation, overlap checks, value clearing, and merge storage.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row (inclusive)
 * @param startCol - Start column (inclusive)
 * @param endRow - End row (inclusive)
 * @param endCol - End column (inclusive)
 * @param _origin - Origin of the change (unused — Rust handles event emission)
 */
export async function mergeRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  _origin: StructureChangeSource = 'user',
): Promise<void> {
  await ctx.computeBridge.mergeRange(sheetId, startRow, startCol, endRow, endCol);
}

// =============================================================================
// Merge Across
// =============================================================================

/**
 * Merge cells across each row separately.
 *
 * Unlike mergeRange which creates a single merge spanning all rows,
 * mergeAcross creates separate horizontal merges for each row in the selection.
 * This matches Excel's "Merge Across" behavior.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row (inclusive)
 * @param startCol - Start column (inclusive)
 * @param endRow - End row (inclusive)
 * @param endCol - End column (inclusive)
 * @param origin - Origin of the change
 */
export async function mergeAcross(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  origin: StructureChangeSource = 'user',
): Promise<void> {
  // Validate range - must span at least 2 columns
  if (startCol >= endCol) return;
  if (startRow > endRow) return;

  // Create a separate merge for each row
  for (let row = startRow; row <= endRow; row++) {
    await mergeRange(ctx, sheetId, row, startCol, row, endCol, origin);
  }
}

/**
 * Check if merging a range would cause data loss.
 *
 * NOTE: With ComputeBridge delegation, data loss checking is handled by
 * the Rust compute core during the merge operation itself. This function
 * is kept for API compatibility but returns a conservative result.
 * Callers should handle merge failures from the compute bridge instead.
 *
 * @param _ctx - Store context (unused)
 * @param _sheetId - Sheet ID (unused)
 * @param _startRow - Start row (unused)
 * @param _startCol - Start column (unused)
 * @param _endRow - End row (unused)
 * @param _endCol - End column (unused)
 * @returns Conservative result — data loss checking is deferred to Rust
 */
export function checkMergeDataLoss(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _startRow: number,
  _startCol: number,
  _endRow: number,
  _endCol: number,
): { hasDataLoss: boolean; cellsWithData: number } {
  // Data loss checking is now handled by Rust compute core
  return { hasDataLoss: false, cellsWithData: 0 };
}

// =============================================================================
// Merge and Center
// =============================================================================

/**
 * Merge cells and apply center alignment.
 *
 * This is a convenience function that combines unmerge + mergeRange.
 * Center alignment must be applied separately via Mutations.setFormat().
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row (inclusive)
 * @param startCol - Start column (inclusive)
 * @param endRow - End row (inclusive)
 * @param endCol - End column (inclusive)
 * @param origin - Origin of the change
 */
export async function mergeAndCenter(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  origin: StructureChangeSource = 'user',
): Promise<void> {
  // First unmerge any existing merges in the range
  await unmergeRange(ctx, sheetId, startRow, startCol, endRow, endCol, origin);

  // Then create the new merge
  await mergeRange(ctx, sheetId, startRow, startCol, endRow, endCol, origin);
}

// =============================================================================
// Unmerge Range
// =============================================================================

/**
 * Unmerge cells in a range.
 *
 * Delegates to ComputeBridge.unmergeCells(). The Rust compute core finds
 * and removes any merges whose origin falls within the range.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row (inclusive)
 * @param startCol - Start column (inclusive)
 * @param endRow - End row (inclusive)
 * @param endCol - End column (inclusive)
 * @param _origin - Origin of the change (unused — Rust handles event emission)
 */
export async function unmergeRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  _origin: StructureChangeSource = 'user',
): Promise<void> {
  await ctx.computeBridge.unmergeRange(sheetId, startRow, startCol, endRow, endCol);
}

// =============================================================================
// Get Merged Regions
// =============================================================================

/**
 * Get all merged regions for a sheet with resolved positions.
 *
 * Delegates to ComputeBridge.getAllMergesInSheet().
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise of resolved merged regions
 */
export async function getAll(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<ResolvedMergedRegion[]> {
  const merges = await ctx.computeBridge.getAllMergesInSheet(sheetId);
  return merges;
}

/**
 * Get merged regions that intersect with a range.
 * Used for clipboard paste operations and range-based queries.
 *
 * Fetches all merges then filters client-side for overlap.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Range start row
 * @param startCol - Range start column
 * @param endRow - Range end row
 * @param endCol - Range end column
 * @returns Promise of resolved merged regions that overlap with the range
 */
export async function getInRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): Promise<ResolvedMergedRegion[]> {
  const allMerges = await ctx.computeBridge.getAllMergesInSheet(sheetId);
  const regions: ResolvedMergedRegion[] = [];

  for (const vm of allMerges) {
    if (
      rangesOverlap(
        vm.startRow,
        vm.startCol,
        vm.endRow,
        vm.endCol,
        startRow,
        startCol,
        endRow,
        endCol,
      )
    ) {
      regions.push(vm);
    }
  }

  return regions;
}

/**
 * Get merged regions that intersect with a viewport.
 * Used for efficient rendering - only returns merges visible in the viewport.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param viewportStartRow - Viewport start row
 * @param viewportStartCol - Viewport start column
 * @param viewportEndRow - Viewport end row
 * @param viewportEndCol - Viewport end column
 * @returns Promise of resolved merged regions in viewport
 */
export async function getInViewport(
  ctx: DocumentContext,
  sheetId: SheetId,
  viewportStartRow: number,
  viewportStartCol: number,
  viewportEndRow: number,
  viewportEndCol: number,
): Promise<ResolvedMergedRegion[]> {
  const allMerges = await ctx.computeBridge.getAllMergesInSheet(sheetId);
  const regions: ResolvedMergedRegion[] = [];

  for (const vm of allMerges) {
    if (
      rangesOverlap(
        vm.startRow,
        vm.startCol,
        vm.endRow,
        vm.endCol,
        viewportStartRow,
        viewportStartCol,
        viewportEndRow,
        viewportEndCol,
      )
    ) {
      regions.push(vm);
    }
  }

  return regions;
}

// =============================================================================
// Get Merge For Cell
// =============================================================================

/**
 * Get the merge containing a specific cell, if any.
 *
 * Delegates to ComputeBridge.getMergeAtCellQuery().
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Cell row
 * @param col - Cell column
 * @returns Promise of merge info if cell is in a merge, null otherwise
 */
export async function getForCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellMergeInfo | null> {
  return ctx.computeBridge.getMergeAtCellQuery(sheetId, row, col);
}

/**
 * Check if a cell is the origin (top-left) of a merge.
 *
 * Delegates to ComputeBridge.getMergeAtCellQuery().
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Cell row
 * @param col - Cell column
 * @returns Promise — true if this cell is a merge origin
 */
export async function isOrigin(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  const info = await ctx.computeBridge.getMergeAtCellQuery(sheetId, row, col);
  if (!info) return false;
  return info.isOrigin;
}

// =============================================================================
// Clear Merged Regions
// =============================================================================

/**
 * Clear all merged regions for a sheet.
 * Used during import to reset merges before loading new data.
 *
 * Fetches all merges then unmerges each one via ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param _origin - Origin of the change (unused — Rust handles event emission)
 */
export async function clearAll(
  ctx: DocumentContext,
  sheetId: SheetId,
  _origin: StructureChangeSource = 'user',
): Promise<void> {
  const merges = await ctx.computeBridge.getAllMergesInSheet(sheetId);
  for (const vm of merges) {
    await ctx.computeBridge.unmergeRange(sheetId, vm.startRow, vm.startCol, vm.endRow, vm.endCol);
  }
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate and clean invalid merges.
 *
 * With ComputeBridge delegation, the Rust compute core handles merge
 * validity internally. This is a no-op kept for API compatibility.
 *
 * @param _ctx - Store context (unused)
 * @param _sheetId - Sheet ID (unused)
 * @param _origin - Origin of the change (unused)
 * @returns Always 0 — validation is handled by Rust
 */
export function validateAndClean(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _origin: StructureChangeSource = 'user',
): number {
  // Rust compute core handles merge validation internally
  return 0;
}

// =============================================================================
// Subscribe to Merges
// =============================================================================

/**
 * Subscribe to merge changes for a specific sheet.
 *
 * NOTE: With ComputeBridge delegation, merge change events are emitted
 * by MutationResultHandler. This function is kept for API compatibility
 * but returns a no-op unsubscribe. Consumers should migrate to listening
 * for merge change events on the event bus instead.
 *
 * @param _ctx - Store context (unused)
 * @param _sheetId - Sheet ID (unused)
 * @param _callback - Called when merges change (unused)
 * @returns No-op unsubscribe function
 */
export function subscribe(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _callback: (merges: ResolvedMergedRegion[]) => void,
): () => void {
  // Merge change events are now emitted by MutationResultHandler
  return () => {};
}
