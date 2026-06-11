/**
 * Coordinate System Implementation
 *
 * The single source of truth for all coordinate conversions in the renderer.
 * All components that need to convert between coordinate spaces MUST use this.
 *
 * @module canvas/coordinates/coordinate-system
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type {
  CellCoord,
  CoordinateSystem,
  DocumentPoint,
  DocumentRect,
  FrozenPanes,
  HeaderVisibility,
  HitTestResult,
  LayerPoint,
  LayerRect,
  ScrollViewport,
  ViewportPoint,
  ViewportPositionIndexLike,
  ViewportMergeIndexLike,
  ViewportRect,
  VisibleRegions,
} from '@mog-sdk/contracts/rendering';
import {
  documentPoint,
  documentRect,
  layerPoint,
  layerRect,
  viewportPoint,
  viewportRect,
} from '@mog/spreadsheet-utils/rendering/coordinates';
import type { Point } from '@mog-sdk/contracts/viewport';
import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  getEffectiveHeaderDimensions,
} from '../shared/constants';

// =============================================================================
// Implementation
// =============================================================================

export class CoordinateSystemImpl implements CoordinateSystem {
  private viewport: ScrollViewport = { scrollTop: 0, scrollLeft: 0, width: 0, height: 0 };
  private frozenPanes: FrozenPanes = { rows: 0, cols: 0 };
  private zoom: number = 1.0;

  // Viewport position index for O(1) lookups
  private positionIndex: ViewportPositionIndexLike | null = null;

  // Viewport merge index for O(1) merge lookups
  private mergeIndex: ViewportMergeIndexLike | null = null;

  // Cache for frozen pane pixel boundaries (per-sheet)
  private frozenRowsHeightCache: Map<string, number> = new Map();
  private frozenColsWidthCache: Map<string, number> = new Map();

  // Outline gutter dimensions (for row/column grouping)
  private rowGutterWidth: number = 0;
  private colGutterHeight: number = 0;

  // Header visibility
  private headerVisibility: HeaderVisibility = {
    showRowHeaders: true,
    showColumnHeaders: true,
  };

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Set the viewport position index for O(1) position lookups.
   */
  setViewportPositionIndex(index: ViewportPositionIndexLike | null): void {
    this.positionIndex = index;
    // Clear frozen boundary caches when position data changes
    this.frozenRowsHeightCache.clear();
    this.frozenColsWidthCache.clear();
  }

  /**
   * Get the current viewport position index, if set.
   */
  getViewportPositionIndex(): ViewportPositionIndexLike | null {
    return this.positionIndex;
  }

  /**
   * Set the viewport merge index for O(1) merge lookups.
   */
  setViewportMergeIndex(index: ViewportMergeIndexLike | null): void {
    this.mergeIndex = index;
  }

  /**
   * Get the current viewport merge index, if set.
   */
  getViewportMergeIndex(): ViewportMergeIndexLike | null {
    return this.mergeIndex;
  }

  setViewport(viewport: ScrollViewport): void {
    this.viewport = viewport;
  }

  getViewport(): ScrollViewport {
    return { ...this.viewport };
  }

  setFrozenPanes(panes: FrozenPanes): void {
    this.frozenPanes = panes;
    // Clear frozen boundary caches when panes change
    this.frozenRowsHeightCache.clear();
    this.frozenColsWidthCache.clear();
  }

  getFrozenPanes(): FrozenPanes {
    return { ...this.frozenPanes };
  }

  /**
   * Get the current sheet ID being rendered.
   * CoordinateSystemImpl does not track sheet ID itself — returns null.
   * Callers that need sheet ID should get it from the renderer or store.
   */
  getCurrentSheetId(): string | null {
    return null;
  }

  /**
   * Get the underlying position index (alias for getViewportPositionIndex).
   */
  getPositionIndex(): ViewportPositionIndexLike | null {
    return this.positionIndex;
  }

  setZoom(zoom: number): void {
    // Clamp zoom between 10% and 400%
    this.zoom = Math.max(0.1, Math.min(4.0, zoom));
  }

  getZoom(): number {
    return this.zoom;
  }

  getDevicePixelRatio(): number {
    return typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  }

  setOutlineGutter(rowGutterWidth: number, colGutterHeight: number): void {
    this.rowGutterWidth = rowGutterWidth;
    this.colGutterHeight = colGutterHeight;
  }

  getOutlineGutter(): { rowGutterWidth: number; colGutterHeight: number } {
    return {
      rowGutterWidth: this.rowGutterWidth,
      colGutterHeight: this.colGutterHeight,
    };
  }

  /**
   * Set header visibility.
   * When headers are hidden, their dimensions are treated as 0 for coordinate calculations.
   */
  setHeaderVisibility(visibility: HeaderVisibility): void {
    this.headerVisibility = { ...visibility };
  }

  /**
   * Get current header visibility settings.
   */
  getHeaderVisibility(): HeaderVisibility {
    return { ...this.headerVisibility };
  }

  /**
   * Get the frozen rows height for a specific sheet.
   * Uses per-sheet caching for performance.
   */
  private getFrozenRowsHeight(sheetId: string): number {
    if (this.frozenPanes.rows <= 0) return 0;

    let cached = this.frozenRowsHeightCache.get(sheetId);
    if (cached === undefined) {
      const pi = this.positionIndex;
      cached = pi
        ? (pi.getRowTop(this.frozenPanes.rows) ?? this.frozenPanes.rows * DEFAULT_ROW_HEIGHT)
        : this.frozenPanes.rows * DEFAULT_ROW_HEIGHT;
      this.frozenRowsHeightCache.set(sheetId, cached);
    }
    return cached;
  }

  /**
   * Get the frozen cols width for a specific sheet.
   * Uses per-sheet caching for performance.
   */
  private getFrozenColsWidth(sheetId: string): number {
    if (this.frozenPanes.cols <= 0) return 0;

    let cached = this.frozenColsWidthCache.get(sheetId);
    if (cached === undefined) {
      const pi = this.positionIndex;
      cached = pi
        ? (pi.getColLeft(this.frozenPanes.cols) ?? this.frozenPanes.cols * DEFAULT_COL_WIDTH)
        : this.frozenPanes.cols * DEFAULT_COL_WIDTH;
      this.frozenColsWidthCache.set(sheetId, cached);
    }
    return cached;
  }

  /**
   * Get the left edge of the cell area (gutter + row header).
   * Respects header visibility - when row headers are hidden, only gutter width is used.
   * @private
   */
  private getCellAreaLeft(): number {
    const { rowHeaderWidth } = getEffectiveHeaderDimensions(this.headerVisibility);
    return this.rowGutterWidth + rowHeaderWidth;
  }

  /**
   * Get the top edge of the cell area (gutter + column header).
   * Respects header visibility - when column headers are hidden, only gutter height is used.
   * @private
   */
  private getCellAreaTop(): number {
    const { colHeaderHeight } = getEffectiveHeaderDimensions(this.headerVisibility);
    return this.colGutterHeight + colHeaderHeight;
  }

  private clipScrollableAxis(
    position: number,
    size: number,
    frozenBoundary: number,
  ): { position: number; size: number } | null {
    if (frozenBoundary <= 0 || position >= frozenBoundary) {
      return { position, size };
    }

    const hiddenSize = frozenBoundary - position;
    if (hiddenSize >= size) return null;

    return {
      position: frozenBoundary,
      size: size - hiddenSize,
    };
  }

  // ===========================================================================
  // CELL -> DOCUMENT
  // ===========================================================================

  cellToDocument(_sheetId: string, cell: CellCoord): DocumentRect {
    const pi = this.positionIndex;

    // Check for merged cells - use the merged region's dimensions
    const merged = this.mergeIndex?.getMergedRegion(cell.row, cell.col) ?? null;
    const effectiveCell = merged ? { row: merged.startRow, col: merged.startCol } : cell;

    const x = pi ? pi.getColLeft(effectiveCell.col) : effectiveCell.col * DEFAULT_COL_WIDTH;
    const y = pi ? pi.getRowTop(effectiveCell.row) : effectiveCell.row * DEFAULT_ROW_HEIGHT;

    // For merged cells, sum the widths/heights
    if (merged) {
      let width = 0;
      let height = 0;

      for (let c = merged.startCol; c <= merged.endCol; c++) {
        if (!(pi?.isColHidden(c) ?? false)) {
          width += pi ? pi.getColWidth(c) : DEFAULT_COL_WIDTH;
        }
      }

      for (let r = merged.startRow; r <= merged.endRow; r++) {
        if (!(pi?.isRowHidden(r) ?? false)) {
          height += pi ? pi.getRowHeight(r) : DEFAULT_ROW_HEIGHT;
        }
      }

      return documentRect(x, y, width, height);
    }

    const width = pi ? pi.getColWidth(cell.col) : DEFAULT_COL_WIDTH;
    const height = pi ? pi.getRowHeight(cell.row) : DEFAULT_ROW_HEIGHT;

    return documentRect(x, y, width, height);
  }

  // ===========================================================================
  // DOCUMENT -> CELL (binary search for performance)
  // ===========================================================================

  documentToCell(sheetId: string, point: DocumentPoint): CellCoord | null {
    // Check bounds
    if (point.x < 0 || point.y < 0) return null;

    // Binary search for row
    const row = this.binarySearchRow(sheetId, point.y);
    if (row === null) return null;

    // Binary search for column
    const col = this.binarySearchCol(sheetId, point.x);
    if (col === null) return null;

    // Check if this cell is part of a merged region
    const merged = this.mergeIndex?.getMergedRegion(row, col) ?? null;
    if (merged) {
      return { row: merged.startRow, col: merged.startCol }; // Always return top-left of merge
    }

    return { row, col };
  }

  private binarySearchRow(_sheetId: string, y: number): number | null {
    const pi = this.positionIndex;
    const totalRows = pi?.totalRows ?? 1_048_576;

    // Try position index binary search first (O(1) per comparison, typed array)
    if (pi && pi.hasData) {
      const row = pi.findRowAtY(y);
      if (row !== null) {
        // Validate with hidden check
        if (pi.isRowHidden(row)) {
          for (let r = row + 1; r < totalRows; r++) {
            if (!pi.isRowHidden(r)) return r;
          }
          return null;
        }
        return row;
      }
    }

    // Fall back to default-based binary search
    let low = 0;
    let high = totalRows - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const rowTop = pi ? pi.getRowTop(mid) : mid * DEFAULT_ROW_HEIGHT;
      const rowBottom = rowTop + (pi ? pi.getRowHeight(mid) : DEFAULT_ROW_HEIGHT);

      if (y < rowTop) {
        high = mid - 1;
      } else if (y >= rowBottom) {
        low = mid + 1;
      } else {
        // Found the row - but skip if hidden
        if (pi?.isRowHidden(mid)) {
          // Find next visible row
          for (let r = mid + 1; r < totalRows; r++) {
            if (!pi.isRowHidden(r)) return r;
          }
          return null;
        }
        return mid;
      }
    }

    return null;
  }

  private binarySearchCol(_sheetId: string, x: number): number | null {
    const pi = this.positionIndex;
    const totalCols = pi?.totalCols ?? 16_384;

    // Try position index binary search first (O(1) per comparison, typed array)
    if (pi && pi.hasData) {
      const col = pi.findColAtX(x);
      if (col !== null) {
        // Validate with hidden check
        if (pi.isColHidden(col)) {
          for (let c = col + 1; c < totalCols; c++) {
            if (!pi.isColHidden(c)) return c;
          }
          return null;
        }
        return col;
      }
    }

    // Fall back to default-based binary search
    let low = 0;
    let high = totalCols - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const colLeft = pi ? pi.getColLeft(mid) : mid * DEFAULT_COL_WIDTH;
      const colRight = colLeft + (pi ? pi.getColWidth(mid) : DEFAULT_COL_WIDTH);

      if (x < colLeft) {
        high = mid - 1;
      } else if (x >= colRight) {
        low = mid + 1;
      } else {
        // Found the column - but skip if hidden
        if (pi?.isColHidden(mid)) {
          // Find next visible column
          for (let c = mid + 1; c < totalCols; c++) {
            if (!pi.isColHidden(c)) return c;
          }
          return null;
        }
        return mid;
      }
    }

    return null;
  }

  // ===========================================================================
  // Range -> Document
  // ===========================================================================

  rangeToDocument(_sheetId: string, range: CellRange): DocumentRect {
    const pi = this.positionIndex;

    const startX = pi ? pi.getColLeft(range.startCol) : range.startCol * DEFAULT_COL_WIDTH;
    const startY = pi ? pi.getRowTop(range.startRow) : range.startRow * DEFAULT_ROW_HEIGHT;

    // Calculate end position
    const endColLeft = pi ? pi.getColLeft(range.endCol) : range.endCol * DEFAULT_COL_WIDTH;
    const endColWidth = pi ? pi.getColWidth(range.endCol) : DEFAULT_COL_WIDTH;
    const endRowTop = pi ? pi.getRowTop(range.endRow) : range.endRow * DEFAULT_ROW_HEIGHT;
    const endRowHeight = pi ? pi.getRowHeight(range.endRow) : DEFAULT_ROW_HEIGHT;

    const endX = endColLeft + endColWidth;
    const endY = endRowTop + endRowHeight;

    return documentRect(startX, startY, endX - startX, endY - startY);
  }

  // ===========================================================================
  // DOCUMENT <-> VIEWPORT CONVERSIONS
  // ===========================================================================

  documentToViewport(sheetId: string, rect: DocumentRect): ViewportRect | null {
    const frozenRowsHeight = this.getFrozenRowsHeight(sheetId);
    const frozenColsWidth = this.getFrozenColsWidth(sheetId);

    const isFrozenRow = rect.y < frozenRowsHeight;
    const isFrozenCol = rect.x < frozenColsWidth;

    let vpX: number;
    let vpY: number;
    let visibleWidth = rect.width;
    let visibleHeight = rect.height;

    if (isFrozenCol) {
      // Frozen columns don't scroll horizontally
      vpX = rect.x;
    } else {
      // Non-frozen: subtract scroll, but position after frozen area
      vpX = rect.x - this.viewport.scrollLeft;
      const clipped = this.clipScrollableAxis(vpX, visibleWidth, frozenColsWidth);
      if (!clipped) return null;
      vpX = clipped.position;
      visibleWidth = clipped.size;
    }

    if (isFrozenRow) {
      // Frozen rows don't scroll vertically
      vpY = rect.y;
    } else {
      // Non-frozen: subtract scroll
      vpY = rect.y - this.viewport.scrollTop;
      const clipped = this.clipScrollableAxis(vpY, visibleHeight, frozenRowsHeight);
      if (!clipped) return null;
      vpY = clipped.position;
      visibleHeight = clipped.size;
    }

    // Apply zoom and add header offsets
    // Cells are rendered after the header area
    const cellAreaLeft = this.getCellAreaLeft();
    const cellAreaTop = this.getCellAreaTop();
    const resultX = vpX * this.zoom + cellAreaLeft;
    const resultY = vpY * this.zoom + cellAreaTop;
    const resultWidth = visibleWidth * this.zoom;
    const resultHeight = visibleHeight * this.zoom;

    // Check if visible in viewport (accounting for header area).
    // Use <= / >= so cells exactly at the boundary (zero visible area) are not visible.
    if (resultX + resultWidth <= cellAreaLeft || resultX >= this.viewport.width) return null;
    if (resultY + resultHeight <= cellAreaTop || resultY >= this.viewport.height) return null;

    return viewportRect(resultX, resultY, resultWidth, resultHeight);
  }

  /**
   * Convert document coordinates to layer-relative viewport coordinates.
   *
   * Unlike documentToViewport() which includes header offsets for input handling,
   * this method returns coordinates suitable for render layers where the canvas
   * translation (ctx.translate(vp.bounds.x, vp.bounds.y)) already accounts for headers.
   *
   * This fixes the "double offset" bug where overlay layer was using documentToViewport()
   * which added header offsets, but the canvas translation ALSO adds those offsets,
   * causing shapes to render 50px right and 24px down from their registered hit paths.
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param rect - Rectangle in document coordinates (e.g., floating object bounds)
   * @returns Rectangle in layer-relative viewport coordinates, or null if not visible
   */
  documentToLayerViewport(sheetId: string, rect: DocumentRect): LayerRect | null {
    const frozenRowsHeight = this.getFrozenRowsHeight(sheetId);
    const frozenColsWidth = this.getFrozenColsWidth(sheetId);

    const isFrozenRow = rect.y < frozenRowsHeight;
    const isFrozenCol = rect.x < frozenColsWidth;

    let layerX: number;
    let layerY: number;
    let visibleWidth = rect.width;
    let visibleHeight = rect.height;

    if (isFrozenCol) {
      // Frozen columns don't scroll horizontally
      layerX = rect.x;
    } else {
      // Non-frozen: subtract scroll, but position after frozen area
      layerX = rect.x - this.viewport.scrollLeft;
      const clipped = this.clipScrollableAxis(layerX, visibleWidth, frozenColsWidth);
      if (!clipped) return null;
      layerX = clipped.position;
      visibleWidth = clipped.size;
    }

    if (isFrozenRow) {
      // Frozen rows don't scroll vertically
      layerY = rect.y;
    } else {
      // Non-frozen: subtract scroll
      layerY = rect.y - this.viewport.scrollTop;
      const clipped = this.clipScrollableAxis(layerY, visibleHeight, frozenRowsHeight);
      if (!clipped) return null;
      layerY = clipped.position;
      visibleHeight = clipped.size;
    }

    // Apply zoom but NO header offsets (canvas translation handles headers)
    // This is the key difference from documentToViewport()
    const resultX = layerX * this.zoom;
    const resultY = layerY * this.zoom;
    const resultWidth = visibleWidth * this.zoom;
    const resultHeight = visibleHeight * this.zoom;

    // Visibility check: use viewport cell area dimensions (excluding headers)
    // The viewport.width/height includes headers, so we subtract them for the cell area
    const cellAreaLeft = this.getCellAreaLeft();
    const cellAreaTop = this.getCellAreaTop();
    const cellAreaWidth = this.viewport.width - cellAreaLeft;
    const cellAreaHeight = this.viewport.height - cellAreaTop;

    if (resultX + resultWidth <= 0 || resultX >= cellAreaWidth) return null;
    if (resultY + resultHeight <= 0 || resultY >= cellAreaHeight) return null;

    return layerRect(resultX, resultY, resultWidth, resultHeight);
  }

  viewportToDocument(sheetId: string, point: ViewportPoint): DocumentPoint {
    const frozenRowsHeight = this.getFrozenRowsHeight(sheetId);
    const frozenColsWidth = this.getFrozenColsWidth(sheetId);

    // Subtract header offsets first, then reverse zoom
    const cellAreaLeft = this.getCellAreaLeft();
    const cellAreaTop = this.getCellAreaTop();
    const contentX = point.x - cellAreaLeft;
    const contentY = point.y - cellAreaTop;

    // If clicking in header area, return negative coordinates (will map to null cell)
    if (contentX < 0 || contentY < 0) {
      return documentPoint(contentX, contentY);
    }

    const unzoomedX = contentX / this.zoom;
    const unzoomedY = contentY / this.zoom;

    // Determine if point is in frozen region
    const inFrozenCols = unzoomedX < frozenColsWidth;
    const inFrozenRows = unzoomedY < frozenRowsHeight;

    let docX: number;
    let docY: number;

    if (inFrozenCols) {
      docX = unzoomedX;
    } else {
      docX = unzoomedX + this.viewport.scrollLeft;
    }

    if (inFrozenRows) {
      docY = unzoomedY;
    } else {
      docY = unzoomedY + this.viewport.scrollTop;
    }

    return documentPoint(docX, docY);
  }

  /**
   * Convert viewport point to layer-relative coordinates.
   * Subtracts header offsets (gutter + headers).
   * Use for: Converting mouse events to layer space for HitMap queries.
   */
  viewportToLayer(point: ViewportPoint): LayerPoint {
    const cellAreaLeft = this.getCellAreaLeft();
    const cellAreaTop = this.getCellAreaTop();
    return layerPoint(point.x - cellAreaLeft, point.y - cellAreaTop);
  }

  /**
   * Convert layer-relative point to viewport coordinates.
   * Adds header offsets (gutter + headers).
   */
  layerToViewport(point: LayerPoint): ViewportPoint {
    const cellAreaLeft = this.getCellAreaLeft();
    const cellAreaTop = this.getCellAreaTop();
    return viewportPoint(point.x + cellAreaLeft, point.y + cellAreaTop);
  }

  // ===========================================================================
  // CELL <-> VIEWPORT (CONVENIENCE)
  // ===========================================================================

  cellToViewport(sheetId: string, cell: CellCoord): ViewportRect | null {
    const docRect = this.cellToDocument(sheetId, cell);
    return this.documentToViewport(sheetId, docRect);
  }

  viewportToCell(sheetId: string, point: ViewportPoint): CellCoord | null {
    const docPoint = this.viewportToDocument(sheetId, point);
    const cell = this.documentToCell(sheetId, docPoint);
    return cell;
  }

  rangeToViewport(sheetId: string, range: CellRange): ViewportRect[] {
    const rects: ViewportRect[] = [];

    // For simplicity, calculate the bounding box and convert
    // A more sophisticated implementation would split at frozen boundaries
    const docRect = this.rangeToDocument(sheetId, range);
    const vpRect = this.documentToViewport(sheetId, docRect);

    if (vpRect) {
      rects.push(vpRect);
    }

    return rects;
  }

  // ===========================================================================
  // CLICK POSITION
  // ===========================================================================

  getClickPositionInCell(
    sheetId: string,
    point: ViewportPoint,
    cell: CellCoord,
  ): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    const cellRect = this.cellToViewport(sheetId, cell);
    if (!cellRect) return null;

    return {
      x: point.x - cellRect.x,
      y: point.y - cellRect.y,
      width: cellRect.width,
      height: cellRect.height,
    };
  }

  // ===========================================================================
  // VIEWPORT QUERIES
  // ===========================================================================

  getVisibleRange(sheetId: string): CellRange {
    const pi = this.positionIndex;
    const totalRows = pi?.totalRows ?? 1_048_576;
    const totalCols = pi?.totalCols ?? 16_384;

    // Calculate the document-space bounds of the viewport
    const docTopLeft = this.viewportToDocument(sheetId, viewportPoint(0, 0));
    const docBottomRight = this.viewportToDocument(
      sheetId,
      viewportPoint(this.viewport.width, this.viewport.height),
    );

    // Find cell range
    const startCell = this.documentToCell(sheetId, docTopLeft) ?? { row: 0, col: 0 };
    const endCell = this.documentToCell(sheetId, docBottomRight) ?? {
      row: totalRows - 1,
      col: totalCols - 1,
    };

    // Expand by 1 for partial cells at edges
    return {
      startRow: Math.max(0, startCell.row - 1),
      startCol: Math.max(0, startCell.col - 1),
      endRow: Math.min(totalRows - 1, endCell.row + 1),
      endCol: Math.min(totalCols - 1, endCell.col + 1),
    };
  }

  getVisibleRegions(sheetId: string): VisibleRegions {
    const visibleRange = this.getVisibleRange(sheetId);

    const hasFrozenRows = this.frozenPanes.rows > 0;
    const hasFrozenCols = this.frozenPanes.cols > 0;

    return {
      // Top-left frozen corner (always visible if frozen panes exist)
      frozenCorner:
        hasFrozenRows && hasFrozenCols
          ? {
              startRow: 0,
              startCol: 0,
              endRow: this.frozenPanes.rows - 1,
              endCol: this.frozenPanes.cols - 1,
            }
          : null,

      // Top frozen rows (horizontal scroll only)
      frozenRows: hasFrozenRows
        ? {
            startRow: 0,
            startCol: hasFrozenCols ? this.frozenPanes.cols : visibleRange.startCol,
            endRow: this.frozenPanes.rows - 1,
            endCol: visibleRange.endCol,
          }
        : null,

      // Left frozen columns (vertical scroll only)
      frozenCols: hasFrozenCols
        ? {
            startRow: hasFrozenRows ? this.frozenPanes.rows : visibleRange.startRow,
            startCol: 0,
            endRow: visibleRange.endRow,
            endCol: this.frozenPanes.cols - 1,
          }
        : null,

      // Main scrollable area
      main: {
        startRow: hasFrozenRows
          ? Math.max(this.frozenPanes.rows, visibleRange.startRow)
          : visibleRange.startRow,
        startCol: hasFrozenCols
          ? Math.max(this.frozenPanes.cols, visibleRange.startCol)
          : visibleRange.startCol,
        endRow: visibleRange.endRow,
        endCol: visibleRange.endCol,
      },
    };
  }

  isCellVisible(sheetId: string, cell: CellCoord): boolean {
    return this.cellToViewport(sheetId, cell) !== null;
  }

  isCellFrozen(_sheetId: string, cell: CellCoord): boolean {
    return cell.row < this.frozenPanes.rows || cell.col < this.frozenPanes.cols;
  }

  // ===========================================================================
  // HIT TESTING
  // ===========================================================================

  /**
   * Classify a viewport point for hit testing.
   * Determines what type of element is at the given viewport coordinates.
   *
   * When isTouch is true, hit areas are expanded to meet touch target guidelines.
   *
   * @param sheetId - The sheet ID to use for coordinate calculations
   * @param point - Point in viewport coordinates
   * @param isTouch - Whether the input is from a touch device (larger hit areas)
   */
  classifyPoint(sheetId: string, point: ViewportPoint, isTouch = false): HitTestResult {
    const { x, y } = point;

    // Use larger hit areas for touch to meet accessibility guidelines
    // Apple HIG recommends 44x44 points minimum for touch targets
    const RESIZE_HANDLE_SIZE = isTouch ? 22 : 5;
    // Pixels from edge to detect hidden boundaries (D.5)
    const HIDDEN_BOUNDARY_SIZE = isTouch ? 22 : 5;

    const { rowGutterWidth, colGutterHeight } = this.getOutlineGutter();

    // Check row gutter area (left side)
    if (x < rowGutterWidth) {
      return { type: 'outlineGutter', orientation: 'row' };
    }

    // Check column gutter area (top side)
    if (y < colGutterHeight) {
      return { type: 'outlineGutter', orientation: 'column' };
    }

    const cellAreaLeft = this.getCellAreaLeft();
    const cellAreaTop = this.getCellAreaTop();

    // Check corner first (top-left intersection of headers = "select all" area)
    if (x < cellAreaLeft && y < cellAreaTop) {
      return { type: 'frozen', region: 'topLeft' };
    }

    // Check column header area (top strip, to the right of row header)
    if (y < cellAreaTop && x >= cellAreaLeft) {
      const col = this.viewportXToCol(sheetId, x);
      if (col === null) {
        return { type: 'empty' };
      }

      // D.5: Check for hidden column boundary (before resize handle check)
      // Check if there are hidden columns immediately before this visible column
      if (col > 0) {
        const pi = this.positionIndex;
        if (pi?.isColHidden(col - 1)) {
          const colLeft = this.getColLeftInViewport(sheetId, col);
          if (colLeft !== null && Math.abs(x - colLeft) <= HIDDEN_BOUNDARY_SIZE) {
            // Find the range of hidden columns
            const hiddenEnd = col - 1;
            let hiddenStart = hiddenEnd;
            // Walk backwards to find the start of the hidden range
            while (hiddenStart > 0 && pi.isColHidden(hiddenStart - 1)) {
              hiddenStart--;
            }
            return { type: 'hiddenColumnBoundary', col, hiddenStart, hiddenEnd };
          }
        }
      }

      // Check if near the right edge of the column header (resize handle)
      const colRight = this.getColRightInViewport(sheetId, col);
      if (colRight !== null && Math.abs(x - colRight) <= RESIZE_HANDLE_SIZE) {
        return { type: 'columnResize', col };
      }

      return { type: 'columnHeader', col };
    }

    // Check row header area (left strip, below column header)
    if (x < cellAreaLeft && y >= cellAreaTop) {
      const row = this.viewportYToRow(sheetId, y);
      if (row === null) {
        return { type: 'empty' };
      }

      // D.5: Check for hidden row boundary (before resize handle check)
      // Check if there are hidden rows immediately before this visible row
      if (row > 0) {
        const pi = this.positionIndex;
        if (pi?.isRowHidden(row - 1)) {
          const rowTop = this.getRowTopInViewport(sheetId, row);
          if (rowTop !== null && Math.abs(y - rowTop) <= HIDDEN_BOUNDARY_SIZE) {
            // Find the range of hidden rows
            const hiddenEnd = row - 1;
            let hiddenStart = hiddenEnd;
            // Walk backwards to find the start of the hidden range
            while (hiddenStart > 0 && pi.isRowHidden(hiddenStart - 1)) {
              hiddenStart--;
            }
            return { type: 'hiddenRowBoundary', row, hiddenStart, hiddenEnd };
          }
        }
      }

      // Check if near the bottom edge of the row header (resize handle)
      const rowBottom = this.getRowBottomInViewport(sheetId, row);
      if (rowBottom !== null && Math.abs(y - rowBottom) <= RESIZE_HANDLE_SIZE) {
        return { type: 'rowResize', row };
      }

      return { type: 'rowHeader', row };
    }

    // Cell area - use existing viewportToCell
    const cell = this.viewportToCell(sheetId, point);
    if (cell) {
      return { type: 'cell', row: cell.row, col: cell.col };
    }

    return { type: 'empty' };
  }

  /**
   * Convert viewport X coordinate to column index.
   * Used for column header hit testing.
   */
  private viewportXToCol(sheetId: string, viewportX: number): number | null {
    const cellAreaLeft = this.getCellAreaLeft();
    if (viewportX < cellAreaLeft) return null;

    // Use a Y coordinate in the cell area to leverage existing conversion logic
    const cellAreaTop = this.getCellAreaTop();
    const docPoint = this.viewportToDocument(sheetId, viewportPoint(viewportX, cellAreaTop + 1));
    const cell = this.documentToCell(sheetId, docPoint);
    return cell?.col ?? null;
  }

  /**
   * Convert viewport Y coordinate to row index.
   * Used for row header hit testing.
   */
  private viewportYToRow(sheetId: string, viewportY: number): number | null {
    const cellAreaTop = this.getCellAreaTop();
    if (viewportY < cellAreaTop) return null;

    // Use an X coordinate in the cell area to leverage existing conversion logic
    const cellAreaLeft = this.getCellAreaLeft();
    const docPoint = this.viewportToDocument(sheetId, viewportPoint(cellAreaLeft + 1, viewportY));
    const cell = this.documentToCell(sheetId, docPoint);
    return cell?.row ?? null;
  }

  /**
   * Get the left edge of a column in viewport coordinates.
   * Used for hidden boundary detection (D.5).
   */
  private getColLeftInViewport(_sheetId: string, col: number): number | null {
    const pi = this.positionIndex;
    const colLeftDoc = pi ? pi.getColLeft(col) : col * DEFAULT_COL_WIDTH;

    // Convert to viewport X
    // Account for frozen columns and scroll
    const isFrozenCol = col < this.frozenPanes.cols;
    const cellAreaLeft = this.getCellAreaLeft();
    let viewportX: number;

    if (isFrozenCol) {
      viewportX = colLeftDoc * this.zoom + cellAreaLeft;
    } else {
      viewportX = (colLeftDoc - this.viewport.scrollLeft) * this.zoom + cellAreaLeft;
    }

    return viewportX;
  }

  /**
   * Get the right edge of a column in viewport coordinates.
   * Used for resize handle detection.
   */
  private getColRightInViewport(_sheetId: string, col: number): number | null {
    const pi = this.positionIndex;
    const colLeft = pi ? pi.getColLeft(col) : col * DEFAULT_COL_WIDTH;
    const colWidth = pi ? pi.getColWidth(col) : DEFAULT_COL_WIDTH;
    const colRightDoc = colLeft + colWidth;

    // Convert to viewport X
    // Account for frozen columns and scroll
    const isFrozenCol = col < this.frozenPanes.cols;
    const cellAreaLeft = this.getCellAreaLeft();
    let viewportX: number;

    if (isFrozenCol) {
      viewportX = colRightDoc * this.zoom + cellAreaLeft;
    } else {
      viewportX = (colRightDoc - this.viewport.scrollLeft) * this.zoom + cellAreaLeft;
    }

    return viewportX;
  }

  /**
   * Get the top edge of a row in viewport coordinates.
   * Used for hidden boundary detection (D.5).
   */
  private getRowTopInViewport(_sheetId: string, row: number): number | null {
    const pi = this.positionIndex;
    const rowTopDoc = pi ? pi.getRowTop(row) : row * DEFAULT_ROW_HEIGHT;

    // Convert to viewport Y
    // Account for frozen rows and scroll
    const isFrozenRow = row < this.frozenPanes.rows;
    const cellAreaTop = this.getCellAreaTop();
    let viewportY: number;

    if (isFrozenRow) {
      viewportY = rowTopDoc * this.zoom + cellAreaTop;
    } else {
      viewportY = (rowTopDoc - this.viewport.scrollTop) * this.zoom + cellAreaTop;
    }

    return viewportY;
  }

  /**
   * Get the bottom edge of a row in viewport coordinates.
   * Used for resize handle detection.
   */
  private getRowBottomInViewport(_sheetId: string, row: number): number | null {
    const pi = this.positionIndex;
    const rowTop = pi ? pi.getRowTop(row) : row * DEFAULT_ROW_HEIGHT;
    const rowHeight = pi ? pi.getRowHeight(row) : DEFAULT_ROW_HEIGHT;
    const rowBottomDoc = rowTop + rowHeight;

    // Convert to viewport Y
    // Account for frozen rows and scroll
    const isFrozenRow = row < this.frozenPanes.rows;
    const cellAreaTop = this.getCellAreaTop();
    let viewportY: number;

    if (isFrozenRow) {
      viewportY = rowBottomDoc * this.zoom + cellAreaTop;
    } else {
      viewportY = (rowBottomDoc - this.viewport.scrollTop) * this.zoom + cellAreaTop;
    }

    return viewportY;
  }

  // ===========================================================================
  // SCROLLING
  // ===========================================================================

  getScrollToCell(
    sheetId: string,
    cell: CellCoord,
    padding: number = 20,
  ): { top: number; left: number } | null {
    const frozenRowsHeight = this.getFrozenRowsHeight(sheetId);
    const frozenColsWidth = this.getFrozenColsWidth(sheetId);

    const isFrozenRow = cell.row < this.frozenPanes.rows;
    const isFrozenCol = cell.col < this.frozenPanes.cols;

    // A cell in both frozen axes is always visible. A cell in only one
    // frozen axis can still need scrolling along the other axis.
    if (isFrozenRow && isFrozenCol) return null;

    const cellRect = this.cellToDocument(sheetId, cell);

    // The viewport includes headers (row header + column header). The scrollable
    // cell area is viewport size minus header area, converted to document space.
    const cellAreaTop = this.getCellAreaTop();
    const cellAreaLeft = this.getCellAreaLeft();
    const scrollableHeight = (this.viewport.height - cellAreaTop) / this.zoom - frozenRowsHeight;
    const scrollableWidth = (this.viewport.width - cellAreaLeft) / this.zoom - frozenColsWidth;

    const visibleTop = this.viewport.scrollTop;
    const visibleLeft = this.viewport.scrollLeft;
    const visibleBottom = this.viewport.scrollTop + scrollableHeight;
    const visibleRight = this.viewport.scrollLeft + scrollableWidth;

    // Adjust cell position relative to scrollable area
    const cellTop = cellRect.y - frozenRowsHeight;
    const cellLeft = cellRect.x - frozenColsWidth;
    const cellBottom = cellTop + cellRect.height;
    const cellRight = cellLeft + cellRect.width;

    let newScrollTop = this.viewport.scrollTop;
    let newScrollLeft = this.viewport.scrollLeft;

    // Check vertical. Frozen rows are already fixed vertically, but may
    // still require horizontal scrolling.
    if (!isFrozenRow) {
      if (cellTop < visibleTop) {
        newScrollTop = Math.max(0, cellTop - padding);
      } else if (cellBottom > visibleBottom) {
        newScrollTop = cellBottom - scrollableHeight + padding;
      }
    }

    // Check horizontal. Frozen columns are already fixed horizontally, but
    // may still require vertical scrolling.
    if (!isFrozenCol) {
      if (cellLeft < visibleLeft) {
        newScrollLeft = Math.max(0, cellLeft - padding);
      } else if (cellRight > visibleRight) {
        newScrollLeft = cellRight - scrollableWidth + padding;
      }
    }

    // Clamp to bounds
    const bounds = this.getScrollBounds(sheetId);
    newScrollTop = Math.max(0, Math.min(bounds.maxScrollTop, newScrollTop));
    newScrollLeft = Math.max(0, Math.min(bounds.maxScrollLeft, newScrollLeft));

    // Return null if no change needed
    if (newScrollTop === this.viewport.scrollTop && newScrollLeft === this.viewport.scrollLeft) {
      return null;
    }

    return { top: newScrollTop, left: newScrollLeft };
  }

  getScrollBounds(sheetId: string): { maxScrollTop: number; maxScrollLeft: number } {
    const pi = this.positionIndex;
    const frozenRowsHeight = this.getFrozenRowsHeight(sheetId);
    const frozenColsWidth = this.getFrozenColsWidth(sheetId);

    // Use O(1) estimation to avoid freezing with 1M+ rows
    const totalRows = pi?.totalRows ?? 1_048_576;
    const totalCols = pi?.totalCols ?? 16_384;
    const totalHeight = totalRows * DEFAULT_ROW_HEIGHT;
    const totalWidth = totalCols * DEFAULT_COL_WIDTH;

    // The scrollable cell area is the viewport minus headers/gutter and frozen panes.
    // maxScroll must be large enough that the last row/col is reachable.
    const cellAreaTop = this.getCellAreaTop();
    const cellAreaLeft = this.getCellAreaLeft();
    const scrollableHeight = (this.viewport.height - cellAreaTop) / this.zoom - frozenRowsHeight;
    const scrollableWidth = (this.viewport.width - cellAreaLeft) / this.zoom - frozenColsWidth;

    return {
      maxScrollTop: Math.max(0, totalHeight - scrollableHeight),
      maxScrollLeft: Math.max(0, totalWidth - scrollableWidth),
    };
  }

  /**
   * Get viewport bounds for auto-scroll edge detection.
   * Returns the scrollable region boundaries, excluding frozen panes and headers.
   *
   * Used by: Auto-scroll service during drag operations
   */
  getViewportBounds(sheetId: string): { left: number; top: number; right: number; bottom: number } {
    const frozenRowsHeight = this.getFrozenRowsHeight(sheetId);
    const frozenColsWidth = this.getFrozenColsWidth(sheetId);
    // Only the unfrozen region should trigger auto-scroll
    const cellAreaLeft = this.getCellAreaLeft();
    const cellAreaTop = this.getCellAreaTop();
    return {
      left: frozenColsWidth + cellAreaLeft,
      top: frozenRowsHeight + cellAreaTop,
      right: this.viewport.width,
      bottom: this.viewport.height,
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================
}

// =============================================================================
// Selection Border Helpers
// =============================================================================

/**
 * Check if a point is on the selection border (within tolerance).
 * Excludes fill handle area (bottom-right corner).
 *
 * Tolerance guidance: the default of 5px is sized for touch input (a
 * touch-friendly fallback for callers that don't specify). Pointer/pen
 * callers should pass 3px to match Excel's ~2-3px border zone, and touch
 * callers should pass 5px. Both the cursor-feedback path and the
 * drag-initiation path must use the same tolerance so the cursor
 * affordance and the click action agree — see use-grid-mouse, where
 * callers branch on PointerEvent.pointerType.
 *
 * @param point - The point to test
 * @param selectionRect - The selection rectangle in viewport coordinates
 * @param tolerance - Distance from border to consider a hit (default 5px, sized for touch)
 * @returns true if point is on the selection border (excluding fill handle)
 */
export function isOnSelectionBorder(
  point: Point,
  selectionRect: { x: number; y: number; width: number; height: number },
  tolerance: number = 5,
): boolean {
  const { x, y, width, height } = selectionRect;

  // Check if outside the rectangle entirely
  if (point.x < x - tolerance || point.x > x + width + tolerance) return false;
  if (point.y < y - tolerance || point.y > y + height + tolerance) return false;

  // Check if inside the rectangle (not on border)
  if (
    point.x > x + tolerance &&
    point.x < x + width - tolerance &&
    point.y > y + tolerance &&
    point.y < y + height - tolerance
  ) {
    return false;
  }

  // Exclude fill handle area (8x8 square centered on bottom-right corner).
  // Must match isOnFillHandle's geometry exactly so a click 4px past the
  // corner counts as fill handle (not selection border).
  const fillHandleHalf = 4; // FILL_HANDLE_HIT_SIZE / 2 — see isOnFillHandle
  const cellRight = x + width;
  const cellBottom = y + height;
  if (
    point.x >= cellRight - fillHandleHalf &&
    point.x <= cellRight + fillHandleHalf &&
    point.y >= cellBottom - fillHandleHalf &&
    point.y <= cellBottom + fillHandleHalf
  ) {
    return false;
  }

  return true;
}

/**
 * Check if a point is on the fill handle (bottom-right corner of selection).
 *
 * Tests an 8px square centered on the bottom-right corner of the selection
 * — matches the rendered fill handle (canvas/grid-renderer/src/layers/ui.ts
 * `fillHandleSize: 8`, drawn centered on the corner) and GridHitTest's hit
 * zone (canvas/grid-renderer/src/hit-test/grid-hit-test.ts FILL_HANDLE_SIZE).
 * The 8 is duplicated across the three call sites by design; each call
 * site comments reference the others.
 *
 * @param point - The point to test (in viewport coordinates)
 * @param selectionRect - The selection rectangle in viewport coordinates
 * @param handleSize - Size of the fill handle hit zone (default 8px, centered on corner)
 * @returns true if point is on the fill handle
 */
export function isOnFillHandle(
  point: Point,
  selectionRect: { x: number; y: number; width: number; height: number },
  handleSize: number = 8,
): boolean {
  const cellRight = selectionRect.x + selectionRect.width;
  const cellBottom = selectionRect.y + selectionRect.height;
  const half = handleSize / 2;
  return (
    point.x >= cellRight - half &&
    point.x <= cellRight + half &&
    point.y >= cellBottom - half &&
    point.y <= cellBottom + half
  );
}

// =============================================================================
// Table Resize Handle Helpers
// =============================================================================

/**
 * Check if a point is on the table resize handle (blue triangle at bottom-right).
 *
 * The resize handle is a triangle at the corner of the table's bottom-right cell.
 * This function checks if a point is within the triangular hit area.
 *
 * @param point - The point to test (in viewport coordinates)
 * @param tableRect - The table rectangle in viewport coordinates
 * @param handleSize - Size of the resize handle (default 10px)
 * @returns true if point is on the table resize handle
 */
export function isOnTableResizeHandle(
  point: Point,
  tableRect: { x: number; y: number; width: number; height: number },
  handleSize: number = 10,
): boolean {
  const { x, y, width, height } = tableRect;

  // The handle is at the bottom-right corner
  const handleX = x + width;
  const handleY = y + height;

  // Add tolerance for easier clicking
  const tolerance = 4;
  const extendedSize = handleSize + tolerance;

  // Check if point is in the general area of the handle
  if (point.x < handleX - extendedSize || point.x > handleX + tolerance) return false;
  if (point.y < handleY - extendedSize || point.y > handleY + tolerance) return false;

  // For simplicity, use a square hit area rather than exact triangle
  // This is more user-friendly as triangles are hard to click precisely
  return true;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new coordinate system instance.
 */
export function createCoordinateSystem(): CoordinateSystemImpl {
  return new CoordinateSystemImpl();
}
