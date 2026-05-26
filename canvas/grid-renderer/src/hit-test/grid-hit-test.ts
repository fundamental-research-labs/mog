/**
 * Grid Hit Test
 *
 * Converts screen-space coordinates into grid-specific hit targets.
 * Implements the HitTestProvider interface from canvas-engine.
 *
 * Hit testing proceeds in priority order:
 * 1. Select-all corner (header intersection)
 * 2. Column header area (resize handles, hidden boundaries, headers)
 * 3. Row header area (resize handles, hidden boundaries, headers)
 * 4. Outline gutter buttons (level buttons, collapse/expand)
 * 5. Fill handle (small square at selection corner)
 * 6. Selection border (for drag-drop initiation)
 * 7. Table resize handle
 * 8. Formula range handles
 * 9. Cell area (or empty beyond data)
 *
 * @module grid-renderer/hit-test/grid-hit-test
 */

import type { HitResult, HitTestProvider, Point } from '@mog/canvas-engine';
import type {
  CellDataSource,
  GroupingDataSource,
  SelectionDataSource,
  SheetDataSource,
} from '@mog-sdk/contracts/rendering';
import type { ViewportMergeIndex } from '../coordinates/viewport-merge-index';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { GridCoordinateSystem } from '../layout/grid-coords';

// =============================================================================
// Hit Target Types
// =============================================================================

export type GridHitTarget =
  | { type: 'cell'; row: number; col: number }
  | { type: 'columnHeader'; col: number }
  | { type: 'rowHeader'; row: number }
  | { type: 'columnResize'; col: number; edge: 'left' | 'right' }
  | { type: 'rowResize'; row: number; edge: 'top' | 'bottom' }
  | { type: 'fillHandle' }
  | { type: 'tableResizeHandle'; tableId: string }
  | { type: 'formulaRangeHandle'; rangeIndex: number; handle: 'nw' | 'ne' | 'sw' | 'se' }
  | { type: 'outlineButton'; axis: 'row' | 'col'; level: number }
  | { type: 'outlineCollapseExpand'; axis: 'row' | 'col'; groupIndex: number }
  | { type: 'hiddenColumnBoundary'; col: number }
  | { type: 'hiddenRowBoundary'; row: number }
  | { type: 'selectAll' }
  | { type: 'selectionBorder'; edge: 'top' | 'bottom' | 'left' | 'right' }
  | { type: 'empty' };

// =============================================================================
// Configuration
// =============================================================================

export interface GridHitTestConfig {
  sheetData: SheetDataSource;
  cellData: CellDataSource;
  selectionData: SelectionDataSource;
  positionIndex: ViewportPositionIndex;
  /**
   * Viewport merge index. When provided, cell hits inside a merged region
   * are snapped to the merge anchor (top-left). Hit-test is the canonical
   * place for this snap so every downstream consumer (selection, drag,
   * keyboard) sees a consistent cell address regardless of where in the
   * lifecycle the merge index was populated.
   */
  mergeIndex?: ViewportMergeIndex;
  groupingData: GroupingDataSource;
  coordSystem: GridCoordinateSystem;
  /** Header gutter width (pixels) for row headers */
  rowHeaderWidth: number;
  /** Header gutter height (pixels) for column headers */
  colHeaderHeight: number;
  /** Input mode for touch-aware hit zones */
  inputMode?: 'pointer' | 'touch';
}

// =============================================================================
// Constants
// =============================================================================

const POINTER_RESIZE_TOLERANCE = 5; // pixels
const TOUCH_RESIZE_TOLERANCE = 22; // pixels for touch targets
const FILL_HANDLE_SIZE = 8; // pixels, size of the fill handle square
const FORMULA_HANDLE_SIZE = 8; // pixels, size of formula range corner handles
const SELECTION_BORDER_TOLERANCE = 4; // pixels, tolerance for selection border hit
const TABLE_RESIZE_HANDLE_SIZE = 10; // pixels, size of table resize handle

const LAYER_ID = 'grid-hit-test';

// =============================================================================
// GridHitTest
// =============================================================================

export class GridHitTest implements HitTestProvider {
  private config: GridHitTestConfig;

  constructor(config: GridHitTestConfig) {
    this.config = config;
  }

  updateConfig(config: Partial<GridHitTestConfig>): void {
    this.config = { ...this.config, ...config };
  }

  hitTest(screenPoint: Point): HitResult | null {
    const { x, y } = screenPoint;
    const tolerance =
      this.config.inputMode === 'touch' ? TOUCH_RESIZE_TOLERANCE : POINTER_RESIZE_TOLERANCE;
    const { rowHeaderWidth, colHeaderHeight } = this.config;

    // 1. Check select-all corner (intersection of row and column headers)
    if (x < rowHeaderWidth && y < colHeaderHeight) {
      return this.makeResult({ type: 'selectAll' }, screenPoint);
    }

    // 2. Check column header area
    if (y < colHeaderHeight && x >= rowHeaderWidth) {
      const target = this.hitTestColumnHeader(x, y, tolerance);
      return this.makeResult(target, screenPoint);
    }

    // 3. Check row header area
    if (x < rowHeaderWidth && y >= colHeaderHeight) {
      const target = this.hitTestRowHeader(x, y, tolerance);
      return this.makeResult(target, screenPoint);
    }

    // 4. Check outline gutter area (if grouping data exists)
    const outlineTarget = this.hitTestOutlineGutter(x, y);
    if (outlineTarget) {
      return this.makeResult(outlineTarget, screenPoint);
    }

    // From here on, we are in the cell area (x >= rowHeaderWidth, y >= colHeaderHeight)

    // 5. Check fill handle
    const fillHandleTarget = this.hitTestFillHandle(x, y);
    if (fillHandleTarget) {
      return this.makeResult(fillHandleTarget, screenPoint);
    }

    // 6. Check selection border (for drag-drop initiation)
    const selBorderTarget = this.hitTestSelectionBorder(x, y);
    if (selBorderTarget) {
      return this.makeResult(selBorderTarget, screenPoint);
    }

    // 7. Check table resize handle
    const tableTarget = this.hitTestTableResizeHandle(x, y);
    if (tableTarget) {
      return this.makeResult(tableTarget, screenPoint);
    }

    // 8. Check formula range handles
    const formulaTarget = this.hitTestFormulaRangeHandles(x, y);
    if (formulaTarget) {
      return this.makeResult(formulaTarget, screenPoint);
    }

    // 9. Convert to cell coordinates
    const docX = x - rowHeaderWidth;
    const docY = y - colHeaderHeight;

    if (docX < 0 || docY < 0) {
      return this.makeResult({ type: 'empty' }, screenPoint);
    }

    const cellAddr = this.config.coordSystem.documentToCell(docX, docY, this.config.positionIndex);

    const totalRows = this.config.positionIndex.totalRows;
    const totalCols = this.config.positionIndex.totalCols;

    if (cellAddr.row >= totalRows || cellAddr.col >= totalCols) {
      return this.makeResult({ type: 'empty' }, screenPoint);
    }

    // Snap to merge anchor: a click anywhere inside a merged region must
    // resolve to the merge's top-left cell. This is the canonical place
    // for the snap so downstream consumers (selection, drag, keyboard)
    // never see a non-anchor cell coordinate from a click.
    const merged = this.config.mergeIndex?.getMergedRegion(cellAddr.row, cellAddr.col);
    if (merged) {
      return this.makeResult(
        { type: 'cell', row: merged.startRow, col: merged.startCol },
        screenPoint,
      );
    }

    return this.makeResult({ type: 'cell', row: cellAddr.row, col: cellAddr.col }, screenPoint);
  }

  // ===========================================================================
  // Column Header Hit Testing
  // ===========================================================================

  private hitTestColumnHeader(x: number, _y: number, tolerance: number): GridHitTarget {
    const docX = x - this.config.rowHeaderWidth;
    const dim = this.config.positionIndex;

    const cellAddr = this.config.coordSystem.documentToCell(docX, 0, dim);
    const col = cellAddr.col;

    // Check for hidden column boundary: if adjacent column is hidden,
    // the visible boundary becomes a hidden-column indicator.
    if (col > 0 && dim.isColHidden(col - 1)) {
      const colLeft = dim.getColLeft(col);
      if (this.isNearBoundary(docX, colLeft, tolerance)) {
        return { type: 'hiddenColumnBoundary', col: col - 1 };
      }
    }

    const nextCol = col + 1;
    if (nextCol < dim.totalCols && dim.isColHidden(nextCol)) {
      const colRight = dim.getColLeft(col) + dim.getColWidth(col);
      if (this.isNearBoundary(docX, colRight, tolerance)) {
        return { type: 'hiddenColumnBoundary', col: nextCol };
      }
    }

    // Check for column resize at left edge
    const colLeft = dim.getColLeft(col);
    if (col > 0 && this.isNearBoundary(docX, colLeft, tolerance)) {
      return { type: 'columnResize', col: col - 1, edge: 'right' };
    }

    // Check for column resize at right edge
    const colRight = colLeft + dim.getColWidth(col);
    if (this.isNearBoundary(docX, colRight, tolerance)) {
      return { type: 'columnResize', col, edge: 'right' };
    }

    return { type: 'columnHeader', col };
  }

  // ===========================================================================
  // Row Header Hit Testing
  // ===========================================================================

  private hitTestRowHeader(_x: number, y: number, tolerance: number): GridHitTarget {
    const docY = y - this.config.colHeaderHeight;
    const dim = this.config.positionIndex;

    const cellAddr = this.config.coordSystem.documentToCell(0, docY, dim);
    const row = cellAddr.row;

    // Check for hidden row boundary
    if (row > 0 && dim.isRowHidden(row - 1)) {
      const rowTop = dim.getRowTop(row);
      if (this.isNearBoundary(docY, rowTop, tolerance)) {
        return { type: 'hiddenRowBoundary', row: row - 1 };
      }
    }

    const nextRow = row + 1;
    if (nextRow < dim.totalRows && dim.isRowHidden(nextRow)) {
      const rowBottom = dim.getRowTop(row) + dim.getRowHeight(row);
      if (this.isNearBoundary(docY, rowBottom, tolerance)) {
        return { type: 'hiddenRowBoundary', row: nextRow };
      }
    }

    // Check for row resize at top edge
    const rowTop = dim.getRowTop(row);
    if (row > 0 && this.isNearBoundary(docY, rowTop, tolerance)) {
      return { type: 'rowResize', row: row - 1, edge: 'bottom' };
    }

    // Check for row resize at bottom edge
    const rowBottom = rowTop + dim.getRowHeight(row);
    if (this.isNearBoundary(docY, rowBottom, tolerance)) {
      return { type: 'rowResize', row, edge: 'bottom' };
    }

    return { type: 'rowHeader', row };
  }

  // ===========================================================================
  // Outline Gutter Hit Testing
  // ===========================================================================

  private hitTestOutlineGutter(_x: number, _y: number): GridHitTarget | null {
    const grouping = this.config.groupingData;
    const maxRowLevel = grouping.maxRowOutlineLevel;
    const maxColLevel = grouping.maxColOutlineLevel;

    // No outline gutter if no grouping levels
    if (maxRowLevel === 0 && maxColLevel === 0) {
      return null;
    }

    // Outline gutter is not within the cell area; it overlaps the header region.
    // For simplicity, we currently return null and leave outline hit testing
    // to a future refinement that maps outline button pixel positions from
    // the headers layer rendering. The structure is in place for when those
    // pixel bounds become available.

    return null;
  }

  // ===========================================================================
  // Fill Handle Hit Testing
  // ===========================================================================

  private hitTestFillHandle(x: number, y: number): GridHitTarget | null {
    if (!this.config.sheetData.allowDragFill) {
      return null;
    }

    const selection = this.config.selectionData.getSelectionState();
    if (!selection.ranges || selection.ranges.length === 0) {
      return null;
    }

    // Fill handle is at the bottom-right corner of the last selection range
    const lastRange = selection.ranges[selection.ranges.length - 1];
    const dim = this.config.positionIndex;

    const endCol = lastRange.endCol;
    const endRow = lastRange.endRow;

    const cellRight = dim.getColLeft(endCol) + dim.getColWidth(endCol) + this.config.rowHeaderWidth;
    const cellBottom =
      dim.getRowTop(endRow) + dim.getRowHeight(endRow) + this.config.colHeaderHeight;

    const halfHandle = FILL_HANDLE_SIZE / 2;

    if (
      x >= cellRight - halfHandle &&
      x <= cellRight + halfHandle &&
      y >= cellBottom - halfHandle &&
      y <= cellBottom + halfHandle
    ) {
      return { type: 'fillHandle' };
    }

    return null;
  }

  // ===========================================================================
  // Selection Border Hit Testing
  // ===========================================================================

  private hitTestSelectionBorder(x: number, y: number): GridHitTarget | null {
    const selection = this.config.selectionData.getSelectionState();
    if (!selection.ranges || selection.ranges.length === 0) {
      return null;
    }

    const lastRange = selection.ranges[selection.ranges.length - 1];
    const dim = this.config.positionIndex;

    const left = dim.getColLeft(lastRange.startCol) + this.config.rowHeaderWidth;
    const top = dim.getRowTop(lastRange.startRow) + this.config.colHeaderHeight;
    const right =
      dim.getColLeft(lastRange.endCol) +
      dim.getColWidth(lastRange.endCol) +
      this.config.rowHeaderWidth;
    const bottom =
      dim.getRowTop(lastRange.endRow) +
      dim.getRowHeight(lastRange.endRow) +
      this.config.colHeaderHeight;

    const tol = SELECTION_BORDER_TOLERANCE;

    // Check if the point is near any edge of the selection border
    const isInHorizontalRange = x >= left - tol && x <= right + tol;
    const isInVerticalRange = y >= top - tol && y <= bottom + tol;

    if (isInHorizontalRange && this.isNearBoundary(y, top, tol)) {
      return { type: 'selectionBorder', edge: 'top' };
    }
    if (isInHorizontalRange && this.isNearBoundary(y, bottom, tol)) {
      return { type: 'selectionBorder', edge: 'bottom' };
    }
    if (isInVerticalRange && this.isNearBoundary(x, left, tol)) {
      return { type: 'selectionBorder', edge: 'left' };
    }
    if (isInVerticalRange && this.isNearBoundary(x, right, tol)) {
      return { type: 'selectionBorder', edge: 'right' };
    }

    return null;
  }

  // ===========================================================================
  // Table Resize Handle Hit Testing
  // ===========================================================================

  private hitTestTableResizeHandle(x: number, y: number): GridHitTarget | null {
    const selection = this.config.selectionData.getSelectionState();
    if (!selection.activeCell) {
      return null;
    }

    const sheetId = this.config.sheetData.sheetId;
    const table = this.config.cellData.getTableAtCell(sheetId, selection.activeCell);
    if (!table) {
      return null;
    }

    const dim = this.config.positionIndex;
    const tableRange = table.range;
    if (!tableRange) {
      return null;
    }

    // Table resize handle is at the bottom-right corner of the table
    const tableRight =
      dim.getColLeft(tableRange.endCol) +
      dim.getColWidth(tableRange.endCol) +
      this.config.rowHeaderWidth;
    const tableBottom =
      dim.getRowTop(tableRange.endRow) +
      dim.getRowHeight(tableRange.endRow) +
      this.config.colHeaderHeight;

    const halfHandle = TABLE_RESIZE_HANDLE_SIZE / 2;

    if (
      x >= tableRight - halfHandle &&
      x <= tableRight + halfHandle &&
      y >= tableBottom - halfHandle &&
      y <= tableBottom + halfHandle
    ) {
      return { type: 'tableResizeHandle', tableId: table.id };
    }

    return null;
  }

  // ===========================================================================
  // Formula Range Handle Hit Testing
  // ===========================================================================

  private hitTestFormulaRangeHandles(x: number, y: number): GridHitTarget | null {
    const selection = this.config.selectionData.getSelectionState();
    if (!selection.formulaRanges || selection.formulaRanges.length === 0) {
      return null;
    }

    const activeIndex = selection.activeReferenceIndex ?? -1;
    if (activeIndex < 0) {
      return null;
    }

    const activeRange = selection.formulaRanges.find((fr) => fr.index === activeIndex);
    if (!activeRange) {
      return null;
    }

    const dim = this.config.positionIndex;
    const range = activeRange.range;

    const left = dim.getColLeft(range.startCol) + this.config.rowHeaderWidth;
    const top = dim.getRowTop(range.startRow) + this.config.colHeaderHeight;
    const right =
      dim.getColLeft(range.endCol) + dim.getColWidth(range.endCol) + this.config.rowHeaderWidth;
    const bottom =
      dim.getRowTop(range.endRow) + dim.getRowHeight(range.endRow) + this.config.colHeaderHeight;

    const halfHandle = FORMULA_HANDLE_SIZE / 2;

    // NW handle
    if (this.isInHandleZone(x, y, left, top, halfHandle)) {
      return { type: 'formulaRangeHandle', rangeIndex: activeIndex, handle: 'nw' };
    }
    // NE handle
    if (this.isInHandleZone(x, y, right, top, halfHandle)) {
      return { type: 'formulaRangeHandle', rangeIndex: activeIndex, handle: 'ne' };
    }
    // SW handle
    if (this.isInHandleZone(x, y, left, bottom, halfHandle)) {
      return { type: 'formulaRangeHandle', rangeIndex: activeIndex, handle: 'sw' };
    }
    // SE handle
    if (this.isInHandleZone(x, y, right, bottom, halfHandle)) {
      return { type: 'formulaRangeHandle', rangeIndex: activeIndex, handle: 'se' };
    }

    return null;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private makeResult(target: GridHitTarget, position: Point): HitResult {
    return { layerId: LAYER_ID, target, position };
  }

  private isNearBoundary(value: number, boundary: number, tolerance: number): boolean {
    return Math.abs(value - boundary) <= tolerance;
  }

  private isInHandleZone(
    x: number,
    y: number,
    handleX: number,
    handleY: number,
    halfSize: number,
  ): boolean {
    return (
      x >= handleX - halfSize &&
      x <= handleX + halfSize &&
      y >= handleY - halfSize &&
      y <= handleY + halfSize
    );
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createGridHitTest(config: GridHitTestConfig): GridHitTest {
  return new GridHitTest(config);
}
