/**
 * Dimensions Domain Module
 *
 * Row height, column width, and row/column visibility operations.
 * Pure functions that take DocumentContext as first parameter.
 *
 * Write operations delegate to ComputeBridge (Rust compute core).
 * MutationResultHandler drives event emission -- no manual event emission here.
 *
 * Sync read operations (getRowHeight, getColWidth) use BinaryViewportBuffer for
 * fast rendering-path access. Off-viewport rows/cols return default values.
 *
 * Async read operations (isRowHidden, isColumnHidden, getHiddenRows, etc.)
 * delegate to ComputeBridge.
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '@mog-sdk/contracts/rendering';

import type { DocumentContext } from '../../context/types';

// =============================================================================
// Local Dimension Cache
// =============================================================================
// Viewport buffer is populated by the rendering pipeline and may be empty in
// headless mode. This cache stores explicitly-set dimensions so getters can
// return correct values regardless of viewport state.

/** sheetId → (row → height) */
const rowHeightCache = new Map<string, Map<number, number>>();
/** sheetId → (col → width) */
const colWidthCache = new Map<string, Map<number, number>>();

// =============================================================================
// Row Height Operations
// =============================================================================

/**
 * Set row height.
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 * Also caches locally for headless-mode read-back.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param height - Height in pixels
 */
export function setRowHeight(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  height: number,
): void {
  void ctx.computeBridge.setRowHeight(sheetId, row, height);
  let sheetMap = rowHeightCache.get(sheetId);
  if (!sheetMap) {
    sheetMap = new Map();
    rowHeightCache.set(sheetId, sheetMap);
  }
  sheetMap.set(row, height);
}

/**
 * Get row height (sync, viewport-scoped).
 *
 * Queries per-viewport buffers for O(1) sync access in the rendering hot path.
 * Falls back to local cache for headless mode, then DEFAULT_ROW_HEIGHT.
 * Returns 0 for hidden rows (hidden flag is part of RowDimension).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @returns Height in pixels (0 if hidden, DEFAULT_ROW_HEIGHT if not in viewport or cache)
 */
export function getRowHeight(ctx: DocumentContext, sheetId: SheetId, row: number): number {
  // Query per-viewport buffers for this sheet (read-only, via coordinator)
  const states = ctx.computeBridge.getPerViewportStates();
  for (const [vpId] of states) {
    if (!vpId.endsWith(':' + sheetId)) continue;
    const buf = ctx.computeBridge.getViewportBuffer(vpId);
    if (!buf) continue;
    const dim = buf.getRowDimension(row);
    if (dim) {
      if (dim.hidden) return 0;
      return dim.height;
    }
  }
  return rowHeightCache.get(sheetId)?.get(row) ?? DEFAULT_ROW_HEIGHT;
}

// =============================================================================
// Column Width Operations
// =============================================================================

/**
 * Set column width.
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 * Also caches locally for headless-mode read-back.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param col - Column index
 * @param width - Width in pixels
 */
export function setColWidth(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
  width: number,
): void {
  void ctx.computeBridge.setColWidth(sheetId, col, width);
  let sheetMap = colWidthCache.get(sheetId);
  if (!sheetMap) {
    sheetMap = new Map();
    colWidthCache.set(sheetId, sheetMap);
  }
  sheetMap.set(col, width);
}

/**
 * Get column width (sync, viewport-scoped).
 *
 * Queries per-viewport buffers for O(1) sync access in the rendering hot path.
 * Falls back to local cache for headless mode, then DEFAULT_COL_WIDTH.
 * Returns 0 for hidden columns (hidden flag is part of ColDimension).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param col - Column index
 * @returns Width in pixels (0 if hidden, DEFAULT_COL_WIDTH if not in viewport or cache)
 */
export function getColWidth(ctx: DocumentContext, sheetId: SheetId, col: number): number {
  // Query per-viewport buffers for this sheet (read-only, via coordinator)
  const states = ctx.computeBridge.getPerViewportStates();
  for (const [vpId] of states) {
    if (!vpId.endsWith(':' + sheetId)) continue;
    const buf = ctx.computeBridge.getViewportBuffer(vpId);
    if (!buf) continue;
    const dim = buf.getColDimension(col);
    if (dim) {
      if (dim.hidden) return 0;
      return dim.width;
    }
  }
  return colWidthCache.get(sheetId)?.get(col) ?? DEFAULT_COL_WIDTH;
}

// =============================================================================
// Hide / Unhide Operations
// =============================================================================

/**
 * Hide rows.
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param rows - Array of row indices to hide
 */
export function hideRows(ctx: DocumentContext, sheetId: SheetId, rows: number[]): void {
  if (rows.length === 0) return;
  void ctx.computeBridge.hideRows(sheetId, rows);
}

/**
 * Unhide rows.
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param rows - Array of row indices to unhide
 */
export function unhideRows(ctx: DocumentContext, sheetId: SheetId, rows: number[]): void {
  if (rows.length === 0) return;
  void ctx.computeBridge.unhideRows(sheetId, rows);
}

/**
 * Hide columns.
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cols - Array of column indices to hide
 */
export function hideColumns(ctx: DocumentContext, sheetId: SheetId, cols: number[]): void {
  if (cols.length === 0) return;
  void ctx.computeBridge.hideColumns(sheetId, cols);
}

/**
 * Unhide columns.
 *
 * Delegates to ComputeBridge. MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param cols - Array of column indices to unhide
 */
export function unhideColumns(ctx: DocumentContext, sheetId: SheetId, cols: number[]): void {
  if (cols.length === 0) return;
  void ctx.computeBridge.unhideColumns(sheetId, cols);
}

// =============================================================================
// Async Visibility Queries (delegate to ComputeBridge)
// =============================================================================

/**
 * Check if a row is hidden.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @returns true if the row is hidden
 */
// NOTE: The selection helper `createVisibilityChecker` now pre-fetches hidden
// bitmaps via getHiddenRowsBitmap/getHiddenColumnsBitmap and uses sync Set.has()
// lookups, so this per-row async API is no longer called in the hot navigation path.
export function isRowHidden(ctx: DocumentContext, sheetId: SheetId, row: number): Promise<boolean> {
  return ctx.computeBridge.isRowHiddenQuery(sheetId, row);
}

/**
 * Check if a column is hidden.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param col - Column index
 * @returns true if the column is hidden
 */
// NOTE: Intentionally NOT async — see isRowHidden comment above.
export function isColumnHidden(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
): Promise<boolean> {
  return ctx.computeBridge.isColHiddenQuery(sheetId, col);
}

/**
 * Get all hidden rows for a sheet.
 *
 * Fetches the data bounds from ComputeBridge and checks each row.
 * Returns a sorted array of hidden row indices.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Array of hidden row indices (sorted)
 */
export async function getHiddenRows(ctx: DocumentContext, sheetId: SheetId): Promise<number[]> {
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);
  if (!bounds) return [];

  const hidden: number[] = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    if (await ctx.computeBridge.isRowHiddenQuery(sheetId, row)) {
      hidden.push(row);
    }
  }
  return hidden;
}

/**
 * Get all hidden columns for a sheet.
 *
 * Fetches the data bounds from ComputeBridge and checks each column.
 * Returns a sorted array of hidden column indices.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Array of hidden column indices (sorted)
 */
export async function getHiddenColumns(ctx: DocumentContext, sheetId: SheetId): Promise<number[]> {
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);
  if (!bounds) return [];

  const hidden: number[] = [];
  for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
    if (await ctx.computeBridge.isColHiddenQuery(sheetId, col)) {
      hidden.push(col);
    }
  }
  return hidden;
}
