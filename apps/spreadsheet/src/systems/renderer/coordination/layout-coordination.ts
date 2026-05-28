/**
 * Layout Coordination Module
 *
 * Centralizes all Workbook event subscriptions that affect viewport layout.
 * Triggers recomputeViewportLayout() when layout-affecting state changes.
 *
 * ARCHITECTURE:
 * - Subscribes to Workbook events that affect layout (freeze, outline, headers)
 * - Subscribes to UIStore.activeSheetId for sheet switching
 * - Uses transition detection pattern to skip redundant recomputation
 * - Uses RAF batching to coalesce rapid changes
 *
 * RESPONSIBILITIES:
 * 1. Subscribe to view:options-changed (toggle headings)
 * 2. Subscribe to filter:applied/cleared (affects scroll bounds)
 * 3. Subscribe to group:created/deleted/collapsed (outline gutter)
 * 4. Subscribe to outline:level-changed
 * 5. Subscribe to row:height-changed, column:width-changed
 * 6. Subscribe to rows:hidden/unhidden, columns:hidden/unhidden
 * 7. Subscribe to UIStore.activeSheetId
 *
 * KEY PATTERNS:
 * - Coordinator owns side effects, UIStore is pure state (§4)
 * - Uses transition detection pattern with previousLayoutInputs (§4)
 * - All Workbook subscriptions are cleaned up on dispose (§8)
 * - Located in features/layout/ per §11
 *
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { SplitViewportConfig } from '@mog-sdk/contracts/viewport-config';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies needed by LayoutCoordination.
 * Injected from SheetCoordinator.
 */
export interface LayoutCoordinationConfig {
  /** Workbook instance for event subscriptions */
  workbook: Workbook;

  /**
   * Subscribe to UIStore activeSheetId changes.
   * Returns unsubscribe function.
   */
  subscribeToActiveSheetId: (callback: (sheetId: string | undefined) => void) => () => void;

  /** Get the current active sheet ID */
  getCurrentSheetId: () => string | undefined;

  /** Trigger viewport layout recomputation */
  recomputeLayout: () => void;

  /** Update header visibility on renderer context */
  updateHeaderVisibility: (show: { rows: boolean; cols: boolean }) => void;

  /** Sync outline gutter dimensions */
  syncOutlineGutter: () => void;

  /** Get current layout inputs for transition detection */
  getLayoutInputs: () => LayoutInputSnapshot;
}

/**
 * Snapshot of layout-affecting inputs for transition detection.
 * Used to skip recomputation if inputs haven't changed.
 */
export interface LayoutInputSnapshot {
  sheetId: string | undefined;
  headerVisibility: { rows: boolean; cols: boolean };
  gutterDimensions: { row: number; col: number };
  frozenPanes: { rows: number; cols: number };
  splitConfig: SplitViewportConfig | null;
}

/**
 * Result returned by setupLayoutCoordination.
 */
export interface LayoutCoordinationResult {
  /** Dispose of all subscriptions and cleanup */
  dispose: () => void;

  /** Force a layout recomputation (for testing or manual triggers) */
  forceRecompute: () => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Compare two LayoutInputSnapshot objects for equality.
 * Used by transition detection to skip redundant recomputation.
 */
function areLayoutInputsEqual(a: LayoutInputSnapshot, b: LayoutInputSnapshot): boolean {
  return (
    a.sheetId === b.sheetId &&
    a.headerVisibility.rows === b.headerVisibility.rows &&
    a.headerVisibility.cols === b.headerVisibility.cols &&
    a.gutterDimensions.row === b.gutterDimensions.row &&
    a.gutterDimensions.col === b.gutterDimensions.col &&
    a.frozenPanes.rows === b.frozenPanes.rows &&
    a.frozenPanes.cols === b.frozenPanes.cols &&
    areSplitConfigsEqual(a.splitConfig, b.splitConfig)
  );
}

/**
 * Compare two SplitViewportConfig objects for equality.
 */
function areSplitConfigsEqual(
  a: SplitViewportConfig | null,
  b: SplitViewportConfig | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.direction === b.direction &&
    a.horizontalPosition === b.horizontalPosition &&
    a.verticalPosition === b.verticalPosition
  );
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Set up layout coordination.
 *
 * This function creates Workbook and UIStore subscriptions to:
 * - Trigger layout recomputation on view option changes
 * - Trigger layout recomputation on outline gutter changes
 * - Trigger layout recomputation on dimension changes
 * - Handle sheet switching (with deduplication)
 *
 * CRITICAL: All subscriptions are cleaned up on dispose.
 *
 * @param config - Configuration including Workbook and callbacks
 * @returns Coordination result with cleanup function
 */
export function setupLayoutCoordination(
  config: LayoutCoordinationConfig,
): LayoutCoordinationResult {
  const {
    workbook,
    subscribeToActiveSheetId,
    getCurrentSheetId,
    recomputeLayout,
    updateHeaderVisibility,
    syncOutlineGutter,
    getLayoutInputs,
  } = config;

  // Track unsubscribe functions for cleanup
  const unsubscribers: Array<() => void> = [];

  // ===========================================================================
  // Transition Detection State (§4)
  // ===========================================================================

  let previousLayoutInputs: LayoutInputSnapshot | null = null;

  // ===========================================================================
  // RAF Batching State
  // ===========================================================================

  let pendingRecompute = false;
  let rafHandle: number | null = null;

  /**
   * Schedule layout recomputation with RAF batching.
   * Multiple events within the same frame are coalesced into a single recomputation.
   */
  function scheduleRecompute(): void {
    // Transition detection - skip if inputs unchanged
    const currentInputs = getLayoutInputs();
    if (previousLayoutInputs && areLayoutInputsEqual(previousLayoutInputs, currentInputs)) {
      return;
    }
    previousLayoutInputs = currentInputs;

    // RAF batching - coalesce multiple events per frame
    if (pendingRecompute) return;
    pendingRecompute = true;

    rafHandle = requestAnimationFrame(() => {
      rafHandle = null;
      pendingRecompute = false;
      recomputeLayout();
    });
  }

  /**
   * Schedule immediate recomputation (no RAF batching).
   * Used for user-facing events that need instant feedback.
   */
  function scheduleImmediateRecompute(): void {
    // Transition detection - skip if inputs unchanged
    const currentInputs = getLayoutInputs();
    if (previousLayoutInputs && areLayoutInputsEqual(previousLayoutInputs, currentInputs)) {
      return;
    }
    previousLayoutInputs = currentInputs;

    recomputeLayout();
  }

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // View Options (Toggle Headings)
  // ---------------------------------------------------------------------------
  const unsubViewOptions = workbook.on('view:options-changed', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Update renderer context with new header visibility
      updateHeaderVisibility({
        rows: event.showRowHeaders,
        cols: event.showColumnHeaders,
      });

      // Trigger immediate layout recomputation
      scheduleImmediateRecompute();
    }
  });
  unsubscribers.push(unsubViewOptions);

  // ---------------------------------------------------------------------------
  // Filter Applied/Cleared (Affects Scroll Bounds)
  // ---------------------------------------------------------------------------
  const unsubFilterApplied = workbook.on('filter:applied', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Filter changes row visibility, affecting scroll bounds
      scheduleImmediateRecompute();
    }
  });
  unsubscribers.push(unsubFilterApplied);

  const unsubFilterCleared = workbook.on('filter:cleared', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Filter cleared restores row visibility
      scheduleImmediateRecompute();
    }
  });
  unsubscribers.push(unsubFilterCleared);

  // ---------------------------------------------------------------------------
  // Outline Gutter Events (Group Created/Deleted/Collapsed)
  // ---------------------------------------------------------------------------
  const unsubGroupCreated = workbook.on('group:created', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Sync outline gutter dimensions
      syncOutlineGutter();
      // Trigger layout recomputation for gutter changes
      scheduleImmediateRecompute();
    }
  });
  unsubscribers.push(unsubGroupCreated);

  const unsubGroupDeleted = workbook.on('group:deleted', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      syncOutlineGutter();
      scheduleImmediateRecompute();
    }
  });
  unsubscribers.push(unsubGroupDeleted);

  const unsubGroupCollapsed = workbook.on('group:collapsed', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Collapse/expand may change visible rows/columns
      syncOutlineGutter();
      scheduleImmediateRecompute();
    }
  });
  unsubscribers.push(unsubGroupCollapsed);

  // ---------------------------------------------------------------------------
  // Outline Level Changed
  // ---------------------------------------------------------------------------
  const unsubOutlineLevelChanged = workbook.on('outline:level-changed', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Level change affects visible rows/columns
      syncOutlineGutter();
      scheduleImmediateRecompute();
    }
  });
  unsubscribers.push(unsubOutlineLevelChanged);

  // ---------------------------------------------------------------------------
  // Dimension Change Events (Row Height / Column Width)
  // ---------------------------------------------------------------------------
  const unsubRowHeightChanged = workbook.on('row:height-changed', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Row height affects frozen row boundaries and visible range
      // Use RAF batching for batch dimension changes (e.g., auto-fit)
      scheduleRecompute();
    }
  });
  unsubscribers.push(unsubRowHeightChanged);

  const unsubColWidthChanged = workbook.on('column:width-changed', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Column width affects frozen col boundaries and visible range
      scheduleRecompute();
    }
  });
  unsubscribers.push(unsubColWidthChanged);

  // ---------------------------------------------------------------------------
  // Hidden Rows/Columns Events
  // ---------------------------------------------------------------------------
  const unsubRowsHidden = workbook.on('rows:hidden', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Hidden rows affect visible range and scroll bounds
      scheduleImmediateRecompute();
    }
  });
  unsubscribers.push(unsubRowsHidden);

  const unsubRowsUnhidden = workbook.on('rows:unhidden', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      scheduleImmediateRecompute();
    }
  });
  unsubscribers.push(unsubRowsUnhidden);

  const unsubColsHidden = workbook.on('columns:hidden', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      scheduleImmediateRecompute();
    }
  });
  unsubscribers.push(unsubColsHidden);

  const unsubColsUnhidden = workbook.on('columns:unhidden', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      scheduleImmediateRecompute();
    }
  });
  unsubscribers.push(unsubColsUnhidden);

  // ---------------------------------------------------------------------------
  // Subscribe to UIStore.activeSheetId
  // ---------------------------------------------------------------------------
  // Note: Sheet switch already calls recomputeViewportLayout() at renderer-execution.ts:430
  // during 'switchingSheet' state. The transition detection pattern handles deduplication -
  // if previousLayoutInputs matches currentInputs, the redundant recompute is skipped.
  const unsubActiveSheetId = subscribeToActiveSheetId((_sheetId) => {
    // Sheet switching triggers layout recomputation
    // The transition detection will skip if inputs match (deduplication)
    scheduleImmediateRecompute();
  });
  unsubscribers.push(unsubActiveSheetId);

  // ===========================================================================
  // Return Result
  // ===========================================================================

  return {
    dispose: () => {
      // Unsubscribe from all events
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers.length = 0;

      // Cancel any pending RAF
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
      pendingRecompute = false;
    },

    forceRecompute: () => {
      // Clear transition detection state to force recomputation
      previousLayoutInputs = null;
      recomputeLayout();
    },
  };
}
