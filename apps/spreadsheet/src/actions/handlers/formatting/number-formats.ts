/**
 * Number Format Action Handlers
 *
 * Handles number format actions:
 * - Preset formats (General, Number, Currency, Percentage, etc.)
 * - Format Cells dialog integration
 * - Decimal place adjustment
 *
 * Multi-sheet support for broadcasting changes
 */

import type {
  ActionDependencies,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import { displayStringOrNull, type CellData, type CellRange } from '@mog-sdk/contracts/core';
import type { Direction } from '@mog-sdk/contracts/machines';

import {
  callUIStoreAction,
  getSelectionContext,
  getTargetSheetIds,
  getUIStore,
  handled,
} from './shared';

// =============================================================================
// Number Format Handlers
// =============================================================================

const POST_COMMIT_FORMAT_TARGET_TTL_MS = 10_000;

interface LastCommittedCellForFormatting {
  sheetId: string;
  row: number;
  col: number;
  direction: Direction | 'none' | null;
  committedAt: number;
}

interface CellCoordinate {
  row: number;
  col: number;
}

function isSingleCellRange(range: CellRange, cell: CellCoordinate): boolean {
  return (
    range.startRow === cell.row &&
    range.endRow === cell.row &&
    range.startCol === cell.col &&
    range.endCol === cell.col
  );
}

function cellAfterCommitNavigation(target: LastCommittedCellForFormatting): CellCoordinate | null {
  switch (target.direction) {
    case 'up':
      return target.row > 0 ? { row: target.row - 1, col: target.col } : null;
    case 'down':
      return { row: target.row + 1, col: target.col };
    case 'left':
      return target.col > 0 ? { row: target.row, col: target.col - 1 } : null;
    case 'right':
      return { row: target.row, col: target.col + 1 };
    case 'none':
    case null:
      return null;
  }
}

function cellHasContent(cell: CellData | null | undefined): boolean {
  if (!cell) return false;
  return (
    cell.formula !== undefined ||
    (cell.value !== null && cell.value !== undefined && cell.value !== '')
  );
}

async function getPostCommitNumberFormatRanges(
  deps: ActionDependencies,
  target: LastCommittedCellForFormatting | null,
): Promise<CellRange[] | null> {
  if (!target) return null;
  const now = deps.wallClockNow?.();
  if (now === undefined || now - target.committedAt > POST_COMMIT_FORMAT_TARGET_TTL_MS) {
    return null;
  }

  const activeSheetId = deps.getActiveSheetId();
  if (target.sheetId !== activeSheetId) return null;

  const movedCell = cellAfterCommitNavigation(target);
  if (!movedCell) return null;

  const { ranges } = getSelectionContext(deps);
  if (ranges.length !== 1 || !isSingleCellRange(ranges[0], movedCell)) return null;

  const ws = deps.workbook.getSheetById(activeSheetId);
  const [committedCell, selectedCell] = await Promise.all([
    ws.getCell(target.row, target.col),
    ws.getCell(movedCell.row, movedCell.col),
  ]);
  if (!cellHasContent(committedCell) || cellHasContent(selectedCell)) return null;

  return [
    {
      startRow: target.row,
      startCol: target.col,
      endRow: target.row,
      endCol: target.col,
    },
  ];
}

/**
 * Apply a number format to selected cells.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 *
 * Performance: Uses setFormatForRanges for O(1) full row/column formatting.
 */
async function applyNumberFormat(
  deps: ActionDependencies,
  format: string,
  rangesOverride?: CellRange[],
): Promise<ActionResult> {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges: selectedRanges } = getSelectionContext(deps);
  const ranges = rangesOverride ?? selectedRanges;

  // Apply to all selected ranges on ALL selected sheets
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { numberFormat: format });
  }

  return handled();
}

/**
 * Set number format for selected cells with a direct payload.
 * Used by toolbar hooks to apply custom/recent formats.
 *
 * @param payload.format - Number format string (e.g., '#,##0.00', '$#,##0.00')
 * @param payload.trackRecent - If true, adds to recent formats list (default: true)
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 *
 * Performance: Uses setFormatForRanges for O(1) full row/column formatting.
 */
export const SET_NUMBER_FORMAT: AsyncActionHandler = async (
  deps,
  payload?: { format: string; trackRecent?: boolean },
) => {
  if (!payload || typeof payload.format !== 'string') {
    return { handled: false, reason: 'disabled' };
  }

  // Apply the format
  const result = await applyNumberFormat(deps, payload.format);

  // Track in recent formats list (default: true)
  const shouldTrack = payload.trackRecent !== false && payload.format !== 'General';
  if (shouldTrack) {
    callUIStoreAction(deps, (state) => state.addRecentNumberFormat(payload.format));
  }

  return result;
};

export const FORMAT_GENERAL: AsyncActionHandler = async (deps) =>
  applyNumberFormat(deps, 'General');
export const FORMAT_NUMBER: AsyncActionHandler = async (deps) =>
  applyNumberFormat(deps, '#,##0.00');
export const FORMAT_TIME: AsyncActionHandler = async (deps) =>
  applyNumberFormat(deps, 'h:mm AM/PM');
export const FORMAT_DATE: AsyncActionHandler = async (deps) => applyNumberFormat(deps, 'd-mmm-yy');
export const FORMAT_CURRENCY: AsyncActionHandler = async (deps) =>
  applyNumberFormat(deps, '$#,##0.00');
export const FORMAT_PERCENTAGE: AsyncActionHandler = async (deps) => applyNumberFormat(deps, '0%');
export const FORMAT_SCIENTIFIC: AsyncActionHandler = async (deps) =>
  applyNumberFormat(deps, '0.00E+00');
export const FORMAT_COMMA: AsyncActionHandler = async (deps) => applyNumberFormat(deps, '#,##0.00');

/**
 * Apply number format from Format Cells Dialog.
 * Uses pending number format from UIStore (Draft + Apply pattern).
 *
 * Pattern:
 * 1. Dialog stores pending format in UIStore
 * 2. Dialog dispatches APPLY_NUMBER_FORMAT (no payload)
 * 3. Handler reads pending format, applies it, and clears it
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const APPLY_NUMBER_FORMAT: AsyncActionHandler = async (deps) => {
  // Read pending format from UIStore
  const { lastCommittedCellForFormatting, pendingNumberFormat } = getUIStore(deps).getState();

  if (!pendingNumberFormat) {
    return handled(); // Nothing to apply
  }

  // Apply the pending format using the shared helper
  const postCommitRanges = await getPostCommitNumberFormatRanges(
    deps,
    lastCommittedCellForFormatting,
  );
  const result = await applyNumberFormat(deps, pendingNumberFormat, postCommitRanges ?? undefined);

  // Clear pending format after applying
  callUIStoreAction(deps, (state) => state.clearPendingNumberFormat());
  callUIStoreAction(deps, (state) => state.clearLastCommittedCellForFormatting());

  // Update recent formats list (ephemeral UI state - OK in handler)
  callUIStoreAction(deps, (state) => state.addRecentNumberFormat(pendingNumberFormat));

  return result;
};

// =============================================================================
// Decimal Adjustment Handlers
// =============================================================================

/**
 * Extract the number of decimal places from a format code.
 */
function getDecimalCount(formatCode: string): number {
  const match = formatCode.match(/\.(\d*)/);
  return match ? match[1].length : 0;
}

/**
 * Count the decimal places actually shown in a cell's displayed text.
 *
 * Used for General/unformatted cells, whose format code carries no decimal
 * count. We measure the fractional digits of what the user currently sees so
 * that Increase/Decrease Decimal step one place at a time from the real
 * precision, matching Excel.
 */
function countDisplayedDecimals(displayText: string | null | undefined): number {
  if (!displayText) return 0;
  // Match the first run of digits after a decimal point, ignoring thousands
  // separators and any trailing symbols (%, currency, etc.).
  const match = displayText.match(/\.(\d+)/);
  return match ? match[1].length : 0;
}

/**
 * Decimal-place count to step from when adjusting Increase/Decrease Decimal.
 *
 * Explicit numeric formats carry the count in their code. General/unformatted
 * cells don't, so we fall back to the decimals shown in the cell — otherwise a
 * General "1.23456" would collapse straight to one decimal instead of stepping
 * 1.2346 → 1.235 → …
 */
function getBaseDecimals(currentFormat: string, displayText: string | null | undefined): number {
  const isGeneralFormat = currentFormat === '' || currentFormat === 'General';
  return isGeneralFormat ? countDisplayedDecimals(displayText) : getDecimalCount(currentFormat);
}

/**
 * Modify a number format to have a specific number of decimal places.
 */
function formatWithDecimals(baseFormat: string, decimals: number): string {
  // Handle special formats that shouldn't be modified
  if (baseFormat === 'General' || baseFormat === '@') {
    return decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`;
  }

  // Handle percentage formats
  if (baseFormat.includes('%')) {
    return decimals === 0 ? '0%' : `0.${'0'.repeat(decimals)}%`;
  }

  // Handle currency formats
  if (baseFormat.includes('$')) {
    return decimals === 0 ? '$#,##0' : `$#,##0.${'0'.repeat(decimals)}`;
  }

  // Handle comma/thousands formats
  if (baseFormat.includes(',')) {
    return decimals === 0 ? '#,##0' : `#,##0.${'0'.repeat(decimals)}`;
  }

  // Default numeric format
  return decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`;
}

/**
 * Increase decimal places in the number format of selected cells.
 * Maximum 10 decimal places.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 * - The base format is determined from the active cell on the active sheet
 *
 * Performance: Uses setFormatForRanges for O(1) full row/column formatting.
 */
export const INCREASE_DECIMALS: AsyncActionHandler = async (deps) => {
  const ws = deps.workbook.activeSheet;
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Get current format from active cell via viewport buffer (always up-to-date)
  const activeCellData = ws.viewport.getCellData(activeCell.row, activeCell.col);
  const activeCellFormat = activeCellData?.format as Record<string, unknown> | undefined;
  const currentFormat = (activeCellFormat?.numberFormat as string) ?? 'General';
  const baseDecimals = getBaseDecimals(
    currentFormat,
    displayStringOrNull(activeCellData?.displayText ?? null),
  );
  const newDecimals = Math.min(baseDecimals + 1, 10);
  const newFormat = formatWithDecimals(currentFormat, newDecimals);

  // Apply to all selected ranges on ALL selected sheets
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { numberFormat: newFormat });
  }

  return handled();
};

/**
 * Decrease decimal places in the number format of selected cells.
 * Minimum 0 decimal places.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 * - The base format is determined from the active cell on the active sheet
 *
 * Performance: Uses setFormatForRanges for O(1) full row/column formatting.
 */
export const DECREASE_DECIMALS: AsyncActionHandler = async (deps) => {
  const ws = deps.workbook.activeSheet;
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Get current format from active cell via viewport buffer (always up-to-date)
  const activeCellData = ws.viewport.getCellData(activeCell.row, activeCell.col);
  const activeCellFormat = activeCellData?.format as Record<string, unknown> | undefined;
  const currentFormat = (activeCellFormat?.numberFormat as string) ?? 'General';
  // Step down from the decimals actually shown. For General cells that means
  // the digits displayed (so "1.23456" walks 1.2346 → 1.235 → …); explicit
  // formats use their own code, so "0" correctly clamps at zero.
  const baseDecimals = getBaseDecimals(
    currentFormat,
    displayStringOrNull(activeCellData?.displayText ?? null),
  );
  const newDecimals = Math.max(baseDecimals - 1, 0);
  const newFormat = formatWithDecimals(currentFormat, newDecimals);

  // Apply to all selected ranges on ALL selected sheets
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { numberFormat: newFormat });
  }

  return handled();
};
