/**
 * Fill Validation - Pre-fill validation and warnings
 *
 * This module provides validation and warning functionality for fill operations.
 * It checks for potential issues before fill execution:
 * - Large fill operations that may take a long time
 * - Merged cell conflicts
 * - Protected cell conflicts
 *
 */

import type { CellRange } from './types';

// =============================================================================
// Constants
// =============================================================================

/**
 * Threshold for large fill warning (number of cells).
 * If the fill operation will affect more than this many cells, show a warning.
 */
export const LARGE_FILL_THRESHOLD = 10000;

/**
 * Threshold for very large fill (absolute limit for safety).
 * Operations larger than this should be blocked or require explicit confirmation.
 */
export const MAX_FILL_CELLS = 1000000;

// =============================================================================
// Types
// =============================================================================

/**
 * Fill validation result
 */
export interface FillValidationResult {
  /** Whether the fill operation is valid and can proceed */
  isValid: boolean;
  /** Warning message to show user (can proceed but should confirm) */
  warning?: string;
  /** Error message (cannot proceed) */
  error?: string;
  /** Number of cells that will be affected */
  cellCount: number;
  /** Whether the fill is large (above threshold) */
  isLargeFill: boolean;
  /** Whether there are merged cell conflicts */
  hasMergeConflicts: boolean;
  /** Whether there are protected cell conflicts */
  hasProtectedCells: boolean;
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Calculate the number of cells in a range
 */
export function getRangeSize(range: CellRange): number {
  const rows = range.endRow - range.startRow + 1;
  const cols = range.endCol - range.startCol + 1;
  return rows * cols;
}

/**
 * Validate a fill operation before execution.
 * Returns warnings and errors that should be shown to the user.
 *
 * @param targetRange - The range that will be filled
 * @param hasMergeConflicts - Whether the fill would split merged cells
 * @param hasProtectedCells - Whether the fill would modify protected cells
 * @returns Validation result with warnings/errors
 */
export function validateFillOperation(
  targetRange: CellRange,
  hasMergeConflicts = false,
  hasProtectedCells = false,
): FillValidationResult {
  const cellCount = getRangeSize(targetRange);
  const isLargeFill = cellCount > LARGE_FILL_THRESHOLD;

  // Check for absolute limit
  if (cellCount > MAX_FILL_CELLS) {
    return {
      isValid: false,
      error: `This operation would affect ${cellCount.toLocaleString()} cells, which exceeds the maximum of ${MAX_FILL_CELLS.toLocaleString()}. Please select a smaller range.`,
      cellCount,
      isLargeFill: true,
      hasMergeConflicts,
      hasProtectedCells,
    };
  }

  // Check for protected cells
  if (hasProtectedCells) {
    return {
      isValid: false,
      error:
        'The cell or chart you are trying to change is on a protected sheet. To make a change, unprotect the sheet.',
      cellCount,
      isLargeFill,
      hasMergeConflicts,
      hasProtectedCells: true,
    };
  }

  // Check for merge conflicts (partial overlaps)
  if (hasMergeConflicts) {
    return {
      isValid: false,
      error: 'This operation requires the merged cells to be identically sized.',
      cellCount,
      isLargeFill,
      hasMergeConflicts: true,
      hasProtectedCells,
    };
  }

  // Large fill warning
  if (isLargeFill) {
    return {
      isValid: true,
      warning: `This operation will affect ${cellCount.toLocaleString()} cells. This may take a while. Do you want to continue?`,
      cellCount,
      isLargeFill: true,
      hasMergeConflicts,
      hasProtectedCells,
    };
  }

  // All good
  return {
    isValid: true,
    cellCount,
    isLargeFill: false,
    hasMergeConflicts,
    hasProtectedCells,
  };
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * Used for progress indicators during long fill operations.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return 'less than a second';
  if (ms < 60000) return `${Math.round(ms / 1000)} seconds`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} minutes`;
  return `${Math.round(ms / 3600000)} hours`;
}

/**
 * Estimate the time a fill operation will take.
 * This is a rough estimate based on typical fill performance.
 *
 * @param cellCount - Number of cells to fill
 * @param hasFormulas - Whether the source contains formulas
 * @returns Estimated duration in milliseconds
 */
export function estimateFillDuration(cellCount: number, hasFormulas = false): number {
  // Base estimate: ~0.01ms per cell for value fill
  // Formulas are slower: ~0.1ms per cell due to ref adjustment
  const msPerCell = hasFormulas ? 0.1 : 0.01;
  return Math.round(cellCount * msPerCell);
}

// =============================================================================
// Merge Conflict Detection
// =============================================================================

/**
 * Represents a merged cell region.
 */
export interface MergedRegion {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Check if the target range has partial overlap with any merged cell regions.
 * A partial overlap occurs when only part of a merged region is within the target range.
 *
 * @param range - The target fill range
 * @param mergedRegions - Array of merged regions in the sheet
 * @returns true if there's a partial overlap conflict
 */
export function hasPartialMergeConflict(range: CellRange, mergedRegions: MergedRegion[]): boolean {
  for (const region of mergedRegions) {
    // Check if the merged region overlaps with the range at all
    const overlapsRows = region.startRow <= range.endRow && region.endRow >= range.startRow;
    const overlapsCols = region.startCol <= range.endCol && region.endCol >= range.startCol;

    if (overlapsRows && overlapsCols) {
      // Check if the merge is fully contained within the range
      const fullyContained =
        region.startRow >= range.startRow &&
        region.endRow <= range.endRow &&
        region.startCol >= range.startCol &&
        region.endCol <= range.endCol;

      // Check if the range includes the anchor cell of the merge (top-left)
      const includesAnchor =
        range.startRow <= region.startRow &&
        range.endRow >= region.startRow &&
        range.startCol <= region.startCol &&
        range.endCol >= region.startCol;

      // Check if range is exactly the anchor cell (single cell that is the merge anchor)
      const isExactlyAnchor =
        range.startRow === region.startRow &&
        range.endRow === region.startRow &&
        range.startCol === region.startCol &&
        range.endCol === region.startCol;

      // OK scenarios:
      // 1. Range fully contains the merge
      // 2. Range is exactly the anchor cell (will fill just the anchor)
      // All other overlaps are conflicts (including being inside the merge but not at anchor)
      if (fullyContained || isExactlyAnchor) {
        continue; // No conflict for this merge
      }

      // Check if the range includes anchor - if so, it must fully contain the merge
      if (includesAnchor && !fullyContained) {
        return true;
      }

      // Range overlaps merge but doesn't include anchor and doesn't fully contain it
      return true;
    }
  }
  return false;
}
