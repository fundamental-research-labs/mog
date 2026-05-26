/**
 * Cell Iteration Domain Module
 *
 * Delegates all data access to ComputeBridge (Rust compute-core).
 *
 * Architecture:
 * - Write operations: fire-and-forget via ctx.computeBridge
 * - Read operations: async via ctx.computeBridge
 * - Events: handled by MutationResultHandler from Rust MutationResult
 * - No CRDT operations — all data goes through Rust
 *
 * @see compute-core/src/storage/cells.rs - Rust implementation
 */

import type { SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../context/types';

// =============================================================================
// Range Operations
// =============================================================================

/**
 * Clear all cells in a range.
 *
 * @deprecated Use computeBridge.clearRangeByPosition() instead — single IPC call,
 * Rust handles CellId resolution internally.
 */
export async function clearRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): Promise<void> {
  await ctx.computeBridge.clearRangeByPosition(sheetId, startRow, startCol, endRow, endCol);
}
