/**
 * Spill / Projection Domain Module (Stream AF: Array Formulas)
 *
 * All data access delegates to ComputeBridge (Rust compute-core).
 *
 * @see compute-core/src/spill.rs - Rust implementation
 */

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { ProjectionInfo } from '@mog-sdk/contracts/spill';

import type { DocumentContext } from '../context/types';

// =============================================================================
// Spill Read Queries — ComputeBridge Delegation (async)
// =============================================================================

/**
 * Check if a cell is a spill anchor / projection source (has spillRange).
 *
 * Delegates to ComputeBridge.isProjectionSource.
 */
export async function isSpillAnchor(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  return ctx.computeBridge.isProjectionSource(sheetId, row, col);
}

/**
 * Check if a cell is a spill member (not anchor) — a projected position
 * that receives a projected value.
 *
 * Delegates to ComputeBridge.isProjectedPosition.
 */
export async function isSpillMember(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  return ctx.computeBridge.isProjectedPosition(sheetId, row, col);
}

/**
 * Get the projection range for a cell (if it is a projection source).
 *
 * Delegates to ComputeBridge.getProjectionRange.
 *
 * @returns The projection range, or null if not a projection source
 */
export async function getSpillRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellRange | null> {
  return ctx.computeBridge.getProjectionRange(sheetId, row, col);
}

/**
 * Get the projection source (anchor position) for a projected position.
 *
 * Delegates to ComputeBridge.getProjectionSource.
 *
 * @returns Source position {row, col} if this is a projected position, null otherwise
 */
export async function getSpillOrigin(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<{ row: number; col: number } | null> {
  return ctx.computeBridge.getProjectionSource(sheetId, row, col);
}

/**
 * Get the anchor cell for a spill member cell.
 *
 * Delegates to ComputeBridge.getProjectionSource.
 *
 * @returns Anchor position {row, col} or undefined
 */
export async function getSpillAnchor(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<{ row: number; col: number } | undefined> {
  const origin = await ctx.computeBridge.getProjectionSource(sheetId, row, col);
  return origin ?? undefined;
}

/**
 * Get the full anchor data for a spill member cell.
 *
 * @returns Anchor position {row, col} or undefined
 */
export async function getSpillAnchorData(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<{ row: number; col: number } | undefined> {
  const origin = await ctx.computeBridge.getProjectionSource(sheetId, row, col);
  return origin ?? undefined;
}

// =============================================================================
// Projection Read Queries (Dynamic Array Architecture)
//
// The Rust compute-core now uses a ProjectionRegistry instead of phantom cells.
// These methods provide projection-aware alternatives to the spill queries above.
// They coexist with the old spill methods — callers can migrate incrementally.
//
// Currently implemented as stubs returning false/undefined because the
// ComputeBridge does not yet expose projection-specific IPC methods. These will
// be wired to real bridge calls when the IPC types are updated from ProjectionChange
// to ProjectionChange.
// =============================================================================

/**
 * Check if a cell is a projection source (contains a dynamic array formula
 * whose result is projected to neighboring cells).
 *
 * Projection sources are the equivalent of "spill anchors" in the old model.
 *
 * @returns true if this cell owns a projection region
 */
export async function isProjectionSource(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  return ctx.computeBridge.isProjectionSource(sheetId, row, col);
}

/**
 * Check if a cell position displays a projected value (i.e., its displayed
 * value comes from another cell's dynamic array result via the projection
 * registry, rather than from its own formula or literal).
 *
 * This replaces isSpillMember() — projected positions are the equivalent of
 * "spill phantoms" in the old model, but without separate CellIds.
 *
 * @returns true if this position is within a projection region (and is not the source)
 */
export async function isProjectedPosition(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  return ctx.computeBridge.isProjectedPosition(sheetId, row, col);
}

/**
 * Get projection information for a cell position.
 *
 * Returns the source cell location and the full extent of the projection region.
 * Works for both source cells and projected positions within the region.
 *
 * @returns ProjectionInfo if this cell is part of a projection, undefined otherwise
 */
export async function getProjectionInfo(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<ProjectionInfo | undefined> {
  // Get projection range — works for source cells
  const range = await ctx.computeBridge.getProjectionRange(sheetId, row, col);
  if (range) {
    return {
      sourceRow: row,
      sourceCol: col,
      originRow: range.startRow,
      originCol: range.startCol,
      rows: range.endRow - range.startRow + 1,
      cols: range.endCol - range.startCol + 1,
    };
  }
  // Get projection source — works for projected positions
  const source = await ctx.computeBridge.getProjectionSource(sheetId, row, col);
  if (source) {
    const sourceRange = await ctx.computeBridge.getProjectionRange(sheetId, source.row, source.col);
    if (sourceRange) {
      return {
        sourceRow: source.row,
        sourceCol: source.col,
        originRow: sourceRange.startRow,
        originCol: sourceRange.startCol,
        rows: sourceRange.endRow - sourceRange.startRow + 1,
        cols: sourceRange.endCol - sourceRange.startCol + 1,
      };
    }
  }
  return undefined;
}
