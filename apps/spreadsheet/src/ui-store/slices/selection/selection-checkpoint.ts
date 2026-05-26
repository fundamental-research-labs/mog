/**
 * Selection Checkpoint Slice
 *
 * Manages selection checkpointing for undo/redo operations.
 * When an undo/redo occurs, the selection is restored to where it was
 * when the operation was originally performed.
 *
 * ARCHITECTURE NOTES:
 * - Selection checkpoints are stored in Yjs UndoManager stack item metadata
 * - This slice provides the API to get/set pending selection checkpoints
 * - The checkpoint is captured BEFORE mutations, stored with the stack item
 * - On undo/redo (stack-item-popped), the checkpoint is read and restored
 *
 */

import type { StateCreator } from 'zustand';

import type { SelectionCheckpoint as ContractSelectionCheckpoint } from '@mog-sdk/contracts/selection';

// Re-export SelectionCheckpoint for backward compatibility
export type SelectionCheckpoint = ContractSelectionCheckpoint;

// =============================================================================
// Slice Interface
// =============================================================================

export interface SelectionCheckpointSlice {
  /**
   * Pending selection checkpoint to be attached to the next undo stack item.
   * Set BEFORE performing an operation, consumed by UndoManager listener.
   */
  pendingSelectionCheckpoint: SelectionCheckpoint | null;

  /**
   * Set the pending selection checkpoint.
   * Call this BEFORE performing an operation that creates an undo point.
   */
  setPendingSelectionCheckpoint: (checkpoint: SelectionCheckpoint | null) => void;

  /**
   * Get and clear the pending selection checkpoint (consumed by UndoManager).
   */
  consumePendingSelectionCheckpoint: () => SelectionCheckpoint | null;
}

// =============================================================================
// Slice Implementation
// =============================================================================

export const createSelectionCheckpointSlice: StateCreator<
  SelectionCheckpointSlice,
  [],
  [],
  SelectionCheckpointSlice
> = (set, get) => ({
  pendingSelectionCheckpoint: null,

  setPendingSelectionCheckpoint: (checkpoint: SelectionCheckpoint | null) => {
    set({ pendingSelectionCheckpoint: checkpoint });
  },

  consumePendingSelectionCheckpoint: () => {
    const checkpoint = get().pendingSelectionCheckpoint;
    if (checkpoint) {
      set({ pendingSelectionCheckpoint: null });
    }
    return checkpoint;
  },
});
