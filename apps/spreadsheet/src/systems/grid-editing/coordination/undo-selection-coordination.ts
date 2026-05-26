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
 * and stores it via wb.setPendingSelectionCheckpoint
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
 * - On **undo**: Restore selection from the pre-operation checkpoint
 * Also capture current selection as post-operation checkpoint for redo
 *
 * - On **redo**: Restore selection from the post-operation checkpoint
 *
 */

import { selectionSelectors } from '../../../selectors';
import type { SelectionCheckpoint } from '@mog-sdk/contracts/selection';

import type { WorkbookHistory } from '@mog-sdk/contracts/api';

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
 * via wb.setPendingSelectionCheckpoint() before mutations.
 *
 * @returns Cleanup function to remove subscriptions
 */
export function setupUndoSelectionCoordination(
  config: UndoSelectionCoordinationConfig,
): () => void {
  const { history, selectionActor } = config;

  // Local stacks mirroring the Rust undo/redo depth
  // Each entry is a selection checkpoint captured before/after an operation
  const undoSelections: SelectionCheckpoint[] = [];
  const redoSelections: SelectionCheckpoint[] = [];

  // Subscribe to undo state changes
  const sub = history.subscribe((event) => {
    const { trigger } = event;

    if (trigger === 'undo') {
      // Capture current selection for potential redo
      const currentSnapshot = selectionActor.getSnapshot();
      const currentSelection = currentSnapshot.context;
      const postCheckpoint: SelectionCheckpoint = {
        ranges: [...selectionSelectors.ranges(currentSnapshot)],
        activeCell: { ...currentSelection.activeCell },
        anchor: currentSelection.anchor ? { ...currentSelection.anchor } : null,
        direction: currentSelection.direction,
      };
      redoSelections.push(postCheckpoint);

      // Restore pre-operation selection from undo stack
      const checkpoint = undoSelections.pop();
      if (checkpoint) {
        selectionActor.send({
          type: 'SET_SELECTION',
          ranges: checkpoint.ranges,
          activeCell: checkpoint.activeCell,
          anchor: checkpoint.anchor,
        });
      }
    } else if (trigger === 'redo') {
      // Capture current selection for potential undo
      const currentSnapshot = selectionActor.getSnapshot();
      const currentSelection = currentSnapshot.context;
      const preCheckpoint: SelectionCheckpoint = {
        ranges: [...selectionSelectors.ranges(currentSnapshot)],
        activeCell: { ...currentSelection.activeCell },
        anchor: currentSelection.anchor ? { ...currentSelection.anchor } : null,
        direction: currentSelection.direction,
      };
      undoSelections.push(preCheckpoint);

      // Restore post-operation selection from redo stack
      const checkpoint = redoSelections.pop();
      if (checkpoint) {
        selectionActor.send({
          type: 'SET_SELECTION',
          ranges: checkpoint.ranges,
          activeCell: checkpoint.activeCell,
          anchor: checkpoint.anchor,
        });
      }
    } else if (trigger === 'push') {
      // Capture current selection as pre-operation checkpoint for the undo stack.
      // The push event fires synchronously from notifyForwardMutation() before
      // the action handler continues, so the selection actor still reflects the
      // position at mutation time — the correct checkpoint for undo restoration.
      undoSelections.push(captureSelectionCheckpoint(selectionActor));

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
export function captureSelectionCheckpoint(selectionActor: SelectionActor): SelectionCheckpoint {
  const snapshot = selectionActor.getSnapshot();
  const context = snapshot.context;

  return {
    ranges: selectionSelectors.ranges(snapshot),
    activeCell: context.activeCell,
    anchor: context.anchor,
    direction: context.direction,
  };
}
