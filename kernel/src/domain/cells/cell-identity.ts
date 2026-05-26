/**
 * Cell Identity Module
 *
 * Foundation layer for cell identity and grid position operations.
 * This module implements the Cell Identity Model where:
 * - Cells are keyed by stable CellId (UUID), not position
 * - Position (row, col) is stored IN the cell data, not AS the key
 * - Grid index maps position -> CellId for O(1) lookup
 * - On insert/delete row/col, only positions change - no formula rewriting
 *
 * Write operations delegate to ComputeBridge (Rust compute core).
 * Read operations are async, querying ComputeBridge.
 * MutationResultHandler handles event emission -- no manual event emission here.
 *
 */

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../context/types';

function mutationResultCellId(data: unknown): CellId {
  if (typeof data !== 'string') {
    throw new Error('Expected getOrCreateCellId mutation result data to be a CellId string');
  }
  return toCellId(data);
}

// =============================================================================
// Grid Index / CellId Operations
// =============================================================================

/**
 * Get CellId at a position, creating the cell if it doesn't exist.
 *
 * This is the canonical implementation - used by:
 * - merge-operations.ts (merge boundaries)
 * - grid-index.ts (CellPositionLookup)
 * - range-schema-operations.ts (schema import)
 *
 * Creates a marker cell with no value (r: null) if the cell doesn't exist.
 * This ensures stable CellIds for features that reference cell positions.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID (for grid key)
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns CellId (existing or newly created)
 */
export async function getOrCreateCellId(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellId> {
  // Check existing first (read-only, faster)
  const existingId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
  if (existingId) {
    return toCellId(existingId);
  }

  // Rust generates CellId and creates marker cell
  const result = await ctx.computeBridge.getOrCreateCellId(sheetId, row, col);
  return mutationResultCellId(result.data);
}

/**
 * Get the CellId at a position.
 *
 * Queries ComputeBridge for the cell ID at a given position.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns CellId or null if no cell at position
 */
export async function getCellIdAt(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellId | null> {
  const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
  return cellId ? toCellId(cellId) : null;
}

/**
 * Update cell position (row and/or col).
 *
 * Delegates to ComputeBridge.relocateCells for position updates.
 * Rust handles updating the grid index after position changes.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cellId - Cell ID to update
 * @param newPosition - New row and column position
 */
export function updateCellPosition(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _cellId: CellId,
  _newPosition: { row: number; col: number },
): void {
  // In the ComputeBridge architecture, cell position updates are handled by
  // Rust during structural operations (relocateCells, insertRows, deleteRows).
  // Direct position updates are not needed from TS; they happen atomically
  // within Rust structure change operations.
  //
  // This is a no-op stub kept for API compatibility.
  // Callers should use relocateCells() for cell movement operations.
}
