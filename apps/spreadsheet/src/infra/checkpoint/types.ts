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
