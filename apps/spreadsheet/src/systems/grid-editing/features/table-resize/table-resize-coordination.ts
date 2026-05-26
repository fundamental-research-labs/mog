/**
 * Table Resize Coordinator
 *
 * Wires the table resize operation to the Tables domain module.
 * This coordinator subscribes to selection machine state transitions and
 * executes table resize when the resize drag ends.
 *
 * Architecture:
 * - Selection machine owns state (tableResizeId, tableResizeTargetRow/Col)
 * - Coordinator executes side effects (calls Tables.resizeTable)
 *
 * Flow:
 * 1. User drags table resize handle -> selection machine tracks resize state
 * 2. User releases -> END_TABLE_RESIZE -> transition to idle
 * 3. Coordinator detects transition, reads resize state
 * 4. Coordinator calls Tables.TablesOperations.tables.resize() via Mutations
 * 5. Coordinator sends CLEAR_TABLE_RESIZE to clean up machine state
 *
 * Tables - 10.4 Table Resize Handle
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import type { SelectionActor, SelectionState } from '../../../shared/actor-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies needed by TableResizeCoordinator.
 * Injected from SheetCoordinator.
 */
export interface TableResizeCoordinatorDependencies {
  /** Selection machine actor */
  selectionActor: SelectionActor;
  /** Workbook for unified API access */
  workbook: Workbook;
  /** Active sheet ID getter */
  getActiveSheetId: () => SheetId;
  /** Callback when table changes (for renderer invalidation) */
  onTableChanged?: (sheetId: SheetId) => void;
}

// =============================================================================
// Table Resize Coordinator
// =============================================================================

/**
 * TableResizeCoordinator - Wires Table Resize to Tables Domain
 *
 * Follows the coordinator pattern:
 * - Selection machine owns state
 * - Coordinator owns execution
 *
 * Usage:
 * ```typescript
 * const tableResizeCoordinator = new TableResizeCoordinator();
 * tableResizeCoordinator.setDependencies({ selectionActor, workbook, ... });
 *
 * // Coordinator auto-subscribes and executes resizes
 *
 * // Clean up
 * tableResizeCoordinator.dispose();
 * ```
 */
export class TableResizeCoordinator {
  /** Dependencies (injected) */
  private deps: TableResizeCoordinatorDependencies | null = null;

  /** Subscription object for cleanup */
  private subscription: { unsubscribe: () => void } | null = null;

  /** Previous state to detect transitions */
  private previousState: SelectionState | null = null;

  /**
   * Set dependencies and start subscriptions.
   * Called by SheetCoordinator when Yjs refs are available.
   */
  setDependencies(deps: TableResizeCoordinatorDependencies): void {
    this.deps = deps;
    this.setupSubscription();
  }

  /**
   * Subscribe to selection machine state changes.
   * Detects END_TABLE_RESIZE transitions and executes table resize.
   */
  private setupSubscription(): void {
    if (!this.deps) return;

    const { selectionActor } = this.deps;

    // Subscribe to state changes
    this.subscription = selectionActor.subscribe((state) => {
      this.handleStateChange(state);
    });

    // Initialize previous state
    this.previousState = selectionActor.getSnapshot();
  }

  /**
   * Handle selection machine state changes.
   * Detect transition OUT of resizingTable state -> execute table resize.
   */
  private handleStateChange(currentState: SelectionState): void {
    if (!this.deps || !this.previousState) {
      this.previousState = currentState;
      return;
    }

    const wasResizing = this.previousState.matches('resizingTable');
    const isResizing = currentState.matches('resizingTable');

    // Detect transition: resizingTable -> NOT resizingTable
    // This happens on END_TABLE_RESIZE (not CANCEL_TABLE_RESIZE which clears state)
    if (wasResizing && !isResizing) {
      // Read resize state from PREVIOUS state (before transition)
      const { tableResizeId, tableResizeStartBounds, tableResizeTargetRow, tableResizeTargetCol } =
        this.previousState.context;

      // Only execute if we have valid resize state
      // CANCEL_TABLE_RESIZE clears state before transition, so this check handles it
      if (
        tableResizeId !== null &&
        tableResizeStartBounds !== null &&
        tableResizeTargetRow !== null &&
        tableResizeTargetCol !== null
      ) {
        this.executeResize(
          tableResizeId,
          tableResizeStartBounds.startRow,
          tableResizeStartBounds.startCol,
          tableResizeTargetRow,
          tableResizeTargetCol,
        );
      }
    }

    this.previousState = currentState;
  }

  /**
   * Execute the table resize.
   */
  private executeResize(
    tableId: string,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): void {
    if (!this.deps) return;

    const { workbook, getActiveSheetId, selectionActor, onTableChanged } = this.deps;
    const sheetId = getActiveSheetId();
    const ws = workbook.getSheetById(sheetId);

    // Calculate the new range as A1 notation for the Worksheet API
    const newRangeA1 = `${toA1(startRow, startCol)}:${toA1(endRow, endCol)}`;

    // Fire-and-forget via Worksheet API
    void ws.tables
      .resize(tableId, newRangeA1)
      .then(() => {
        // Notify renderer to invalidate
        onTableChanged?.(sheetId);
      })
      .catch((error: unknown) => {
        // Log but don't throw - resize may fail due to overlap with other tables
        console.warn('Table resize failed:', error);
      });

    // Clear resize state in selection machine
    selectionActor.send({ type: 'CLEAR_TABLE_RESIZE' });
  }

  /**
   * Clean up subscriptions.
   */
  dispose(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.previousState = null;
    this.deps = null;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new TableResizeCoordinator instance.
 */
export function createTableResizeCoordinator(): TableResizeCoordinator {
  return new TableResizeCoordinator();
}
