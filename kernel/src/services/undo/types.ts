/**
 * Undo Service Types
 *
 * Re-exports from contracts (single source of truth) plus kernel-internal types.
 *
 * @see @mog-sdk/contracts/services — canonical IUndoService interface
 */

// Re-export all undo types from contracts — single source of truth
export type {
  IUndoService,
  UndoError,
  UndoServiceState,
  UndoStateChangeEvent,
} from '@mog-sdk/contracts/services';

// =============================================================================
// Kernel-Internal Types (not in contracts)
// =============================================================================

/**
 * Information about an undo stack item.
 * Used internally by the kernel's undo service implementation.
 */
export interface UndoStackItem {
  /** Description of the operation (for UI display) */
  description: string;
  /** Timestamp when the operation was performed */
  timestamp: number;
}
