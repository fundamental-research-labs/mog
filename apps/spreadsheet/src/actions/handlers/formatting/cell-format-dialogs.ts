/**
 * Cell Format Dialog Action Handlers
 *
 * Handles Format Cells dialog integration for non-font, non-border tabs:
 * - Alignment tab (APPLY_ALIGNMENT_FORMAT)
 * - Fill tab (APPLY_FILL_FORMAT)
 * - Protection tab (APPLY_PROTECTION_FORMAT)
 * - Table insertion (INSERT_TABLE)
 *
 * All handlers use the Draft + Apply pattern:
 * 1. Dialog stores pending format in UIStore
 * 2. Dialog dispatches action (no payload)
 * 3. Handler reads pending format, applies it, clears it
 *
 * Multi-sheet support for broadcasting changes
 */

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { CellFormat } from '@mog-sdk/contracts/core';

import { resolveDataDialogTarget } from '../../data-command-target';
import {
  callUIStoreAction,
  getSelectionContext,
  getTargetSheetIds,
  getUIStore,
  handled,
} from './shared';
import { applyCenterAcrossSelectionFormat } from './center-across-selection';
import { normalizeSolidFillFormat } from './fill-format';
import { autoFitRowsForBoundedRanges } from './row-autofit';

// =============================================================================
// Type Guards for Alignment Values
// =============================================================================

const HORIZONTAL_ALIGNS = [
  'general',
  'left',
  'center',
  'right',
  'fill',
  'justify',
  'centerContinuous',
  'distributed',
] as const;
const VERTICAL_ALIGNS = ['top', 'middle', 'bottom', 'justify', 'distributed'] as const;

function isHorizontalAlign(value: string): value is NonNullable<CellFormat['horizontalAlign']> {
  return (HORIZONTAL_ALIGNS as readonly string[]).includes(value);
}

function isVerticalAlign(value: string): value is NonNullable<CellFormat['verticalAlign']> {
  return (VERTICAL_ALIGNS as readonly string[]).includes(value);
}

function refreshActiveCellFormat(
  deps: Parameters<AsyncActionHandler>[0],
  activeCell: { row: number; col: number },
): void {
  const format =
    (deps.workbook.activeSheet.viewport.getCellData(activeCell.row, activeCell.col)?.format as
      | CellFormat
      | undefined) ?? null;
  callUIStoreAction(deps, (state) => state.setActiveCellFormat(format));
}

// =============================================================================
// Format Cells Dialog Handlers
// =============================================================================

/**
 * Apply alignment format from Format Cells dialog.
 * Reads pending format from UIStore (set by dialog before dispatch).
 *
 * This handler is called when user clicks Apply/OK in the Alignment tab.
 * The dialog accumulates changes in local state, stores them in UIStore,
 * then dispatches this action to apply them via Mutations.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 *
 */
export const APPLY_ALIGNMENT_FORMAT: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // Read pending format from UIStore (set by dialog before dispatch)
  const { pendingAlignmentFormat } = getUIStore(deps).getState();
  if (!pendingAlignmentFormat) {
    return handled();
  }

  if (pendingAlignmentFormat.horizontalAlign === 'centerContinuous') {
    const result = await applyCenterAcrossSelectionFormat(deps, pendingAlignmentFormat);
    if (result.handled && !result.error) {
      callUIStoreAction(deps, (state) => state.clearPendingAlignmentFormat());
      if (pendingAlignmentFormat.wrapText !== undefined) {
        await autoFitRowsForBoundedRanges(deps, ranges);
      }
      if (
        typeof pendingAlignmentFormat.textRotation === 'number' &&
        pendingAlignmentFormat.textRotation !== 0
      ) {
        await autoFitRowsForBoundedRanges(deps, ranges);
      }
    }
    return result;
  }

  // Apply to all selected ranges on ALL selected sheets
  // Uses setFormatForRanges for O(1) full row/column performance
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, pendingAlignmentFormat);
  }

  // Clear pending format
  callUIStoreAction(deps, (state) => state.clearPendingAlignmentFormat());

  // Auto-fit affected rows whenever wrap-text changes so disabling it can
  // shrink previously wrapped rows back to their content height.
  if (pendingAlignmentFormat.wrapText !== undefined) {
    await autoFitRowsForBoundedRanges(deps, ranges);
  }
  if (
    typeof pendingAlignmentFormat.textRotation === 'number' &&
    pendingAlignmentFormat.textRotation !== 0
  ) {
    await autoFitRowsForBoundedRanges(deps, ranges);
  }

  return handled();
};

/**
 * Apply fill format from Format Cells dialog.
 * Reads pendingFillFormat from UIStore (set by FillTab) and applies to selection.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 *
 */
export const APPLY_FILL_FORMAT: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // Read pending format from UIStore (set by FillTab before dispatch)
  const pendingFillFormat = getUIStore(deps).getState().pendingFillFormat;
  if (!pendingFillFormat) {
    return handled();
  }

  // Apply to all selected ranges on ALL selected sheets
  // Uses setFormatForRanges for O(1) full row/column performance
  const fillFormat = normalizeSolidFillFormat(pendingFillFormat);
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, fillFormat);
  }

  // Clear pending format after applying
  callUIStoreAction(deps, (state) => state.clearPendingFillFormat());
  return handled();
};

/**
 * Apply Protection Format (A6.6)
 *
 * Applies cell protection properties (locked, hidden) from Protection tab to selected cells.
 * Protection only takes effect when the sheet is protected.
 *
 */
export const APPLY_PROTECTION_FORMAT: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // Read pending format from UIStore (set by ProtectionTab before dispatch)
  const pendingProtectionFormat = getUIStore(deps).getState().pendingProtectionFormat;
  if (!pendingProtectionFormat) {
    return handled();
  }

  // Apply to all selected ranges on ALL selected sheets
  // Uses setFormatForRanges for O(1) full row/column performance
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, pendingProtectionFormat);
  }

  // Clear pending format after applying
  callUIStoreAction(deps, (state) => state.clearPendingProtectionFormat());
  return handled();
};

// =============================================================================
// Table and Merge Handlers
// =============================================================================

/**
 * Insert a table - opens the Insert Table dialog via UIStore.
 *
 * Excel parity: when a single cell (or single row) is selected, auto-expand
 * to the contiguous data region so the dialog seeds with the user's data
 * block instead of just the click target. Pass the resolved range to the
 * dialog via `openInsertTableDialog(range)` — the dialog reads it from the
 * UIStore field `insertTableInitialRange` to override its selection-derived
 * default.
 *
 * Section 16 Compliance: Dialog opening uses UIStore, not onUIAction.
 *
 */
export const INSERT_TABLE: AsyncActionHandler = async (
  deps,
  payload?: { stylePreset?: import('@mog-sdk/contracts/tables').TableStylePreset },
) => {
  const sheetId = deps.getActiveSheetId();
  const { ranges } = getSelectionContext(deps);
  if (ranges.length === 0) {
    return { handled: false, reason: 'disabled' };
  }

  const ws = deps.workbook.getSheetById(sheetId);
  const target = await resolveDataDialogTarget(ws, ranges[0]);

  const uiState = getUIStore(deps).getState();
  if (uiState?.openInsertTableDialog) {
    uiState.openInsertTableDialog({
      range: target.range,
      hasHeaders: target.hasHeaders,
      ...(payload?.stylePreset ? { stylePreset: payload.stylePreset } : {}),
    });
    return handled();
  }
  return { handled: false, reason: 'disabled' };
};

// =============================================================================
// Direct Alignment Handlers (Toolbar Unification)
// =============================================================================

/**
 * Set horizontal alignment for selected cells.
 * Multi-sheet support
 */
export const SET_HORIZONTAL_ALIGN: AsyncActionHandler = async (
  deps,
  payload?: { align: string },
) => {
  if (!payload || !isHorizontalAlign(payload.align)) {
    return { handled: false, reason: 'disabled' };
  }

  const horizontalAlign = payload.align;
  if (horizontalAlign === 'centerContinuous') {
    return applyCenterAcrossSelectionFormat(deps, { horizontalAlign });
  }

  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { horizontalAlign });
  }

  return handled();
};

/**
 * Set vertical alignment for selected cells.
 * Multi-sheet support
 */
export const SET_VERTICAL_ALIGN: AsyncActionHandler = async (deps, payload?: { align: string }) => {
  if (!payload || !isVerticalAlign(payload.align)) {
    return { handled: false, reason: 'disabled' };
  }

  const verticalAlign = payload.align;
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { verticalAlign });
  }

  return handled();
};

/**
 * Set text rotation for selected cells.
 * Multi-sheet support
 */
export const SET_TEXT_ROTATION: AsyncActionHandler = async (
  deps,
  payload?: { rotation: number },
) => {
  if (payload === undefined || typeof payload.rotation !== 'number') {
    return { handled: false, reason: 'disabled' };
  }

  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { textRotation: payload.rotation });
  }

  if (payload.rotation !== 0) {
    await autoFitRowsForBoundedRanges(deps, ranges);
  }

  return handled();
};

/**
 * Increase indent level for selected cells.
 * Multi-sheet support
 */
export const INCREASE_INDENT: AsyncActionHandler = async (deps) => {
  const ws = deps.workbook.activeSheet;
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Read current indent from active cell via viewport buffer (always up-to-date)
  const activeCellFormat = ws.viewport.getCellData(activeCell.row, activeCell.col)?.format as
    | Record<string, unknown>
    | undefined;
  const currentIndent = (activeCellFormat?.indent as number) ?? 0;
  const newIndent = currentIndent + 1;

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { indent: newIndent });
  }
  refreshActiveCellFormat(deps, activeCell);

  return handled();
};

/**
 * Decrease indent level for selected cells.
 * Multi-sheet support
 */
export const DECREASE_INDENT: AsyncActionHandler = async (deps) => {
  const ws = deps.workbook.activeSheet;
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Read current indent from active cell via viewport buffer (always up-to-date)
  const activeCellFormat = ws.viewport.getCellData(activeCell.row, activeCell.col)?.format as
    | Record<string, unknown>
    | undefined;
  const currentIndent = (activeCellFormat?.indent as number) ?? 0;
  const newIndent = Math.max(0, currentIndent - 1);

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { indent: newIndent });
  }
  refreshActiveCellFormat(deps, activeCell);

  return handled();
};
