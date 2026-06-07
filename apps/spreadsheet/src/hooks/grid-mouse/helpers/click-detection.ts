/**
 * Click Detection Helpers
 *
 * Pure functions for detecting clicks on various interactive elements within cells.
 * These functions determine if a click position is within the bounds of specific UI elements
 * like filter buttons, validation dropdowns, and comment indicators.
 *
 * All functions are pure (no side effects, no React state) and can be unit tested easily.
 *
 * @see use-grid-mouse.ts - Main hook that uses these helpers
 */

import {
  getAutofitColumnsForResize,
  getAutofitRowsForResize,
  type AutofitUsedRange,
} from '../../../systems/grid-editing/features/autofit/selection-targets';

// =============================================================================
// Constants
// =============================================================================

/**
 * Filter button constants (must match renderFilterButton in cells-layer.ts)
 */
export const FILTER_BUTTON = {
  /** Size of the filter button in pixels */
  SIZE: 10,
  /** Padding from cell edge in pixels */
  PADDING: 3,
  /** Extra hit area around the button for easier clicking */
  HIT_PADDING: 2,
} as const;

/**
 * Validation dropdown constants (must match renderDropdownIndicator in validation-renderer.ts)
 */
export const VALIDATION_DROPDOWN = {
  /** Size of the dropdown arrow in pixels */
  ARROW_SIZE: 8,
  /** Padding from cell edge in pixels */
  ARROW_PADDING: 2,
  /** Extra hit area around the arrow for easier clicking */
  HIT_PADDING: 4,
} as const;

/**
 * Comment indicator constants (must match renderCommentIndicator in cells-layer.ts)
 */
export const COMMENT_INDICATOR = {
  /** Size of the triangle in pixels */
  TRIANGLE_SIZE: 6,
  /** Extra hit area around the triangle for easier clicking */
  HIT_PADDING: 4,
} as const;

// =============================================================================
// Click Detection Functions
// =============================================================================

/**
 * Check if a click is within the filter button area of a cell.
 * Filter button is rendered in the right side of header cells.
 *
 * @param clickX - X position of click relative to cell left
 * @param clickY - Y position of click relative to cell top
 * @param cellWidth - Width of the cell
 * @param cellHeight - Height of the cell
 * @returns true if click is within filter button bounds
 *
 * @example
 * ```ts
 * const isOnFilter = isClickOnFilterButton(
 * clickXInCell,
 * clickYInCell,
 * cellWidth,
 * cellHeight
 * );
 * if (isOnFilter) {
 * // Open filter dropdown
 * }
 * ```
 */
export function isClickOnFilterButton(
  clickX: number,
  clickY: number,
  cellWidth: number,
  cellHeight: number,
): boolean {
  const { SIZE: buttonSize, PADDING: padding, HIT_PADDING: hitPadding } = FILTER_BUTTON;
  const buttonX = cellWidth - buttonSize - padding;
  const buttonY = (cellHeight - buttonSize) / 2;

  return (
    clickX >= buttonX - hitPadding &&
    clickX <= buttonX + buttonSize + hitPadding &&
    clickY >= buttonY - hitPadding &&
    clickY <= buttonY + buttonSize + hitPadding
  );
}

/**
 * Check if a click is within the validation dropdown arrow area of a cell.
 * Dropdown arrow is rendered in the right side of cells with list validation.
 *
 * @param clickX - X position of click relative to cell left
 * @param clickY - Y position of click relative to cell top
 * @param cellWidth - Width of the cell
 * @param cellHeight - Height of the cell
 * @returns true if click is within dropdown arrow bounds
 *
 * @example
 * ```ts
 * const isOnDropdown = isClickOnValidationDropdown(
 * clickXInCell,
 * clickYInCell,
 * cellWidth,
 * cellHeight
 * );
 * if (isOnDropdown) {
 * // Open validation dropdown picker
 * }
 * ```
 */
export function isClickOnValidationDropdown(
  clickX: number,
  clickY: number,
  cellWidth: number,
  cellHeight: number,
): boolean {
  const {
    ARROW_SIZE: arrowSize,
    ARROW_PADDING: arrowPadding,
    HIT_PADDING: hitPadding,
  } = VALIDATION_DROPDOWN;
  const arrowX = cellWidth - arrowSize - arrowPadding;
  const arrowY = (cellHeight - arrowSize * 0.6) / 2;

  return (
    clickX >= arrowX - hitPadding &&
    clickX <= cellWidth &&
    clickY >= arrowY - hitPadding &&
    clickY <= arrowY + arrowSize * 0.6 + hitPadding
  );
}

/**
 * Check if a click is within the comment indicator area of a cell.
 * Comment indicator is a red triangle in the top-right corner of the cell.
 *
 * @param clickX - X position of click relative to cell left
 * @param clickY - Y position of click relative to cell top
 * @param cellWidth - Width of the cell
 * @returns true if click is within comment indicator bounds
 *
 * @example
 * ```ts
 * const isOnComment = isClickOnCommentIndicator(clickXInCell, clickYInCell, cellWidth);
 * if (isOnComment) {
 * // Show comment popover
 * }
 * ```
 */
export function isClickOnCommentIndicator(
  clickX: number,
  clickY: number,
  cellWidth: number,
): boolean {
  const { TRIANGLE_SIZE: triangleSize, HIT_PADDING: hitPadding } = COMMENT_INDICATOR;

  // Triangle is in top-right corner: from (width - triangleSize, 0) to (width, triangleSize)
  // Check if click is within the triangle's bounding box (expanded by hitPadding)
  const inXRange =
    clickX >= cellWidth - triangleSize - hitPadding && clickX <= cellWidth + hitPadding;
  const inYRange = clickY >= -hitPadding && clickY <= triangleSize + hitPadding;

  return inXRange && inYRange;
}

// =============================================================================
// Selection Helper Functions
// =============================================================================

/**
 * Range interface for selection calculations.
 */
export interface SelectionRange {
  startCol: number;
  endCol: number;
  startRow: number;
  endRow: number;
  isFullRow?: boolean;
  isFullColumn?: boolean;
}

/**
 * Get columns to auto-fit based on selection.
 * If the column is part of a selected range, return all columns in that range.
 * Otherwise, return just the single column.
 *
 * Used for double-click auto-fit behavior where selected columns should all
 * be auto-fitted together.
 *
 * @param col - Column index where double-click occurred
 * @param ranges - Current selection ranges
 * @returns Array of column indices to auto-fit
 *
 * @example
 * ```ts
 * // If columns B-D are selected and user double-clicks column C border
 * const cols = getSelectedColumnsOrSingle(2, [{ startCol: 1, endCol: 3, ... }]);
 * // Returns [1, 2, 3] - all selected columns
 *
 * // If no selection includes the column
 * const cols = getSelectedColumnsOrSingle(5, [{ startCol: 1, endCol: 3, ... }]);
 * // Returns [5] - just the clicked column
 * ```
 */
export function getSelectedColumnsOrSingle(
  col: number,
  ranges: readonly Pick<SelectionRange, 'startCol' | 'endCol' | 'isFullRow'>[],
  usedRange?: AutofitUsedRange | null,
): number[] {
  return getAutofitColumnsForResize(col, ranges, usedRange);
}

/**
 * Get rows to auto-fit based on selection.
 * If the row is part of a selected range, return all rows in that range.
 * Otherwise, return just the single row.
 *
 * Used for double-click auto-fit behavior where selected rows should all
 * be auto-fitted together.
 *
 * @param row - Row index where double-click occurred
 * @param ranges - Current selection ranges
 * @returns Array of row indices to auto-fit
 *
 * @example
 * ```ts
 * // If rows 2-4 are selected and user double-clicks row 3 border
 * const rows = getSelectedRowsOrSingle(2, [{ startRow: 1, endRow: 3, ... }]);
 * // Returns [1, 2, 3] - all selected rows
 *
 * // If no selection includes the row
 * const rows = getSelectedRowsOrSingle(5, [{ startRow: 1, endRow: 3, ... }]);
 * // Returns [5] - just the clicked row
 * ```
 */
export function getSelectedRowsOrSingle(
  row: number,
  ranges: readonly Pick<SelectionRange, 'startRow' | 'endRow' | 'isFullColumn'>[],
  usedRange?: AutofitUsedRange | null,
): number[] {
  return getAutofitRowsForResize(row, ranges, usedRange);
}
