/**
 * Smart Positioning Utility
 *
 * Provides unified positioning logic for floating objects (charts, pivot tables, etc.)
 * to ensure they are always visible when created.
 *
 * Strategy:
 * 1. Try source-relative position (configurable offset from source range end)
 * 2. If that position would be off-screen, fallback to viewport-relative position
 *
 * This ensures floating objects are always visible when created, matching Excel behavior.
 *
 * @module engine/src/state/coordinator/utils/smart-positioning
 */

import type { ISheetViewGeometry, ISheetViewViewport } from '@mog-sdk/sheet-view';
import type { ScrollViewport } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Types
// =============================================================================

/**
 * Source range for positioning calculations.
 */
export interface SourceRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Anchor position in cell coordinates.
 */
export interface AnchorPosition {
  anchorRow: number;
  anchorCol: number;
}

/**
 * Offset configuration for positioning.
 */
export interface PositionOffset {
  /** Rows offset from source range end */
  rows: number;
  /** Columns offset from source range end */
  cols: number;
}

/**
 * Configuration for smart positioning.
 */
export interface SmartPositionConfig {
  /**
   * Source range for relative positioning.
   * If null, only defaultPosition will be used.
   */
  sourceRange: SourceRange | null;

  /**
   * Geometry capability for position calculations.
   * If null, source-relative position will be used without visibility check.
   */
  geometry?: ISheetViewGeometry | null;

  /**
   * Viewport capability for scroll/visibility calculations.
   * If null, source-relative position will be used without visibility check.
   */
  viewport?: ISheetViewViewport | null;

  /**
   * Default position when source range is not available or all else fails.
   */
  defaultPosition: AnchorPosition;

  /**
   * Offset from source range end for the candidate position.
   * Default: { rows: 2, cols: 0 } (directly below source)
   */
  offsetFromSource?: PositionOffset;

  /**
   * Additional offset for fallback viewport-relative position.
   * Default: { rows: 2, cols: 2 }
   */
  fallbackOffset?: PositionOffset;

  /**
   * Whether to position to the right of source (like pivot tables).
   * When true, uses endCol + offset.cols as anchor column.
   * When false, uses startCol as anchor column (like charts).
   * Default: false
   */
  positionRight?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Default offset from source range.
 */
const DEFAULT_SOURCE_OFFSET: PositionOffset = { rows: 2, cols: 0 };

/**
 * Default offset for viewport fallback.
 */
const DEFAULT_FALLBACK_OFFSET: PositionOffset = { rows: 2, cols: 2 };

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Maximum number of rows/columns to search when looking for a visible row/column.
 * Prevents infinite loops if all rows/columns in a range are hidden.
 */
const MAX_HIDDEN_SEARCH_LIMIT = 1000;

/**
 * Find the first visible row starting from the given index.
 * Skips over hidden rows to find one that is visible.
 *
 * @param startRow - The starting row index
 * @param geometry - Geometry capability to check visibility
 * @returns The first visible row index, or startRow if no hidden row detection is available
 */
function findFirstVisibleRow(startRow: number, geometry: ISheetViewGeometry): number {
  try {
    let row = startRow;
    let searchCount = 0;

    while (searchCount < MAX_HIDDEN_SEARCH_LIMIT) {
      const dims = geometry.getDimensions({ row, col: 0 });
      const rowDim = dims.find((d: any) => 'top' in d);
      if (rowDim && 'hidden' in rowDim && rowDim.hidden) {
        row++;
        searchCount++;
      } else {
        break;
      }
    }

    // If we hit the search limit, return the original row as fallback
    return searchCount >= MAX_HIDDEN_SEARCH_LIMIT ? startRow : row;
  } catch {
    // If any call fails, return original row
    return startRow;
  }
}

/**
 * Find the first visible column starting from the given index.
 * Skips over hidden columns to find one that is visible.
 *
 * @param startCol - The starting column index
 * @param geometry - Geometry capability to check visibility
 * @returns The first visible column index, or startCol if no hidden column detection is available
 */
function findFirstVisibleCol(startCol: number, geometry: ISheetViewGeometry): number {
  try {
    let col = startCol;
    let searchCount = 0;

    while (searchCount < MAX_HIDDEN_SEARCH_LIMIT) {
      const dims = geometry.getDimensions({ row: 0, col });
      const colDim = dims.find((d: any) => 'left' in d);
      if (colDim && 'hidden' in colDim && colDim.hidden) {
        col++;
        searchCount++;
      } else {
        break;
      }
    }

    // If we hit the search limit, return the original col as fallback
    return searchCount >= MAX_HIDDEN_SEARCH_LIMIT ? startCol : col;
  } catch {
    // If any call fails, return original col
    return startCol;
  }
}

/**
 * Adjust an anchor position to skip hidden rows and columns.
 * If the anchor row or column is hidden, find the first visible one.
 *
 * @param position - The anchor position to adjust
 * @param geometry - Geometry capability to check visibility
 * @returns Adjusted anchor position with visible row/col
 */
function adjustForHiddenRowsCols(
  position: AnchorPosition,
  geometry: ISheetViewGeometry,
): AnchorPosition {
  const visibleRow = findFirstVisibleRow(position.anchorRow, geometry);
  const visibleCol = findFirstVisibleCol(position.anchorCol, geometry);

  return {
    anchorRow: visibleRow,
    anchorCol: visibleCol,
  };
}

/**
 * Check if a document position is visible in the viewport.
 * Uses 4-boundary check for complete visibility verification.
 *
 * @param docPos - Document position { x, y }
 * @param viewport - Current viewport state
 * @returns true if the position is visible
 */
function isPositionVisible(docPos: { x: number; y: number }, viewport: ScrollViewport): boolean {
  return (
    docPos.x >= viewport.scrollLeft &&
    docPos.x < viewport.scrollLeft + viewport.width &&
    docPos.y >= viewport.scrollTop &&
    docPos.y < viewport.scrollTop + viewport.height
  );
}

/**
 * Calculate safe offset for viewport-to-cell conversion.
 * Uses header dimensions when available, falls back to default (100).
 *
 * @param _geometry - Geometry capability (reserved for future header dimension queries)
 * @returns Safe offset point { x, y }
 */
function getSafeViewportOffset(_geometry: ISheetViewGeometry): { x: number; y: number } {
  // Use a conservative default offset (100px) that ensures we're past
  // any header/gutter areas.
  const DEFAULT_OFFSET = 100;
  return { x: DEFAULT_OFFSET, y: DEFAULT_OFFSET };
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Get smart position for a floating object that ensures visibility.
 *
 * Strategy:
 * 1. If no source range, return default position
 * 2. Calculate source-relative candidate position
 * 3. If geometry/viewport capabilities available, check if candidate is visible
 * 4. If visible, use candidate position
 * 5. If not visible, fallback to viewport-relative position
 * 6. Last resort: use candidate position even if off-screen
 *
 * @param config - Smart positioning configuration
 * @returns Anchor position in cell coordinates
 *
 * @example
 * // For charts (directly below selection)
 * const position = getSmartPosition({
 * sourceRange: selectionRange,
 * geometry,
 * viewport,
 * defaultPosition: { anchorRow: 2, anchorCol: 2 },
 * offsetFromSource: { rows: 2, cols: 0 },
 * positionRight: false
 * });
 *
 * @example
 * // For pivot tables (below-right of source)
 * const position = getSmartPosition({
 * sourceRange: pivotSourceRange,
 * geometry,
 * viewport,
 * defaultPosition: { anchorRow: 2, anchorCol: 2 },
 * offsetFromSource: { rows: 2, cols: 2 },
 * positionRight: true
 * });
 */
export function getSmartPosition(config: SmartPositionConfig): AnchorPosition {
  const {
    sourceRange,
    geometry,
    viewport,
    defaultPosition,
    offsetFromSource = DEFAULT_SOURCE_OFFSET,
    fallbackOffset = DEFAULT_FALLBACK_OFFSET,
    positionRight = false,
  } = config;

  // If no source range, use default position
  if (!sourceRange) {
    return defaultPosition;
  }

  // Calculate source-relative candidate position
  let candidatePosition: AnchorPosition = {
    anchorRow: sourceRange.endRow + offsetFromSource.rows,
    anchorCol: positionRight
      ? sourceRange.endCol + offsetFromSource.cols
      : sourceRange.startCol + offsetFromSource.cols,
  };

  // --- Capability-based path (preferred) ---
  if (geometry) {
    candidatePosition = adjustForHiddenRowsCols(candidatePosition, geometry);

    try {
      if (!viewport) {
        return candidatePosition;
      }

      const scrollPos = viewport.getScrollPosition();
      const snapshot = viewport.getSnapshot();
      const vpWidth = snapshot.visibleRange
        ? (snapshot.visibleRange.endCol - snapshot.visibleRange.startCol) * 80
        : 800;
      const vpHeight = snapshot.visibleRange
        ? (snapshot.visibleRange.endRow - snapshot.visibleRange.startRow) * 20
        : 600;

      if (vpWidth === 0 || vpHeight === 0) {
        return candidatePosition;
      }

      const docRect = geometry.getCellPageRect({
        row: candidatePosition.anchorRow,
        col: candidatePosition.anchorCol,
      });

      if (!docRect) {
        return candidatePosition;
      }

      const viewportForCheck: ScrollViewport = {
        scrollLeft: scrollPos.x,
        scrollTop: scrollPos.y,
        width: vpWidth,
        height: vpHeight,
      };

      if (isPositionVisible({ x: docRect.x, y: docRect.y }, viewportForCheck)) {
        return candidatePosition;
      }

      const safeOffset = getSafeViewportOffset(geometry);

      const viewportCell = geometry.fromViewportPoint({
        x: safeOffset.x,
        y: safeOffset.y,
      });

      if (viewportCell) {
        const fallbackPosition: AnchorPosition = {
          anchorRow: viewportCell.row + fallbackOffset.rows,
          anchorCol: viewportCell.col + fallbackOffset.cols,
        };
        return adjustForHiddenRowsCols(fallbackPosition, geometry);
      }

      return candidatePosition;
    } catch {
      return candidatePosition;
    }
  }

  // No geometry available — return candidate position without visibility check
  return candidatePosition;
}

/**
 * Preset configuration for chart positioning.
 * Charts are positioned directly below the source selection.
 */
export const CHART_POSITION_PRESET: Pick<
  SmartPositionConfig,
  'offsetFromSource' | 'fallbackOffset' | 'positionRight'
> = {
  offsetFromSource: { rows: 2, cols: 0 },
  fallbackOffset: { rows: 2, cols: 2 },
  positionRight: false,
};

/**
 * Preset configuration for pivot table positioning.
 * Pivot tables are positioned below-right of the source range.
 */
export const PIVOT_POSITION_PRESET: Pick<
  SmartPositionConfig,
  'offsetFromSource' | 'fallbackOffset' | 'positionRight'
> = {
  offsetFromSource: { rows: 2, cols: 2 },
  fallbackOffset: { rows: 0, cols: 5 },
  positionRight: true,
};

/**
 * Preset configuration for shape positioning.
 * Shapes are positioned directly below the active cell/selection.
 */
export const SHAPE_POSITION_PRESET: Pick<
  SmartPositionConfig,
  'offsetFromSource' | 'fallbackOffset' | 'positionRight'
> = {
  offsetFromSource: { rows: 1, cols: 0 },
  fallbackOffset: { rows: 2, cols: 2 },
  positionRight: false,
};

/**
 * Preset configuration for text box positioning.
 * Text boxes are positioned directly below the active cell/selection.
 */
export const TEXTBOX_POSITION_PRESET: Pick<
  SmartPositionConfig,
  'offsetFromSource' | 'fallbackOffset' | 'positionRight'
> = {
  offsetFromSource: { rows: 1, cols: 0 },
  fallbackOffset: { rows: 2, cols: 2 },
  positionRight: false,
};
