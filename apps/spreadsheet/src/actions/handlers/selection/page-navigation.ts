/**
 * Selection Handlers - Page Navigation
 *
 * Handles page-based navigation actions:
 * - PAGE_UP / PAGE_DOWN - Move selection by visible rows
 * - PAGE_LEFT / PAGE_RIGHT - Move selection by visible columns
 *
 */

import { handled, type ActionDependencies, type ActionHandler } from './helpers';

// =============================================================================
// Viewport Dimension Helper
// =============================================================================

/**
 * Get visible row/col count from the coordinator's geometry capability.
 * Falls back to reasonable defaults if geometry is not available.
 */
/**
 * Type guard for coordinator with geometry capability via renderer.
 */
function hasGeometry(coordinator: unknown): coordinator is {
  renderer: {
    getGeometry: () => {
      getVisibleRange: () => {
        startRow: number;
        startCol: number;
        endRow: number;
        endCol: number;
      };
    } | null;
  };
} {
  return (
    coordinator !== null &&
    coordinator !== undefined &&
    typeof coordinator === 'object' &&
    'renderer' in coordinator &&
    coordinator.renderer !== null &&
    typeof coordinator.renderer === 'object' &&
    'getGeometry' in (coordinator.renderer as Record<string, unknown>) &&
    typeof (coordinator.renderer as Record<string, unknown>).getGeometry === 'function'
  );
}

function getViewportDimensions(deps: ActionDependencies): {
  visibleRows: number;
  visibleCols: number;
} {
  const defaultVisibleRows = 20;
  const defaultVisibleCols = 10;

  const coordinator = deps.coordinator;
  if (!hasGeometry(coordinator)) {
    return { visibleRows: defaultVisibleRows, visibleCols: defaultVisibleCols };
  }

  const geometry = coordinator.renderer.getGeometry();
  if (!geometry) {
    return { visibleRows: defaultVisibleRows, visibleCols: defaultVisibleCols };
  }

  // Get visible range from geometry capability
  const visibleRange = geometry.getVisibleRange();

  // Calculate visible rows and cols from the range
  const visibleRows = Math.max(1, visibleRange.endRow - visibleRange.startRow);
  const visibleCols = Math.max(1, visibleRange.endCol - visibleRange.startCol);

  return { visibleRows, visibleCols };
}

// =============================================================================
// Page Navigation Handlers
// =============================================================================

export const PAGE_UP: ActionHandler = (deps) => {
  const { visibleRows } = getViewportDimensions(deps);
  deps.commands.selection.pageUp(visibleRows, false);
  return handled();
};

export const PAGE_DOWN: ActionHandler = (deps) => {
  const { visibleRows } = getViewportDimensions(deps);
  deps.commands.selection.pageDown(visibleRows, false);
  return handled();
};

export const PAGE_LEFT: ActionHandler = (deps) => {
  const { visibleCols } = getViewportDimensions(deps);
  deps.commands.selection.pageLeft(visibleCols, false);
  return handled();
};

export const PAGE_RIGHT: ActionHandler = (deps) => {
  const { visibleCols } = getViewportDimensions(deps);
  deps.commands.selection.pageRight(visibleCols, false);
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
