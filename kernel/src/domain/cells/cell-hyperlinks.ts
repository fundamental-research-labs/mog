/**
 * Cell Hyperlinks Module
 *
 * Manages hyperlink operations on cells - adding, retrieving, and removing URLs.
 * Excel treats hyperlinks as separate from cell values, stored as cell metadata.
 *
 * Write operations delegate to ComputeBridge (Rust compute core) via dedicated
 * setHyperlink / removeHyperlink bridge commands.
 * Read operations query ComputeBridge via a dedicated getHyperlink bridge command
 * that reads directly from the Yrs CRDT (bypassing the CellMirror).
 * MutationResultHandler handles event emission -- no manual event emission here.
 *
 */

import type { SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../context/types';

// =============================================================================
// Public API
// =============================================================================

/**
 * Set a hyperlink on a cell.
 * If the cell doesn't exist, Rust creates a marker cell with the hyperlink.
 *
 * Delegates to ComputeBridge.setHyperlink which calls Rust's set_hyperlink.
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @param url - Hyperlink URL (e.g., "https://example.com", "mailto:test@test.com")
 */
export async function setHyperlink(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  url: string,
): Promise<void> {
  await ctx.computeBridge.setHyperlink(sheetId, row, col, url);
}

/**
 * Get the hyperlink for a cell.
 *
 * Queries ComputeBridge for active cell data which includes hyperlink_url.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 * @returns Hyperlink URL or undefined if none
 */
export async function getHyperlink(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string | undefined> {
  const url = await ctx.computeBridge.getHyperlink(sheetId, row, col);
  return url ?? undefined;
}

/**
 * Remove a hyperlink from a cell.
 * Preserves other cell data (value, formula, note).
 *
 * Delegates to ComputeBridge.removeHyperlink which calls Rust's remove_hyperlink.
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index
 * @param col - Column index
 */
export async function removeHyperlink(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<void> {
  await ctx.computeBridge.removeHyperlink(sheetId, row, col);
}
