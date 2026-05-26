/**
 * Row/Column Identity Module (Kernel Domain)
 *
 * Delegates all data access to ComputeBridge (Rust compute-core).
 *
 * Architecture:
 * - Cell identity: ctx.computeBridge.getCellIdAt()
 * - Row/column identity: Rust owns identity tracking internally.
 *   Row/col IDs are resolved by Rust during cell writes.
 * - Index rebuild: Rust maintains its own internal indices.
 *
 * @see compute-core/src/storage/identity.rs - Rust implementation
 */

import {
  toColId,
  type ColData,
  type ColId,
  type RowData,
  type RowId,
  toRowId,
} from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../context/types';

// Re-export types for convenience
export type { ColData, ColId, RowData, RowId };

// =============================================================================
// Row Identity Operations (ComputeBridge-delegated)
// =============================================================================

/**
 * Get the RowId at a position (read-only lookup).
 *
 * Rust compute-core owns row identity. It generates and tracks RowIds
 * internally when cells are written. This delegates to getCellIdAt
 * to check whether a row has any materialized cells, then derives the
 * RowId from the workbook settings.
 *
 * For callers that need a RowId for non-cell operations (e.g., row height,
 * row format), a synthetic RowId is generated based on position. Rust
 * handles the real identity internally.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @returns RowId or null if the row is virtual (no materialized data)
 */
export async function getRowIdAt(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
): Promise<RowId | null> {
  // Check if any cell exists in this row by checking column 0.
  // Rust owns row identity; we use getCellIdAt as a proxy.
  const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, 0);
  if (cellId) {
    // Row has materialized data -- derive a stable RowId from position.
    // Rust tracks the real identity; this is a thin proxy.
    return toRowId(`row-${sheetId}-${row}`);
  }

  // Check data bounds to see if this row is within the used range
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);
  if (bounds && row >= bounds.minRow && row <= bounds.maxRow) {
    return toRowId(`row-${sheetId}-${row}`);
  }

  return null;
}

/**
 * Get or create a RowId at a position (materializing lookup).
 *
 * Rust compute-core handles row identity internally during cell writes.
 * This function provides a stable RowId for callers that need one before
 * a cell write (e.g., setting row height or format). The RowId is
 * deterministic based on sheet + position.
 *
 * @param ctx - Store context
 * @param _maps - Sheet maps (unused - Rust owns identity)
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param _origin - Transaction origin (unused, kept for API compat)
 * @returns RowId (deterministic based on position)
 */
export function getOrCreateRowId(
  _ctx: DocumentContext,
  _maps: unknown,
  sheetId: SheetId,
  row: number,
  _origin: string = 'user',
): RowId {
  // Rust owns row identity. Return a deterministic RowId based on position.
  // When Rust materializes cells at this row, it assigns its own internal ID.
  return toRowId(`row-${sheetId}-${row}`);
}

// =============================================================================
// Column Identity Operations (ComputeBridge-delegated)
// =============================================================================

/**
 * Get the ColId at a position (read-only lookup).
 *
 * Rust compute-core owns column identity. It generates and tracks ColIds
 * internally when cells are written.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param col - Column index (0-based)
 * @returns ColId or null if the column is virtual (no materialized data)
 */
export async function getColIdAt(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
): Promise<ColId | null> {
  // Check if any cell exists in this column by checking row 0.
  // Rust owns column identity; we use getCellIdAt as a proxy.
  const cellId = await ctx.computeBridge.getCellIdAt(sheetId, 0, col);
  if (cellId) {
    return toColId(`col-${sheetId}-${col}`);
  }

  // Check data bounds to see if this column is within the used range
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);
  if (bounds && col >= bounds.minCol && col <= bounds.maxCol) {
    return toColId(`col-${sheetId}-${col}`);
  }

  return null;
}

/**
 * Get or create a ColId at a position (materializing lookup).
 *
 * Rust compute-core handles column identity internally during cell writes.
 * This function provides a stable ColId for callers that need one before
 * a cell write (e.g., setting column width or format). The ColId is
 * deterministic based on sheet + position.
 *
 * @param ctx - Store context
 * @param _maps - Sheet maps (unused - Rust owns identity)
 * @param sheetId - Sheet ID
 * @param col - Column index (0-based)
 * @param _origin - Transaction origin (unused, kept for API compat)
 * @returns ColId (deterministic based on position)
 */
export function getOrCreateColId(
  _ctx: DocumentContext,
  _maps: unknown,
  sheetId: SheetId,
  col: number,
  _origin: string = 'user',
): ColId {
  // Rust owns column identity. Return a deterministic ColId based on position.
  return toColId(`col-${sheetId}-${col}`);
}

// =============================================================================
// Minimal Interfaces for Index Rebuild Operations (no-op stubs)
// =============================================================================

/**
 * Minimal interface for row index rebuild operations.
 * Kept for API compatibility. Rust maintains its own internal indices.
 */
export interface RowIndexMaps {
  rows: unknown;
  rowIndex: unknown;
}

/**
 * Minimal interface for column index rebuild operations.
 * Kept for API compatibility. Rust maintains its own internal indices.
 */
export interface ColIndexMaps {
  cols: unknown;
  colIndex: unknown;
}

// =============================================================================
// Index Rebuild Operations (no-op stubs -- Rust maintains internal indices)
// =============================================================================

/**
 * Rebuild the row index from the rows map.
 *
 * In the ComputeBridge architecture, Rust maintains its own internal
 * index of row identities. This is a no-op stub kept for API compatibility
 * with callers in structures.ts.
 *
 * @param _maps - Row index maps (unused - Rust manages indices internally)
 */
export function rebuildRowIndex(_maps: RowIndexMaps): void {
  // Rust compute-core maintains row indices internally.
  // No store index rebuild needed.
}

/**
 * Rebuild the column index from the cols map.
 *
 * In the ComputeBridge architecture, Rust maintains its own internal
 * index of column identities. This is a no-op stub kept for API compatibility
 * with callers in structures.ts.
 *
 * @param _maps - Column index maps (unused - Rust manages indices internally)
 */
export function rebuildColIndex(_maps: ColIndexMaps): void {
  // Rust compute-core maintains column indices internally.
  // No store index rebuild needed.
}
