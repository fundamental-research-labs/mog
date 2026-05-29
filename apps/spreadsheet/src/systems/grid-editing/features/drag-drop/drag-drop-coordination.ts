/**
 * Drag-Drop Coordinator (Cut-Paste Formula Update
 *
 * Wires cell drag-drop operations to the cell relocation (move) or copy logic.
 * This coordinator subscribes to selection machine state transitions and
 * executes move/copy operations when the drag ends.
 *
 * Architecture:
 * - Selection machine owns state (dragSourceRange, dragTargetCell, dragMode)
 * - Coordinator executes side effects (calls relocateCells or copy logic)
 *
 * Flow:
 * 1. User drags cells → selection machine tracks dragSourceRange, dragTargetCell, dragMode
 * 2. User releases → END_DRAG_CELLS → transition to idle
 * 3. Coordinator detects transition, reads dragSourceRange/dragTargetCell/dragMode
 * 4. If dragMode === 'move': calls Cells._internal.relocateCells() to preserve CellIds
 * 5. If dragMode === 'copy': creates new cells at target (copy logic)
 * 6. Coordinator updates selection to new location
 * 7. Coordinator sends CLEAR_DRAG_CELLS to clean up machine state
 *
 * Key Insight: Using Cells._internal.relocateCells() for move preserves CellIds, so formulas
 * referencing the moved cells automatically update (they reference CellIds, not positions).
 *
 * @see docs/renderer/README.md - Coordinator Pattern
 */

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { StoreApi } from 'zustand';

import type { SelectionActor, SelectionState } from '../../../shared/actor-types';
import type { GridEditingUIStore } from '../../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies needed by DragDropCoordinator.
 * Injected from SheetCoordinator.
 */
/**
 * Result from an executeMove operation (mirrored from coordinator/mutations/drag-drop).
 * DAG Violation Fix - types inlined to avoid importing from coordinator/mutations.
 */
interface MoveResult {
  success: boolean;
  movedCount: number;
  error?: string;
}

/**
 * Result from an executeCopy operation (mirrored from coordinator/mutations/drag-drop).
 */
interface CopyResult {
  success: boolean;
  copiedCount: number;
  error?: string;
}

export interface DragDropCoordinatorDependencies {
  /** Selection machine actor */
  selectionActor: SelectionActor;
  /** Workbook for unified API access */
  workbook?: Workbook;
  /** Active sheet ID getter */
  getActiveSheetId: () => SheetId;
  /** UI store for dialog management */
  uiStore?: StoreApi<GridEditingUIStore>;
  /** Callback when cells change (for renderer invalidation) */
  onCellsChanged?: (sheetId: SheetId) => void;
  /** Action dependencies builder for dispatch() calls */
  getActionDependencies?: () => ActionDependencies;
  /** Action dispatch function (injected to avoid actions/ dependency) */
  dispatch?: (action: string, deps: ActionDependencies, payload?: unknown) => unknown;
  /**
   * Execute a MOVE operation using relocateCells (preserves CellIds).
   * Injected from coordinator layer.
   */
  executeMove: (
    sheetId: SheetId,
    sourceRange: CellRange,
    targetCell: CellCoord,
  ) => MoveResult | Promise<MoveResult>;
  /**
   * Execute a COPY operation by creating new cells.
   * Injected from coordinator layer.
   */
  executeCopy: (
    sheetId: SheetId,
    sourceRange: CellRange,
    targetCell: CellCoord,
  ) => CopyResult | Promise<CopyResult>;
}

/**
 * Result from a drag-drop operation.
 */
export interface DragDropResult {
  success: boolean;
  movedCount: number;
  copiedCount: number;
  mode: 'move' | 'copy';
  error?: string;
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Check if a range entirely contains a merge region.
 * Used to validate that a drop operation won't partially overwrite a merge.
 */
function isEntireMergeInRange(
  merge: { start_row: number; start_col: number; end_row: number; end_col: number },
  targetRange: { startRow: number; startCol: number; endRow: number; endCol: number },
): boolean {
  return (
    merge.start_row >= targetRange.startRow &&
    merge.end_row <= targetRange.endRow &&
    merge.start_col >= targetRange.startCol &&
    merge.end_col <= targetRange.endCol
  );
}

/**
 * Validate if a drop target is valid (doesn't partially overwrite merged cells).
 * Returns validation result with optional reason for invalidity.
 *
 * Uses Worksheet API getMergedRegions() for merge detection.
 *
 * Exported for use in cursor feedback during drag operations.
 * @see use-grid-mouse.ts - Uses this for not-allowed cursor during invalid drop
 */
export async function isValidDropTarget(
  sheetId: SheetId,
  sourceRange: CellRange,
  targetCell: CellCoord,
  workbook?: Workbook,
): Promise<{ valid: boolean; reason?: string }> {
  // Calculate target range from source dimensions + target start
  const targetRange = {
    startRow: targetCell.row,
    startCol: targetCell.col,
    endRow: targetCell.row + (sourceRange.endRow - sourceRange.startRow),
    endCol: targetCell.col + (sourceRange.endCol - sourceRange.startCol),
  };

  // Use Worksheet API to get merged regions
  if (!workbook) return { valid: true };
  const ws = workbook.getSheetById(sheetId);
  const mergedRegions = await ws.structure.getMergedRegions();

  for (const region of mergedRegions) {
    // Check if this merge overlaps with the target range
    const overlaps = !(
      region.endRow < targetRange.startRow ||
      region.startRow > targetRange.endRow ||
      region.endCol < targetRange.startCol ||
      region.startCol > targetRange.endCol
    );
    if (!overlaps) continue;

    const merge = {
      start_row: region.startRow,
      start_col: region.startCol,
      end_row: region.endRow,
      end_col: region.endCol,
    };
    if (!isEntireMergeInRange(merge, targetRange)) {
      return {
        valid: false,
        reason: 'Cannot drop onto partial merged cells',
      };
    }
  }

  return { valid: true };
}

/**
 * Check if target range contains any non-empty cells.
 * Used to determine if overwrite warning should be shown.
 *
 * Uses Worksheet API getRange() to check for non-empty cells.
 */
async function hasDataAtTarget(
  sheetId: SheetId,
  targetRange: { startRow: number; startCol: number; endRow: number; endCol: number },
  workbook?: Workbook,
): Promise<boolean> {
  if (!workbook) return false;
  const ws = workbook.getSheetById(sheetId);
  const rangeData = await ws.getRange(
    targetRange.startRow,
    targetRange.startCol,
    targetRange.endRow,
    targetRange.endCol,
  );
  // Check if any cell has non-empty data
  for (const row of rangeData) {
    for (const cell of row) {
      if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
        return true;
      }
    }
  }
  return false;
}

// =============================================================================
// Drag-Drop Coordinator
// =============================================================================

/**
 * DragDropCoordinator - Wires Cell Drag to Move/Copy Logic
 *
 * Follows the coordinator pattern:
 * - Selection machine owns state
 * - Coordinator owns execution
 *
 * Usage:
 * ```typescript
 * const dragDropCoordinator = new DragDropCoordinator();
 * dragDropCoordinator.setDependencies({ selectionActor, workbook, ... });
 *
 * // Coordinator auto-subscribes and executes drag-drop
 *
 * // Clean up
 * dragDropCoordinator.dispose();
 * ```
 */
export class DragDropCoordinator {
  /** Dependencies (injected) */
  private deps: DragDropCoordinatorDependencies | null = null;

  /** Subscription object for cleanup */
  private subscription: { unsubscribe: () => void } | null = null;

  /** Previous selection state for transition detection */
  private previousState: SelectionState | null = null;

  /** Last drag-drop result for debugging */
  private lastResult: DragDropResult | null = null;

  /** Pending drop operation (waiting for overwrite confirmation) */
  private pendingDrop: {
    sourceRange: CellRange;
    targetCell: CellCoord;
    mode: 'move' | 'copy';
    sheetId: SheetId;
  } | null = null;

  constructor() {
    // Dependencies injected via setDependencies()
  }

  // ===========================================================================
  // DEPENDENCY INJECTION
  // ===========================================================================

  /**
   * Set dependencies and start subscribing to selection machine.
   * Call this from SheetCoordinator after actors are created.
   */
  setDependencies(deps: DragDropCoordinatorDependencies): void {
    // Clean up previous subscription if any
    this.dispose();

    this.deps = deps;
    this.previousState = deps.selectionActor.getSnapshot();

    // Subscribe to selection machine state changes
    this.subscription = deps.selectionActor.subscribe((state) => {
      this.onStateChange(state);
    });
  }

  /**
   * Check if dependencies are set.
   */
  hasDependencies(): boolean {
    return this.deps !== null;
  }

  /**
   * Clean up subscription.
   */
  dispose(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.previousState = null;
  }

  // ===========================================================================
  // STATE CHANGE HANDLER
  // ===========================================================================

  /**
   * Handle selection machine state changes.
   * Detects transitions from draggingCells to idle and executes move/copy.
   */
  private onStateChange(state: SelectionState): void {
    if (!this.deps || !this.previousState) {
      this.previousState = state;
      return;
    }

    // Detect transition from draggingCells to idle
    const wasDraggingCells = this.previousState.matches('draggingCells');
    const isNowIdle = state.matches('idle');

    if (wasDraggingCells && isNowIdle) {
      // Drag ended - execute move or copy
      // IMPORTANT: Read context from PREVIOUS state (before transition cleared it)
      this.executeDragDropOperation(this.previousState);
    }

    this.previousState = state;
  }

  // ===========================================================================
  // DRAG-DROP EXECUTION
  // ===========================================================================

  /**
   * Execute the drag-drop operation based on previous state context.
   *
   * This is called when the selection machine transitions from
   * draggingCells to idle (user released mouse).
   */
  private async executeDragDropOperation(previousState: SelectionState): Promise<void> {
    if (!this.deps) return;

    const { dragSourceRange, dragTargetCell, dragMode } = previousState.context;

    // Validate we have the required context
    if (!dragSourceRange || !dragTargetCell) {
      // No drag context - may have been cancelled via Escape
      this.clearDragContext();
      return;
    }

    // Check if target is same as source (no actual move)
    if (
      dragTargetCell.row === dragSourceRange.startRow &&
      dragTargetCell.col === dragSourceRange.startCol
    ) {
      // User didn't actually move - no operation needed
      this.clearDragContext();
      return;
    }

    const sheetId = this.deps.getActiveSheetId();

    // D.1: Validate drop target (check for partial merge conflicts)
    const validation = await isValidDropTarget(
      sheetId,
      dragSourceRange,
      dragTargetCell,
      this.deps.workbook,
    );
    if (!validation.valid) {
      console.warn('[DragDropCoordinator] Invalid drop target:', validation.reason);
      this.lastResult = {
        success: false,
        movedCount: 0,
        copiedCount: 0,
        mode: dragMode ?? 'move',
        error: validation.reason,
      };
      this.clearDragContext();
      return;
    }

    // Calculate target range for overwrite check
    const targetRange = {
      startRow: dragTargetCell.row,
      startCol: dragTargetCell.col,
      endRow: dragTargetCell.row + (dragSourceRange.endRow - dragSourceRange.startRow),
      endCol: dragTargetCell.col + (dragSourceRange.endCol - dragSourceRange.startCol),
    };

    // Store drop info for execution
    this.pendingDrop = {
      sourceRange: dragSourceRange,
      targetCell: dragTargetCell,
      mode: dragMode ?? 'move',
      sheetId,
    };

    // D.2: Check for data overwrite
    if (await hasDataAtTarget(sheetId, targetRange, this.deps.workbook)) {
      // Show overwrite confirmation dialog via dispatch()
      // The dialog will call CONFIRM_DRAG_DROP_OVERWRITE or CANCEL_DRAG_DROP_OVERWRITE
      // which will execute or cancel the drop via action handlers
      if (this.deps.getActionDependencies) {
        const actionDeps = this.deps.getActionDependencies();
        this.deps!.dispatch?.('SHOW_DRAG_DROP_OVERWRITE_DIALOG', actionDeps, {
          sourceRange: dragSourceRange,
          targetCell: dragTargetCell,
          mode: dragMode ?? 'move',
          sheetId,
        });
        // Don't execute drop here - wait for user confirmation via dialog
        // Clear the drag context but keep pending drop for the handler
        this.clearDragContext();
        return;
      }

      // Fallback: If no action dependencies available, proceed with overwrite
      console.warn(
        '[DragDropCoordinator] Target has data but no action deps - proceeding with overwrite',
      );
      await this.executeDropConfirmed();
      return;
    }

    // No conflicts - execute drop directly
    await this.executeDropConfirmed();
  }

  /**
   * Execute the confirmed drop operation.
   * Called either directly (no conflicts) or after user confirmation (data overwrite).
   */
  private async executeDropConfirmed(): Promise<void> {
    if (!this.deps) return;

    const dropInfo = this.pendingDrop;
    if (!dropInfo) return;

    const { sourceRange, targetCell, mode, sheetId } = dropInfo;

    const success =
      mode === 'move'
        ? await this.executeMove(sheetId, sourceRange, targetCell)
        : await this.executeCopy(sheetId, sourceRange, targetCell);

    if (!success) {
      this.pendingDrop = null;
      this.clearDragContext();
      return;
    }

    // Update selection to new location
    const rangeWidth = sourceRange.endCol - sourceRange.startCol;
    const rangeHeight = sourceRange.endRow - sourceRange.startRow;
    const newRange: CellRange = {
      sheetId,
      startRow: targetCell.row,
      startCol: targetCell.col,
      endRow: targetCell.row + rangeHeight,
      endCol: targetCell.col + rangeWidth,
    };

    this.deps.selectionActor.send({
      type: 'SET_SELECTION',
      ranges: [newRange],
      activeCell: targetCell,
    });

    // Clear pending drop and drag context
    this.pendingDrop = null;
    this.clearDragContext();

    // Notify of changes (renderer invalidation)
    this.deps.onCellsChanged?.(sheetId);
    // NOTE: triggerRecalc is no longer called - handled by Mutations layer via Yjs observers
  }

  /**
   * Cancel the pending drop operation.
   * Called when user cancels the overwrite dialog.
   *
   * Public for future use by dialog component.
   */
  public cancelDrop(): void {
    this.pendingDrop = null;
    this.clearDragContext();
  }

  /**
   * Execute a MOVE operation using relocateCells.
   * Preserves CellIds so formulas automatically follow.
   */
  private async executeMove(
    sheetId: SheetId,
    sourceRange: CellRange,
    targetCell: CellCoord,
  ): Promise<boolean> {
    const result = await this.deps!.executeMove(sheetId, sourceRange, targetCell);

    this.lastResult = {
      success: result.success,
      movedCount: result.movedCount,
      copiedCount: 0,
      mode: 'move',
      error: result.error,
    };

    if (!result.success) {
      console.warn('[DragDropCoordinator] Move failed:', result.error);
    }
    return result.success;
  }

  /**
   * Execute a COPY operation by creating new cells.
   * Creates new CellIds - source cells are unchanged.
   *
   * Also copies validation rules from source cells to target cells.
   * Since drag-copy creates new CellIds, we must explicitly copy validation schemas.
   */
  private async executeCopy(
    sheetId: SheetId,
    sourceRange: CellRange,
    targetCell: CellCoord,
  ): Promise<boolean> {
    const result = await this.deps!.executeCopy(sheetId, sourceRange, targetCell);

    this.lastResult = {
      success: result.success,
      movedCount: 0,
      copiedCount: result.copiedCount,
      mode: 'copy',
      error: result.error,
    };
    if (!result.success) {
      console.warn('[DragDropCoordinator] Copy failed:', result.error);
    }
    return result.success;
  }

  /**
   * Send CLEAR_DRAG_CELLS to selection machine.
   */
  private clearDragContext(): void {
    if (!this.deps) return;
    // The machine clears on CANCEL_DRAG_CELLS, but for normal end we need
    // to manually send it after we've read the context
    this.deps.selectionActor.send({ type: 'CANCEL_DRAG_CELLS' });
  }

  // ===========================================================================
  // ACCESSORS
  // ===========================================================================

  /**
   * Get the last drag-drop result for debugging.
   */
  getLastResult(): DragDropResult | null {
    return this.lastResult;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new DragDropCoordinator instance.
 */
export function createDragDropCoordinator(): DragDropCoordinator {
  return new DragDropCoordinator();
}
