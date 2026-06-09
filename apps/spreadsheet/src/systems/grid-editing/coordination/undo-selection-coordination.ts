/**
 * Undo Selection Coordination
 *
 * Manages selection state restoration for undo/redo operations.
 * When an undo/redo occurs, the selection is restored to where it was
 * when the operation was originally performed, matching Excel behavior.
 *
 * ## Architecture
 *
 * Selection checkpoints flow through three stages:
 *
 * 1. **Capture**: Before each mutation, the caller captures current selection
 * and exposes it through consumePendingSelectionCheckpoint.
 *
 * 2. **Attach**: When the UndoService receives a mutation notification,
 * the pending checkpoint is consumed and stored in a local stack
 * (previously stored in Yjs UndoManager stack item metadata)
 *
 * 3. **Restore**: When undo/redo is triggered, THIS coordination reads
 * the checkpoint from the local stack and restores selection via the
 * selection actor
 *
 * ## Undo vs Redo Selection
 *
 * - On **undo**: Restore selection from the operation checkpoint and move it
 * to the redo stack
 *
 * - On **redo**: Restore selection from the same operation checkpoint and move
 * it back to the undo stack
 *
 */

import { selectionSelectors } from '../../../selectors';
import type { SelectionCheckpoint } from '@mog-sdk/contracts/selection';

import type { WorkbookHistory } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId, type CellRange, type SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import type { SelectionActor } from './cross-coordination';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for undo-selection coordination.
 */
export interface UndoSelectionCoordinationConfig {
  /** Workbook history sub-API (provides subscribe for undo/redo state changes) */
  history: WorkbookHistory;
  /** Selection actor to restore selection on undo/redo */
  selectionActor: SelectionActor;
  /** Current active sheet ID at the time an undoable operation is pushed */
  getActiveSheetId?: () => SheetId | string;
  /** Switch to the sheet associated with a restored checkpoint */
  setActiveSheet?: (sheetId: SheetId) => void;
  /** Prime per-sheet view state before switching, preventing async restore overwrite */
  primeSheetViewState?: (sheetId: SheetId, checkpoint: SelectionCheckpoint) => void;
  /** Consume a checkpoint captured before the mutation that produced the history item. */
  consumePendingSelectionCheckpoint?: () => SelectionCheckpoint | null;
}

// =============================================================================
// Setup Function
// =============================================================================

/**
 * Set up undo-selection coordination.
 *
 * This subscribes to the UndoService state changes and restores selection
 * when undo/redo operations occur.
 *
 * Note: The capture side (storing checkpoints) is handled by callers
 * via consumePendingSelectionCheckpoint before mutations.
 *
 * @returns Cleanup function to remove subscriptions
 */
export function setupUndoSelectionCoordination(
  config: UndoSelectionCoordinationConfig,
): () => void {
  const { history, selectionActor, getActiveSheetId } = config;

  // Local stacks mirroring the Rust undo/redo depth
  // Each entry is a selection checkpoint captured before/after an operation
  const undoSelections: SelectionCheckpoint[] = [];
  const redoSelections: SelectionCheckpoint[] = [];

  // Subscribe to undo state changes
  const sub = history.subscribe((event) => {
    const { trigger } = event;

    if (trigger === 'undo') {
      // Move the original operation checkpoint to redo. Sampling the current
      // cursor during replay would bind redo to whichever sheet the user is on.
      const checkpoint = undoSelections.pop();
      if (checkpoint) {
        redoSelections.push(checkpoint);
        restoreSelectionCheckpoint(checkpoint, config);
      }
    } else if (trigger === 'redo') {
      // Move the original operation checkpoint back to undo so future undo/redo
      // cycles keep targeting the operation's sheet, not the replay location.
      const checkpoint = redoSelections.pop();
      if (checkpoint) {
        undoSelections.push(checkpoint);
        restoreSelectionCheckpoint(checkpoint, config);
      }
    } else if (trigger === 'push') {
      const pendingCheckpoint = config.consumePendingSelectionCheckpoint?.() ?? null;
      undoSelections.push(
        pendingCheckpoint ?? captureSelectionCheckpoint(selectionActor, getActiveSheetId),
      );

      // Clear redo selections on new operation (redo path is invalidated)
      redoSelections.length = 0;
    } else if (trigger === 'clear') {
      // All history cleared
      undoSelections.length = 0;
      redoSelections.length = 0;
    }
  });

  // Return cleanup function (CallableDisposable is directly callable)
  return sub;
}

// =============================================================================
// Helper: Capture Selection Checkpoint
// =============================================================================

/**
 * Capture the current selection state as a checkpoint.
 *
 * Call this BEFORE performing an operation that creates an undo point.
 * The captured checkpoint will be associated with the undo stack item.
 *
 * @param selectionActor - The selection actor to capture state from
 * @returns SelectionCheckpoint to store
 */
export function captureSelectionCheckpoint(
  selectionActor: SelectionActor,
  getActiveSheetId?: () => SheetId | string,
): SelectionCheckpoint {
  const snapshot = selectionActor.getSnapshot();
  const context = snapshot.context;

  return {
    sheetId: getActiveSheetId ? toSheetId(getActiveSheetId()) : undefined,
    ranges: cloneRanges(selectionSelectors.ranges(snapshot)),
    activeCell: cloneCell(context.activeCell),
    anchor: context.anchor ? cloneCell(context.anchor) : null,
    direction: context.direction,
  };
}

function restoreSelectionCheckpoint(
  checkpoint: SelectionCheckpoint,
  config: UndoSelectionCoordinationConfig,
): void {
  const targetSheetId = checkpoint.sheetId ? toSheetId(checkpoint.sheetId) : null;

  if (targetSheetId && config.setActiveSheet && config.getActiveSheetId) {
    const activeSheetId = toSheetId(config.getActiveSheetId());

    if (targetSheetId !== activeSheetId) {
      config.primeSheetViewState?.(targetSheetId, checkpoint);
      config.setActiveSheet(targetSheetId);
    }
  }

  config.selectionActor.send({
    type: 'SET_SELECTION',
    ranges: cloneRanges(checkpoint.ranges),
    activeCell: cloneCell(checkpoint.activeCell),
    anchor: checkpoint.anchor ? cloneCell(checkpoint.anchor) : null,
  });
}

function cloneRanges(ranges: CellRange[]): CellRange[] {
  return ranges.map((range) => ({ ...range }));
}

function cloneCell(cell: CellCoord): CellCoord {
  return { row: cell.row, col: cell.col };
}
