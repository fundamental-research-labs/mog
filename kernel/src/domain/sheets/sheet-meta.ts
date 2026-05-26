/**
 * Sheet Metadata Domain Module
 *
 * Delegates all data access to ComputeBridge (Rust compute-core).
 *
 * Architecture:
 * - Write operations: fire-and-forget via ctx.computeBridge
 * - Read operations: async via ctx.computeBridge
 * - Events: handled by MutationResultHandler from Rust MutationResult
 *
 * @see compute-core/src/storage/sheet_meta.rs - Rust implementation
 */

import type { PrintSettings, SheetId } from '@mog-sdk/contracts/core';

import { DEFAULT_SHEET_PRINT_SETTINGS } from '../workbook/core-defaults';
import type { CellCoord, FrozenPanes } from '@mog-sdk/contracts/rendering';
import type { SheetMeta, UsedRange } from '@mog-sdk/contracts/store';

import type { DocumentContext } from '../../context/types';

// =============================================================================
// Sheet Metadata (ComputeBridge-delegated)
// =============================================================================

/**
 * Get sheet metadata by assembling fields from ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Sheet metadata or undefined if not found
 */
export async function getMeta(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<SheetMeta | undefined> {
  const name = await ctx.computeBridge.getSheetName(sheetId);
  if (name === null) return undefined;

  const [frozen, tabColor, hidden, defaultRowHeight, defaultColWidth] = await Promise.all([
    ctx.computeBridge.getFrozenPanesQuery(sheetId),
    ctx.computeBridge.getTabColorQuery(sheetId),
    ctx.computeBridge.isSheetHidden(sheetId),
    ctx.computeBridge.getDefaultRowHeight(sheetId),
    ctx.computeBridge.getDefaultColWidth(sheetId),
  ]);

  return {
    id: sheetId,
    name,
    defaultRowHeight,
    defaultColWidth,
    frozenRows: frozen.rows,
    frozenCols: frozen.cols,
    tabColor: tabColor ?? undefined,
    hidden,
  };
}

/**
 * Get ordered list of sheet IDs.
 */
export async function getOrder(ctx: DocumentContext): Promise<SheetId[]> {
  return ctx.computeBridge.getAllSheetIds();
}

/**
 * Get the first sheet ID (guaranteed to exist).
 */
export async function getFirstId(ctx: DocumentContext): Promise<SheetId> {
  const ids = await ctx.computeBridge.getAllSheetIds();
  return ids[0];
}

/**
 * Get sheet name by ID.
 */
export async function getName(ctx: DocumentContext, sheetId: SheetId): Promise<string | undefined> {
  const name = await ctx.computeBridge.getSheetName(sheetId);
  return name ?? undefined;
}

// =============================================================================
// Used Range (ComputeBridge-delegated via getDataBounds)
// =============================================================================

/**
 * Get the end point of the used range for Ctrl+End navigation. O(1).
 *
 * Delegates to ComputeBridge.getDataBounds() which returns the bounding
 * rectangle of all non-empty cells.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise resolving to the bottom-right corner of the used range
 */
export async function getUsedRangeEnd(ctx: DocumentContext, sheetId: SheetId): Promise<CellCoord> {
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);

  if (!bounds) {
    return { row: 0, col: 0 };
  }

  return { row: bounds.maxRow, col: bounds.maxCol };
}

/**
 * Get the full used range metadata.
 *
 * Delegates to ComputeBridge.getDataBounds() and converts to UsedRange format.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise resolving to UsedRange or null if sheet is empty
 */
export async function getUsedRange(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<UsedRange | null> {
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);

  if (!bounds) {
    return null;
  }

  return {
    endRow: bounds.maxRow,
    endCol: bounds.maxCol,
  };
}

/**
 * Set the used range explicitly.
 * Called during file import or when recomputing usedRange after deletions.
 *
 * In the ComputeBridge architecture, Rust owns the data bounds. This is
 * a no-op stub kept for API compatibility. Rust automatically recomputes
 * bounds when cells are modified.
 *
 * @param _ctx - Store context (unused)
 * @param _sheetId - Sheet ID (unused)
 * @param _usedRange - Used range (unused - Rust manages bounds internally)
 */
export function setUsedRange(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _usedRange: UsedRange | null,
): void {
  // Rust compute-core owns data bounds. Bounds are automatically maintained
  // when cells are written or cleared. No explicit set needed.
}

// =============================================================================
// Frozen Panes (ComputeBridge-delegated)
// =============================================================================

/**
 * Get frozen panes configuration for a sheet.
 */
export async function getFrozenPanes(ctx: DocumentContext, sheetId: SheetId): Promise<FrozenPanes> {
  return ctx.computeBridge.getFrozenPanesQuery(sheetId);
}

/**
 * Set frozen panes configuration for a sheet.
 *
 * Fire-and-forget: MutationResultHandler handles event emission.
 */
export function setFrozenPanes(
  ctx: DocumentContext,
  sheetId: SheetId,
  rows: number,
  cols: number,
  _origin: string = 'user',
): void {
  void ctx.computeBridge.setFrozenPanes(sheetId, Math.max(0, rows), Math.max(0, cols));
}

// =============================================================================
// Print Settings (ComputeBridge-delegated via workbook settings)
// =============================================================================

/** Single page break entry with full metadata. */
export interface PageBreakEntry {
  id: number;
  min: number;
  max: number;
  manual: boolean;
  pt: boolean;
}

/** Page breaks configuration. */
export interface PageBreaks {
  rowBreaks: PageBreakEntry[];
  colBreaks: PageBreakEntry[];
}

/**
 * Get page breaks for a sheet.
 *
 * Delegates to ComputeBridge.getPageBreaks() which reads from Rust storage.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise resolving to page breaks configuration
 */
export async function getPageBreaks(ctx: DocumentContext, sheetId: SheetId): Promise<PageBreaks> {
  return ctx.computeBridge.getPageBreaks(sheetId);
}

/**
 * Set page breaks for a sheet.
 *
 * Computes a diff between current and desired breaks, then uses the
 * dedicated CB add/remove methods. Fire-and-forget via void.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param type - 'horizontal' or 'vertical'
 * @param breaks - Array of row/column indices
 * @param _origin - Transaction origin (unused, kept for API compat)
 */
export async function setPageBreaks(
  ctx: DocumentContext,
  sheetId: SheetId,
  type: 'horizontal' | 'vertical',
  breaks: number[],
  _origin: string = 'import',
): Promise<void> {
  const sortedBreaks = [...breaks].sort((a, b) => a - b);
  const current = await getPageBreaks(ctx, sheetId);
  const currentEntries = type === 'horizontal' ? current.rowBreaks : current.colBreaks;
  const currentIds = currentEntries.map((e) => e.id);

  const currentSet = new Set(currentIds);
  const desiredSet = new Set(sortedBreaks);

  // Remove breaks that are no longer desired
  const breaksToRemove = currentIds.filter((b) => !desiredSet.has(b));
  await Promise.all(
    breaksToRemove.map((b) =>
      type === 'horizontal'
        ? ctx.computeBridge.removeHorizontalPageBreak(sheetId, b)
        : ctx.computeBridge.removeVerticalPageBreak(sheetId, b),
    ),
  );

  // Add breaks that are newly desired
  const breaksToAdd = sortedBreaks.filter((b) => !currentSet.has(b));
  await Promise.all(
    breaksToAdd.map((b) =>
      type === 'horizontal'
        ? ctx.computeBridge.addHorizontalPageBreak(sheetId, b)
        : ctx.computeBridge.addVerticalPageBreak(sheetId, b),
    ),
  );
}

/**
 * Get print settings for a sheet.
 *
 * Delegates to ComputeBridge.getWorkbookSettings() which stores per-sheet
 * print settings in the workbook settings blob.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise resolving to print settings with defaults applied
 */
export async function getPrintSettings(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<PrintSettings> {
  const perSheetRaw = await ctx.computeBridge.getWorkbookSetting('sheetPrintSettings');
  const perSheet =
    perSheetRaw && typeof perSheetRaw === 'object'
      ? (perSheetRaw as Record<string, PrintSettings>)
      : undefined;

  if (perSheet && perSheet[sheetId]) {
    return { ...DEFAULT_SHEET_PRINT_SETTINGS, ...perSheet[sheetId] };
  }

  return DEFAULT_SHEET_PRINT_SETTINGS;
}

/**
 * Set print settings for a sheet.
 *
 * Fire-and-forget: MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param settings - Partial print settings to merge
 * @param _origin - Transaction origin (unused, kept for API compat)
 */
export async function setPrintSettings(
  ctx: DocumentContext,
  sheetId: SheetId,
  printSettings: Partial<PrintSettings>,
  _origin: string = 'user',
): Promise<void> {
  const currentPrintSettings = await getPrintSettings(ctx, sheetId);
  const merged: PrintSettings = { ...currentPrintSettings, ...printSettings };

  const perSheetRaw = await ctx.computeBridge.getWorkbookSetting('sheetPrintSettings');
  const perSheet =
    perSheetRaw && typeof perSheetRaw === 'object'
      ? (perSheetRaw as Record<string, PrintSettings>)
      : {};

  void ctx.computeBridge.setWorkbookSetting('sheetPrintSettings', {
    ...perSheet,
    [sheetId]: merged,
  });
}
