/**
 * Checkpoint Types
 *
 * Type definitions for local checkpointing using Rust compute engine undo/redo.
 * This enables save/restore functionality for AI agent operations.
 */

// ============================================================================
// Checkpoint
// ============================================================================

/**
 * A checkpoint represents a saved position in the undo history.
 * Used for rollback/rollforward operations during AI interactions.
 */
export interface Checkpoint {
  /** Unique checkpoint identifier */
  id: string;
  /** Human-readable name for the checkpoint */
  name: string;
  /** Creation timestamp (ms since epoch) */
  timestamp: number;
  /** Undo stack size at creation time */
  undoStackSize: number;
  /** Redo stack size at creation time (for rollforward) */
  redoStackSize: number;
  /**
   * Resolves when undoStackSize/redoStackSize have been hydrated from the
   * compute bridge. Present only on checkpoints created via `createSync()`,
   * where the undo state is fetched asynchronously after the synchronous
   * return. Callers that need accurate undo/redo counts (e.g. `restore()`)
   * must await this before reading the values.
   */
  hydrated?: Promise<void>;
}

// ============================================================================
// Options
// ============================================================================

/**
 * Options for creating a checkpoint.
 */
export interface CreateCheckpointOptions {
  /** Optional human-readable name (default: "Checkpoint") */
  name?: string;
}

/**
 * Options for restoring a checkpoint.
 */
export interface RestoreCheckpointOptions {
  /** If true, clear all checkpoints created after this one (default: false) */
  clearLaterCheckpoints?: boolean;
}

// ============================================================================
// ICheckpointManager
// ============================================================================

import type { IDisposable } from '@mog-sdk/contracts/core';
import type { Result } from '../primitives';

/**
 * Interface for checkpoint management using undo/redo history.
 *
 * Provides save/restore functionality for AI agent operations by tracking
 * positions in the undo history and navigating back/forward as needed.
 */
export interface ICheckpointManager extends IDisposable {
  // -- Core Operations ------------------------------------------------------

  /** Create a checkpoint at the current state (async, reads undo state). */
  create(options?: CreateCheckpointOptions): Promise<Result<string>>;

  /** Create a checkpoint synchronously with a caller-provided ID. */
  createSync(id: string, options?: CreateCheckpointOptions): string;

  /** Restore to a previously created checkpoint. */
  restore(checkpointId: string, options?: RestoreCheckpointOptions): Promise<Result<void>>;

  /** List all checkpoints, sorted by creation time (newest first). */
  list(): Checkpoint[];

  /** Get a specific checkpoint by ID. */
  get(checkpointId: string): Checkpoint | undefined;

  /** Delete a checkpoint (does not undo changes). */
  delete(checkpointId: string): Result<void>;

  /** Clear all checkpoints. */
  clear(): void;

  // -- Query Methods --------------------------------------------------------

  /** Check if a checkpoint can be restored. */
  canRestore(checkpointId: string): Promise<boolean>;

  /** Get the number of operations between current state and a checkpoint. */
  getDistance(checkpointId: string): Promise<number | null>;
}
