/**
 * Print/Export Action Handlers
 *
 * Pure handler functions for print and export-related actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps, payload) => ActionResult
 * - Print/export actions delegate to UIStore (print slices) and Sheets domain
 *
 * This file handles:
 * - EXPORT_PDF: Export current sheet/workbook to PDF
 * - TOGGLE_PAGE_BREAK_PREVIEW: Toggle page break preview mode
 * - SET_PRINT_AREA: Set the print area for the current sheet
 * - CLEAR_PRINT_AREA: Clear the print area for the current sheet
 * - ADD_TO_PRINT_AREA: Add selection to existing print area
 * - RESET_PAGE_BREAKS: Remove all manual page breaks
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { CellRange } from '@mog-sdk/contracts/core';

import { rangeToA1 } from '@mog-sdk/kernel';

import { getUIStore, handled, notHandled } from './handler-utils';

/**
 * Convert multiple ranges to a comma-separated A1 notation string.
 * Used for print areas that can span multiple discontinuous ranges.
 */
function rangesToPrintArea(ranges: CellRange[]): string {
  return ranges.map((range) => rangeToA1(range)).join(',');
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * EXPORT_PDF
 *
 * Exports the current sheet or workbook to PDF.
 * Opens the export dialog or triggers direct export based on payload.
 *
 * Payload (optional):
 * - scope: 'selection' | 'sheet' | 'workbook' - What to export
 * - openDialog: boolean - Whether to open export dialog first
 */
export const EXPORT_PDF: ActionHandler = (
  deps: ActionDependencies,
  payload?: { scope?: 'selection' | 'sheet' | 'workbook'; openDialog?: boolean },
): ActionResult => {
  if (deps.featureGates?.capabilities?.fileMenu === false) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);

  // Default to opening backstage with export panel if no specific instructions
  if (payload?.openDialog !== false) {
    // Open backstage to export panel
    uiStore.getState().openBackstage();
    uiStore.getState().setActivePanel('export');
    return handled();
  }

  // Direct export not yet implemented - requires PDF generation library integration
  // For now, always open the backstage export panel
  uiStore.getState().openBackstage();
  uiStore.getState().setActivePanel('export');

  return handled();
};

/**
 * EXPORT_TO_PDF - Alias for EXPORT_PDF.
 * Maintains backwards compatibility with code expecting EXPORT_TO_PDF.
 */
export const EXPORT_TO_PDF = EXPORT_PDF;

/**
 * TOGGLE_PAGE_BREAK_PREVIEW
 *
 * Toggles the page break preview view mode.
 * In this mode, users can see and drag page break lines.
 *
 * Uses UIStore's pageBreakPreviewMode from the MiscSlice.
 */
export const TOGGLE_PAGE_BREAK_PREVIEW: ActionHandler = (
  deps: ActionDependencies,
): ActionResult => {
  const uiStore = getUIStore(deps);

  // Toggle page break preview mode in UIStore
  uiStore.getState().togglePageBreakPreviewMode();

  return handled();
};

/**
 * SET_PRINT_AREA
 *
 * Sets the print area for the current sheet to the current selection.
 * Replaces any existing print area.
 */
export const SET_PRINT_AREA: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();

  // Get current selection ranges via accessor, constrained to data bounds
  const ranges = deps.accessors.selection.getDataBoundedRanges(sheetId);

  if (ranges.length === 0) {
    // No selection, cannot set print area
    return notHandled('disabled');
  }

  // Convert ranges to A1 notation
  const printArea = rangesToPrintArea(ranges);

  const ws = deps.workbook.getSheetById(sheetId);
  await ws.print.setArea(printArea);

  return handled();
};

/**
 * CLEAR_PRINT_AREA
 *
 * Clears the print area for the current sheet.
 * The entire used range will be printed.
 */
export const CLEAR_PRINT_AREA: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();

  const ws = deps.workbook.getSheetById(sheetId);
  await ws.print.clearArea();

  return handled();
};

/**
 * ADD_TO_PRINT_AREA
 *
 * Adds the current selection to the existing print area.
 * If no print area exists, sets the selection as the print area.
 *
 * Note: Excel stores multiple print areas as comma-separated discontinuous ranges.
 * We append the new selection to the existing print area string.
 */
export const ADD_TO_PRINT_AREA: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();

  // Get current selection ranges via accessor, constrained to data bounds
  const ranges = deps.accessors.selection.getDataBoundedRanges(sheetId);

  if (ranges.length === 0) {
    // No selection, cannot add to print area
    return notHandled('disabled');
  }

  const ws = deps.workbook.getSheetById(sheetId);

  // Get existing print area
  const existingPrintArea = await ws.print.getArea();

  // Convert new ranges to A1 notation
  const newRanges = rangesToPrintArea(ranges);

  // Combine with existing print area
  let updatedPrintArea: string;
  if (existingPrintArea) {
    // Append new ranges to existing print area
    updatedPrintArea = `${existingPrintArea},${newRanges}`;
  } else {
    // No existing print area, use new selection
    updatedPrintArea = newRanges;
  }

  // Update print area
  await ws.print.setArea(updatedPrintArea);

  return handled();
};

/**
 * RESET_PAGE_BREAKS
 *
 * Removes all manual page breaks from the current sheet.
 * Automatic page breaks based on page size and margins are preserved.
 */
export const RESET_PAGE_BREAKS: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();

  const ws = deps.workbook.getSheetById(sheetId);
  await ws.print.clearPageBreaks();

  return handled();
};

/**
 * TOGGLE_PRINT_GRIDLINES
 *
 * Toggle whether gridlines are included in printed output for the active sheet.
 * Reads current `gridlines` flag from print settings, writes the inverse.
 *
 * Page Layout dispatch: logic moved from
 * `apps/spreadsheet/src/hooks/file-io/use-sheet-print-settings.ts:73-78`.
 */
export const TOGGLE_PRINT_GRIDLINES: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const current = await ws.print.getSettings();
  await ws.print.setSettings({ gridlines: !current.gridlines });

  return handled();
};

/**
 * TOGGLE_PRINT_HEADINGS
 *
 * Toggle whether row + column headings are included in printed output for
 * the active sheet. Reads current `headings` flag from print settings,
 * writes the inverse.
 *
 * Page Layout dispatch: logic moved from
 * `apps/spreadsheet/src/hooks/file-io/use-sheet-print-settings.ts:80-85`.
 */
export const TOGGLE_PRINT_HEADINGS: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const current = await ws.print.getSettings();
  await ws.print.setSettings({ headings: !current.headings });

  return handled();
};

// =============================================================================
// Backstage Print View
// =============================================================================

/**
 * Print scope type for SET_PRINT_SCOPE action.
 */
export type PrintScope = 'active_sheet' | 'workbook' | 'selection';

/**
 * SET_PRINT_SCOPE
 *
 * Sets what to print: active sheet, entire workbook, or current selection.
 * Used in the Backstage Print View "Print What" dropdown.
 *
 * Payload:
 * - scope: 'active_sheet' | 'workbook' | 'selection'
 *
 * Backstage Print View
 */
export const SET_PRINT_SCOPE: ActionHandler = (
  deps: ActionDependencies,
  payload?: { scope: PrintScope },
): ActionResult => {
  if (!payload?.scope) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);

  // Store the print scope in UIStore for use by print preview/export
  uiStore.getState().setPrintScope?.(payload.scope);

  return handled();
};

/**
 * SET_PRINT_PAGE_RANGE
 *
 * Sets a specific page range to print (e.g., pages 1-3).
 * Used in the Backstage Print View page range inputs.
 *
 * Payload:
 * - from?: number - Starting page (1-indexed)
 * - to?: number - Ending page (1-indexed, undefined = to end)
 *
 * Backstage Print View
 */
export const SET_PRINT_PAGE_RANGE: ActionHandler = (
  deps: ActionDependencies,
  payload?: { from?: number; to?: number },
): ActionResult => {
  const uiStore = getUIStore(deps);

  // Store the page range in UIStore for use by print preview/export
  // from/to can be undefined to clear the range (print all pages)
  uiStore.getState().setPrintPageRange?.({
    from: payload?.from,
    to: payload?.to,
  });

  return handled();
};

// =============================================================================
// Quick Print
// =============================================================================

/**
 * QUICK_PRINT
 *
 * Prints directly using current print settings and default printer.
 * Bypasses the print dialog for quick output.
 *
 * calls `window.print` directly. `window.print` is a browser
 * API that works the same on web and Tauri (Tauri exposes the same DOM
 * interface), so this is not a platform-bridged operation.
 *
 * Keyboard shortcut: Ctrl+Shift+F12
 */
export const QUICK_PRINT: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const bridge = deps.hostCommands;
  if (bridge) {
    const owner = bridge.getOwner('print');
    if (owner === 'disabled') return notHandled('disabled');
    if (owner === 'host') {
      const result = await bridge.request({ command: 'print', source: 'keyboard' });
      if (result.status === 'handled') return handled();
      if (result.status === 'denied') {
        return { handled: false, reason: 'blocked', error: result.reason };
      }
      return { handled: false, reason: 'blocked' };
    }
  }

  if (typeof window === 'undefined' || typeof window.print !== 'function') {
    return notHandled('disabled');
  }
  window.print();
  return handled();
};
