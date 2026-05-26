/**
 * Sheet Management Operations Module
 *
 * Standalone functions for sheet-level management operations:
 * - Freeze panes
 * - Sheet protection
 * - Page breaks
 *
 * All functions take DocumentContext and sheetId as first two params.
 *
 * @see sheet-api.ts - Main SheetAPI class that delegates to these functions
 */

import type { ProtectionOptions } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { SheetProtectionOptions } from '@mog-sdk/contracts/protection';

import type { DocumentContext, OperationResult } from './shared';
import { operationFailed } from './shared';
import { normalizeProtectionOptions } from '../protection-options';

// ── A1-notation helpers for print area ───────────────────────────

/** Parse a cell reference like "A1" into 0-based { row, col }. */
function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const colLetters = match[1].toUpperCase();
  const rowNum = parseInt(match[2], 10);
  let col = 0;
  for (let i = 0; i < colLetters.length; i++) {
    col = col * 26 + (colLetters.charCodeAt(i) - 64);
  }
  return { row: rowNum - 1, col: col - 1 };
}

/** Convert 0-based column index to Excel column letters (0=A, 25=Z, 26=AA). */
function colToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c >= 0) {
    result = String.fromCharCode((c % 26) + 65) + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}

/** Convert a PrintRange (0-based row/col) back to "A1:D10" notation. */
function printRangeToA1(range: {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}): string {
  const startRef = `${colToLetter(range.startCol)}${range.startRow + 1}`;
  const endRef = `${colToLetter(range.endCol)}${range.endRow + 1}`;
  return `${startRef}:${endRef}`;
}

// =============================================================================
// Freeze Panes Operations
// =============================================================================

/**
 * Get the current frozen panes configuration.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Object with rows and cols indicating frozen positions
 */
export async function getFrozenPanes(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<{ rows: number; cols: number }> {
  return ctx.computeBridge.getFrozenPanesQuery(sheetId);
}

/**
 * Freeze a specified number of top rows.
 *
 * Preserves the current column freeze.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param count - Number of rows to freeze (0 to unfreeze)
 * @returns OperationResult indicating success or failure
 */
export async function freezeRows(
  ctx: DocumentContext,
  sheetId: SheetId,
  count: number,
): Promise<OperationResult<void>> {
  if (count < 0) {
    return {
      success: false,
      error: operationFailed('freezeRows', 'Row count cannot be negative'),
    };
  }

  try {
    // Get current frozen panes to preserve column freeze
    const current = await ctx.computeBridge.getFrozenPanesQuery(sheetId);
    await ctx.computeBridge.setFrozenPanes(sheetId, count, current.cols);
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('freezeRows', String(e)),
    };
  }
}

/**
 * Freeze a specified number of left columns.
 *
 * Preserves the current row freeze.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param count - Number of columns to freeze (0 to unfreeze)
 * @returns OperationResult indicating success or failure
 */
export async function freezeColumns(
  ctx: DocumentContext,
  sheetId: SheetId,
  count: number,
): Promise<OperationResult<void>> {
  if (count < 0) {
    return {
      success: false,
      error: operationFailed('freezeColumns', 'Column count cannot be negative'),
    };
  }

  try {
    // Get current frozen panes to preserve row freeze
    const current = await ctx.computeBridge.getFrozenPanesQuery(sheetId);
    await ctx.computeBridge.setFrozenPanes(sheetId, current.rows, count);
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('freezeColumns', String(e)),
    };
  }
}

/**
 * Freeze a specified number of top rows and left columns atomically.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param rows - Number of rows to freeze (0 to freeze no rows)
 * @param cols - Number of columns to freeze (0 to freeze no columns)
 * @returns OperationResult indicating success or failure
 */
export async function freezePanes(
  ctx: DocumentContext,
  sheetId: SheetId,
  rows: number,
  cols: number,
): Promise<OperationResult<void>> {
  if (rows < 0 || cols < 0) {
    return {
      success: false,
      error: operationFailed('freezePanes', 'Frozen row and column counts cannot be negative'),
    };
  }

  try {
    await ctx.computeBridge.setFrozenPanes(sheetId, rows, cols);
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('freezePanes', String(e)),
    };
  }
}

/**
 * Remove all frozen panes.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns OperationResult indicating success or failure
 */
export async function unfreeze(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<OperationResult<void>> {
  try {
    await ctx.computeBridge.setFrozenPanes(sheetId, 0, 0);
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('unfreeze', String(e)),
    };
  }
}

// =============================================================================
// Sheet Protection Operations
// =============================================================================

/**
 * Check if a sheet is protected.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns True if sheet is protected
 */
export async function isProtected(ctx: DocumentContext, sheetId: SheetId): Promise<boolean> {
  return ctx.computeBridge.isSheetProtected(sheetId);
}

/**
 * Protect a sheet with optional password and protection options.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param passwordHash - Optional password hash (null for no password)
 * @param options - Optional protection settings (e.g., allowFormatCells, allowInsertRows)
 * @returns OperationResult indicating success or failure
 */
export async function protectSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
  passwordHash?: string | null,
  options?: any,
): Promise<OperationResult<void>> {
  try {
    await ctx.computeBridge.protectSheet(sheetId, passwordHash ?? null);
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('protectSheet', String(e)),
    };
  }
}

/**
 * Unprotect a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param password - Optional password (required if sheet was protected with password)
 * @returns Object with success boolean
 */
export async function unprotectSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
  password?: string | null,
): Promise<{ success: boolean }> {
  await ctx.computeBridge.unprotectSheet(sheetId, password ?? null);
  return { success: true };
}

/**
 * Get the current protection options for a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Protection options object
 */
export async function getProtectionOptions(ctx: DocumentContext, sheetId: SheetId): Promise<any> {
  return ctx.computeBridge.getSheetProtectionOptions(sheetId);
}

/**
 * Check if a structural operation is allowed on a protected sheet.
 *
 * Delegates to computeBridge to check protection options.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param operation - The operation to check (e.g., 'insertRows', 'sort')
 * @returns true if operation is allowed
 */
export async function isOperationAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: string,
): Promise<boolean> {
  // If sheet is not protected, all operations are allowed
  const sheetProtected = await isProtected(ctx, sheetId);
  if (!sheetProtected) return true;

  // Sheet is protected — check protection options via computeBridge
  const options = await ctx.computeBridge.getSheetProtectionOptions(sheetId);
  if (!options) return false;

  switch (operation) {
    case 'insertRows':
      return options.insertRows ?? false;
    case 'insertColumns':
      return options.insertColumns ?? false;
    case 'deleteRows':
      return options.deleteRows ?? false;
    case 'deleteColumns':
      return options.deleteColumns ?? false;
    case 'formatCells':
      return options.formatCells ?? false;
    case 'formatRows':
      return options.formatRows ?? false;
    case 'formatColumns':
      return options.formatColumns ?? false;
    case 'sort':
      return options.sort ?? false;
    case 'filter':
      return options.useAutoFilter ?? false;
    case 'editObject':
      return options.editObjects ?? false;
    default:
      return false;
  }
}

// =============================================================================
// Page Break Operations
// =============================================================================

/**
 * Get all page breaks for the sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Object with rowBreaks and colBreaks arrays of PageBreakEntry
 */
export async function getPageBreaks(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<{
  rowBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
  colBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
}> {
  return ctx.computeBridge.getPageBreaks(sheetId);
}

/**
 * Add a page break at the specified position.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param type - Type of page break ('horizontal' or 'vertical')
 * @param position - Row index (for horizontal) or column index (for vertical)
 * @returns OperationResult indicating success or failure
 */
export async function addPageBreak(
  ctx: DocumentContext,
  sheetId: SheetId,
  type: 'horizontal' | 'vertical' | 'row' | 'col',
  position: number,
): Promise<OperationResult<void>> {
  if (position < 0) {
    return {
      success: false,
      error: operationFailed('addPageBreak', 'Position cannot be negative'),
    };
  }

  try {
    if (type === 'horizontal' || type === 'row') {
      await ctx.computeBridge.addHorizontalPageBreak(sheetId, position);
    } else {
      await ctx.computeBridge.addVerticalPageBreak(sheetId, position);
    }
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('addPageBreak', String(e)),
    };
  }
}

/**
 * Remove a page break at the specified position.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param type - Type of page break ('horizontal' or 'vertical')
 * @param position - Row index (for horizontal) or column index (for vertical)
 * @returns OperationResult indicating success or failure
 */
export async function removePageBreak(
  ctx: DocumentContext,
  sheetId: SheetId,
  type: 'horizontal' | 'vertical' | 'row' | 'col',
  position: number,
): Promise<OperationResult<void>> {
  if (position < 0) {
    return {
      success: false,
      error: operationFailed('removePageBreak', 'Position cannot be negative'),
    };
  }

  try {
    if (type === 'horizontal' || type === 'row') {
      await ctx.computeBridge.removeHorizontalPageBreak(sheetId, position);
    } else {
      await ctx.computeBridge.removeVerticalPageBreak(sheetId, position);
    }
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('removePageBreak', String(e)),
    };
  }
}

/**
 * Clear all page breaks from the sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns OperationResult indicating success or failure
 */
export async function clearPageBreaks(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<OperationResult<void>> {
  try {
    await ctx.computeBridge.clearAllPageBreaks(sheetId);
    return {
      success: true,
      data: undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('clearPageBreaks', String(e)),
    };
  }
}

/**
 * Get the tab color for a sheet.
 */
export async function getTabColor(ctx: DocumentContext, sheetId: SheetId): Promise<string | null> {
  return ctx.computeBridge.getTabColorQuery(sheetId);
}

/**
 * Set the tab color for a sheet.
 */
export async function setTabColor(
  ctx: DocumentContext,
  sheetId: SheetId,
  color: string | null,
): Promise<OperationResult<void>> {
  try {
    await ctx.computeBridge.setTabColor(sheetId, color);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: operationFailed('setTabColor', String(e)) };
  }
}

// =============================================================================
// Print Settings Operations
// =============================================================================

/**
 * Get print settings for a sheet.
 */
export async function getPrintSettings(ctx: DocumentContext, sheetId: SheetId): Promise<any> {
  try {
    return await ctx.computeBridge.getPrintSettings(sheetId);
  } catch {
    // Return default settings if bridge method not available
    return {};
  }
}

/**
 * Set print settings for a sheet.
 */
export async function setPrintSettings(
  ctx: DocumentContext,
  sheetId: SheetId,
  settings: any,
): Promise<OperationResult<void>> {
  try {
    await ctx.computeBridge.setPrintSettings(sheetId, settings);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: operationFailed('setPrintSettings', String(e)) };
  }
}

/**
 * Get the print area for a sheet.
 */
export async function getPrintArea(ctx: DocumentContext, sheetId: SheetId): Promise<string | null> {
  try {
    const result = await ctx.computeBridge.getPrintArea(sheetId);
    if (!result) return null;
    // Convert PrintRange struct to A1-style string representation
    return printRangeToA1(result);
  } catch {
    return null;
  }
}

/**
 * Set the print area for a sheet.
 */
export async function setPrintArea(
  ctx: DocumentContext,
  sheetId: SheetId,
  area: string,
): Promise<OperationResult<void>> {
  try {
    // Parse A1-style range (e.g. "A1:D10") into PrintRange struct
    const rangeParts = area.split(':');
    if (rangeParts.length !== 2) {
      return {
        success: false,
        error: operationFailed('setPrintArea', `Invalid range format: ${area}`),
      };
    }
    const start = parseCellRef(rangeParts[0]);
    const end = parseCellRef(rangeParts[1]);
    if (!start || !end) {
      return {
        success: false,
        error: operationFailed('setPrintArea', `Invalid cell reference in range: ${area}`),
      };
    }
    const printRange: { startRow: number; startCol: number; endRow: number; endCol: number } = {
      startRow: start.row,
      startCol: start.col,
      endRow: end.row,
      endCol: end.col,
    };
    await ctx.computeBridge.setPrintArea(sheetId, printRange);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: operationFailed('setPrintArea', String(e)) };
  }
}

/**
 * Clear the print area for a sheet.
 */
export async function clearPrintArea(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<OperationResult<void>> {
  try {
    await ctx.computeBridge.setPrintArea(sheetId, null);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: operationFailed('clearPrintArea', String(e)) };
  }
}

/**
 * Get view options for a sheet (gridlines, headings).
 * Bridge returns { show_gridlines, show_row_headers, show_column_headers }.
 */
export async function getViewOptions(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<{ showGridlines: boolean; showRowHeaders: boolean; showColumnHeaders: boolean }> {
  const raw = await ctx.computeBridge.getViewOptionsQuery(sheetId);
  return {
    showGridlines: raw.showGridlines,
    showRowHeaders: raw.showRowHeaders,
    showColumnHeaders: raw.showColumnHeaders,
  };
}

// =============================================================================
// Protection Option Mapping
// =============================================================================

/**
 * Map API ProtectionOptions (allow* prefix) to internal SheetProtectionOptions.
 */
export function mapProtectionOptions(options?: ProtectionOptions): SheetProtectionOptions {
  return normalizeProtectionOptions(options);
}
