/**
 * Undo Domain Module
 *
 * Thin helpers used by WorkbookHistoryImpl for history listing and
 * go-to-index. Core undo/redo operations are handled by UndoService
 * (kernel/src/services/undo/), NOT by this module.
 *
 * @see compute-core/src/undo.rs - Rust implementation
 * @see kernel/src/services/undo/undo-service.ts - UndoService (undo/redo pipeline)
 */

import type { DocumentContext } from '../context/types';
import type { IUndoReplayService } from '../services/undo';

// =============================================================================
// Types
// =============================================================================

export interface UndoHistoryEntry {
  /** Unique identifier for this entry */
  id: string;
  /** Human-readable description of the operation */
  description: string;
  /** Timestamp when the operation was performed */
  timestamp: number;
}

// =============================================================================
// History Operations
// =============================================================================

/**
 * Get the undo history.
 *
 * In the ComputeBridge architecture, undo history is managed by Rust.
 * This stub returns an empty array for API compatibility.
 *
 * @returns Empty array (history managed by Rust)
 */
export function getUndoHistory(ctx: DocumentContext): UndoHistoryEntry[] {
  const descriptions = ctx.services?.undo.listDescriptions() ?? [];
  const now = Date.now();
  return descriptions.map((description, index) => ({
    id: `undo-${index}`,
    description: description || 'Undo',
    timestamp: now,
  }));
}

/**
 * Undo to a specific index in the history.
 *
 * Performs multiple undo operations via CB to reach the target state.
 *
 * @param targetIndex - Index in the reversed history (0 = most recent operation)
 */
export async function undoToIndex(ctx: DocumentContext, targetIndex: number): Promise<void> {
  const service = ctx.services?.undo as IUndoReplayService | undefined;
  if (!service?.undoToIndex) {
    throw new Error('Undo service replay API is unavailable');
  }
  const result = await service.undoToIndex(targetIndex);
  if (!result.ok) {
    throw new Error('reason' in result.error ? result.error.reason : result.error.type);
  }
}
