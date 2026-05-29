/**
 * Zoom to Selection Utility
 *
 * Pure function for calculating optimal zoom and scroll position
 * to fit a selection in the viewport.
 *
 * @module state/utils/zoom-to-selection
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type { HeaderVisibility as RendererHeaderVisibility } from '@mog-sdk/contracts/rendering';
import type { HeaderVisibility as SheetViewHeaderVisibility } from '@mog-sdk/sheet-view';
import { getEffectiveHeaderDimensions } from '@mog/spreadsheet-utils/rendering/constants';
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
  /** Position dimensions for row/column measurements */
  positionDimensions: ZoomToSelectionPositionDimensions;
  /** Extra padding around selection in screen pixels (default: 20) */
  padding?: number;
  /** Optional header visibility settings (defaults to both visible) */
  headerVisibility?: ZoomToSelectionHeaderVisibility;
}

export interface ZoomToSelectionResult {
  /** Calculated zoom level (clamped to MIN_ZOOM..MAX_ZOOM) */
  zoom: number;
  /** Scroll X position in document coordinates */
  scrollX: number;
  /** Scroll Y position in document coordinates */
  scrollY: number;
}

export interface ZoomToSelectionPositionDimensions {
  readonly totalRows: number;
  readonly totalCols: number;
  getRowTop(row: number): number;
  getRowHeight(row: number): number;
  getColLeft(col: number): number;
  getColWidth(col: number): number;
}

export type ZoomToSelectionHeaderVisibility = SheetViewHeaderVisibility;

function toRendererHeaderVisibility(
  headerVisibility: ZoomToSelectionHeaderVisibility | undefined,
): RendererHeaderVisibility | undefined {
  if (!headerVisibility) return undefined;
  return {
    showRowHeaders: headerVisibility.rowHeaders,
    showColumnHeaders: headerVisibility.colHeaders,
  };
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
    positionDimensions,
    padding = 20,
    headerVisibility,
  } = params;

  const normalized = normalizeSelection(selection, positionDimensions);

  // Get effective header dimensions based on visibility
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(
    toRendererHeaderVisibility(headerVisibility),
  );

  // Calculate selection bounds in document coordinates
  const startX = positionDimensions.getColLeft(normalized.startCol);
  const startY = positionDimensions.getRowTop(normalized.startRow);
  const endX =
    positionDimensions.getColLeft(normalized.endCol) +
    positionDimensions.getColWidth(normalized.endCol);
  const endY =
    positionDimensions.getRowTop(normalized.endRow) +
    positionDimensions.getRowHeight(normalized.endRow);

  const selectionWidth = Math.max(1, endX - startX);
  const selectionHeight = Math.max(1, endY - startY);

  // Available viewport area for content (excluding headers)
  // Note: Frozen panes support can be added here later by subtracting frozen dimensions
  const contentWidth = Math.max(1, viewportWidth - rowHeaderWidth);
  const contentHeight = Math.max(1, viewportHeight - colHeaderHeight);

  // Calculate zoom to fit selection with padding (padding is in screen pixels)
  const availableWidth = Math.max(1, contentWidth - padding * 2);
  const availableHeight = Math.max(1, contentHeight - padding * 2);

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

function normalizeSelection(
  selection: CellRange,
  positionDimensions: ZoomToSelectionPositionDimensions,
): CellRange {
  const maxRow = Math.max(0, positionDimensions.totalRows - 1);
  const maxCol = Math.max(0, positionDimensions.totalCols - 1);
  const startRow = clampIndex(Math.min(selection.startRow, selection.endRow), maxRow);
  const endRow = clampIndex(Math.max(selection.startRow, selection.endRow), maxRow);
  const startCol = clampIndex(Math.min(selection.startCol, selection.endCol), maxCol);
  const endCol = clampIndex(Math.max(selection.startCol, selection.endCol), maxCol);

  return { startRow, startCol, endRow, endCol };
}

function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.trunc(value)));
}
