/**
 * Clipboard Anchors (Spreadsheet-Specific)
 *
 * Cell-anchor-specific logic for clipboard/duplication operations.
 * Handles offsetting CellAnchor xOffset/yOffset values when duplicating objects.
 *
 * Extracted from operations/clipboard.ts — the cell-anchor-specific parts.
 * The generic clipboard operations (prepareObjectForClipboard, createObjectFromClipboard)
 * remain in operations/clipboard.ts.
 *
 * @see operations/clipboard.ts - Generic clipboard operations
 * @see cell-anchor-resolver.ts - Cell-grid position resolution
 */

import type { ObjectPosition } from '@mog-sdk/contracts/floating-objects';

import { DEFAULT_DUPLICATE_OFFSET } from '../types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Offset for positioning duplicated objects on the cell grid.
 */
export interface CellDuplicateOffset {
  /** Horizontal offset in pixels (positive = right) */
  dx: number;
  /** Vertical offset in pixels (positive = down) */
  dy: number;
}

// =============================================================================
// CELL-ANCHOR OFFSET OPERATIONS
// =============================================================================

/**
 * Calculate the position for a duplicated object on the cell grid.
 *
 * Applies the given offset to the CellAnchor's xOffset/yOffset values.
 * This creates a new position that is visually offset from the original
 * while maintaining the same cell anchor (cellId stays the same).
 *
 * This is cell-grid-specific because it manipulates CellAnchor offsets
 * directly — other anchor types would have different offset semantics.
 *
 * @param originalPosition - The position of the source object
 * @param offset - The offset to apply (defaults to DEFAULT_DUPLICATE_OFFSET)
 * @returns New ObjectPosition with offset applied to CellAnchor offsets
 */
export function calculateDuplicatePosition(
  originalPosition: ObjectPosition,
  offset?: Partial<CellDuplicateOffset>,
): ObjectPosition {
  const dx = offset?.dx ?? DEFAULT_DUPLICATE_OFFSET;
  const dy = offset?.dy ?? DEFAULT_DUPLICATE_OFFSET;

  // Offset the 'from' anchor's pixel offsets within the cell
  const newPosition: ObjectPosition = {
    ...originalPosition,
    from: {
      ...originalPosition.from,
      xOffset: originalPosition.from.xOffset + dx,
      yOffset: originalPosition.from.yOffset + dy,
    },
  };

  // If there's a 'to' anchor (two-cell anchor), offset that too
  if (originalPosition.to) {
    newPosition.to = {
      ...originalPosition.to,
      xOffset: originalPosition.to.xOffset + dx,
      yOffset: originalPosition.to.yOffset + dy,
    };
  }

  return newPosition;
}

/**
 * Calculate an offset for multiple duplicates to avoid stacking.
 *
 * When duplicating multiple objects at once, this calculates progressive
 * offsets so each duplicate is visible and not directly overlapping others.
 *
 * @param index - The index of the duplicate (0-based)
 * @param baseOffset - The base offset for the first duplicate
 * @returns Offset for this specific duplicate
 */
export function calculateBatchDuplicateOffset(
  index: number,
  baseOffset?: Partial<CellDuplicateOffset>,
): CellDuplicateOffset {
  const baseDx = baseOffset?.dx ?? DEFAULT_DUPLICATE_OFFSET;
  const baseDy = baseOffset?.dy ?? DEFAULT_DUPLICATE_OFFSET;

  const multiplier = index + 1;

  return {
    dx: baseDx * multiplier,
    dy: baseDy * multiplier,
  };
}
