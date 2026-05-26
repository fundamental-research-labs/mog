/**
 * CheckpointManager - Local Checkpoint Management using Rust Compute Engine
 *
 * Provides checkpoint functionality for AI agent operations:
 * - Create checkpoints before AI executes code
 * - Restore to checkpoint if user rejects changes
 * - List all checkpoints for inspection
 *
 * Delegates undo/redo to Workbook API (Rust compute engine)
 * instead of Yjs UndoManager.
 *
 * @example
 * ```typescript
 * const manager = new CheckpointManager(workbook);
 *
 * // Before AI operation
 * const checkpointId = await manager.create({ name: 'Before AI Edit' });
 *
 * // AI executes code, making changes...
 *
 * // User rejects changes
 * await manager.restore(checkpointId);
 *
 * // Or user accepts - delete checkpoint
 * manager.delete(checkpointId);
 * ```
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { Result } from '@mog-sdk/contracts/core';
import { ok, err } from '@mog/spreadsheet-utils/result';
import type { Checkpoint, CreateCheckpointOptions, RestoreCheckpointOptions } from './types';

// ============================================================================
// CheckpointManager
// ============================================================================

export class CheckpointManager {
  private workbook: Workbook;
  private checkpoints: Map<string, Checkpoint> = new Map();
  private nextId = 1;

  constructor(workbook: Workbook) {
    this.workbook = workbook;
  }

  // ==========================================================================
  // Core Operations
  // ==========================================================================

  /**
   * Create a checkpoint at the current state.
   *
   * This marks the current position in the undo history. Future changes
   * can be undone back to this point using restore().
   *
   * @param options - Optional configuration
   * @returns Checkpoint ID on success
   */
  async create(options: CreateCheckpointOptions = {}): Promise<Result<string>> {
    try {
      const undoState = await this.workbook.history.getState();

      const id = `checkpoint-${this.nextId++}-${Date.now()}`;
      const checkpoint: Checkpoint = {
        id,
        name: options.name ?? 'Checkpoint',
        timestamp: Date.now(),
        undoStackSize: undoState.undoDepth,
        redoStackSize: undoState.redoDepth,
      };

      this.checkpoints.set(id, checkpoint);

      return ok(id);
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Restore to a checkpoint.
   *
   * This undoes or redoes operations to return to the state when the
   * checkpoint was created. Works for both rollback (undo) and
   * rollforward (redo) scenarios.
   *
   * @param checkpointId - The checkpoint to restore to
   * @param options - Optional configuration
   * @returns Success/failure result
   */
  async restore(
    checkpointId: string,
    options: RestoreCheckpointOptions = {},
  ): Promise<Result<void>> {
    try {
      const checkpoint = this.checkpoints.get(checkpointId);
      if (!checkpoint) {
        return err(`Checkpoint not found: ${checkpointId}`);
      }

      const undoState = await this.workbook.history.getState();
      const currentUndoSize = undoState.undoDepth;
      const targetUndoSize = checkpoint.undoStackSize;

      if (currentUndoSize > targetUndoSize) {
        // Need to undo to reach checkpoint
        const undosNeeded = currentUndoSize - targetUndoSize;
        for (let i = 0; i < undosNeeded; i++) {
          const canUndo = await this.workbook.history.canUndo();
          if (!canUndo) {
            return err(`Cannot undo: only ${i} of ${undosNeeded} undos completed`);
          }
          await this.workbook.history.undo();
        }
      } else if (currentUndoSize < targetUndoSize) {
        // Need to redo to reach checkpoint (rollforward)
        const redosNeeded = targetUndoSize - currentUndoSize;
        for (let i = 0; i < redosNeeded; i++) {
          const canRedo = await this.workbook.history.canRedo();
          if (!canRedo) {
            return err(`Cannot redo: only ${i} of ${redosNeeded} redos completed`);
          }
          await this.workbook.history.redo();
        }
      }

      // Optionally clear later checkpoints
      if (options.clearLaterCheckpoints) {
        this.clearCheckpointsAfter(checkpoint.timestamp);
      }

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * List all checkpoints, sorted by creation time (newest first).
   *
   * @returns Array of checkpoints
   */
  list(): Checkpoint[] {
    return Array.from(this.checkpoints.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get a specific checkpoint by ID.
   *
   * @param checkpointId - The checkpoint ID
   * @returns The checkpoint, or undefined if not found
   */
  get(checkpointId: string): Checkpoint | undefined {
    return this.checkpoints.get(checkpointId);
  }

  /**
   * Delete a checkpoint.
   *
   * This only removes the checkpoint marker - it does not undo any changes.
   * Use this after changes are accepted and no longer need to be rolled back.
   *
   * @param checkpointId - The checkpoint to delete
   * @returns Success/failure result
   */
  delete(checkpointId: string): Result<void> {
    if (!this.checkpoints.has(checkpointId)) {
      return err(`Checkpoint not found: ${checkpointId}`);
    }
    this.checkpoints.delete(checkpointId);
    return ok(undefined);
  }

  /**
   * Clear all checkpoints.
   *
   * Use this when starting a fresh session or when checkpoints are no longer needed.
   */
  clear(): void {
    this.checkpoints.clear();
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Check if a checkpoint can be restored.
   *
   * A checkpoint may not be restorable if:
   * - The undo/redo stacks have been cleared
   * - Too many operations have occurred (stack overflow)
   *
   * @param checkpointId - The checkpoint to check
   * @returns true if the checkpoint can likely be restored
   */
  async canRestore(checkpointId: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) return false;

    const undoState = await this.workbook.history.getState();
    const currentUndoSize = undoState.undoDepth;
    const targetUndoSize = checkpoint.undoStackSize;

    if (currentUndoSize > targetUndoSize) {
      // Check if we can undo enough times
      return currentUndoSize - targetUndoSize <= currentUndoSize;
    } else if (currentUndoSize < targetUndoSize) {
      // Check if we can redo enough times
      return targetUndoSize - currentUndoSize <= undoState.redoDepth;
    }

    return true; // Already at checkpoint
  }

  /**
   * Get the number of operations between current state and a checkpoint.
   *
   * Positive = need to undo, negative = need to redo, 0 = at checkpoint.
   *
   * @param checkpointId - The checkpoint to measure from
   * @returns Number of operations, or null if checkpoint not found
   */
  async getDistance(checkpointId: string): Promise<number | null> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) return null;

    const undoState = await this.workbook.history.getState();
    return undoState.undoDepth - checkpoint.undoStackSize;
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  /**
   * Clear checkpoints created after a given timestamp.
   */
  private clearCheckpointsAfter(timestamp: number): void {
    for (const [id, checkpoint] of this.checkpoints) {
      if (checkpoint.timestamp > timestamp) {
        this.checkpoints.delete(id);
      }
    }
  }
}
