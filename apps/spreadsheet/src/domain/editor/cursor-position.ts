/**
 * Cursor Position Utilities
 *
 * Utilities for computing screen positions for autocomplete popups.
 * These are pure functions that work with a minimal geometry interface.
 *
 */

import type { CellCoord } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Types
// =============================================================================

export interface CursorScreenPosition {
  x: number;
  y: number;
}

export interface PopupSize {
  width: number;
  height: number;
}

/**
 * Minimal geometry interface to avoid tight coupling to ISheetViewGeometry.
 * Only the two methods needed for popup positioning are required.
 */
export interface CellGeometryLike {
  getCellRect(cell: CellCoord): { x: number; y: number; width: number; height: number } | null;
  getContainerRect(): DOMRect;
}

// =============================================================================
// Position Utilities
// =============================================================================

/**
 * Get screen position for autocomplete popup near the editing cursor.
 * Prioritizes input element position for precise placement, falls back to cell position.
 *
 * @param coordinateSystem - Canvas coordinate system (optional, used as fallback)
 * @param editingCell - Cell being edited
 * @param _cursorOffset - Character offset within cell (for future cursor-precise positioning)
 * @param inputElement - DOM input element for precise positioning
 */
export function getAutoCompletePosition(
  coordinateSystem: CellGeometryLike | null,
  editingCell: CellCoord,
  _cursorOffset: number,
  inputElement?: HTMLInputElement | HTMLTextAreaElement | null,
): CursorScreenPosition {
  // If we have the input element, use its position for precise placement
  if (inputElement) {
    const rect = inputElement.getBoundingClientRect();
    // Position below the input with small gap
    return {
      x: rect.left,
      y: rect.bottom + 4,
    };
  }

  // Fallback: use cell position from coordinate system
  if (coordinateSystem) {
    const cellRect = coordinateSystem.getCellRect(editingCell);
    if (cellRect) {
      const containerRect = coordinateSystem.getContainerRect();

      return {
        x: containerRect.left + cellRect.x,
        y: containerRect.top + cellRect.y + cellRect.height + 4,
      };
    }
  }

  // Ultimate fallback: use fixed position
  return { x: 100, y: 100 };
}

/**
 * Get position for argument hint tooltip (positioned above the cell).
 * Similar to getAutoCompletePosition but places above instead of below.
 *
 * @param coordinateSystem - Canvas coordinate system
 * @param editingCell - Cell being edited
 * @param inputElement - DOM input element for precise positioning
 * @param hintHeight - Expected height of the hint tooltip
 */
export function getArgumentHintPosition(
  coordinateSystem: CellGeometryLike | null,
  editingCell: CellCoord,
  inputElement?: HTMLInputElement | HTMLTextAreaElement | null,
  hintHeight: number = 120,
): CursorScreenPosition {
  // If we have the input element, position above it
  if (inputElement) {
    const rect = inputElement.getBoundingClientRect();
    return {
      x: rect.left,
      y: Math.max(8, rect.top - hintHeight - 4),
    };
  }

  // Fallback: use cell position
  if (coordinateSystem) {
    const cellRect = coordinateSystem.getCellRect(editingCell);
    if (cellRect) {
      const containerRect = coordinateSystem.getContainerRect();

      return {
        x: containerRect.left + cellRect.x,
        y: Math.max(8, containerRect.top + cellRect.y - hintHeight - 4),
      };
    }
  }

  return { x: 100, y: 100 };
}

/**
 * Ensure popup stays within viewport bounds.
 * Handles both horizontal and vertical overflow.
 *
 * @param position - Initial position
 * @param popupSize - Expected popup dimensions
 * @param padding - Padding from viewport edges (default 8px)
 */
export function clampToViewport(
  position: CursorScreenPosition,
  popupSize: PopupSize,
  padding: number = 8,
): CursorScreenPosition {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;

  let { x, y } = position;

  // Clamp horizontal - prefer left alignment, shift left if overflows right
  if (x + popupSize.width > viewportWidth - padding) {
    x = viewportWidth - popupSize.width - padding;
  }
  if (x < padding) {
    x = padding;
  }

  // Clamp vertical - prefer below, flip above if no room
  if (y + popupSize.height > viewportHeight - padding) {
    // Try to flip above the original Y position (subtract popup height + gap)
    const flippedY = position.y - popupSize.height - 8; // 8px gap
    if (flippedY >= padding) {
      y = flippedY;
    } else {
      // Can't flip, just clamp to bottom
      y = viewportHeight - popupSize.height - padding;
    }
  }
  if (y < padding) {
    y = padding;
  }

  return { x, y };
}

/**
 * Calculate position that flips above/below based on available space.
 * Returns position and flip state.
 *
 * @param anchorRect - The anchor element's bounding rect
 * @param popupSize - Expected popup dimensions
 * @param preferBelow - Prefer below anchor (default true)
 * @param gap - Gap between anchor and popup (default 4px)
 */
export function calculateFlipPosition(
  anchorRect: DOMRect,
  popupSize: PopupSize,
  preferBelow: boolean = true,
  gap: number = 4,
): { position: CursorScreenPosition; flipped: boolean } {
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const padding = 8;

  const spaceBelow = viewportHeight - anchorRect.bottom - padding;
  const spaceAbove = anchorRect.top - padding;

  let y: number;
  let flipped = false;

  if (preferBelow) {
    if (spaceBelow >= popupSize.height) {
      // Fits below
      y = anchorRect.bottom + gap;
    } else if (spaceAbove >= popupSize.height) {
      // Flip above
      y = anchorRect.top - popupSize.height - gap;
      flipped = true;
    } else {
      // Neither fits perfectly, use whichever has more space
      if (spaceBelow >= spaceAbove) {
        y = anchorRect.bottom + gap;
      } else {
        y = anchorRect.top - popupSize.height - gap;
        flipped = true;
      }
    }
  } else {
    // Prefer above
    if (spaceAbove >= popupSize.height) {
      y = anchorRect.top - popupSize.height - gap;
    } else if (spaceBelow >= popupSize.height) {
      y = anchorRect.bottom + gap;
      flipped = true;
    } else {
      if (spaceAbove >= spaceBelow) {
        y = anchorRect.top - popupSize.height - gap;
      } else {
        y = anchorRect.bottom + gap;
        flipped = true;
      }
    }
  }

  // Clamp x position
  let x = anchorRect.left;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
  if (x + popupSize.width > viewportWidth - padding) {
    x = viewportWidth - popupSize.width - padding;
  }
  if (x < padding) {
    x = padding;
  }

  return {
    position: { x, y },
    flipped,
  };
}
