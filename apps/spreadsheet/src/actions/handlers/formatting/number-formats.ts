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

/**
 * Apply a number format to selected cells.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 *
 * Performance: Uses setFormatForRanges for O(1) full row/column formatting.
 */
async function applyNumberFormat(deps: ActionDependencies, format: string): Promise<ActionResult> {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

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
  applyNumberFormat(deps, 'h:mm:ss AM/PM');
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
  const { pendingNumberFormat } = getUIStore(deps).getState();

  if (!pendingNumberFormat) {
    return handled(); // Nothing to apply
  }

  // Apply the pending format using the shared helper
  const result = await applyNumberFormat(deps, pendingNumberFormat);

  // Clear pending format after applying
  callUIStoreAction(deps, (state) => state.clearPendingNumberFormat());

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
  const activeCellFormat = ws.viewport.getCellData(activeCell.row, activeCell.col)?.format as
    | Record<string, unknown>
    | undefined;
  const currentFormat = (activeCellFormat?.numberFormat as string) ?? 'General';
  const currentDecimals = getDecimalCount(currentFormat);
  const newDecimals = Math.min(currentDecimals + 1, 10);
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
  const activeCellFormat = ws.viewport.getCellData(activeCell.row, activeCell.col)?.format as
    | Record<string, unknown>
    | undefined;
  const currentFormat = (activeCellFormat?.numberFormat as string) ?? 'General';
  const currentDecimals = getDecimalCount(currentFormat);
  // Default to 2 decimals if current format has none (e.g., 'General')
  const effectiveDecimals = currentDecimals || 2;
  const newDecimals = Math.max(effectiveDecimals - 1, 0);
  const newFormat = formatWithDecimals(currentFormat, newDecimals);

  // Apply to all selected ranges on ALL selected sheets
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { numberFormat: newFormat });
  }

  return handled();
};
