/**
 * Selection Utilities
 *
 * Shared utilities for working with CellRange selections from the state machine.
 * These helpers are used across toolbar state and toolbar actions.
 *
 * @see engine/src/state/ui-store/slices/toolbar.ts
 * @see engine/src/hooks/use-toolbar-actions.ts
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import { toA1 } from '@mog/spreadsheet-utils/a1';

// =============================================================================
// Cell Enumeration
// =============================================================================

/**
 * Get all cell coordinates from selection ranges.
 * Used for computing common format across multi-cell selection and applying formats.
 *
 * Note: For very large selections (full rows/columns), callers should implement
 * their own performance optimizations (e.g., using active cell format only).
 *
 * @param ranges Array of CellRange from selection state
 * @returns Array of {row, col} coordinates for all cells in all ranges
 */
export function getCellsFromRanges(
  ranges: readonly CellRange[],
): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  for (const range of ranges) {
    const startRow = Math.min(range.startRow, range.endRow);
    const endRow = Math.max(range.startRow, range.endRow);
    const startCol = Math.min(range.startCol, range.endCol);
    const endCol = Math.max(range.startCol, range.endCol);

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        cells.push({ row, col });
      }
    }
  }
  return cells;
}

// =============================================================================
// Range Description
// =============================================================================

/**
 * Generate a human-readable description for a selection range.
 * Used for undo descriptions.
 *
 * @param ranges Array of CellRange from selection state
 * @returns Description like "A1", "A1:B10", or "A1:B10, C5:D8 (+1 more)"
 *
 * @example
 * getRangeDescription([{startRow: 0, startCol: 0, endRow: 0, endCol: 0}]) // "A1"
 * getRangeDescription([{startRow: 0, startCol: 0, endRow: 9, endCol: 1}]) // "A1:B10"
 */
export function getRangeDescription(ranges: readonly CellRange[]): string {
  if (ranges.length === 0) return '';

  const rangeStrings = ranges.map((range) => {
    const startRow = Math.min(range.startRow, range.endRow);
    const endRow = Math.max(range.startRow, range.endRow);
    const startCol = Math.min(range.startCol, range.endCol);
    const endCol = Math.max(range.startCol, range.endCol);

    if (startRow === endRow && startCol === endCol) {
      return toA1(startRow, startCol);
    }
    return `${toA1(startRow, startCol)}:${toA1(endRow, endCol)}`;
  });

  // Limit to first 2 ranges to keep description short
  if (rangeStrings.length > 2) {
    return `${rangeStrings.slice(0, 2).join(', ')} (+${rangeStrings.length - 2} more)`;
  }
  return rangeStrings.join(', ');
}
