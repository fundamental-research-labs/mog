/**
 * Cell Indicators
 *
 * Visual indicators rendered as overlays on top of cell content:
 * - Comment indicator: red triangle at top-right corner
 * - Filter button: dropdown arrow or funnel icon in table/AutoFilter header cells
 * - Checkbox: rendered checkboxes for boolean schema cells
 * - Dropdown indicator: small triangle for cells with data validation dropdowns
 * - Validation error: small red indicator for cells failing validation
 * - Data binding status: connection/staleness icon for external data cells
 *
 * Ported from grid-canvas/src/layers/cells/indicator-renderer.ts.
 *
 * @module grid-renderer/cells/indicators
 */

import type { CellBindingStatus } from '@mog-sdk/contracts/rendering';
import type { ResolvedSheetViewControlIndicatorSkin } from '@mog-sdk/contracts/rendering/sheet-view-skin';

type IndicatorSkin = Partial<ResolvedSheetViewControlIndicatorSkin>;

// =============================================================================
// Comment Indicator
// =============================================================================

/** Size of the comment indicator triangle in pixels */
const COMMENT_TRIANGLE_SIZE = 6;

/**
 * Render comment indicator (red triangle) in top-right corner of cell.
 * Excel-style: Small red triangle in the top-right corner indicates a comment.
 *
 * @param ctx - Canvas rendering context
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 */
export function renderCommentIndicator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  skin?: IndicatorSkin,
): void {
  const triangleSize = COMMENT_TRIANGLE_SIZE;

  ctx.save();
  ctx.fillStyle = skin?.commentIndicator ?? '#FF0000';
  ctx.beginPath();
  // Triangle: top-right corner
  ctx.moveTo(x + width - triangleSize, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + triangleSize);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// =============================================================================
// Filter Button
// =============================================================================

/** Size of the filter button icon in pixels */
export const FILTER_BUTTON_SIZE = 10;
/** Padding from cell edge for filter button */
export const FILTER_BUTTON_PADDING = 3;
/** Gap reserved between header text and the filter icon. */
export const FILTER_BUTTON_TEXT_GAP = 6;
/** Minimum DOM hit target for the canvas-rendered filter icon. */
export const FILTER_BUTTON_HIT_SIZE = 16;

export function getFilterButtonIconBounds(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: x + width - FILTER_BUTTON_SIZE - FILTER_BUTTON_PADDING,
    y: y + (height - FILTER_BUTTON_SIZE) / 2,
    width: FILTER_BUTTON_SIZE,
    height: FILTER_BUTTON_SIZE,
  };
}

export function getFilterButtonHitBounds(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const icon = getFilterButtonIconBounds(x, y, width, height);
  const hitSize = Math.max(1, Math.min(FILTER_BUTTON_HIT_SIZE, width, height));
  const centeredX = icon.x + (icon.width - hitSize) / 2;
  const centeredY = icon.y + (icon.height - hitSize) / 2;
  return {
    x: Math.min(Math.max(centeredX, x), x + width - hitSize),
    y: Math.min(Math.max(centeredY, y), y + height - hitSize),
    width: hitSize,
    height: hitSize,
  };
}

export function getFilterButtonTextContentWidth(cellWidth: number): number {
  return Math.max(
    0,
    cellWidth - FILTER_BUTTON_SIZE - FILTER_BUTTON_PADDING - FILTER_BUTTON_TEXT_GAP,
  );
}

/**
 * Render filter dropdown button indicator in table or AutoFilter header cell.
 *
 * When filter is inactive: shows dropdown arrow (triangle)
 * When filter is active: shows funnel icon to indicate filtering is applied
 *
 * @param ctx - Canvas rendering context
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 * @param hasActiveFilter - Whether this column has filter criteria applied
 */
export function renderFilterButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  hasActiveFilter: boolean,
  skin?: IndicatorSkin,
): void {
  const button = getFilterButtonIconBounds(x, y, width, height);
  const buttonX = button.x;
  const buttonY = button.y;
  const buttonSize = button.width;

  if (hasActiveFilter) {
    // Draw funnel icon when filter is active (Excel-style blue color)
    // Funnel shape: trapezoid top + stem at bottom (like Excel's funnel)
    ctx.fillStyle = skin?.filterActiveIcon ?? '#0066cc';

    ctx.beginPath();
    // Top of funnel (wide opening)
    ctx.moveTo(buttonX, buttonY + 1);
    ctx.lineTo(buttonX + buttonSize, buttonY + 1);
    // Funnel sides tapering down to center
    ctx.lineTo(buttonX + buttonSize * 0.6, buttonY + buttonSize * 0.55);
    // Stem going down
    ctx.lineTo(buttonX + buttonSize * 0.6, buttonY + buttonSize - 1);
    ctx.lineTo(buttonX + buttonSize * 0.4, buttonY + buttonSize - 1);
    // Back up the stem
    ctx.lineTo(buttonX + buttonSize * 0.4, buttonY + buttonSize * 0.55);
    // Back to top left
    ctx.closePath();
    ctx.fill();
  } else {
    // Draw dropdown arrow (triangle) when filter is inactive
    ctx.fillStyle = skin?.filterIcon ?? 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.moveTo(buttonX, buttonY + 3);
    ctx.lineTo(buttonX + buttonSize, buttonY + 3);
    ctx.lineTo(buttonX + buttonSize / 2, buttonY + buttonSize - 1);
    ctx.closePath();
    ctx.fill();
  }
}

// =============================================================================
// Checkbox
// =============================================================================

/**
 * Render a checkbox for boolean schema cells.
 *
 * @param ctx - Canvas context
 * @param value - Cell value (expected boolean)
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 */
export function renderCheckbox(
  ctx: CanvasRenderingContext2D,
  value: unknown,
  x: number,
  y: number,
  width: number,
  height: number,
  skin?: IndicatorSkin,
): void {
  const isChecked = value === true || value === 'TRUE' || value === 1;
  const checkboxSize = Math.min(16, height - 4, width - 4);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const halfSize = checkboxSize / 2;

  // Draw checkbox box
  ctx.fillStyle = skin?.checkboxBackground ?? 'transparent';
  ctx.beginPath();
  ctx.roundRect(centerX - halfSize, centerY - halfSize, checkboxSize, checkboxSize, 2);
  ctx.fill();

  ctx.strokeStyle = skin?.checkboxBorder ?? '#666666';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(centerX - halfSize, centerY - halfSize, checkboxSize, checkboxSize, 2);
  ctx.stroke();

  // Draw checkmark if checked
  if (isChecked) {
    ctx.strokeStyle = skin?.checkboxCheck ?? '#217346';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    // Checkmark path: starts at left, goes down, then up to right
    const startX = centerX - halfSize * 0.4;
    const startY = centerY;
    const midX = centerX - halfSize * 0.1;
    const midY = centerY + halfSize * 0.4;
    const endX = centerX + halfSize * 0.5;
    const endY = centerY - halfSize * 0.3;
    ctx.moveTo(startX, startY);
    ctx.lineTo(midX, midY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }
}

// =============================================================================
// Dropdown Indicator
// =============================================================================

/** Size of the dropdown triangle */
const DROPDOWN_TRIANGLE_SIZE = 5;
/** Padding for the dropdown indicator from cell edge */
const DROPDOWN_PADDING = 3;

/**
 * Render a dropdown indicator (small triangle) for cells with data validation dropdowns.
 * Positioned at the right edge of the cell, vertically centered.
 *
 * @param ctx - Canvas rendering context
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 */
export function renderDropdownIndicator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  skin?: IndicatorSkin,
): void {
  const size = DROPDOWN_TRIANGLE_SIZE;
  const padding = DROPDOWN_PADDING;
  const triX = x + width - size - padding;
  const triY = y + (height - size) / 2;

  ctx.save();
  ctx.fillStyle = skin?.validationDropdown ?? 'rgba(0, 0, 0, 0.4)';
  ctx.beginPath();
  ctx.moveTo(triX, triY);
  ctx.lineTo(triX + size, triY);
  ctx.lineTo(triX + size / 2, triY + size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// =============================================================================
// Validation Error Indicator
// =============================================================================

/** Size of the validation error indicator */
const VALIDATION_ERROR_SIZE = 5;

/**
 * Render a validation error indicator (small red dot) at the top-left corner of a cell.
 * Indicates the cell value fails a data validation rule.
 *
 * @param ctx - Canvas rendering context
 * @param x - Cell x position
 * @param y - Cell y position
 */
export function renderValidationError(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  skin?: IndicatorSkin,
): void {
  const size = VALIDATION_ERROR_SIZE;
  const padding = 2;

  ctx.save();
  ctx.fillStyle = skin?.validationError ?? '#FF4444';
  ctx.beginPath();
  ctx.arc(x + padding + size / 2, y + padding + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// =============================================================================
// Data Binding Status Indicator
// =============================================================================

/** Size of the binding status icon */
const BINDING_ICON_SIZE = 8;

/**
 * Render a data binding status icon at the bottom-left corner of a cell.
 * Shows connection/staleness state for cells bound to external data sources.
 *
 * - fresh: small green circle (data is up to date)
 * - stale: small yellow circle (data may be outdated)
 * - error: small red circle with X (connection error)
 *
 * @param ctx - Canvas rendering context
 * @param x - Cell x position
 * @param y - Cell y position
 * @param height - Cell height
 * @param status - Data binding status
 */
export function renderBindingStatus(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  status: CellBindingStatus,
): void {
  const size = BINDING_ICON_SIZE;
  const padding = 2;
  const iconX = x + padding;
  const iconY = y + height - size - padding;
  const cx = iconX + size / 2;
  const cy = iconY + size / 2;
  const radius = size / 2;

  ctx.save();

  switch (status.staleness) {
    case 'fresh':
      ctx.fillStyle = '#00B050';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'stale':
      ctx.fillStyle = '#FFC000';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'error':
      // Red circle
      ctx.fillStyle = '#FF0000';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      // White X
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - radius * 0.4, cy - radius * 0.4);
      ctx.lineTo(cx + radius * 0.4, cy + radius * 0.4);
      ctx.moveTo(cx + radius * 0.4, cy - radius * 0.4);
      ctx.lineTo(cx - radius * 0.4, cy + radius * 0.4);
      ctx.stroke();
      break;
  }

  ctx.restore();
}

// =============================================================================
// Table Header Detection
// =============================================================================

/**
 * Check if a cell is a table header cell.
 *
 * Uses resolved startRow to account for Cell Identity Model shifts.
 * The resolvedStartRow parameter should be obtained from the
 * table range resolution function.
 *
 * @param hasHeaderRow - Whether the table has a header row
 * @param row - The row to check
 * @param resolvedStartRow - The resolved header row from Cell Identity Model
 * @returns true if this row is the table header row
 */
export function isTableHeaderCell(
  hasHeaderRow: boolean,
  row: number,
  resolvedStartRow: number,
): boolean {
  return hasHeaderRow && row === resolvedStartRow;
}
