import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { Point, Viewport, ViewportLayout } from '@mog-sdk/contracts/viewport';

type CoordinateScrollTarget = { top?: number; left?: number; x?: number; y?: number };

type PositionIndexLike = {
  readonly hasData: boolean;
  getRowTop(row: number): number;
  getRowHeight(row: number): number;
  getColLeft(col: number): number;
  getColWidth(col: number): number;
};

export type LayoutAwareScrollToCellInput = {
  sheetId: string;
  cell: CellCoord;
  layout: ViewportLayout | null;
  positionIndex: PositionIndexLike;
  frozenPanes: { rows: number; cols: number };
  currentScroll: Point;
  maxScroll: Point;
  getCellPageBounds(row: number, col: number): { width: number; height: number } | null;
  getCoordinateScrollTarget(sheetId: string, cell: CellCoord): CoordinateScrollTarget | null;
};

export function getLayoutAwareScrollToCell({
  sheetId,
  cell,
  layout,
  positionIndex,
  frozenPanes,
  currentScroll,
  maxScroll,
  getCellPageBounds,
  getCoordinateScrollTarget,
}: LayoutAwareScrollToCellInput): Point | null {
  if (layout) {
    const pageBounds = getCellPageBounds(cell.row, cell.col);
    if (pageBounds && pageBounds.width > 0 && pageBounds.height > 0) {
      return null;
    }
    if (positionIndex.hasData) {
      return deriveScrollToCellFromLayout({
        sheetId,
        cell,
        layout,
        positionIndex,
        frozenPanes,
        currentScroll,
        maxScroll,
      });
    }
  }

  const coordinateTarget = getCoordinateScrollTarget(sheetId, cell);
  if (coordinateTarget) {
    return {
      x: coordinateTarget.left ?? coordinateTarget.x ?? 0,
      y: coordinateTarget.top ?? coordinateTarget.y ?? 0,
    };
  }

  return null;
}

type DeriveScrollToCellInput = {
  sheetId: string;
  cell: CellCoord;
  layout: ViewportLayout;
  positionIndex: PositionIndexLike;
  frozenPanes: { rows: number; cols: number };
  currentScroll: Point;
  maxScroll: Point;
};

const SCROLL_PADDING_PX = 20;

function deriveScrollToCellFromLayout({
  sheetId,
  cell,
  layout,
  positionIndex,
  frozenPanes,
  currentScroll,
  maxScroll,
}: DeriveScrollToCellInput): Point | null {
  if (cell.row < frozenPanes.rows && cell.col < frozenPanes.cols) return null;

  let next = { ...currentScroll };

  if (cell.row >= frozenPanes.rows) {
    const viewport = findScrollViewportForCell(layout, sheetId, cell, 'y');
    if (viewport) {
      const rowTop = positionIndex.getRowTop(cell.row);
      const rowHeight = positionIndex.getRowHeight(cell.row);
      const target = deriveAxisScrollTarget({
        itemStart: rowTop,
        itemSize: rowHeight,
        viewportOrigin: viewport.viewportOrigin.y,
        viewportSize: viewport.bounds.height,
        currentScroll: currentScroll.y,
        zoom: viewport.zoom,
        beforeViewport: cell.row < viewport.cellRange.startRow,
      });
      if (target !== null) {
        next.y = target;
      }
    }
  }

  if (cell.col >= frozenPanes.cols) {
    const viewport = findScrollViewportForCell(layout, sheetId, cell, 'x');
    if (viewport) {
      const colLeft = positionIndex.getColLeft(cell.col);
      const colWidth = positionIndex.getColWidth(cell.col);
      const target = deriveAxisScrollTarget({
        itemStart: colLeft,
        itemSize: colWidth,
        viewportOrigin: viewport.viewportOrigin.x,
        viewportSize: viewport.bounds.width,
        currentScroll: currentScroll.x,
        zoom: viewport.zoom,
        beforeViewport: cell.col < viewport.cellRange.startCol,
      });
      if (target !== null) {
        next.x = target;
      }
    }
  }

  next = {
    x: Math.max(0, Math.min(maxScroll.x, next.x)),
    y: Math.max(0, Math.min(maxScroll.y, next.y)),
  };

  if (next.x === currentScroll.x && next.y === currentScroll.y) return null;
  return next;
}

function deriveAxisScrollTarget({
  itemStart,
  itemSize,
  viewportOrigin,
  viewportSize,
  currentScroll,
  zoom,
  beforeViewport,
}: {
  itemStart: number;
  itemSize: number;
  viewportOrigin: number;
  viewportSize: number;
  currentScroll: number;
  zoom: number;
  beforeViewport: boolean;
}): number | null {
  const viewportSizeInDocument = viewportSize / zoom;
  if (itemSize <= 0 || viewportSizeInDocument <= 0) return null;

  const itemEnd = itemStart + itemSize;
  const viewportStart = currentScroll + viewportOrigin;
  const viewportEnd = viewportStart + viewportSizeInDocument;

  if (itemStart >= viewportStart && itemEnd <= viewportEnd) {
    return null;
  }

  const paddingInDocument = Math.min(
    SCROLL_PADDING_PX / zoom,
    Math.max(0, (viewportSizeInDocument - itemSize) / 2),
  );

  if (beforeViewport || itemStart < viewportStart) {
    return itemStart - viewportOrigin - paddingInDocument;
  }

  return itemEnd - viewportOrigin - viewportSizeInDocument + paddingInDocument;
}

function findScrollViewportForCell(
  layout: ViewportLayout,
  sheetId: string,
  cell: CellCoord,
  axis: 'x' | 'y',
): Viewport | null {
  const candidates = layout.viewports.filter(
    (viewport) => matchesSheet(viewport, sheetId) && canScrollAxis(viewport, axis),
  );
  return (
    candidates.find((viewport) => containsOrthogonalCell(viewport, cell, axis)) ??
    candidates.find((viewport) => viewport.id === layout.primaryViewportId) ??
    candidates.find((viewport) => viewport.id === 'main') ??
    candidates[0] ??
    null
  );
}

function matchesSheet(viewport: Viewport, sheetId: string): boolean {
  return (viewport.sheetId ?? sheetId) === sheetId;
}

function canScrollAxis(viewport: Viewport, axis: 'x' | 'y'): boolean {
  const behavior = viewport.scrollBehavior;
  return (
    behavior.type === 'free' ||
    (axis === 'x' && behavior.type === 'horizontal-only') ||
    (axis === 'y' && behavior.type === 'vertical-only') ||
    (behavior.type === 'linked' && behavior.axis === axis)
  );
}

function containsOrthogonalCell(viewport: Viewport, cell: CellCoord, axis: 'x' | 'y'): boolean {
  const range = viewport.cellRange;
  return axis === 'y'
    ? cell.col >= range.startCol && cell.col <= range.endCol
    : cell.row >= range.startRow && cell.row <= range.endRow;
}
