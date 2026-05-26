/**
 * Coordinate System Types for Canvas Rendering
 *
 * These types define the coordinate spaces and dimension interfaces used
 * throughout the renderer. Moved to contracts to enable decoupling of
 * canvas and state subsystems.
 *
 * Coordinate Spaces:
 * 1. CELL SPACE - Logical cell references { row: 0, col: 0 } = A1
 * 2. DOCUMENT SPACE - Full document coordinates in pixels (no scroll, no zoom)
 * 3. VIEWPORT SPACE - Canvas-absolute coordinates (accounts for scroll, zoom, includes headers)
 * 4. LAYER SPACE - Layer-relative coordinates (accounts for scroll, zoom, NO headers - canvas translation handles headers)
 * 5. CANVAS SPACE - Physical pixels on canvas (viewport * devicePixelRatio)
 *
 * @module @mog-sdk/contracts/rendering/coordinates
 */

import type { CellRange } from '@mog/types-core';
import type { Point, Rect } from '@mog/types-viewport';
import type { HitTestResult } from './hit-test';
import type { CellCoord } from '@mog/types-viewport/rendering/primitives';
import type { HeaderVisibility } from '@mog/types-viewport/rendering/constants';

// Re-export CellCoord from primitives
export type { CellCoord } from '@mog/types-viewport/rendering/primitives';

// =============================================================================
// Branded Types for Coordinate Space Type Safety
// =============================================================================
// These branded types make coordinate spaces incompatible at the type level,
// preventing bugs where coordinates from one space are passed to functions
// expecting another space.
//
// Branded types are compile-time only - zero runtime overhead.

/** Brand for document coordinate space (unzoomed, from sheet origin) */
declare const DocumentBrand: unique symbol;

/** Brand for viewport coordinate space (zoomed, from canvas origin, includes headers) */
declare const ViewportBrand: unique symbol;

/** Brand for layer-relative coordinate space (zoomed, from cell area origin, no headers) */
declare const LayerBrand: unique symbol;

// -----------------------------------------------------------------------------
// Branded Point Types
// -----------------------------------------------------------------------------

/**
 * Point in document coordinates.
 * - Origin: Top-left of sheet content (cell A1)
 * - Units: Unzoomed pixels
 * - Scroll: Not affected by scroll position
 * - Use: Storage, formulas, cell references, floating object positions
 */
export type DocumentPoint = Point & { readonly [DocumentBrand]: true };

/**
 * Point in viewport coordinates.
 * - Origin: Top-left of canvas element
 * - Units: Screen pixels (zoomed)
 * - Headers: Includes row header width (50px) and column header height (24px)
 * - Use: Mouse events, canvas dimensions, absolute positioning, input handling
 */
export type ViewportPoint = Point & { readonly [ViewportBrand]: true };

/**
 * Point in layer-relative coordinates.
 * - Origin: Top-left of cell area (after headers)
 * - Units: Screen pixels (zoomed)
 * - Headers: Does NOT include header offsets (canvas ctx.translate() handles them)
 * - Use: Render layers, HitMap paths (paths are registered in layer-relative space)
 */
export type LayerPoint = Point & { readonly [LayerBrand]: true };

// -----------------------------------------------------------------------------
// Branded Rect Types
// -----------------------------------------------------------------------------

/**
 * Rectangle in document coordinates.
 * @see DocumentPoint for coordinate space details
 */
export type DocumentRect = Rect & { readonly [DocumentBrand]: true };

/**
 * Rectangle in viewport coordinates.
 * @see ViewportPoint for coordinate space details
 */
export type ViewportRect = Rect & { readonly [ViewportBrand]: true };

/**
 * Rectangle in layer-relative coordinates.
 * @see LayerPoint for coordinate space details
 */
export type LayerRect = Rect & { readonly [LayerBrand]: true };

// =============================================================================
// ScrollViewport (Low-Level Scroll State)
// =============================================================================

/**
 * ScrollViewport bounds - defines the visible area and scroll position.
 * Named ScrollViewport to distinguish from contracts Viewport which is
 * a high-level rendering viewport with bounds, cellRange, scrollOffset, zoom.
 */
export interface ScrollViewport {
  /** Pixels scrolled from top */
  scrollTop: number;
  /** Pixels scrolled from left */
  scrollLeft: number;
  /** Viewport width in CSS pixels */
  width: number;
  /** Viewport height in CSS pixels */
  height: number;
}

// =============================================================================
// Frozen Panes
// =============================================================================

/**
 * Frozen pane configuration.
 * Frozen rows/cols stay visible regardless of scroll position.
 */
export interface FrozenPanes {
  /** Number of frozen rows (0 = none) */
  rows: number;
  /** Number of frozen cols (0 = none) */
  cols: number;
}

// =============================================================================
// Visible Regions (for rendering with frozen panes)
// =============================================================================

/**
 * Visible regions accounting for frozen panes.
 * With frozen panes, the viewport is divided into up to 4 regions.
 *
 * Layout:
 * +-------------+-------------------------+
 * |frozenCorner | frozenRows              |
 * | (fixed)     | (scrolls horizontally)  |
 * +-------------+-------------------------+
 * | frozenCols  | main                    |
 * | (scrolls    | (scrolls both ways)     |
 * |  vertically)|                         |
 * +-------------+-------------------------+
 */
export interface VisibleRegions {
  /** Frozen corner - always visible at top-left (null if no frozen panes) */
  frozenCorner: CellRange | null;

  /** Frozen rows - scrolls horizontally only (null if no frozen rows) */
  frozenRows: CellRange | null;

  /** Frozen columns - scrolls vertically only (null if no frozen cols) */
  frozenCols: CellRange | null;

  /** Main scrollable area - scrolls both horizontally and vertically */
  main: CellRange;
}

// =============================================================================
// Minimal Interfaces for Index Types
// =============================================================================
// These minimal interfaces define what callers actually need from the concrete
// ViewportPositionIndex and ViewportMergeIndex classes (in grid-renderer).
// This avoids importing those concrete types into contracts while providing
// type safety for consumers.

/**
 * Minimal interface for viewport position index lookups.
 * The concrete implementation is ViewportPositionIndex in @mog/grid-renderer.
 */
export interface ViewportPositionIndexLike {
  /** O(1) - pixel position of row's top edge */
  getRowTop(row: number): number;
  /** O(1) - pixel position of column's left edge */
  getColLeft(col: number): number;
  /** O(1) - row height */
  getRowHeight(row: number): number;
  /** O(1) - column width */
  getColWidth(col: number): number;
  /** Whether position data is available */
  readonly hasData: boolean;
  /** Total number of rows in the sheet */
  readonly totalRows: number;
  /** Total number of columns in the sheet */
  readonly totalCols: number;
  /** Binary search for the row at a given Y position */
  findRowAtY(y: number): number | null;
  /** Binary search for the column at a given X position */
  findColAtX(x: number): number | null;
  /** Whether the given row is hidden */
  isRowHidden(row: number): boolean;
  /** Whether the given column is hidden */
  isColHidden(col: number): boolean;
}

/**
 * Minimal merge region shape returned by merge index lookups.
 */
export interface MergeRegionLike {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Minimal interface for viewport merge index lookups.
 * The concrete implementation is ViewportMergeIndex in @mog/grid-renderer.
 */
export interface ViewportMergeIndexLike {
  /** O(1) - returns the merge region containing (row, col), or null */
  getMergedRegion(row: number, col: number): MergeRegionLike | null;
}

// =============================================================================
// Coordinate System Interface
// =============================================================================

/**
 * The CoordinateSystem is the single source of truth for all coordinate conversions.
 *
 * IMPORTANT: All components that need to convert between coordinate spaces
 * MUST use this service. Do not implement coordinate math elsewhere.
 *
 * Type Safety: Methods use branded types (DocumentPoint, ViewportPoint, LayerPoint, etc.)
 * to prevent coordinate space mismatches at compile time.
 */
export interface CoordinateSystem {
  // ===========================================================================
  // CELL <-> DOCUMENT CONVERSIONS
  // ===========================================================================

  /**
   * Get the document-space rectangle for a cell.
   * Accounts for: column widths, row heights, merged cells
   * Does NOT account for: scroll, frozen panes, hidden rows/cols in position
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param cell - The cell coordinate
   */
  cellToDocument(sheetId: string, cell: CellCoord): DocumentRect;

  /**
   * Get the cell at a document-space point.
   * Returns null if point is out of bounds.
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param point - The document-space point
   */
  documentToCell(sheetId: string, point: DocumentPoint): CellCoord | null;

  /**
   * Get document-space bounding rectangle for a range.
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param range - The cell range
   */
  rangeToDocument(sheetId: string, range: CellRange): DocumentRect;

  // ===========================================================================
  // DOCUMENT <-> VIEWPORT CONVERSIONS
  // ===========================================================================

  /**
   * Convert document rectangle to viewport coordinates (includes header offsets).
   * Accounts for: scroll offset, frozen panes, zoom, header offsets
   * Returns null if the rect is not visible in the viewport.
   *
   * Use this for: Input handling (mouse events to document coords)
   * Do NOT use for: Render layers (they should use documentToLayerViewport)
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param rect - Rectangle in document coordinates
   */
  documentToViewport(sheetId: string, rect: DocumentRect): ViewportRect | null;

  /**
   * Convert document rectangle to layer-relative viewport coordinates.
   *
   * Unlike documentToViewport() which includes header offsets for input handling,
   * this method returns coordinates suitable for render layers where the canvas
   * translation (ctx.translate(vp.bounds.x, vp.bounds.y)) already accounts for headers.
   *
   * Coordinate spaces:
   * - documentToViewport(): Returns canvas-absolute coords (for mouse events)
   * - documentToLayerViewport(): Returns layer-relative coords (for rendering)
   *
   * Use this for: Render layers (overlay, selection, etc.)
   * Use documentToViewport() for: Input handling (mouse events)
   *
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param rect - Rectangle in document coordinates
   * @returns Rectangle in layer-relative viewport coordinates, or null if not visible
   */
  documentToLayerViewport(sheetId: string, rect: DocumentRect): LayerRect | null;

  /**
   * Convert viewport point to document coordinates.
   * Used for hit testing: viewport click -> document point -> cell
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param point - Point in viewport coordinates
   */
  viewportToDocument(sheetId: string, point: ViewportPoint): DocumentPoint;

  /**
   * Convert viewport point to layer-relative coordinates.
   * Subtracts header offsets (ROW_HEADER_WIDTH, COL_HEADER_HEIGHT).
   * Use for: Converting mouse events to layer space for HitMap queries.
   */
  viewportToLayer(point: ViewportPoint): LayerPoint;

  /**
   * Convert layer-relative point to viewport coordinates.
   * Adds header offsets (ROW_HEADER_WIDTH, COL_HEADER_HEIGHT).
   */
  layerToViewport(point: LayerPoint): ViewportPoint;

  // ===========================================================================
  // CELL <-> VIEWPORT (CONVENIENCE)
  // ===========================================================================

  /**
   * Get the viewport-space rectangle for a cell.
   * Returns null if cell is not currently visible.
   * This is the most common operation for rendering.
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param cell - The cell coordinate
   */
  cellToViewport(sheetId: string, cell: CellCoord): ViewportRect | null;

  /**
   * Get the cell at a viewport-space point (e.g., mouse click).
   * This is the most common operation for hit testing.
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param point - Point in viewport coordinates (e.g., mouse click position)
   */
  viewportToCell(sheetId: string, point: ViewportPoint): CellCoord | null;

  /**
   * Get viewport rectangles for a range.
   * May return multiple rects if range spans frozen/non-frozen boundary.
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param range - The cell range
   */
  rangeToViewport(sheetId: string, range: CellRange): ViewportRect[];

  // ===========================================================================
  // CLICK POSITION
  // ===========================================================================

  /**
   * Get the click position relative to a cell's top-left corner.
   * Correctly handles frozen panes, zoom, and header offsets.
   *
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param point - Click position in viewport coordinates
   * @param cell - The cell to get relative position within
   * @returns Position within cell and cell dimensions, or null if cell not visible
   *
   * @note ALWAYS use this method instead of manually calculating
   * `cellLeft - viewport.scrollLeft`. The manual calculation doesn't
   * account for frozen panes, zoom, or header offsets.
   */
  getClickPositionInCell(
    sheetId: string,
    point: ViewportPoint,
    cell: CellCoord,
  ): {
    x: number; // click X relative to cell left
    y: number; // click Y relative to cell top
    width: number; // cell width (zoomed)
    height: number; // cell height (zoomed)
  } | null;

  // ===========================================================================
  // VIEWPORT QUERIES
  // ===========================================================================

  /**
   * Get the range of cells currently visible in the viewport.
   * Critical for virtualized rendering - only render these cells.
   * @param sheetId - The sheet ID to use for coordinate calculations
   */
  getVisibleRange(sheetId: string): CellRange;

  /**
   * Get visible range split by frozen panes.
   * Returns up to 4 regions for frozen rows + frozen cols.
   * @param sheetId - The sheet ID to use for coordinate calculations
   */
  getVisibleRegions(sheetId: string): VisibleRegions;

  /**
   * Check if a cell is currently visible in the viewport.
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param cell - The cell coordinate to check
   */
  isCellVisible(sheetId: string, cell: CellCoord): boolean;

  /**
   * Check if a cell is in the frozen region.
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param cell - The cell coordinate to check
   */
  isCellFrozen(sheetId: string, cell: CellCoord): boolean;

  // ===========================================================================
  // HIT TESTING
  // ===========================================================================

  /**
   * Classify a viewport point for hit testing.
   * Returns what type of element is at the given viewport coordinates.
   *
   * Used by components to determine if a click is on:
   * - A cell (main grid area)
   * - Column header (for column selection)
   * - Row header (for row selection)
   * - Column/row resize handle
   * - Fill handle
   * - Frozen corner (select all)
   * - Empty area
   *
   * Touch Target Sizing
   * When isTouch is true, hit areas are expanded to meet touch target guidelines.
   *
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param point - Point in viewport coordinates (e.g., mouse click position)
   * @param isTouch - Whether the input is from a touch device (larger hit areas)
   */
  classifyPoint(sheetId: string, point: ViewportPoint, isTouch?: boolean): HitTestResult;

  // ===========================================================================
  // SCROLLING
  // ===========================================================================

  /**
   * Calculate scroll offset to bring a cell into view.
   * Returns null if cell is already visible.
   *
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param cell - The cell to scroll to
   * @param padding - Optional padding in pixels from viewport edge
   */
  getScrollToCell(
    sheetId: string,
    cell: CellCoord,
    padding?: number,
  ): { top: number; left: number } | null;

  /**
   * Get the maximum scroll bounds.
   * @param sheetId - The sheet ID to use for coordinate calculations
   */
  getScrollBounds(sheetId: string): { maxScrollTop: number; maxScrollLeft: number };

  /**
   * Get viewport bounds for auto-scroll edge detection.
   * Returns the scrollable region boundaries (excluding frozen panes and headers).
   * Used by auto-scroll service during drag operations.
   * @param sheetId - The sheet ID to use for coordinate calculations
   */
  getViewportBounds(sheetId: string): { left: number; top: number; right: number; bottom: number };

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  /** Update viewport (scroll position, size) */
  setViewport(viewport: ScrollViewport): void;

  /** Get current viewport */
  getViewport(): ScrollViewport;

  /** Update frozen panes */
  setFrozenPanes(panes: FrozenPanes): void;

  /** Get current frozen panes */
  getFrozenPanes(): FrozenPanes;

  /**
   * Get the current sheet ID being rendered.
   * Returns null if no sheet is active.
   *
   * Used by callers that need the active sheet ID but don't have it
   * available through other means (e.g., scroll coordination helpers).
   */
  getCurrentSheetId(): string | null;

  /**
   * Get the underlying position index (alias for getViewportPositionIndex).
   * Convenience method used by scroll coordination and object coordination
   * for snap-to-cell and pixel-to-cell conversion.
   */
  getPositionIndex(): ViewportPositionIndexLike | null;

  /**
   * Set the viewport position index for O(1) position lookups.
   *
   * @param index - The ViewportPositionIndex instance, or null to clear
   */
  setViewportPositionIndex(index: ViewportPositionIndexLike | null): void;

  /**
   * Get the viewport position index.
   * Returns null if no position index has been set.
   */
  getViewportPositionIndex(): ViewportPositionIndexLike | null;

  /** Update zoom level (1.0 = 100%) */
  setZoom(zoom: number): void;

  /** Get current zoom level */
  getZoom(): number;

  /** Get device pixel ratio (for canvas scaling) */
  getDevicePixelRatio(): number;

  /**
   * Set the viewport merge index for merge-aware coordinate lookups.
   *
   * @param index - The ViewportMergeIndex instance, or null to clear
   */
  setViewportMergeIndex(index: ViewportMergeIndexLike | null): void;

  /**
   * Get the viewport merge index.
   * Returns null if no merge index has been set.
   */
  getViewportMergeIndex(): ViewportMergeIndexLike | null;

  /**
   * Set outline gutter dimensions based on grouping state.
   * This shifts all content (headers + cells) right/down to make room.
   *
   * @param rowGutterWidth - Width of row outline gutter (0 if no row groups)
   * @param colGutterHeight - Height of column outline gutter (0 if no col groups)
   */
  setOutlineGutter(rowGutterWidth: number, colGutterHeight: number): void;

  /**
   * Get current outline gutter dimensions.
   * @returns Object with rowGutterWidth and colGutterHeight
   */
  getOutlineGutter(): { rowGutterWidth: number; colGutterHeight: number };

  /**
   * Set header visibility.
   * When headers are hidden, their dimensions are treated as 0 for coordinate calculations.
   *
   * @param visibility - Header visibility configuration
   */
  setHeaderVisibility(visibility: HeaderVisibility): void;

  /**
   * Get current header visibility settings.
   * Used by layers to determine header offsets for positioning.
   *
   * @returns Header visibility configuration
   */
  getHeaderVisibility(): HeaderVisibility;
}
