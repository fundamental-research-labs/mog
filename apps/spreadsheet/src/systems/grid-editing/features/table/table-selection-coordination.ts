/**
 * Table Selection Coordination
 *
 * Coordinates table selection detection with UIStore updates.
 * This module subscribes to selection changes and updates the UIStore
 * selectedTableId when the selection enters or exits a table.
 *
 * PERFORMANCE: This coordination is the single point of subscription
 * for table selection detection. The useTableSelection hook reads from
 * UIStore (selectedTableId) instead of subscribing to selection directly,
 * preventing unnecessary re-renders in ToolbarContainer on every selection change.
 *
 * ARCHITECTURE:
 * - Subscribes to selection actor for changes
 * - Subscribes to table topology changes for create/update/delete/resize
 * - Only updates UIStore when selection is idle (not during drag)
 * - Detects table at active cell position
 * - Updates UIStore.tableDesign.selectedTableId
 *
 * @see engine/src/hooks/use-table-selection.ts
 */

// Migrated to unified Workbook API (ws.getTableAtCell).
import type { Workbook } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { CleanupManager } from '../../../shared/cleanup-manager';
import type { ReadableStoreApi } from '../../../shared/types';
import type { GridEditingUIStore } from '../../types';

const TABLE_TOPOLOGY_EVENTS = [
  'table:changed',
  'table:created',
  'table:updated',
  'table:deleted',
] as const;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for table selection coordination.
 */
export interface TableSelectionCoordinationConfig {
  /** Selection actor; table detection only needs the active cell and idle state. */
  actors: {
    selection: {
      getSnapshot: () => TableSelectionSnapshot;
      subscribe: (listener: (state: TableSelectionSnapshot) => void) => { unsubscribe: () => void };
    };
  };
  /** UI store API for updating selectedTableId */
  uiStoreApi: ReadableStoreApi<GridEditingUIStore>;
  /** Get the current active sheet ID */
  getActiveSheetId: () => string;
  /** Unified Workbook API */
  workbook?: Workbook;
}

interface TableSelectionSnapshot {
  context: { activeCell: { row: number; col: number } };
  matches: (value: string) => boolean;
}

/**
 * Result of table selection coordination setup.
 */
export interface TableSelectionCoordinationResult {
  /** Cleanup function to unsubscribe */
  cleanup: () => void;
}

// =============================================================================
// COORDINATION SETUP
// =============================================================================

/**
 * Set up table selection coordination.
 *
 * Subscribes to selection actor and updates UIStore.tableDesign.selectedTableId
 * when the selection enters or exits a table. Only updates when selection is idle
 * to prevent cascading re-renders during drag operations.
 *
 * Pattern: Uses transition detection - only updates when selection settles (idle state)
 * and the active cell has actually changed position.
 *
 * @param config - Configuration with actors and uiStoreApi
 * @param cleanups - CleanupManager to register cleanup function
 * @returns Table selection coordination result
 */
export function setupTableSelectionCoordination(
  config: TableSelectionCoordinationConfig,
  cleanups: CleanupManager,
): TableSelectionCoordinationResult {
  const { actors, uiStoreApi, getActiveSheetId, workbook } = config;

  // Track previous active cell to detect changes
  let prevActiveCell = actors.selection.getSnapshot().context.activeCell;
  let hasPendingUpdate = false;
  let disposed = false;
  let refreshGeneration = 0;

  const isEventForActiveSheet = (event: unknown): boolean => {
    if (event == null || typeof event !== 'object' || !('sheetId' in event)) {
      return true;
    }
    const eventSheetId = (event as { sheetId?: unknown }).sheetId;
    return typeof eventSheetId !== 'string' || eventSheetId === getActiveSheetId();
  };

  const refreshSelectedTableAtActiveCell = (): void => {
    if (!workbook) return;

    const generation = ++refreshGeneration;
    const activeCell = actors.selection.getSnapshot().context.activeCell;
    const sheetId = getActiveSheetId();

    void (async () => {
      try {
        const ws = workbook.getSheetById(toSheetId(sheetId));
        const table = await ws.tables.getAtCell(activeCell.row, activeCell.col);
        if (disposed || generation !== refreshGeneration) return;

        const newTableId = table?.name ?? null;
        const currentTableId = uiStoreApi.getState().tableDesign.selectedTableId;
        if (currentTableId !== newTableId) {
          uiStoreApi.getState().setSelectedTable(newTableId);
        }
      } catch {
        if (disposed || generation !== refreshGeneration) return;

        const currentTableId = uiStoreApi.getState().tableDesign.selectedTableId;
        if (currentTableId !== null) {
          uiStoreApi.getState().setSelectedTable(null);
        }
      }
    })();
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
      refreshSelectedTableAtActiveCell();
    }
  });

  // A table can appear, move, resize, or disappear under the current active
  // cell without the selection actor emitting a new active-cell position.
  // Keep the contextual Table Design state tied to table topology too.
  const tableTopologyUnsubs =
    workbook?.on == null
      ? []
      : TABLE_TOPOLOGY_EVENTS.map((eventName) =>
          workbook.on(eventName, (event) => {
            if (isEventForActiveSheet(event)) {
              refreshSelectedTableAtActiveCell();
            }
          }),
        );

  // Changing sheets changes the coordinate space even when the active cell
  // position is numerically identical.
  const activeSheetUnsub = uiStoreApi.subscribe((state, previousState) => {
    if (state.activeSheetId !== previousState.activeSheetId) {
      prevActiveCell = actors.selection.getSnapshot().context.activeCell;
      hasPendingUpdate = false;
      refreshSelectedTableAtActiveCell();
    }
  });

  refreshSelectedTableAtActiveCell();

  const cleanup = () => {
    disposed = true;
    refreshGeneration++;
    selectionSub.unsubscribe();
    activeSheetUnsub();
    for (const unsub of tableTopologyUnsubs) {
      unsub();
    }
  };

  // Register cleanup with manager
  cleanups.register('tableSelectionCoordination', cleanup);

  return { cleanup };
}
