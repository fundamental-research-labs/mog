/**
 * Structures Domain Module
 *
 * Insert/delete rows and columns operations.
 * Pure functions that take DocumentContext as first parameter.
 *
 * Write operations delegate to ComputeBridge.structureChange() (Rust compute core).
 * MutationResultHandler drives event emission -- no manual event emission here.
 *
 * CELL IDENTITY MODEL:
 * - Cells are keyed by stable CellId (UUID), not position
 * - Rust compute-core handles all position management and grid index rebuilding
 * - NO FORMULA REWRITING - formulas reference cells by ID, not position
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';

import type { StructureChange } from '../../bridges/compute/compute-bridge';
import type { MutationResult } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context/types';

// =============================================================================
// Insert Rows
// =============================================================================

/**
 * Insert rows at the specified position.
 *
 * Delegates to ComputeBridge.structureChange(). Rust handles:
 * - Cell position updates
 * - Grid index rebuild
 * - Row identity management
 * - Merge region adjustments
 *
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param _maps - Sheet maps (unused — kept for caller compatibility)
 * @param startRow - Row index where insertion begins
 * @param count - Number of rows to insert
 * @param _origin - Transaction origin (unused — kept for caller compatibility)
 */
export async function insertRows(
  ctx: DocumentContext,
  sheetId: SheetId,
  _maps: any,
  startRow: number,
  count: number,
  _origin: string = 'user',
): Promise<MutationResult | void> {
  if (count <= 0) return;

  const change: StructureChange = {
    InsertRows: { at: startRow, count, new_row_ids: [] },
  };
  return await ctx.computeBridge.structureChange(sheetId, change);
}

// =============================================================================
// Delete Rows
// =============================================================================

/**
 * Delete rows at the specified position.
 *
 * Delegates to ComputeBridge.structureChange(). Rust handles:
 * - Cell deletion in the removed range
 * - Row identity cleanup
 * - Grid index rebuild
 * - Merge cleanup for lost corner cells
 * - Comment validation
 *
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param _maps - Sheet maps (unused — kept for caller compatibility)
 * @param startRow - Row index where deletion begins
 * @param count - Number of rows to delete
 * @param _origin - Transaction origin (unused — kept for caller compatibility)
 */
export async function deleteRows(
  ctx: DocumentContext,
  sheetId: SheetId,
  _maps: any,
  startRow: number,
  count: number,
  _origin: string = 'user',
): Promise<MutationResult | void> {
  if (count <= 0) return;

  const change: StructureChange = {
    DeleteRows: { at: startRow, count, deleted_cell_ids: [] },
  };
  return await ctx.computeBridge.structureChange(sheetId, change);
}

// =============================================================================
// Insert Columns
// =============================================================================

/**
 * Insert columns at the specified position.
 *
 * Delegates to ComputeBridge.structureChange(). Rust handles:
 * - Cell position updates
 * - Grid index rebuild
 * - Column identity management
 * - Merge region adjustments
 *
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param _maps - Sheet maps (unused — kept for caller compatibility)
 * @param startCol - Column index where insertion begins
 * @param count - Number of columns to insert
 * @param _origin - Transaction origin (unused — kept for caller compatibility)
 */
export async function insertColumns(
  ctx: DocumentContext,
  sheetId: SheetId,
  _maps: any,
  startCol: number,
  count: number,
  _origin: string = 'user',
): Promise<MutationResult | void> {
  if (count <= 0) return;

  const change: StructureChange = {
    InsertCols: { at: startCol, count, new_col_ids: [] },
  };
  return await ctx.computeBridge.structureChange(sheetId, change);
}

// =============================================================================
// Delete Columns
// =============================================================================

/**
 * Delete columns at the specified position.
 *
 * Delegates to ComputeBridge.structureChange(). Rust handles:
 * - Cell deletion in the removed range
 * - Column identity cleanup
 * - Grid index rebuild
 * - Merge cleanup for lost corner cells
 * - Schema cleanup
 * - Comment validation
 *
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param _maps - Sheet maps (unused — kept for caller compatibility)
 * @param startCol - Column index where deletion begins
 * @param count - Number of columns to delete
 * @param _origin - Transaction origin (unused — kept for caller compatibility)
 */
export async function deleteColumns(
  ctx: DocumentContext,
  sheetId: SheetId,
  _maps: any,
  startCol: number,
  count: number,
  _origin: string = 'user',
): Promise<MutationResult | void> {
  if (count <= 0) return;

  const change: StructureChange = {
    DeleteCols: { at: startCol, count, deleted_cell_ids: [] },
  };
  return await ctx.computeBridge.structureChange(sheetId, change);
}
