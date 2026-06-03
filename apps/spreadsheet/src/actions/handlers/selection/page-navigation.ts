/**
 * Selection Handlers - Page Navigation
 *
 * Handles page-based navigation actions:
 * - PAGE_UP / PAGE_DOWN - Move selection by visible rows
 * - PAGE_LEFT / PAGE_RIGHT - Move selection by visible columns
 *
 */

import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';

import { handled, type ActionDependencies, type ActionHandler } from './helpers';

// =============================================================================
// Viewport Dimension Helper
// =============================================================================

/**
 * Get visible row/col count from the coordinator's rendered viewport snapshot.
 * Falls back to geometry, then to reasonable defaults if capabilities are not available.
 */
interface VisibleRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

type RendererWithViewport = Record<string, unknown> & {
  getViewport: () => {
    getSnapshot: () => {
      visibleRange?: VisibleRange | null;
    } | null;
  } | null;
};

type RendererWithGeometry = Record<string, unknown> & {
  getGeometry: () => {
    getVisibleRange: () => VisibleRange;
  } | null;
};

type RendererWithCellScroll = Record<string, unknown> & {
  applyCellLevelScroll: (topRow: number, leftCol: number) => void;
};

function getRenderer(coordinator: unknown): Record<string, unknown> | null {
  if (
    coordinator === null ||
    coordinator === undefined ||
    typeof coordinator !== 'object' ||
    !('renderer' in coordinator) ||
    coordinator.renderer === null ||
    typeof coordinator.renderer !== 'object'
  ) {
    return null;
  }

  return coordinator.renderer as Record<string, unknown>;
}

function hasViewport(renderer: Record<string, unknown>): renderer is RendererWithViewport {
  return 'getViewport' in renderer && typeof renderer.getViewport === 'function';
}

function hasGeometry(renderer: Record<string, unknown>): renderer is RendererWithGeometry {
  return 'getGeometry' in renderer && typeof renderer.getGeometry === 'function';
}

function hasCellScroll(renderer: Record<string, unknown>): renderer is RendererWithCellScroll {
  return 'applyCellLevelScroll' in renderer && typeof renderer.applyCellLevelScroll === 'function';
}

function isValidVisibleRange(range: VisibleRange | null | undefined): range is VisibleRange {
  return (
    range !== null &&
    range !== undefined &&
    Number.isFinite(range.startRow) &&
    Number.isFinite(range.startCol) &&
    Number.isFinite(range.endRow) &&
    Number.isFinite(range.endCol)
  );
}

function getViewportVisibleRange(renderer: Record<string, unknown>): VisibleRange | null {
  if (!hasViewport(renderer)) {
    return null;
  }

  const snapshot = renderer.getViewport()?.getSnapshot();
  const visibleRange = snapshot?.visibleRange;
  return isValidVisibleRange(visibleRange) ? visibleRange : null;
}

function getGeometryVisibleRange(renderer: Record<string, unknown>): VisibleRange | null {
  if (!hasGeometry(renderer)) {
    return null;
  }

  const visibleRange = renderer.getGeometry()?.getVisibleRange();
  return isValidVisibleRange(visibleRange) ? visibleRange : null;
}

function getViewportDimensions(deps: ActionDependencies): {
  visibleRows: number;
  visibleCols: number;
  visibleRange: VisibleRange | null;
} {
  const defaultVisibleRows = 20;
  const defaultVisibleCols = 10;

  const renderer = getRenderer(deps.coordinator);
  if (!renderer) {
    return { visibleRows: defaultVisibleRows, visibleCols: defaultVisibleCols, visibleRange: null };
  }

  const viewportVisibleRange = getViewportVisibleRange(renderer);
  if (viewportVisibleRange) {
    return {
      visibleRows: Math.max(1, viewportVisibleRange.endRow - viewportVisibleRange.startRow + 1),
      visibleCols: Math.max(1, viewportVisibleRange.endCol - viewportVisibleRange.startCol + 1),
      visibleRange: viewportVisibleRange,
    };
  }

  const geometryVisibleRange = getGeometryVisibleRange(renderer);
  if (geometryVisibleRange) {
    return {
      visibleRows: Math.max(1, geometryVisibleRange.endRow - geometryVisibleRange.startRow),
      visibleCols: Math.max(1, geometryVisibleRange.endCol - geometryVisibleRange.startCol),
      visibleRange: geometryVisibleRange,
    };
  }

  return { visibleRows: defaultVisibleRows, visibleCols: defaultVisibleCols, visibleRange: null };
}

function applyPageScroll(
  deps: ActionDependencies,
  visibleRange: VisibleRange | null,
  topRow: number,
  leftCol: number,
): void {
  const renderer = getRenderer(deps.coordinator);
  if (!renderer || !hasCellScroll(renderer)) return;

  const fallbackTop = visibleRange?.startRow ?? 0;
  const fallbackLeft = visibleRange?.startCol ?? 0;
  renderer.applyCellLevelScroll(
    Math.max(0, Math.min(MAX_ROWS - 1, Number.isFinite(topRow) ? topRow : fallbackTop)),
    Math.max(0, Math.min(MAX_COLS - 1, Number.isFinite(leftCol) ? leftCol : fallbackLeft)),
  );
}

function getActiveCellFallback(deps: ActionDependencies): { row: number; col: number } {
  return deps.accessors?.selection?.getActiveCell?.() ?? { row: 0, col: 0 };
}

// =============================================================================
// Page Navigation Handlers
// =============================================================================

export const PAGE_UP: ActionHandler = (deps) => {
  const { visibleRows, visibleRange } = getViewportDimensions(deps);
  const activeCell = getActiveCellFallback(deps);
  deps.commands.selection.pageUp(visibleRows, false);
  applyPageScroll(
    deps,
    visibleRange,
    (visibleRange?.startRow ?? activeCell.row) - visibleRows,
    visibleRange?.startCol ?? activeCell.col,
  );
  return handled();
};

export const PAGE_DOWN: ActionHandler = (deps) => {
  const { visibleRows, visibleRange } = getViewportDimensions(deps);
  const activeCell = getActiveCellFallback(deps);
  deps.commands.selection.pageDown(visibleRows, false);
  applyPageScroll(
    deps,
    visibleRange,
    (visibleRange?.startRow ?? activeCell.row) + visibleRows,
    visibleRange?.startCol ?? activeCell.col,
  );
  return handled();
};

export const PAGE_LEFT: ActionHandler = (deps) => {
  const { visibleCols, visibleRange } = getViewportDimensions(deps);
  const activeCell = getActiveCellFallback(deps);
  deps.commands.selection.pageLeft(visibleCols, false);
  applyPageScroll(
    deps,
    visibleRange,
    visibleRange?.startRow ?? activeCell.row,
    (visibleRange?.startCol ?? activeCell.col) - visibleCols,
  );
  return handled();
};

export const PAGE_RIGHT: ActionHandler = (deps) => {
  const { visibleCols, visibleRange } = getViewportDimensions(deps);
  const activeCell = getActiveCellFallback(deps);
  deps.commands.selection.pageRight(visibleCols, false);
  applyPageScroll(
    deps,
    visibleRange,
    visibleRange?.startRow ?? activeCell.row,
    (visibleRange?.startCol ?? activeCell.col) + visibleCols,
  );
  return handled();
};

// =============================================================================
// Page Navigation Extension Handlers (Shift+PageUp/PageDown)
// =============================================================================

export const EXTEND_SELECTION_PAGE_UP: ActionHandler = (deps) => {
  const { visibleRows } = getViewportDimensions(deps);
  deps.commands.selection.pageUp(visibleRows, true);
  return handled();
};

export const EXTEND_SELECTION_PAGE_DOWN: ActionHandler = (deps) => {
  const { visibleRows } = getViewportDimensions(deps);
  deps.commands.selection.pageDown(visibleRows, true);
  return handled();
};
