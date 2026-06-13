/**
 * Slicer Action Handlers
 *
 * Pure handler functions for slicer operations.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps, payload?) => ActionResult
 * - Data mutations use Worksheet API (ws.* methods)
 * - Dialog operations use UIStore directly
 * - onUIAction is ONLY used for browser APIs (not data mutations)
 *
 * Worksheet API migration (z-order, delete, duplicate)
 * - Z-order: ws.bringSlicerToFront, ws.sendSlicerToBack, ws.bringSlicerForward, ws.sendSlicerBackward
 * - Delete: ws.removeSlicer (was coordinator deleteSlicer)
 * - Duplicate/Paste: ws.duplicateSlicer (was coordinator duplicateSlicer)
 * - Removed: coordinator/mutations/slicers imports for z-order, delete, duplicate
 *
 * This file handles:
 * - Cut, Copy, Paste slicer
 * - Slicer Settings
 * - Report Connections
 * - Size and Properties
 * - Z-Order operations
 * - Delete slicer
 *
 * onUIAction Misuse Fix
 */

import type { ActionHandler, ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { Slicer } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// Slicer Clipboard Actions
// =============================================================================

/**
 * CUT_SLICER - Cut slicer to clipboard, then mark for delete on paste.
 * Payload: { slicerId: string }
 *
 * Now async — reads slicer via Worksheet API (ws.getSlicer).
 */
export const CUT_SLICER: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const slicerId = payload?.slicerId;
  if (!slicerId) {
    return { handled: false, error: 'Missing slicerId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Read slicer config via Worksheet API
  const slicer = await ws.slicers.get(slicerId);
  if (!slicer) {
    return { handled: false, error: `Slicer ${slicerId} not found` };
  }

  // Store in UIStore clipboard with isCut flag
  // TODO: slicer clipboard not yet in UIState
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();
  if (uiStore && state.setSlicerClipboard) {
    state.setSlicerClipboard({
      slicer,
      isCut: true,
      sourceSheetId: sheetId,
    });
  }

  return handled();
};

/**
 * COPY_SLICER - Copy slicer to clipboard.
 * Payload: { slicerId: string }
 *
 * Now async — reads slicer via Worksheet API (ws.getSlicer).
 */
export const COPY_SLICER: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const slicerId = payload?.slicerId;
  if (!slicerId) {
    return { handled: false, error: 'Missing slicerId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Read slicer config via Worksheet API
  const slicer = await ws.slicers.get(slicerId);
  if (!slicer) {
    return { handled: false, error: `Slicer ${slicerId} not found` };
  }

  // Store in UIStore clipboard
  // TODO: slicer clipboard not yet in UIState
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();
  if (uiStore && state.setSlicerClipboard) {
    state.setSlicerClipboard({
      slicer,
      isCut: false,
      sourceSheetId: sheetId,
    });
  }

  return handled();
};

/**
 * PASTE_SLICER - Paste slicer from clipboard.
 */
export const PASTE_SLICER: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }

  // TODO: slicer clipboard not yet in UIState
  const state = uiStore.getState();
  const clipboard = state.slicerClipboard as
    | { slicer: Slicer; isCut: boolean; sourceSheetId: SheetId }
    | undefined;

  if (!clipboard?.slicer) {
    return { handled: false, reason: 'disabled' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Worksheet API migration — use ws.duplicateSlicer
  try {
    await ws.slicers.duplicate(clipboard.slicer.id, { x: 20, y: 20 });
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  // If this was a cut operation, delete the original slicer
  if (clipboard.isCut) {
    const sourceWs = deps.workbook.getSheetById(clipboard.sourceSheetId);
    await sourceWs.slicers.remove(clipboard.slicer.id);

    // Clear clipboard after cut-paste
    // TODO: slicer clipboard not yet in UIState
    if (state.clearSlicerClipboard) {
      state.clearSlicerClipboard();
    }
  }

  return handled();
};

// =============================================================================
// Slicer Settings/Properties Actions
// =============================================================================

/**
 * OPEN_SLICER_SETTINGS - Open slicer settings dialog.
 * Payload: { slicerId: string }
 *
 * This opens a dialog via UIStore - NOT a data mutation.
 */
export const OPEN_SLICER_SETTINGS: ActionHandler = (deps, payload): ActionResult => {
  const slicerId = payload?.slicerId;
  if (!slicerId) {
    return { handled: false, error: 'Missing slicerId in payload' };
  }

  // TODO: Should read current slicer settings from Worksheet API to populate dialog.
  // For now opens with defaults (pre-existing — handler was never functional with correct API).
  getUIStore(deps).getState().openSlicerSettingsPanel(slicerId, {
    caption: '',
    stylePreset: 'light1',
    columnCount: 1,
    buttonHeight: 24,
    showHeader: true,
    showSelectionIndicator: true,
    crossFilter: 'showItemsWithDataAtTop',
    sortOrder: 'ascending',
  });

  return handled();
};

/**
 * CLOSE_SLICER_SETTINGS - Close slicer settings dialog.
 */
export const CLOSE_SLICER_SETTINGS: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeSlicerSettingsPanel();
  return handled();
};

/**
 * OPEN_SLICER_REPORT_CONNECTIONS - Open report connections dialog.
 * Payload: { slicerId: string }
 *
 * This opens a dialog via UIStore - NOT a data mutation.
 */
export const OPEN_SLICER_REPORT_CONNECTIONS: ActionHandler = (deps, payload): ActionResult => {
  const slicerId = payload?.slicerId;
  if (!slicerId) {
    return { handled: false, error: 'Missing slicerId in payload' };
  }

  // TODO: slicer report-connections not yet in UIState
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();
  if (uiStore && state.openSlicerReportConnections) {
    state.openSlicerReportConnections(slicerId);
  }

  return handled();
};

/**
 * CLOSE_SLICER_REPORT_CONNECTIONS - Close report connections dialog.
 */
export const CLOSE_SLICER_REPORT_CONNECTIONS: ActionHandler = (deps): ActionResult => {
  // TODO: slicer report-connections not yet in UIState
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();
  if (uiStore && state.closeSlicerReportConnections) {
    state.closeSlicerReportConnections();
  }

  return handled();
};

// =============================================================================
// Slicer Connections Dialog Actions
// =============================================================================

/**
 * OPEN_SLICER_CONNECTIONS - Open the slicer connections dialog.
 * Payload: { slicerId: string }
 *
 * This opens a dialog via UIStore - NOT a data mutation.
 */
export const OPEN_SLICER_CONNECTIONS: ActionHandler = (deps, payload): ActionResult => {
  const slicerId = payload?.slicerId;
  if (!slicerId) {
    return { handled: false, error: 'Missing slicerId in payload' };
  }

  // For now, open with empty connections and no source column
  // The actual connection data should be fetched from the slicer domain
  getUIStore(deps).getState().openSlicerConnectionsDialog(slicerId, [], '');

  return handled();
};

/**
 * UPDATE_SLICER_CONNECTIONS - Update slicer connections and close dialog.
 * Payload: { slicerId: string, connections: string[] }
 *
 * TODO: This should use Mutations layer if it writes to Yjs.
 * For now, it only updates UIStore state.
 */
export const UPDATE_SLICER_CONNECTIONS: ActionHandler = (deps, payload): ActionResult => {
  const slicerId = payload?.slicerId;
  const connections = payload?.connections;

  if (!slicerId || !Array.isArray(connections)) {
    return { handled: false, error: 'Missing slicerId or connections in payload' };
  }

  const state = getUIStore(deps).getState();
  state.updateSlicerConnections(slicerId, connections);
  state.closeSlicerConnectionsDialog();

  return handled();
};

/**
 * CLOSE_SLICER_CONNECTIONS_DIALOG - Close slicer connections dialog without applying changes.
 */
export const CLOSE_SLICER_CONNECTIONS_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeSlicerConnectionsDialog();
  return handled();
};

/**
 * OPEN_SLICER_SIZE_PROPERTIES - Open size and properties panel.
 * Payload: { slicerId: string }
 *
 * This opens a panel via UIStore - NOT a data mutation.
 */
export const OPEN_SLICER_SIZE_PROPERTIES: ActionHandler = (deps, payload): ActionResult => {
  const slicerId = payload?.slicerId;
  if (!slicerId) {
    return { handled: false, error: 'Missing slicerId in payload' };
  }

  // TODO: slicer size-properties not yet in UIState
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();
  if (uiStore && state.openSlicerSizeProperties) {
    state.openSlicerSizeProperties(slicerId);
  }

  return handled();
};

/**
 * CLOSE_SLICER_SIZE_PROPERTIES - Close size and properties panel.
 */
export const CLOSE_SLICER_SIZE_PROPERTIES: ActionHandler = (deps): ActionResult => {
  // TODO: slicer size-properties not yet in UIState
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();
  if (uiStore && state.closeSlicerSizeProperties) {
    state.closeSlicerSizeProperties();
  }

  return handled();
};

// =============================================================================
// Slicer Z-Order Actions
// =============================================================================

/**
 * BRING_SLICER_TO_FRONT - Bring slicer to highest z-index.
 * Payload: { slicerId: string }
 */
export const BRING_SLICER_TO_FRONT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const slicerId = payload?.slicerId;
  if (!slicerId) {
    return { handled: false, error: 'Missing slicerId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    await ws.objects.bringToFront(slicerId);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * SEND_SLICER_TO_BACK - Send slicer to lowest z-index.
 * Payload: { slicerId: string }
 */
export const SEND_SLICER_TO_BACK: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const slicerId = payload?.slicerId;
  if (!slicerId) {
    return { handled: false, error: 'Missing slicerId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    await ws.objects.sendToBack(slicerId);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * BRING_SLICER_FORWARD - Bring slicer forward by one layer.
 * Payload: { slicerId: string }
 */
export const BRING_SLICER_FORWARD: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const slicerId = payload?.slicerId;
  if (!slicerId) {
    return { handled: false, error: 'Missing slicerId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    await ws.objects.bringForward(slicerId);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * SEND_SLICER_BACKWARD - Send slicer backward by one layer.
 * Payload: { slicerId: string }
 */
export const SEND_SLICER_BACKWARD: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const slicerId = payload?.slicerId;
  if (!slicerId) {
    return { handled: false, error: 'Missing slicerId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    await ws.objects.sendBackward(slicerId);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

// =============================================================================
// Slicer Delete Action
// =============================================================================

/**
 * DELETE_SLICER - Delete a slicer.
 * Payload: { slicerId: string }
 */
export const DELETE_SLICER: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const slicerId = payload?.slicerId;
  if (!slicerId) {
    return { handled: false, error: 'Missing slicerId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    await ws.slicers.remove(slicerId);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

// =============================================================================
// Insert Slicer Dialog Action
// =============================================================================

/**
 * OPEN_INSERT_SLICER_DIALOG - Open the Insert Slicer dialog.
 *
 * This gathers table info at the current selection and opens the dialog.
 * Only works when the active cell is inside a table.
 *
 * Reads slicer data via Worksheet API (ws.listSlicers).
 */
export const OPEN_INSERT_SLICER_DIALOG: AsyncActionHandler = async (
  deps,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Get active cell position using the accessor pattern
  const activeCell = deps.accessors.selection.getActiveCell();
  if (!activeCell) {
    return notHandled('disabled');
  }

  const { row: activeRow, col: activeCol } = activeCell;

  // Use Worksheet API for table lookup at cell position
  const tableAtSelection = await ws.tables.getAtCell(activeRow, activeCol);
  if (!tableAtSelection) {
    // Selection is not in a table - this should be disabled at the UI level
    return notHandled('disabled');
  }

  // Get existing slicers via Worksheet API to check which columns already have slicers
  const allSlicers = await ws.slicers.list();
  const existingSlicers = allSlicers.filter(
    (s: any) => s.source?.type === 'table' && s.source?.tableId === tableAtSelection.id,
  );
  const existingColumnCellIds = new Set(
    existingSlicers
      .filter((s: any) => s.source.type === 'table')
      .map((s: any) => (s.source as { columnCellId: string }).columnCellId),
  );

  // Build column options from table columns
  // Each column in the table can have a slicer
  // Parse the table range to get header row/col positions
  const rangeMatch = tableAtSelection.range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  const tableStartRow = rangeMatch ? parseInt(rangeMatch[2], 10) - 1 : 0;
  const tableStartCol = rangeMatch ? colLettersToIndex(rangeMatch[1]) : 0;

  const columns = await Promise.all(
    tableAtSelection.columns.map(async (col: any, index: number) => {
      // Get the CellId for this column's header via Worksheet API
      const headerRow = tableStartRow;
      const headerCol = tableStartCol + index;
      const cellId =
        (await ws._internal.getCellIdAt(headerRow, headerCol)) || `temp-${headerRow}-${headerCol}`;

      return {
        columnCellId: cellId,
        columnName: col.name,
        hasExistingSlicer: existingColumnCellIds.has(cellId),
      };
    }),
  );

  // Open the dialog via UIStore
  getUIStore(deps).getState().openInsertSlicerDialog('table', tableAtSelection.id, columns);

  return handled();
};

/** Convert column letters to 0-based index. */
function colLettersToIndex(letters: string): number {
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  }
  return result - 1;
}
