/**
 * WorkbookHistory -- Undo/redo sub-API interface.
 *
 * Provides access to undo/redo operations, history listing, and undo state.
 */
import type { CallableDisposable } from '@mog/types-core/disposable';
import type { RedoReceipt, UndoReceipt } from '../mutation-receipt';
import type { UndoStateChangeEvent } from '../../services/index';
import type { UndoHistoryEntry, UndoState } from '../types';

export interface WorkbookHistory {
  /** Undo the last operation. */
  undo(): Promise<UndoReceipt>;

  /** Redo the last undone operation. */
  redo(): Promise<RedoReceipt>;

  /** Check if undo is available. Synchronous (uses cached state). */
  canUndo(): boolean;

  /** Check if redo is available. Synchronous (uses cached state). */
  canRedo(): boolean;

  /** Get the undo history entries. Synchronous. */
  list(): UndoHistoryEntry[];

  /**
   * Undo to a specific index in the history.
   * Performs multiple undo operations to reach the target state.
   * @param index - Index in the history (0 = most recent operation)
   */
  goToIndex(index: number): Promise<void>;

  /**
   * Get the full undo/redo state from the compute engine.
   * Returns depth counts used by CheckpointManager to track checkpoint state.
   */
  getState(): Promise<UndoState>;

  /**
   * Subscribe to undo/redo state changes.
   * Called whenever the undo stack changes (push, undo, redo, clear).
   * @returns Unsubscribe function
   */
  subscribe(listener: (event: UndoStateChangeEvent) => void): CallableDisposable;

  /**
   * Set the description for the next undo step.
   * Call immediately before a mutation to label the undo entry.
   */
  setNextDescription(description: string): void;
}
