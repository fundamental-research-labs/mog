import type { Point, ViewportLayout } from '@mog-sdk/contracts/viewport';

type PageScrollAxis = 'horizontal' | 'vertical';
type PageScrollDirection = 'previous' | 'next';

interface VisibleRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

interface PositionDimensions {
  totalRows: number;
  totalCols: number;
  getRowTop(row: number): number;
  getColLeft(col: number): number;
}

interface ResolvePageScrollPositionOptions {
  axis: PageScrollAxis;
  direction: PageScrollDirection;
  visibleRange: VisibleRange;
  dimensions: PositionDimensions;
  current: Point;
  layout: ViewportLayout | null;
}

function getPrimaryViewportOrigin(layout: ViewportLayout | null): Point {
  const primaryViewport =
    layout?.viewports.find((viewport) => viewport.id === layout.primaryViewportId) ??
    layout?.viewports.find((viewport) => viewport.id === 'main') ??
    layout?.viewports.find((viewport) => viewport.id.startsWith('main:')) ??
    layout?.viewports[0];

  return primaryViewport?.viewportOrigin ?? { x: 0, y: 0 };
}

/**
 * Page navigation chooses a target row/column in document coordinates. Convert
 * that target to the canonical scroll offset for the active viewport, whose
 * document origin may start after frozen rows/columns.
 */
export function resolvePageScrollPosition({
  axis,
  direction,
  visibleRange,
  dimensions,
  current,
  layout,
}: ResolvePageScrollPositionOptions): Point {
  const viewportOrigin = getPrimaryViewportOrigin(layout);
  let next = { x: current.x, y: current.y };

  if (axis === 'horizontal') {
    const visibleCols = Math.max(1, visibleRange.endCol - visibleRange.startCol + 1);
    const targetStartCol =
      direction === 'previous'
        ? Math.max(0, visibleRange.startCol - visibleCols)
        : Math.min(dimensions.totalCols - 1, visibleRange.startCol + visibleCols);
    next = {
      ...next,
      x: Math.max(0, dimensions.getColLeft(targetStartCol) - viewportOrigin.x),
    };
  } else {
    const visibleRows = Math.max(1, visibleRange.endRow - visibleRange.startRow + 1);
    const targetStartRow =
      direction === 'previous'
        ? Math.max(0, visibleRange.startRow - visibleRows)
        : Math.min(dimensions.totalRows - 1, visibleRange.startRow + visibleRows);
    next = {
      ...next,
      y: Math.max(0, dimensions.getRowTop(targetStartRow) - viewportOrigin.y),
    };
  }

  return next;
}
