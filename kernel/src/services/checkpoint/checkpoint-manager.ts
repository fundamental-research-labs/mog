/**
 * CheckpointManager - Local Checkpoint Management using Rust Compute Engine
 *
 * Provides checkpoint functionality for AI agent operations:
 * - Create checkpoints before AI executes code
 * - Restore to checkpoint if user rejects changes
 * - List all checkpoints for inspection
 *
 * Delegates undo/redo replay to UndoService so checkpoint restore uses the
 * same mutation-result pipeline as public history operations.
 *
 * @example
 * ```typescript
 * const manager = new CheckpointManager(computeBridge);
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

import type { Result } from '../primitives';
import { ok, err } from '../primitives';
import type { ComputeBridge } from '../../bridges/compute/compute-bridge';
import type { IUndoService } from '@mog-sdk/contracts/services';
import type { IUndoReplayService } from '../undo';
import type {
  Checkpoint,
  CreateCheckpointOptions,
  ICheckpointManager,
  RestoreCheckpointOptions,
} from './types';

// ============================================================================
// CheckpointManager
// ============================================================================

class CheckpointManager implements ICheckpointManager {
  private computeBridge: ComputeBridge;
  private undoService?: IUndoService;
  private checkpoints: Map<string, Checkpoint> = new Map();
  private nextId = 1;

  constructor(computeBridge: ComputeBridge, undoService?: IUndoService) {
    this.computeBridge = computeBridge;
    this.undoService = undoService;
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
      const undoState = await this.computeBridge.getUndoState();

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
   * Create a checkpoint synchronously with a caller-provided ID.
   *
   * Registers the checkpoint in the Map immediately so that restore()
   * can find it. The undo/redo stack sizes are initially set to 0 and
   * hydrated asynchronously. The checkpoint's `hydrated` promise resolves
   * once the true undo/redo counts have been written. All async consumers
   * (restore, canRestore, getDistance) await this promise before reading
   * the values, so callers do not need to handle the race themselves.
   *
   * @param id - The checkpoint ID to register
   * @param options - Optional configuration
   * @returns The checkpoint ID
   */
  createSync(id: string, options: CreateCheckpointOptions = {}): string {
    const checkpoint: Checkpoint = {
      id,
      name: options.name ?? 'Checkpoint',
      timestamp: Date.now(),
      undoStackSize: 0,
      redoStackSize: 0,
    };

    // Hydrate undo/redo counts asynchronously. The `hydrated` promise lets
    // consumers (restore, canRestore, getDistance) await accurate values
    // before acting on them, eliminating the race condition where stale 0/0
    // placeholders would cause incorrect undo/redo counts.
    checkpoint.hydrated = this.computeBridge.getUndoState().then((undoState) => {
      checkpoint.undoStackSize = undoState.undoDepth;
      checkpoint.redoStackSize = undoState.redoDepth;
    });

    this.checkpoints.set(id, checkpoint);

    return id;
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

      // Ensure undo/redo counts are fully hydrated before we use them.
      // This is a no-op for checkpoints created via `create()` (no hydrated field).
      await checkpoint.hydrated;

      const undoState = await this.computeBridge.getUndoState();
      const currentUndoSize = undoState.undoDepth;
      const targetUndoSize = checkpoint.undoStackSize;

      if (currentUndoSize !== targetUndoSize) {
        const replayResult = await this.replayToUndoDepth(targetUndoSize);
        if (!replayResult.ok) return replayResult;
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

  private async replayToUndoDepth(targetUndoSize: number): Promise<Result<void>> {
    const replayService = this.undoService as IUndoReplayService | undefined;
    if (replayService?.replayToUndoDepth) {
      const result = await replayService.replayToUndoDepth(targetUndoSize);
      if (result.ok) return ok(undefined);
      return err('reason' in result.error ? result.error.reason : result.error.type);
    }

    const undoState = await this.computeBridge.getUndoState();
    const currentUndoSize = undoState.undoDepth;
    if (currentUndoSize > targetUndoSize) {
      const undosNeeded = currentUndoSize - targetUndoSize;
      for (let i = 0; i < undosNeeded; i++) {
        const result = await this.undoService?.undo();
        if (!result?.ok)
          return err(result ? this.formatUndoError(result.error) : 'Undo service unavailable');
      }
    } else if (currentUndoSize < targetUndoSize) {
      const redosNeeded = targetUndoSize - currentUndoSize;
      for (let i = 0; i < redosNeeded; i++) {
        const result = await this.undoService?.redo();
        if (!result?.ok)
          return err(result ? this.formatUndoError(result.error) : 'Undo service unavailable');
      }
    }

    return ok(undefined);
  }

  private formatUndoError(error: { type: string; reason?: string }): string {
    return error.type === 'rust-failed' ? (error.reason ?? error.type) : error.type;
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

    await checkpoint.hydrated;

    const undoState = await this.computeBridge.getUndoState();
    const currentUndoSize = undoState.undoDepth;
    const targetUndoSize = checkpoint.undoStackSize;

    if (currentUndoSize > targetUndoSize) {
      return currentUndoSize - targetUndoSize <= currentUndoSize;
    } else if (currentUndoSize < targetUndoSize) {
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

    await checkpoint.hydrated;

    const undoState = await this.computeBridge.getUndoState();
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

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Dispose the checkpoint manager and clear all checkpoint state.
   */
  dispose(): void {
    this.checkpoints.clear();
    this.nextId = 1;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new CheckpointManager instance.
 *
 * @param computeBridge - The compute bridge for undo/redo operations
 * @returns A new CheckpointManager
 */
export function createCheckpointManager(
  computeBridge: ComputeBridge,
  undoService?: IUndoService,
): ICheckpointManager {
  return new CheckpointManager(computeBridge, undoService);
}
