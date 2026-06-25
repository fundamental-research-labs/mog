/**
 * Mock Coordinate System for Testing
 *
 * A minimal mock implementing the CoordinateSystem interface from contracts.
 * Map-backed, no rendering. Configurable viewport bounds with fixed cell sizes.
 * Promoted from input/testing/ to shared testing foundation.
 *
 * @module systems/testing-foundation
 */

import {
  COL_HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
  type CellCoord,
  type CoordinateSystem,
  type DocumentPoint,
  type DocumentRect,
  type FrozenPanes,
  type HeaderVisibility,
  type HitTestResult,
  type LayerPoint,
  type LayerRect,
  type ScrollViewport,
  type ViewportPoint,
  type ViewportPositionIndexLike,
  type ViewportMergeIndexLike,
  type ViewportRect,
  type VisibleRegions,
} from '@mog-sdk/contracts/rendering';

import type { CellRange } from '@mog-sdk/contracts/core';

import {
  documentPoint,
  documentRect,
  layerPoint,
  layerRect,
  viewportPoint,
  viewportRect,
} from '@mog/spreadsheet-utils/rendering/coordinates';

import { ViewportPositionIndex, ViewportMergeIndex } from '@mog/grid-renderer';

// =============================================================================
// Options
// =============================================================================

export interface MockCoordinateSystemOptions {
  viewportWidth?: number;
  viewportHeight?: number;
  cellWidth?: number;
  cellHeight?: number;
  totalRows?: number;
  totalCols?: number;
}

// =============================================================================
// Mock ViewportPositionIndex + ViewportMergeIndex
// =============================================================================

function createMockViewportPositionIndex(
  cellWidth: number,
  cellHeight: number,
  totalRows: number,
  totalCols: number,
): ViewportPositionIndex {
  const vpi = new ViewportPositionIndex(cellHeight, cellWidth);
  // Build position arrays covering the full grid
  const rowPositions = new Float64Array(totalRows);
  for (let i = 0; i < totalRows; i++) {
    rowPositions[i] = i * cellHeight;
  }
  const colPositions = new Float64Array(totalCols);
  for (let i = 0; i < totalCols; i++) {
    colPositions[i] = i * cellWidth;
  }
  vpi.setPositions(rowPositions, colPositions, 0, 0);
  vpi.setTotalDimensions(totalRows, totalCols);
  return vpi;
}

function createMockViewportMergeIndex(): ViewportMergeIndex {
  return new ViewportMergeIndex();
}

// =============================================================================
// Factory
// =============================================================================

export function createMockCoordinateSystem(
  options?: MockCoordinateSystemOptions,
): CoordinateSystem {
  const vpWidth = options?.viewportWidth ?? 1000;
  const vpHeight = options?.viewportHeight ?? 600;
  const cellWidth = options?.cellWidth ?? 80;
  const cellHeight = options?.cellHeight ?? 20;
  const totalRows = options?.totalRows ?? 1000;
  const totalCols = options?.totalCols ?? 26;

  let viewport: ScrollViewport = {
    scrollTop: 0,
    scrollLeft: 0,
    width: vpWidth,
    height: vpHeight,
  };

  let frozenPanes: FrozenPanes = { rows: 0, cols: 0 };
  let zoom = 1.0;
  let positionIndex: ViewportPositionIndexLike | null = createMockViewportPositionIndex(
    cellWidth,
    cellHeight,
    totalRows,
    totalCols,
  );
  let mergeIndex: ViewportMergeIndexLike | null = createMockViewportMergeIndex();
  let headerVisibility: HeaderVisibility = {
    showRowHeaders: true,
    showColumnHeaders: true,
  };

  function getEffectiveHeaderWidth(): number {
    return headerVisibility.showRowHeaders !== false ? ROW_HEADER_WIDTH : 0;
  }

  function getEffectiveHeaderHeight(): number {
    return headerVisibility.showColumnHeaders !== false ? COL_HEADER_HEIGHT : 0;
  }

  const coordSystem: CoordinateSystem = {
    // CELL <-> DOCUMENT
    cellToDocument: (_sheetId: string, cell: CellCoord): DocumentRect => {
      return documentRect(cell.col * cellWidth, cell.row * cellHeight, cellWidth, cellHeight);
    },

    documentToCell: (_sheetId: string, point: DocumentPoint): CellCoord | null => {
      const col = Math.floor(point.x / cellWidth);
      const row = Math.floor(point.y / cellHeight);
      if (row < 0 || col < 0 || row >= totalRows || col >= totalCols) return null;
      return { row, col };
    },

    rangeToDocument: (_sheetId: string, range: CellRange): DocumentRect => {
      const x = range.startCol * cellWidth;
      const y = range.startRow * cellHeight;
      const w = (range.endCol - range.startCol + 1) * cellWidth;
      const h = (range.endRow - range.startRow + 1) * cellHeight;
      return documentRect(x, y, w, h);
    },

    // DOCUMENT <-> VIEWPORT
    documentToViewport: (_sheetId: string, rect: DocumentRect): ViewportRect | null => {
      const hdrW = getEffectiveHeaderWidth();
      const hdrH = getEffectiveHeaderHeight();
      const x = (rect.x - viewport.scrollLeft) * zoom + hdrW;
      const y = (rect.y - viewport.scrollTop) * zoom + hdrH;
      const w = rect.width * zoom;
      const h = rect.height * zoom;
      return viewportRect(x, y, w, h);
    },

    documentToLayerViewport: (_sheetId: string, rect: DocumentRect): LayerRect | null => {
      const x = (rect.x - viewport.scrollLeft) * zoom;
      const y = (rect.y - viewport.scrollTop) * zoom;
      const w = rect.width * zoom;
      const h = rect.height * zoom;
      return layerRect(x, y, w, h);
    },

    viewportToDocument: (_sheetId: string, point: ViewportPoint): DocumentPoint => {
      const hdrW = getEffectiveHeaderWidth();
      const hdrH = getEffectiveHeaderHeight();
      const x = (point.x - hdrW) / zoom + viewport.scrollLeft;
      const y = (point.y - hdrH) / zoom + viewport.scrollTop;
      return documentPoint(x, y);
    },

    viewportToLayer: (point: ViewportPoint): LayerPoint => {
      return layerPoint(point.x - getEffectiveHeaderWidth(), point.y - getEffectiveHeaderHeight());
    },

    layerToViewport: (point: LayerPoint): ViewportPoint => {
      return viewportPoint(
        point.x + getEffectiveHeaderWidth(),
        point.y + getEffectiveHeaderHeight(),
      );
    },

    // CELL <-> VIEWPORT
    cellToViewport: (sheetId: string, cell: CellCoord): ViewportRect | null => {
      const docRect = coordSystem.cellToDocument(sheetId, cell);
      return coordSystem.documentToViewport(sheetId, docRect);
    },

    viewportToCell: (sheetId: string, point: ViewportPoint): CellCoord | null => {
      const docPt = coordSystem.viewportToDocument(sheetId, point);
      return coordSystem.documentToCell(sheetId, docPt);
    },

    rangeToViewport: (sheetId: string, range: CellRange): ViewportRect[] => {
      const vpRect = coordSystem.documentToViewport(
        sheetId,
        coordSystem.rangeToDocument(sheetId, range),
      );
      return vpRect ? [vpRect] : [];
    },

    // CLICK POSITION
    getClickPositionInCell: (sheetId: string, point: ViewportPoint, cell: CellCoord) => {
      const vpRect = coordSystem.cellToViewport(sheetId, cell);
      if (!vpRect) return null;
      return {
        x: point.x - vpRect.x,
        y: point.y - vpRect.y,
        width: vpRect.width,
        height: vpRect.height,
      };
    },

    // VIEWPORT QUERIES
    getVisibleRange: (_sheetId: string): CellRange => {
      const startCol = Math.floor(viewport.scrollLeft / cellWidth);
      const startRow = Math.floor(viewport.scrollTop / cellHeight);
      const endCol = Math.min(startCol + Math.ceil(vpWidth / (cellWidth * zoom)), totalCols - 1);
      const endRow = Math.min(startRow + Math.ceil(vpHeight / (cellHeight * zoom)), totalRows - 1);
      return { startRow, startCol, endRow, endCol };
    },

    getVisibleRegions: (sheetId: string): VisibleRegions => {
      return {
        frozenCorner: null,
        frozenRows: null,
        frozenCols: null,
        main: coordSystem.getVisibleRange(sheetId),
      };
    },

    isCellVisible: (sheetId: string, cell: CellCoord): boolean => {
      const range = coordSystem.getVisibleRange(sheetId);
      return (
        cell.row >= range.startRow &&
        cell.row <= range.endRow &&
        cell.col >= range.startCol &&
        cell.col <= range.endCol
      );
    },

    isCellFrozen: (_sheetId: string, cell: CellCoord): boolean => {
      return cell.row < frozenPanes.rows || cell.col < frozenPanes.cols;
    },

    // HIT TESTING
    classifyPoint: (_sheetId: string, _point: ViewportPoint, _isTouch?: boolean): HitTestResult => {
      return { type: 'empty' };
    },

    // SCROLLING
    getScrollToCell: (
      sheetId: string,
      cell: CellCoord,
      _padding?: number,
    ): { top: number; left: number } | null => {
      if (coordSystem.isCellVisible(sheetId, cell)) return null;
      return {
        top: cell.row * cellHeight,
        left: cell.col * cellWidth,
      };
    },

    getScrollBounds: (_sheetId: string): { maxScrollTop: number; maxScrollLeft: number } => {
      return {
        maxScrollTop: Math.max(0, totalRows * cellHeight - vpHeight),
        maxScrollLeft: Math.max(0, totalCols * cellWidth - vpWidth),
      };
    },

    getViewportBounds: (_sheetId: string) => {
      return {
        left: getEffectiveHeaderWidth(),
        top: getEffectiveHeaderHeight(),
        right: vpWidth,
        bottom: vpHeight,
      };
    },

    // CONFIGURATION
    setViewport: (vp: ScrollViewport) => {
      viewport = { ...vp };
    },

    getViewport: (): ScrollViewport => ({ ...viewport }),

    setFrozenPanes: (panes: FrozenPanes) => {
      frozenPanes = { ...panes };
    },

    getFrozenPanes: (): FrozenPanes => ({ ...frozenPanes }),

    setZoom: (z: number) => {
      zoom = z;
    },

    getZoom: () => zoom,

    getDevicePixelRatio: () => 1,

    getCurrentSheetId: (): string | null => null,

    getPositionIndex: (): ViewportPositionIndexLike | null => positionIndex,

    setViewportPositionIndex: (index: ViewportPositionIndexLike | null) => {
      positionIndex = index;
    },

    getViewportPositionIndex: (): ViewportPositionIndexLike | null => positionIndex,

    setViewportMergeIndex: (index: ViewportMergeIndexLike | null) => {
      mergeIndex = index;
    },

    getViewportMergeIndex: (): ViewportMergeIndexLike | null => mergeIndex,

    setOutlineGutter: (_rowGutterWidth: number, _colGutterHeight: number) => {
      // no-op for mock
    },

    getOutlineGutter: () => ({ rowGutterWidth: 0, colGutterHeight: 0 }),

    setHeaderVisibility: (visibility: HeaderVisibility) => {
      headerVisibility = { ...visibility };
    },

    getHeaderVisibility: (): HeaderVisibility => ({ ...headerVisibility }),
  };

  return coordSystem;
}
