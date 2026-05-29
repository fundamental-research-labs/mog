/**
 * Sparkline Selection Coordination
 *
 * Coordinates sparkline detection at active cell with UIStore updates.
 * This module subscribes to selection changes and updates the UIStore
 * contextualTabs.hasSparklineInActiveCell when the active cell enters or
 * exits a cell containing a sparkline.
 *
 * PERFORMANCE: This coordination is the single point of subscription
 * for sparkline detection at active cell. The useContextualTabs hook reads
 * from UIStore (hasSparklineInActiveCell) instead of subscribing to selection
 * directly, preventing unnecessary re-renders in TabbedToolbar on every cell
 * selection change.
 *
 * ARCHITECTURE:
 * - Subscribes to selection actor for changes
 * - Only updates UIStore when selection is idle (not during drag)
 * - Detects sparkline at active cell position
 * - Updates UIStore.contextualTabs.hasSparklineInActiveCell
 *
 * @see engine/src/components/toolbar/contextual/useContextualTabs.ts
 */

import type { ISparklineManager as SparklineManager } from '@mog-sdk/contracts/sparklines';
import type { CleanupManager } from '../../shared/cleanup-manager';
import type { ReadableStoreApi } from '../../shared/types';
import type { RendererUIStore } from '../types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for sparkline selection coordination.
 */
export interface SparklineSelectionCoordinationConfig {
  /** Selection actor; sparkline detection only needs the active cell and idle state. */
  actors: {
    selection: {
      getSnapshot: () => SparklineSelectionSnapshot;
      subscribe: (listener: (state: SparklineSelectionSnapshot) => void) => {
        unsubscribe: () => void;
      };
    };
  };
  /** Sparkline manager for checking sparklines at cells */
  sparklineManager: SparklineManager;
  /** UI store API for updating hasSparklineInActiveCell */
  uiStoreApi: ReadableStoreApi<RendererUIStore>;
  /** Get the current active sheet ID */
  getActiveSheetId: () => string;
}

interface SparklineSelectionSnapshot {
  context: { activeCell: { row: number; col: number } };
  matches: (value: string) => boolean;
}

/**
 * Result of sparkline selection coordination setup.
 */
export interface SparklineSelectionCoordinationResult {
  /** Recompute hasSparklineInActiveCell for the current active cell */
  refresh: () => void;
  /** Cleanup function to unsubscribe */
  cleanup: () => void;
}

// =============================================================================
// COORDINATION SETUP
// =============================================================================

/**
 * Set up sparkline selection coordination.
 *
 * Subscribes to selection actor and updates UIStore.contextualTabs.hasSparklineInActiveCell
 * when the active cell enters or exits a sparkline cell. Only updates when selection is idle
 * to prevent cascading re-renders during drag operations.
 *
 * Pattern: Uses transition detection - only updates when selection settles (idle state)
 * and the active cell has actually changed position.
 *
 * @param config - Configuration with actors, sparklineManager, and uiStoreApi
 * @param cleanups - CleanupManager to register cleanup function
 * @returns Sparkline selection coordination result
 */
export function setupSparklineSelectionCoordination(
  config: SparklineSelectionCoordinationConfig,
  cleanups: CleanupManager,
): SparklineSelectionCoordinationResult {
  const { actors, sparklineManager, uiStoreApi, getActiveSheetId } = config;

  // Track previous active cell to detect changes
  let prevActiveCell = actors.selection.getSnapshot().context.activeCell;
  let hasPendingUpdate = false;
  let active = true;

  const refresh = (): void => {
    if (!active) return;

    const activeCell = actors.selection.getSnapshot().context.activeCell;
    const sheetId = getActiveSheetId();
    const sparkline = sparklineManager.getSparklineAtCell(sheetId, activeCell.row, activeCell.col);
    const hasSparkline = !!sparkline;

    // Get current hasSparklineInActiveCell from UIStore
    const currentHasSparkline = uiStoreApi.getState().contextualTabs.hasSparklineInActiveCell;

    // Only update if the boolean actually changed
    if (currentHasSparkline !== hasSparkline) {
      uiStoreApi.getState().setHasSparklineInActiveCell(hasSparkline);
    }
  };

  // Subscribe to selection actor
  const selectionSub = actors.selection.subscribe((state) => {
    const currActiveCell = state.context.activeCell;
    const isIdle = state.matches('idle');

    // Check if active cell changed
    const activeCellChanged =
      currActiveCell.row !== prevActiveCell.row || currActiveCell.col !== prevActiveCell.col;

    if (activeCellChanged) {
      prevActiveCell = currActiveCell;
      hasPendingUpdate = true;
    }

    // Only update UIStore when selection is idle (settled)
    // This prevents cascading re-renders during drag operations
    if (isIdle && hasPendingUpdate) {
      hasPendingUpdate = false;
      refresh();
    }
  });

  // Changing sheets changes the coordinate space even when the active cell
  // position is numerically identical.
  const activeSheetUnsub = uiStoreApi.subscribe((state, previousState) => {
    if (state.activeSheetId !== previousState.activeSheetId) {
      prevActiveCell = actors.selection.getSnapshot().context.activeCell;
      hasPendingUpdate = false;
      refresh();
    }
  });

  refresh();

  const cleanup = () => {
    if (!active) return;
    active = false;
    selectionSub.unsubscribe();
    activeSheetUnsub();
  };

  // Register cleanup with manager
  cleanups.register('sparklineSelectionCoordination', cleanup);

  return { cleanup, refresh };
}
