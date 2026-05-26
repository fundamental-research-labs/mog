/**
 * Hyperlink Operations Module
 *
 * Operations for managing cell hyperlinks.
 * Delegates to the domain cell-hyperlinks module which uses ComputeBridge.
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import * as Cells from '../../../domain/cells';

import type { DocumentContext, OperationResult } from './shared';
import { invalidCellAddress, operationFailed } from './shared';

// =============================================================================
// Hyperlink Operations
// =============================================================================

/**
 * Set a hyperlink on a cell.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @param url - Hyperlink URL
 * @returns OperationResult indicating success or failure
 */
export async function setHyperlink(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  url: string,
): Promise<OperationResult<void>> {
  if (row < 0 || col < 0) {
    return { success: false, error: invalidCellAddress(row, col) };
  }

  try {
    await Cells.setHyperlink(ctx, sheetId, row, col, url);
    return { success: true, data: undefined };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('setHyperlink', String(e)),
    };
  }
}

/**
 * Get the hyperlink URL for a cell.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns The hyperlink URL, or null if no hyperlink
 */
export async function getHyperlink(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string | null> {
  if (row < 0 || col < 0) {
    return null;
  }

  try {
    const url = await Cells.getHyperlink(ctx, sheetId, row, col);
    return url ?? null;
  } catch {
    return null;
  }
}

/**
 * Remove a hyperlink from a cell.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns OperationResult indicating success or failure
 */
export async function removeHyperlink(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<OperationResult<void>> {
  if (row < 0 || col < 0) {
    return { success: false, error: invalidCellAddress(row, col) };
  }

  try {
    await Cells.removeHyperlink(ctx, sheetId, row, col);
    return { success: true, data: undefined };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('removeHyperlink', String(e)),
    };
  }
}
