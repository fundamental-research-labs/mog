/**
 * Merge Operations Module
 *
 * Standalone functions for cell merge operations extracted from SheetAPI.
 * All functions take DocumentContext and sheetId as the first two parameters.
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  CellFormat,
  CellRange,
  DocumentContext,
  MergedRegion,
  OperationResult,
} from './shared';
import { invalidRange, operationFailed } from './shared';

import * as Merges from '../../../domain/formatting/merges';

import { isValidRange, normalizeRange, toA1 } from '../../internal/utils';

// =============================================================================
// Merge Operations
// =============================================================================

/**
 * Merge cells in a range.
 *
 * Creates a merged region where the top-left cell contains the value
 * and spans across all cells in the range. Other cells in the range
 * are cleared.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - The range to merge
 * @returns OperationResult with the merge info, or error if range is invalid/overlaps
 *
 * @example
 * ```typescript
 * // Merge cells A1:B2
 * const result = mergeCells(ctx, sheetId, { startRow: 0, startCol: 0, endRow: 1, endCol: 1 });
 * if (result.success) {
 *   console.log('Merged region created');
 * }
 * ```
 */
export async function mergeCells(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<OperationResult<MergedRegion>> {
  if (!isValidRange(range)) {
    return {
      success: false,
      error: invalidRange(range.startRow, range.startCol, range.endRow, range.endCol),
    };
  }

  const normalized = normalizeRange(range);

  // Check for single cell (invalid merge)
  if (normalized.startRow === normalized.endRow && normalized.startCol === normalized.endCol) {
    return {
      success: false,
      error: operationFailed('mergeCells', 'Cannot merge a single cell'),
    };
  }

  try {
    await Merges.mergeRange(
      ctx,
      sheetId,
      normalized.startRow,
      normalized.startCol,
      normalized.endRow,
      normalized.endCol,
      'api',
    );

    // Build result from the normalized range
    const info: MergedRegion = {
      range: `${toA1(normalized.startRow, normalized.startCol)}:${toA1(normalized.endRow, normalized.endCol)}`,
      startRow: normalized.startRow,
      startCol: normalized.startCol,
      endRow: normalized.endRow,
      endCol: normalized.endCol,
      rowSpan: normalized.endRow - normalized.startRow + 1,
      colSpan: normalized.endCol - normalized.startCol + 1,
    };

    return { success: true, data: info };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('mergeCells', String(e)),
    };
  }
}

/**
 * Unmerge cells in a range.
 *
 * Removes any merged regions whose origin falls within the given range.
 * The origin cell retains its value.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - The range to unmerge
 * @returns OperationResult indicating success
 */
export async function unmergeCells(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<OperationResult<void>> {
  if (!isValidRange(range)) {
    return {
      success: false,
      error: invalidRange(range.startRow, range.startCol, range.endRow, range.endCol),
    };
  }

  const normalized = normalizeRange(range);

  try {
    await Merges.unmergeRange(
      ctx,
      sheetId,
      normalized.startRow,
      normalized.startCol,
      normalized.endRow,
      normalized.endCol,
      'api',
    );

    return { success: true, data: undefined };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('unmergeCells', String(e)),
    };
  }
}

/**
 * Get all merged regions in a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise of merged regions with their resolved positions
 */
export async function getMergedRegions(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<MergedRegion[]> {
  const regions = await Merges.getAll(ctx, sheetId);
  return regions.map((region) => ({
    range: `${toA1(region.startRow, region.startCol)}:${toA1(region.endRow, region.endCol)}`,
    startRow: region.startRow,
    startCol: region.startCol,
    endRow: region.endRow,
    endCol: region.endCol,
    rowSpan: region.rowSpan,
    colSpan: region.colSpan,
  }));
}

/**
 * Get the merge containing a specific cell, if any.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns Promise of merge info if cell is in a merge, undefined otherwise
 */
export async function getMergeAt(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<MergedRegion | undefined> {
  const info = await Merges.getForCell(ctx, sheetId, row, col);
  if (!info) return undefined;

  return {
    range: `${toA1(info.merge.startRow, info.merge.startCol)}:${toA1(info.merge.endRow, info.merge.endCol)}`,
    startRow: info.merge.startRow,
    startCol: info.merge.startCol,
    endRow: info.merge.endRow,
    endCol: info.merge.endCol,
    rowSpan: info.merge.rowSpan,
    colSpan: info.merge.colSpan,
  };
}

/**
 * Merge cells in a range and apply center horizontal alignment.
 *
 * This is a convenience function that combines merge + center alignment,
 * matching Excel's "Merge & Center" button behavior. Any existing merges
 * in the range are removed first, then the new merge is created and
 * center alignment is applied to the top-left (origin) cell.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - The range to merge and center
 * @returns OperationResult with the merge info, or error if range is invalid
 *
 * @example
 * ```typescript
 * const result = mergeAndCenter(ctx, sheetId, { startRow: 0, startCol: 0, endRow: 1, endCol: 3 });
 * if (result.success) {
 *   console.log('Merged and centered');
 * }
 * ```
 */
export async function mergeAndCenter(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<OperationResult<MergedRegion>> {
  if (!isValidRange(range)) {
    return {
      success: false,
      error: invalidRange(range.startRow, range.startCol, range.endRow, range.endCol),
    };
  }

  const normalized = normalizeRange(range);

  // Check for single cell (invalid merge)
  if (normalized.startRow === normalized.endRow && normalized.startCol === normalized.endCol) {
    return {
      success: false,
      error: operationFailed('mergeAndCenter', 'Cannot merge a single cell'),
    };
  }

  try {
    await Merges.mergeAndCenter(
      ctx,
      sheetId,
      normalized.startRow,
      normalized.startCol,
      normalized.endRow,
      normalized.endCol,
      'api',
    );

    // Apply center horizontal alignment to the merged range
    const centerFormat: CellFormat = { horizontalAlign: 'center' } as CellFormat;
    await ctx.computeBridge.setFormatForRanges(
      sheetId,
      [[normalized.startRow, normalized.startCol, normalized.endRow, normalized.endCol]],
      centerFormat,
    );

    // Build result from the normalized range
    const info: MergedRegion = {
      range: `${toA1(normalized.startRow, normalized.startCol)}:${toA1(normalized.endRow, normalized.endCol)}`,
      startRow: normalized.startRow,
      startCol: normalized.startCol,
      endRow: normalized.endRow,
      endCol: normalized.endCol,
      rowSpan: normalized.endRow - normalized.startRow + 1,
      colSpan: normalized.endCol - normalized.startCol + 1,
    };

    return { success: true, data: info };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('mergeAndCenter', String(e)),
    };
  }
}

/**
 * Get the merge containing a specific cell, returning a CellRange or null.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns CellRange of the merge if cell is in a merge, null otherwise
 */
export async function getMergeAtCellRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellRange | null> {
  const info = await getMergeAt(ctx, sheetId, row, col);
  if (!info) return null;
  return {
    startRow: info.startRow,
    startCol: info.startCol,
    endRow: info.endRow,
    endCol: info.endCol,
  };
}

/**
 * Clear all merged regions in a sheet.
 *
 * Fetches all merged regions and unmerges each one. This is a convenience
 * function for bulk-clearing all merges in a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise of OperationResult with the count of regions cleared
 *
 * @example
 * ```typescript
 * const result = await clearAllMerges(ctx, sheetId);
 * if (result.success) {
 *   console.log(`Cleared ${result.data.count} merged regions`);
 * }
 * ```
 */
export async function clearAllMerges(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<OperationResult<{ count: number }>> {
  try {
    const regions = await getMergedRegions(ctx, sheetId);
    const count = regions.length;

    for (const region of regions) {
      await unmergeCells(ctx, sheetId, region);
    }

    return { success: true, data: { count } };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('clearAllMerges', String(e)),
    };
  }
}
