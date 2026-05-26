/**
 * Grid Index Domain Module
 *
 * Cell position lookup and reverse index operations.
 * Moved from spreadsheet-model/src/grid-index.ts.
 *
 * Architecture:
 * - All operations delegate to ComputeBridge (Rust compute-core)
 * - Position -> CellId: ctx.computeBridge.getCellIdAt()
 * - CellId -> Position: ctx.computeBridge.getCellPosition()
 * - Cell creation: ctx.computeBridge.setCellValueParsed()
 * - Reactivity: handled by MutationResultHandler from Rust MutationResult
 *
 * @see compute-core/src/storage/ - Rust implementation
 */

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { SerializedCellData } from '@mog-sdk/contracts/store';

import type { CellValue } from '@mog-sdk/contracts/core';
import type { DocumentContext } from '../context/types';

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Convert a CellValue back to CellRawValue for SerializedCellData.
 * After wire unification, values are already plain primitives.
 */
function fromComputeValue(cv: CellValue | null | undefined): string | number | boolean | null {
  if (cv === null || cv === undefined) return null;
  if (typeof cv === 'number' || typeof cv === 'string' || typeof cv === 'boolean') {
    return cv;
  }
  // Error objects
  if (typeof cv === 'object' && 'type' in cv && cv.type === 'error') {
    return cv.value;
  }
  return null;
}

// =============================================================================
// Reverse Index Infrastructure
// =============================================================================

/**
 * Build the reverse index (CellId -> SheetId) via ComputeBridge.
 *
 * Iterates all sheets and queries cells in each sheet to build the mapping.
 * This is an async operation delegating to Rust compute-core.
 *
 * @param ctx - Store context with ComputeBridge
 * @returns Map from CellId to SheetId
 */
export async function getReverseIndexForRefs(ctx: DocumentContext): Promise<Map<CellId, SheetId>> {
  const index = new Map<CellId, SheetId>();
  const rawSheetIds = await ctx.computeBridge.getAllSheetIds();
  for (const rawId of rawSheetIds) {
    const sid = toSheetId(rawId);
    const bounds = await ctx.computeBridge.getDataBounds(sid);
    if (!bounds) continue;
    const rangeResult = await ctx.computeBridge.queryRange(
      sid,
      bounds.minRow,
      bounds.minCol,
      bounds.maxRow,
      bounds.maxCol,
    );
    if (rangeResult?.cells) {
      for (const cell of rangeResult.cells) {
        if (cell && cell.cellId) {
          index.set(toCellId(cell.cellId), sid);
        }
      }
    }
  }
  return index;
}

/**
 * Get the reverse index (CellId -> SheetId) for a store context.
 *
 * @param ctx - Store context with ComputeBridge
 * @returns Map from CellId to SheetId
 */
export async function getReverseIndex(ctx: DocumentContext): Promise<Map<CellId, SheetId>> {
  return getReverseIndexForRefs(ctx);
}

// =============================================================================
// Low-Level Grid Index Operations (CB-backed)
// =============================================================================

/**
 * Get cell ID at position via ComputeBridge.
 *
 * Replaces the former SheetMaps-based sync lookup.
 * Signature changed: takes DocumentContext + sheetId instead of SheetMaps.
 *
 * @param ctx - Store context with ComputeBridge
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns CellId or null if no cell exists at position
 */
export async function getCellIdAtPositionFromMaps(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellId | null> {
  const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
  return cellId ? toCellId(cellId) : null;
}

/**
 * Get cell ID at a position using store context.
 *
 * @param ctx - Store context with ComputeBridge
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns CellId or null if no cell exists at position
 */
export async function getCellIdAtPosition(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellId | null> {
  const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
  return cellId ? toCellId(cellId) : null;
}

/**
 * Get cell data by position via ComputeBridge.
 *
 * Replaces the former SheetMaps-based sync lookup.
 * Signature changed: takes DocumentContext + sheetId instead of SheetMaps.
 *
 * @param ctx - Store context with ComputeBridge
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Cell data or undefined if no cell at position
 */
export async function getCellDataByPositionFromMaps(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<SerializedCellData | undefined> {
  const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
  if (!cellId) return undefined;
  const activeCell = await ctx.computeBridge.getActiveCell(sheetId, cellId);
  if (!activeCell) return undefined;
  return {
    id: toCellId(activeCell.cellId),
    row,
    col,
    r: fromComputeValue(activeCell.value),
    f: activeCell.formula ?? undefined,
  };
}

/**
 * Get cell data by position using store context.
 *
 * @param ctx - Store context with ComputeBridge
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Cell data or undefined if no cell at position
 */
export async function getCellDataByPosition(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<SerializedCellData | undefined> {
  return getCellDataByPositionFromMaps(ctx, sheetId, row, col);
}

/**
 * Create or update a cell via ComputeBridge (fire-and-forget).
 *
 * Replaces the former SheetMaps-based sync write.
 * Signature changed: takes DocumentContext + sheetId instead of SheetMaps.
 *
 * @param ctx - Store context with ComputeBridge
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param data - Partial cell data to write
 */
export function setCellFromMaps(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  data: Partial<Omit<SerializedCellData, 'id' | 'row' | 'col'>>,
): void {
  // Build input string for Rust's position-based method
  const input = data.f ? `=${data.f}` : String(data.r ?? '');
  void ctx.computeBridge.setCellValueParsed(sheetId, row, col, input);
}

/**
 * Create or update a cell using store context (fire-and-forget).
 *
 * @param ctx - Store context with ComputeBridge
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param data - Partial cell data to write
 */
export function setCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  data: Partial<Omit<SerializedCellData, 'id' | 'row' | 'col'>>,
): void {
  setCellFromMaps(ctx, sheetId, row, col, data);
}
