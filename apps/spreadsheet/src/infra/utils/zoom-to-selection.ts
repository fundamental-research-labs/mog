/**
 * Zoom to Selection Utility
 *
 * Pure function for calculating optimal zoom and scroll position
 * to fit a selection in the viewport.
 *
 * @module state/utils/zoom-to-selection
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type { HeaderVisibility } from '@mog-sdk/contracts/rendering';
import { getEffectiveHeaderDimensions } from '@mog/spreadsheet-utils/rendering/constants';
import type { ViewportPositionIndexLike } from '@mog-sdk/contracts/rendering';
import { clampZoom } from './zoom-utils';

// =============================================================================
// TYPES
// =============================================================================

export interface ZoomToSelectionParams {
  /** The selection range to zoom to */
  selection: CellRange;
  /** Viewport width in screen pixels */
  viewportWidth: number;
  /** Viewport height in screen pixels */
  viewportHeight: number;
  /** Position index for row/column measurements */
  positionIndex: ViewportPositionIndexLike;
  /** Extra padding around selection in screen pixels (default: 20) */
  padding?: number;
  /** Optional header visibility settings (defaults to both visible) */
  headerVisibility?: HeaderVisibility;
}

export interface ZoomToSelectionResult {
  /** Calculated zoom level (clamped to MIN_ZOOM..MAX_ZOOM) */
  zoom: number;
  /** Scroll X position in document coordinates */
  scrollX: number;
  /** Scroll Y position in document coordinates */
  scrollY: number;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Calculate optimal zoom and scroll position to fit a selection in the viewport.
 *
 * This is a pure function with no side effects - all state changes are made
 * by the caller (coordinator) using the returned values.
 *
 * Algorithm:
 * 1. Calculate selection bounds in document coordinates
 * 2. Determine available viewport area (excluding headers)
 * 3. Compute zoom to fit selection with padding
 * 4. Calculate scroll position to center selection
 *
 * @param params - Selection and viewport parameters
 * @returns Calculated zoom and scroll position
 */
export function calculateZoomToSelection(params: ZoomToSelectionParams): ZoomToSelectionResult {
  const {
    selection,
    viewportWidth,
    viewportHeight,
    positionIndex,
    padding = 20,
    headerVisibility,
  } = params;

  // Get effective header dimensions based on visibility
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);

  // Calculate selection bounds in document coordinates
  const startX = positionIndex.getColLeft(selection.startCol);
  const startY = positionIndex.getRowTop(selection.startRow);
  const endX = positionIndex.getColLeft(selection.endCol + 1);
  const endY = positionIndex.getRowTop(selection.endRow + 1);

  const selectionWidth = endX - startX;
  const selectionHeight = endY - startY;

  // Guard against zero-size selections (shouldn't happen, but be safe)
  if (selectionWidth <= 0 || selectionHeight <= 0) {
    return { zoom: 1, scrollX: 0, scrollY: 0 };
  }

  // Available viewport area for content (excluding headers)
  // Note: Frozen panes support can be added here later by subtracting frozen dimensions
  const contentWidth = viewportWidth - rowHeaderWidth;
  const contentHeight = viewportHeight - colHeaderHeight;

  // Guard against too-small viewport
  if (contentWidth <= padding * 2 || contentHeight <= padding * 2) {
    return { zoom: 1, scrollX: startX, scrollY: startY };
  }

  // Calculate zoom to fit selection with padding (padding is in screen pixels)
  const availableWidth = contentWidth - padding * 2;
  const availableHeight = contentHeight - padding * 2;

  const zoomX = availableWidth / selectionWidth;
  const zoomY = availableHeight / selectionHeight;
  const zoom = clampZoom(Math.min(zoomX, zoomY));

  // Calculate selection center in document coordinates
  const centerX = (startX + endX) / 2;
  const centerY = (startY + endY) / 2;

  // Calculate scroll position to center selection (in document coordinates)
  // After zoom, viewport shows (contentWidth / zoom) document units
  // To center: scrollX + (contentWidth / zoom) / 2 = centerX
  // Therefore: scrollX = centerX - contentWidth / (2 * zoom)
  const scrollX = centerX - contentWidth / (2 * zoom);
  const scrollY = centerY - contentHeight / (2 * zoom);

  return {
    zoom,
    scrollX: Math.max(0, scrollX),
    scrollY: Math.max(0, scrollY),
  };
}
