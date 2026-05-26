/**
 * Range Utilities for Conditional Formatting
 *
 * Provides geometric operations on CF cell ranges, including subtraction
 * for partial overlap clearing.
 *
 * Types remain in @mog-sdk/contracts/core.
 */

import type { CellRange } from '@mog-sdk/contracts/core';

/**
 * Check if two ranges overlap.
 *
 * @param a - First range
 * @param b - Second range
 * @returns True if ranges have any cells in common
 */
export function rangesOverlap(a: CellRange, b: CellRange): boolean {
  // No overlap if one range is entirely to the left, right, above, or below the other
  return !(
    a.endRow < b.startRow ||
    a.startRow > b.endRow ||
    a.endCol < b.startCol ||
    a.startCol > b.endCol
  );
}

/**
 * Check if one range completely contains another.
 *
 * @param outer - The potential containing range
 * @param inner - The potential contained range
 * @returns True if outer completely contains inner
 */
export function rangeContains(outer: CellRange, inner: CellRange): boolean {
  return (
    outer.startRow <= inner.startRow &&
    outer.endRow >= inner.endRow &&
    outer.startCol <= inner.startCol &&
    outer.endCol >= inner.endCol
  );
}

/**
 * Subtract one range from another, returning non-overlapping rectangular regions.
 *
 * This is the core algorithm for Excel-compatible partial overlap clearing.
 * When a CF rule's range partially overlaps the cleared selection, the range
 * is split into non-overlapping portions (up to 4 rectangular regions).
 *
 * Example:
 * ```
 * Original:  A1:D10
 * Subtract:  B5:C8
 *
 * Result: 4 strips
 * - Top strip:    A1:D4  (rows above cleared area)
 * - Bottom strip: A9:D10 (rows below cleared area)
 * - Left strip:   A5:A8  (column A in cleared rows)
 * - Right strip:  D5:D8  (column D in cleared rows)
 * ```
 *
 * @param original - The original CF range
 * @param subtract - The range to subtract (clear area)
 * @returns Array of remaining ranges after subtraction (0-4 ranges)
 */
export function subtractRange(original: CellRange, subtract: CellRange): CellRange[] {
  // Check if ranges overlap at all
  if (!rangesOverlap(original, subtract)) {
    return [original]; // No overlap, return original unchanged
  }

  // Check if subtract completely contains original
  if (rangeContains(subtract, original)) {
    return []; // Nothing remains
  }

  const results: CellRange[] = [];

  // Top strip: rows above the subtracted area (full width of original)
  if (subtract.startRow > original.startRow) {
    results.push({
      startRow: original.startRow,
      startCol: original.startCol,
      endRow: subtract.startRow - 1,
      endCol: original.endCol,
    });
  }

  // Bottom strip: rows below the subtracted area (full width of original)
  if (subtract.endRow < original.endRow) {
    results.push({
      startRow: subtract.endRow + 1,
      startCol: original.startCol,
      endRow: original.endRow,
      endCol: original.endCol,
    });
  }

  // Calculate the "middle" row range where left and right strips exist
  // This is the intersection of original's rows with subtract's rows
  const middleStartRow = Math.max(original.startRow, subtract.startRow);
  const middleEndRow = Math.min(original.endRow, subtract.endRow);

  // Left strip: in the middle rows, columns left of subtracted area
  if (subtract.startCol > original.startCol) {
    results.push({
      startRow: middleStartRow,
      startCol: original.startCol,
      endRow: middleEndRow,
      endCol: subtract.startCol - 1,
    });
  }

  // Right strip: in the middle rows, columns right of subtracted area
  if (subtract.endCol < original.endCol) {
    results.push({
      startRow: middleStartRow,
      startCol: subtract.endCol + 1,
      endRow: middleEndRow,
      endCol: original.endCol,
    });
  }

  return results;
}

/**
 * Check if a range is valid (non-negative dimensions).
 *
 * @param range - Range to validate
 * @returns True if range has valid coordinates
 */
export function isValidRange(range: CellRange): boolean {
  return (
    range.startRow >= 0 &&
    range.startCol >= 0 &&
    range.endRow >= range.startRow &&
    range.endCol >= range.startCol
  );
}

/**
 * Calculate the intersection of two ranges.
 *
 * @param a - First range
 * @param b - Second range
 * @returns Intersection range, or null if no overlap
 */
export function intersectRanges(a: CellRange, b: CellRange): CellRange | null {
  if (!rangesOverlap(a, b)) {
    return null;
  }

  return {
    startRow: Math.max(a.startRow, b.startRow),
    startCol: Math.max(a.startCol, b.startCol),
    endRow: Math.min(a.endRow, b.endRow),
    endCol: Math.min(a.endCol, b.endCol),
  };
}
