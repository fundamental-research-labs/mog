/**
 * Geometry Capability Implementation
 *
 * Wraps coordinateSystem, positionIndex, mergeIndex, and
 * gridRenderer.getCellPageBounds/getRangePageBounds to provide
 * the ISheetViewGeometry capability interface.
 *
 * @module @mog-sdk/sheet-view/capabilities/geometry
 */

import type { ViewportMergeIndex, ViewportPositionIndex } from '@mog/grid-renderer';
import type { CoordinateSystem, GridRenderer } from '@mog-sdk/contracts/rendering';
import type { ViewportPoint } from '@mog-sdk/contracts/rendering/coordinates';

import type { ISheetViewGeometry } from '../capability-interfaces';
import type {
  CellAddress,
  ColDimensionInfo,
  DimensionInfo,
  HeaderVisibility,
  MergeRegion,
  OutlineGutter,
  PositionDimensions,
  RangeAddress,
  RowDimensionInfo,
  SheetAnchor,
  SheetBounds,
  SheetDisposable,
  SheetPoint,
  SheetRect,
  SheetSize,
} from '../public-types';
import { mapMergeRegion } from './type-mappers';

// =============================================================================
// Internal accessor type
// =============================================================================

/** Accessors for SheetView internal state that geometry needs. */
export interface GeometryInternals {
  getRenderer(): GridRenderer;
  getCoordinateSystem(): CoordinateSystem;
  getPositionIndex(): ViewportPositionIndex;
  getMergeIndex(): ViewportMergeIndex;
  getCurrentSheetId(): string;
  getContainer(): HTMLElement;
  getHeaderVisibility(): { showRowHeaders?: boolean; showColumnHeaders?: boolean };
  getOutlineGutter(): { rowGutterWidth: number; colGutterHeight: number };
}

// =============================================================================
// Helpers
// =============================================================================

/** An observed anchor and its last-seen rect. */
interface AnchorObservation {
  anchor: SheetAnchor;
  listener: (rect: SheetRect | null) => void;
  lastRect: SheetRect | null;
}

/** Compare two nullable SheetRects for equality. */
function rectsEqual(a: SheetRect | null, b: SheetRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// =============================================================================
// Implementation
// =============================================================================

export class SheetViewGeometry implements ISheetViewGeometry {
  private _anchorObservers: Map<number, AnchorObservation> = new Map();
  private _nextObserverId = 0;

  constructor(private readonly _internals: GeometryInternals) {}

  getCellRect(cell: CellAddress): SheetRect | null {
    const coords = this._internals.getCoordinateSystem();
    const sheetId = this._internals.getCurrentSheetId();
    if (!sheetId) return null;

    const vr = coords.cellToViewport(sheetId, { row: cell.row, col: cell.col });
    if (!vr) return null;

    return { x: vr.x, y: vr.y, width: vr.width, height: vr.height };
  }

  getRangeRects(range: RangeAddress): SheetRect[] {
    const coords = this._internals.getCoordinateSystem();
    const sheetId = this._internals.getCurrentSheetId();
    if (!sheetId) return [];

    const rects = coords.rangeToViewport(sheetId, {
      startRow: range.startRow,
      startCol: range.startCol,
      endRow: range.endRow,
      endCol: range.endCol,
    });

    return rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
  }

  getCellPageRect(cell: CellAddress): SheetRect | null {
    const renderer = this._internals.getRenderer();
    const result = renderer.getCellPageBounds(cell.row, cell.col);
    if (!result) return null;
    return { x: result.x, y: result.y, width: result.width, height: result.height };
  }

  getRangePageRects(range: RangeAddress): SheetRect[] {
    const renderer = this._internals.getRenderer();
    const results = renderer.getRangePageBounds({
      startRow: range.startRow,
      startCol: range.startCol,
      endRow: range.endRow,
      endCol: range.endCol,
    });
    return results.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
  }

  getCellRenderedSize(cell: CellAddress): SheetSize | null {
    const renderer = this._internals.getRenderer();
    const result = renderer.getCellRenderedSize(cell.row, cell.col);
    if (!result) return null;
    return { width: result.width, height: result.height };
  }

  getDimensions(anchor: SheetAnchor): DimensionInfo[] {
    const posIndex = this._internals.getPositionIndex();
    const result: DimensionInfo[] = [];

    if ('startRow' in anchor) {
      // RangeAddress — return dimensions for anchor row/col.
      const rowInfo: RowDimensionInfo = {
        row: anchor.startRow,
        top: posIndex.getRowTop(anchor.startRow),
        height: posIndex.getRowHeight(anchor.startRow),
        hidden: posIndex.isRowHidden(anchor.startRow),
      };
      const colInfo: ColDimensionInfo = {
        col: anchor.startCol,
        left: posIndex.getColLeft(anchor.startCol),
        width: posIndex.getColWidth(anchor.startCol),
        hidden: posIndex.isColHidden(anchor.startCol),
      };
      result.push(rowInfo, colInfo);
    } else {
      // CellAddress — return both row and column dimension.
      const rowInfo: RowDimensionInfo = {
        row: anchor.row,
        top: posIndex.getRowTop(anchor.row),
        height: posIndex.getRowHeight(anchor.row),
        hidden: posIndex.isRowHidden(anchor.row),
      };
      const colInfo: ColDimensionInfo = {
        col: anchor.col,
        left: posIndex.getColLeft(anchor.col),
        width: posIndex.getColWidth(anchor.col),
        hidden: posIndex.isColHidden(anchor.col),
      };
      result.push(rowInfo, colInfo);
    }

    return result;
  }

  fromViewportPoint(point: SheetPoint): CellAddress | null {
    const coords = this._internals.getCoordinateSystem();
    const sheetId = this._internals.getCurrentSheetId();
    if (!sheetId) return null;

    const cell = coords.viewportToCell(sheetId, { x: point.x, y: point.y } as ViewportPoint);
    if (!cell) return null;
    return { row: cell.row, col: cell.col };
  }

  toViewportPoint(cell: CellAddress): SheetPoint | null {
    const coords = this._internals.getCoordinateSystem();
    const sheetId = this._internals.getCurrentSheetId();
    if (!sheetId) return null;

    const vr = coords.cellToViewport(sheetId, { row: cell.row, col: cell.col });
    if (!vr) return null;
    return { x: vr.x, y: vr.y };
  }

  getVisibleRange(): RangeAddress {
    const coords = this._internals.getCoordinateSystem();
    const sheetId = this._internals.getCurrentSheetId();
    if (!sheetId) {
      return { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    }
    const range = coords.getVisibleRange(sheetId);
    return {
      startRow: range.startRow,
      startCol: range.startCol,
      endRow: range.endRow,
      endCol: range.endCol,
    };
  }

  getSheetBounds(): SheetBounds {
    const posIndex = this._internals.getPositionIndex();
    return {
      totalRows: posIndex.totalRows,
      totalCols: posIndex.totalCols,
    };
  }

  getMergeAnchor(row: number, col: number): MergeRegion | null {
    const mergeIndex = this._internals.getMergeIndex();
    const region = mergeIndex.getMergedRegion(row, col);
    if (!region) return null;
    return mapMergeRegion(region);
  }

  getPositionDimensions(): PositionDimensions {
    const posIndex = this._internals.getPositionIndex();
    return {
      totalRows: posIndex.totalRows,
      totalCols: posIndex.totalCols,
      getRowTop: (row: number) => posIndex.getRowTop(row),
      getRowHeight: (row: number) => posIndex.getRowHeight(row),
      getColLeft: (col: number) => posIndex.getColLeft(col),
      getColWidth: (col: number) => posIndex.getColWidth(col),
    };
  }

  observe(anchor: SheetAnchor, listener: (rect: SheetRect | null) => void): SheetDisposable {
    const id = this._nextObserverId++;
    const initialRect = this._computeAnchorRect(anchor);
    this._anchorObservers.set(id, { anchor, listener, lastRect: initialRect });
    return {
      dispose: () => {
        this._anchorObservers.delete(id);
      },
    };
  }

  /**
   * Notify all anchor observers that geometry may have changed (scroll,
   * resize, zoom, row/col resize, freeze pane changes, etc.).
   * Called internally by SheetView after layout recomputation.
   * Not part of the public interface.
   *
   * This is a coarse-grained observation: all anchors are re-checked on
   * every geometry-affecting event. For most use cases (overlays, popovers)
   * the number of observed anchors is small, so this is efficient enough.
   */
  notifyGeometryChanged(): void {
    if (this._anchorObservers.size === 0) return;

    for (const [, obs] of this._anchorObservers) {
      const rect = this._computeAnchorRect(obs.anchor);
      if (!rectsEqual(obs.lastRect, rect)) {
        obs.lastRect = rect;
        try {
          obs.listener(rect);
        } catch {
          // Swallow subscriber errors to avoid breaking the notification loop.
        }
      }
    }
  }

  /** Remove all observers (called on dispose). */
  clearObservers(): void {
    this._anchorObservers.clear();
  }

  /**
   * Compute the viewport-space rect for an anchor (cell or range).
   * Returns null if the anchor is not visible.
   */
  private _computeAnchorRect(anchor: SheetAnchor): SheetRect | null {
    if ('startRow' in anchor) {
      const rects = this.getRangeRects(anchor);
      if (rects.length === 0) return null;
      // Return the bounding box of all sub-rects (e.g. across frozen pane boundaries).
      let minX = rects[0].x,
        minY = rects[0].y;
      let maxX = rects[0].x + rects[0].width;
      let maxY = rects[0].y + rects[0].height;
      for (let i = 1; i < rects.length; i++) {
        const r = rects[i];
        if (r.x < minX) minX = r.x;
        if (r.y < minY) minY = r.y;
        if (r.x + r.width > maxX) maxX = r.x + r.width;
        if (r.y + r.height > maxY) maxY = r.y + r.height;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    } else {
      return this.getCellRect(anchor);
    }
  }

  getHeaderVisibility(): HeaderVisibility {
    const vis = this._internals.getHeaderVisibility();
    return {
      rowHeaders: vis.showRowHeaders ?? true,
      colHeaders: vis.showColumnHeaders ?? true,
    };
  }

  getContainerRect(): SheetRect {
    const el = this._internals.getContainer();
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  getOutlineGutter(): OutlineGutter {
    const g = this._internals.getOutlineGutter();
    return { rowGutterWidth: g.rowGutterWidth, colGutterHeight: g.colGutterHeight };
  }

  getCellAreaOffset(): SheetPoint {
    // viewportToLayer(0, 0) returns (-cellAreaLeft, -cellAreaTop), so negate.
    const coords = this._internals.getCoordinateSystem();
    const origin = coords.viewportToLayer({ x: 0, y: 0 } as ViewportPoint);
    return { x: -origin.x, y: -origin.y };
  }

  getClippedCellContent(row: number, col: number): string | null {
    const renderer = this._internals.getRenderer();
    return renderer.getClippedCellContent(row, col);
  }
}
