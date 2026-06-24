/**
 * File Operations, Backstage, Find, and Calculation Handlers
 *
 * This module contains UI action handlers for:
 * - File operations (save, open, new, close, print)
 * - Find operations (find next/previous)
 * - Calculation triggers (recalculate all/sheet)
 * - Data refresh operations
 * - Formula auditing (trace precedents/dependents)
 * - Backstage view actions
 *
 * Split from ui.ts for better maintainability.
 *
 * ARCHITECTURE NOTE:
 * - File operations (SAVE, OPEN, EXPORT_FILE, EXPORT_AS_*, BROWSE_FILES) flow
 * through `deps.platform.dialogs.*` returning a `PlatformFileHandle`. The
 * handler reads/writes bytes through that handle (FSA / Tauri / anchor
 * download — all behind one capability). 01 the related wiring
 * eliminated the inline `triggerDownload` / `triggerWebFilePicker` /
 * `window.__SHELL__` reach-arounds.
 * - NEW_WORKBOOK / CLOSE_WORKBOOK / CLOSE_FILE / OPEN_RECENT_FILE go through
 * `deps.shellService` for document-lifecycle ops.
 * - Formula auditing operations (TRACE_*, REMOVE_*) call UIStore directly
 * because they are simple state changes that don't need browser APIs.
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
  HostSpreadsheetCommand,
} from '@mog-sdk/contracts/actions';
import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { TraceArrow } from '@mog-sdk/contracts/trace-arrows';

import { cellRangeToA1, parseA1, toA1 } from '@mog/spreadsheet-utils/a1';

import type { BackstagePanelType } from '../../../ui-store/slices/ribbon/backstage';
import { getTracePrecedentSources } from '../../../utils/formula-auditing';
import { getUIStore, handled, notHandled } from '../handler-utils';

// =============================================================================
// File I/O helpers
// =============================================================================

const XLSX_FILTER = {
  name: 'XLSX Workbook',
  extensions: ['xlsx'],
};

const CSV_FILTER = {
  name: 'CSV (Comma delimited)',
  extensions: ['csv'],
};

const OPEN_FILTER = {
  name: 'Spreadsheets',
  extensions: ['xlsx', 'xls', 'csv'],
};

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/**
 * Derive a sensible base filename for downloads. Reads the active document's
 * stored `displayName` from `shellService.getDocumentState()`; falls back to
 * the file id; falls back to "Untitled".
 */
function getActiveFileBaseName(deps: ActionDependencies): string {
  const state = deps.shellService.getDocumentState();
  const activeId = state.activeFileId;
  if (activeId) {
    const file = state.files[activeId];
    const raw = file?.displayName ?? activeId;
    return raw.replace(/\.[^.]+$/, '') || 'Untitled';
  }
  return 'Untitled';
}

function selectionSqrefForExport(ranges: CellRange[], activeCellA1: string): string {
  const sqref = ranges.map(cellRangeToA1).filter(Boolean).join(' ');
  return sqref || activeCellA1;
}

interface SelectionSnapshotForXlsxExport {
  readonly activeCell?: { readonly row: number; readonly col: number } | null;
  readonly ranges?: CellRange[];
}

function isCellPosition(value: unknown): value is { readonly row: number; readonly col: number } {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as { readonly row?: unknown; readonly col?: unknown };
  return Number.isInteger(candidate.row) && Number.isInteger(candidate.col);
}

function getSelectionForXlsxExport(deps: ActionDependencies): {
  readonly activeCell: { readonly row: number; readonly col: number };
  readonly ranges: CellRange[];
} | null {
  const snapshot = deps.getSelection?.() as SelectionSnapshotForXlsxExport | undefined;
  const snapshotActiveCell = snapshot?.activeCell;
  const activeCell = isCellPosition(snapshotActiveCell)
    ? snapshotActiveCell
    : deps.accessors?.selection?.getActiveCell?.();

  if (!activeCell) return null;

  return {
    activeCell,
    ranges: snapshot?.ranges ?? deps.accessors?.selection?.getRanges?.() ?? [],
  };
}

async function persistActiveSheetSelectionForXlsxExport(deps: ActionDependencies): Promise<void> {
  const selection = getSelectionForXlsxExport(deps);
  if (!selection) return;

  const activeSheetId = deps.getActiveSheetId();
  const activeCellA1 = toA1(selection.activeCell.row, selection.activeCell.col);
  const ws = deps.workbook.getSheetById(activeSheetId);
  const settings = ws.settings as unknown as {
    set(key: 'activeCell' | 'sqref', value: string): Promise<void>;
  };

  await Promise.all([
    settings.set('activeCell', activeCellA1),
    settings.set('sqref', selectionSqrefForExport(selection.ranges, activeCellA1)),
  ]);
}

/**
 * Choose between an XLSX and CSV parser kind from the file basename.
 */
function inferKindFromName(name: string): 'xlsx' | 'csv' {
  return name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
}

function encodeCsvForDownload(csv: string): Uint8Array {
  const encoded = new TextEncoder().encode(csv);
  if (csv.charCodeAt(0) === 0xfeff) {
    return encoded;
  }

  const bytes = new Uint8Array(UTF8_BOM.byteLength + encoded.byteLength);
  bytes.set(UTF8_BOM, 0);
  bytes.set(encoded, UTF8_BOM.byteLength);
  return bytes;
}

async function routeHostCommand(
  deps: ActionDependencies,
  command: HostSpreadsheetCommand,
  options: { readonly format?: 'xlsx' | 'csv' | 'pdf' | 'json'; readonly source?: string } = {},
): Promise<ActionResult | null> {
  const bridge = deps.hostCommands;
  if (!bridge) return null;

  const owner = bridge.getOwner(command);
  if (owner === 'mog') return null;
  if (owner === 'disabled') return notHandled('disabled');

  const result = await bridge.request({ command, ...options });
  if (result.status === 'handled') return handled();
  if (result.status === 'denied')
    return { handled: false, reason: 'blocked', error: result.reason };
  return { handled: false, reason: 'blocked' };
}

function isFileMenuDisabled(deps: ActionDependencies): boolean {
  return deps.featureGates?.capabilities?.fileMenu === false;
}

// =============================================================================
// File Operations
// =============================================================================

/**
 * SAVE - Save the current workbook.
 *
 * Reuses the active document's stored `PlatformFileHandle` if present, so a
 * second SAVE writes through the same desktop file (or FSA write-through)
 * without re-prompting. If no handle is stored, prompts via
 * `dialogs.showSaveDialog` and persists the returned handle.
 */
export const SAVE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  await persistActiveSheetSelectionForXlsxExport(deps);
  const hostResult = await routeHostCommand(deps, 'save', { source: 'file-menu' });
  if (hostResult) return hostResult;

  const state = deps.shellService.getDocumentState();
  const activeId = state.activeFileId;
  const baseName = getActiveFileBaseName(deps);

  let handle = activeId ? (state.files[activeId]?.handle ?? null) : null;
  if (!handle) {
    handle = await deps.platform.dialogs.showSaveDialog({
      title: 'Save',
      defaultPath: `${baseName}.xlsx`,
      filters: [XLSX_FILTER],
    });
    if (!handle) {
      return notHandled('disabled');
    }
  }

  const bytes = await deps.workbook.toXlsx();
  await handle.write(bytes);
  if (activeId) {
    deps.shellService.setDocumentHandle(activeId, handle);
  }
  return handled();
};

/**
 * OPEN - Open a workbook file via the platform file dialog.
 *
 * Reads bytes through the returned `PlatformFileHandle`, hands them to the
 * shell service for parsing/hydration, and persists the handle so future
 * SAVEs can write through it.
 */
export const OPEN: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const hostResult = await routeHostCommand(deps, 'open', { source: 'file-menu' });
  if (hostResult) return hostResult;

  const handle = await deps.platform.dialogs.showOpenDialog({
    title: 'Open',
    filters: [OPEN_FILTER],
  });
  if (!handle) return notHandled('disabled');

  const bytes = await handle.read();
  const kind = inferKindFromName(handle.name);
  const fileId = await deps.shellService.loadDocument(handle.name, bytes, { kind });
  deps.shellService.setDocumentHandle(fileId, handle);
  return handled();
};

/**
 * NEW_WORKBOOK - Create a new empty workbook via the shell service.
 */
export const NEW_WORKBOOK: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  await deps.shellService.newDocument();
  return handled();
};

/**
 * EXPORT_FILE - Save As. Always prompts; never reuses the document handle.
 * Persists the new handle so the next SAVE writes through it.
 */
export const EXPORT_FILE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  await persistActiveSheetSelectionForXlsxExport(deps);
  const hostResult = await routeHostCommand(deps, 'export', {
    format: 'xlsx',
    source: 'file-menu',
  });
  if (hostResult) return hostResult;

  const baseName = getActiveFileBaseName(deps);
  const handle = await deps.platform.dialogs.showSaveDialog({
    title: 'Save As',
    defaultPath: `${baseName}.xlsx`,
    filters: [XLSX_FILTER],
  });
  if (!handle) return notHandled('disabled');

  const bytes = await deps.workbook.toXlsx();
  await handle.write(bytes);

  const activeId = deps.shellService.getDocumentState().activeFileId;
  if (activeId) {
    deps.shellService.setDocumentHandle(activeId, handle);
  }
  return handled();
};

/**
 * OPEN_COMMAND_PALETTE - Open the command palette via the UIStore.
 */
export const OPEN_COMMAND_PALETTE: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openCommandPalette();
  return handled();
};

/**
 * CLOSE_WORKBOOK - Close the active workbook via the shell service.
 */
export const CLOSE_WORKBOOK: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  await deps.shellService.closeActiveDocument();
  return handled();
};

/**
 * PRINT - Open print panel in backstage.
 *
 * Opens backstage directly instead of using callback pattern.
 * This ensures consistent behavior across all input sources (keyboard, toolbar, menu).
 */
export const PRINT: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const hostResult = await routeHostCommand(deps, 'print', { source: 'file-menu' });
  if (hostResult) return hostResult;
  if (isFileMenuDisabled(deps)) return notHandled('disabled');

  // Close editor if currently editing
  // MIGRATION: Uses deps.accessors.editor and deps.commands.editor instead of direct actor access
  if (deps.accessors?.editor?.isEditing()) {
    deps.commands?.editor?.cancel();
  }

  // Open backstage and navigate to print panel
  const uiStore = getUIStore(deps);
  uiStore.getState().openBackstage();
  uiStore.getState().setActivePanel('print');
  return handled();
};

// =============================================================================
// Find Operations
// =============================================================================

/**
 * F3 - Find next match.
 *
 * Find & Replace
 *
 * Sends FIND_NEXT event to find-replace actor. Returns `notHandled('disabled')`
 * if the actor command surface is unavailable (no `onUIAction`
 * fallback — there is no real handler on that channel).
 */
export const FIND_NEXT: ActionHandler = (deps): ActionResult => {
  if (deps.commands.findReplace) {
    deps.commands.findReplace.findNext();
    return handled();
  }
  return notHandled('disabled');
};

/**
 * Shift+F3 - Find previous match.
 *
 * Find & Replace
 *
 * Sends FIND_PREVIOUS event to find-replace actor. Returns
 * `notHandled('disabled')` if the actor command surface is unavailable.
 */
export const FIND_PREVIOUS: ActionHandler = (deps): ActionResult => {
  if (deps.commands.findReplace) {
    deps.commands.findReplace.findPrevious();
    return handled();
  }
  return notHandled('disabled');
};

// =============================================================================
// Calculation Actions
// =============================================================================

/**
 * F9 - Force recalculation of all formulas in all sheets.
 * This is handled directly in the action system (not through UI callback)
 * because it operates on the calculation engine.
 */
export const CALCULATE_ALL: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  await deps.workbook.calculate();
  return handled();
};

/**
 * Shift+F9 - Force recalculation of formulas in the current sheet only.
 */
export const CALCULATE_SHEET: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  await deps.workbook.calculate();
  return handled();
};

// =============================================================================
// Data Refresh Actions
// =============================================================================

/**
 * Refresh All Data - refresh all bound sheets and connections.
 *
 * Recalculates all formulas. 01 dropped the
 * `deps.onUIAction?.('REFRESH_ALL_DATA')` notification — it was an unwired
 * no-op on every shipping host. A future desktop connection-refresh service
 * would surface as `shellService.refreshConnections()`.
 */
export const REFRESH_ALL_DATA: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  await deps.workbook.calculate();
  return handled();
};

/**
 * Refresh a specific connection.
 *
 * Disabled until a real connection service exists. The former silent
 * `onUIAction` no-op has been removed.
 */
export const REFRESH_CONNECTION: ActionHandler = (): ActionResult => {
  return notHandled('disabled');
};

/**
 * Create names from selection.
 *
 * Named Ranges
 * Opens the "Create Names from Selection" dialog that allows users to specify
 * whether to create names from:
 * - Top row (uses first row as name for each column)
 * - Left column (uses first column as name for each row)
 * - Bottom row (uses last row as name for each column)
 * - Right column (uses last column as name for each row)
 */
export const CREATE_NAMES_FROM_SELECTION: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openCreateNamesDialog();
  return handled();
};

// =============================================================================
// Formula Auditing Actions
// =============================================================================
// MIGRATION:
// These handlers were incorrectly using createUICallbackHandler which relies on
// an onUIAction callback that may not be wired up. They now call UIStore directly
// because trace arrows are ephemeral UI state, not browser API operations.
//
// The implementation mirrors the logic from use-trace-arrows.ts hook but is
// self-contained in the handler (handlers should not depend on React hooks).
// =============================================================================

/**
 * Get or create CellId for a cell position.
 */
async function getCellIdForPosition(
  deps: ActionDependencies,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellId> {
  // Try to get existing cell ID via Worksheet API
  const ws = deps.workbook.getSheetById(sheetId);
  const existingId = await ws._internal.getCellIdAt(row, col);
  if (existingId) return toCellId(existingId);

  // Generate a temporary ID for display purposes
  // The cell doesn't have data, but we still want to show arrows
  return toCellId(crypto.randomUUID());
}

/**
 * Trace precedent cells - show arrows from cells that this cell references.
 *
 * Formula Auditing
 *
 * This handler calls UIStore directly (handlers should be self-contained).
 * The logic mirrors use-trace-arrows.ts but without React hook dependencies.
 */
export const TRACE_PRECEDENTS: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const sheetId = deps.getActiveSheetId();

  // Get active cell from accessors
  const activeCell = deps.accessors?.selection?.getActiveCell();
  if (!activeCell) {
    return notHandled('disabled');
  }

  const { row, col } = activeCell;

  // Get the CellId for the target cell
  const targetCellId = await getCellIdForPosition(deps, sheetId, row, col);

  const ws = deps.workbook.getSheetById(sheetId);
  const precedents = await getTracePrecedentSources(ws, row, col);

  if (precedents.length === 0) {
    // No precedents - cell doesn't have a formula or formula has no cell refs
    return handled();
  }

  // Convert A1 strings to TraceArrow format
  const arrows: TraceArrow[] = await Promise.all(
    precedents.map(async (precedent, index: number) => {
      const { row: precRow, col: precCol } = precedent;
      const fromCellId = await getCellIdForPosition(deps, sheetId, precRow, precCol);

      return {
        id: `prec-${targetCellId}-${fromCellId}-${index}`,
        fromCellId,
        toCellId: targetCellId,
        type: 'precedent' as const,
        crossSheet: false,
        fromSheetId: sheetId,
        toSheetId: sheetId,
        level: 1,
        // Store positions as fallback for rendering when CellId lookup fails
        fromPosition: { sheetId, row: precRow, col: precCol },
        toPosition: { sheetId, row, col },
      };
    }),
  );

  // Add arrows to UIStore
  uiStore.getState().addPrecedentArrows(sheetId, targetCellId, arrows);
  return handled();
};

/**
 * Trace dependent cells - show arrows to cells that reference this cell.
 *
 * Formula Auditing
 *
 * This handler calls UIStore directly (handlers should be self-contained).
 */
export const TRACE_DEPENDENTS: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const sheetId = deps.getActiveSheetId();

  // Get active cell from accessors
  const activeCell = deps.accessors?.selection?.getActiveCell();
  if (!activeCell) {
    return notHandled('disabled');
  }

  const { row, col } = activeCell;

  // Get the CellId for the source cell
  const sourceCellId = await getCellIdForPosition(deps, sheetId, row, col);

  // Get dependent cells using Worksheet API (returns A1 strings, same-sheet only)
  const ws = deps.workbook.getSheetById(sheetId);
  const dependents = await ws.getDependents(row, col);

  if (dependents.length === 0) {
    // No dependents - no formulas reference this cell
    return handled();
  }

  // Convert A1 strings to TraceArrow format
  const arrows: TraceArrow[] = await Promise.all(
    dependents.map(async (depAddr: string, index: number) => {
      // getDependents returns A1 strings (same-sheet only)
      const { row: depRow, col: depCol } = parseA1(depAddr);
      const toCellId = await getCellIdForPosition(deps, sheetId, depRow, depCol);

      return {
        id: `dep-${sourceCellId}-${toCellId}-${index}`,
        fromCellId: sourceCellId,
        toCellId,
        type: 'dependent' as const,
        crossSheet: false,
        fromSheetId: sheetId,
        toSheetId: sheetId,
        level: 1,
        // Store positions as fallback for rendering when CellId lookup fails
        fromPosition: { sheetId, row, col },
        toPosition: { sheetId, row: depRow, col: depCol },
      };
    }),
  );

  // Add arrows to UIStore
  uiStore.getState().addDependentArrows(sheetId, sourceCellId, arrows);
  return handled();
};

/**
 * Remove all trace arrows from the current sheet.
 *
 * Formula Auditing
 *
 * Uses UIStore directly - no browser API needed.
 */
export const REMOVE_TRACE_ARROWS: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().clearAllTraceArrows();
  return handled();
};

/**
 * Remove only precedent arrows.
 *
 * Formula Auditing
 *
 * Uses UIStore directly - no browser API needed.
 */
export const REMOVE_PRECEDENT_ARROWS: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().removePrecedentArrows();
  return handled();
};

/**
 * Remove only dependent arrows.
 *
 * Formula Auditing
 *
 * Uses UIStore directly - no browser API needed.
 */
export const REMOVE_DEPENDENT_ARROWS: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().removeDependentArrows();
  return handled();
};

// =============================================================================
// File menu actions
// =============================================================================

/**
 * Open the File menu.
 * Opens the full-screen file menu overlay with the specified panel.
 */
export const OPEN_BACKSTAGE: ActionHandler = (deps): ActionResult => {
  if (isFileMenuDisabled(deps)) {
    return notHandled('disabled');
  }

  // Close editor if currently editing
  // MIGRATION: Uses deps.accessors.editor and deps.commands.editor instead of direct actor access
  if (deps.accessors?.editor?.isEditing()) {
    deps.commands?.editor?.cancel();
  }

  // Open backstage via UIStore
  getUIStore(deps).getState().openBackstage();
  return handled();
};

/**
 * Close backstage view.
 */
export const CLOSE_BACKSTAGE: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeBackstage();
  return handled();
};

/**
 * Set active backstage panel.
 *
 * @param deps - Action dependencies
 * @param payload - Panel to set (e.g., { panel: 'info' })
 */
export const SET_BACKSTAGE_PANEL: ActionHandler = (
  deps,
  payload?: { panel: string },
): ActionResult => {
  if (isFileMenuDisabled(deps)) {
    return notHandled('disabled');
  }

  if (payload?.panel) {
    getUIStore(deps)
      .getState()
      .setActivePanel(payload.panel as BackstagePanelType);
  }
  return handled();
};

// =============================================================================
// File Menu Leaves (issue #115) — every leaf MUST produce an observable side
// effect (download, file picker, document close, dispatched action). No silent
// no-ops; the chrome-symmetry harness enforces this contract.
// =============================================================================

/**
 * EXPORT_AS_XLSX — serialise the active workbook and persist via the platform.
 *
 * Path: kernel `Workbook.toXlsx()` → `dialogs.showSaveDialog` →
 * `PlatformFileHandle.write`. On web with FSA the user picks a path; on web
 * without FSA the handle's `write` performs an anchor download. On desktop
 * Tauri writes through the OS path. The chrome-symmetry harness asserts the
 * download event fires on the web fallback.
 */
export const EXPORT_AS_XLSX: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  await persistActiveSheetSelectionForXlsxExport(deps);
  const hostResult = await routeHostCommand(deps, 'export', {
    format: 'xlsx',
    source: 'file-menu',
  });
  if (hostResult) return hostResult;

  const baseName = getActiveFileBaseName(deps);
  const handle = await deps.platform.dialogs.showSaveDialog({
    title: 'Export as XLSX',
    defaultPath: `${baseName}.xlsx`,
    filters: [XLSX_FILTER],
  });
  if (!handle) return notHandled('disabled');

  const bytes = await deps.workbook.toXlsx();
  await handle.write(bytes);
  return handled();
};

/**
 * EXPORT_AS_CSV — serialise the active sheet via `Worksheet.toCSV()` and
 * persist via the platform. CSV is a per-sheet format; we use the active sheet.
 * The file boundary adds a UTF-8 BOM for Excel/Windows encoding detection;
 * the worksheet API remains plain CSV text.
 */
export const EXPORT_AS_CSV: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const hostResult = await routeHostCommand(deps, 'export', { format: 'csv', source: 'file-menu' });
  if (hostResult) return hostResult;

  const baseName = getActiveFileBaseName(deps);
  const handle = await deps.platform.dialogs.showSaveDialog({
    title: 'Export as CSV',
    defaultPath: `${baseName}.csv`,
    filters: [CSV_FILTER],
  });
  if (!handle) return notHandled('disabled');

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const csv = await ws.toCSV();
  const bytes = encodeCsvForDownload(csv);
  await handle.write(bytes);
  return handled();
};

/**
 * EXPORT_AS_PDF — surface the production PDF export path.
 *
 * The in-house renderer (SpreadsheetPdfExporter, `@mog/print-export`) runs
 * inside the React-hooked `usePdfExport()` flow that ExportPanel wires up.
 * Web cannot return bytes back to JS without that mount, so the production
 * download flow is "Backstage > Export panel > Export PDF button". The legacy
 * `onUIAction` desktop interception has been removed; Tauri hosts that need a
 * native path will wire it through `deps.platform` later.
 */
export const EXPORT_AS_PDF: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const hostResult = await routeHostCommand(deps, 'export', { format: 'pdf', source: 'file-menu' });
  if (hostResult) return hostResult;
  if (isFileMenuDisabled(deps)) return notHandled('disabled');

  const uiStore = getUIStore(deps);
  uiStore.getState().openBackstage();
  uiStore.getState().setActivePanel('export');
  return handled();
};

/**
 * BROWSE_FILES — surface the OS file chooser. Closes the backstage view
 * first so the picked file appears in a clean canvas, then runs the same
 * `OPEN` flow.
 */
export const BROWSE_FILES: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const hostResult = await routeHostCommand(deps, 'open', { source: 'file-menu' });
  if (hostResult) return hostResult;

  getUIStore(deps).getState().closeBackstage();
  return OPEN(deps);
};

/**
 * OPEN_RECENT_FILE — switch the active file to the recents entry. The shell's
 * `openFileIds` is the recents list (closed files are not currently retained).
 * Without a payload we open the most-recently-used entry that isn't currently
 * active.
 */
export const OPEN_RECENT_FILE: ActionHandler = (
  deps,
  payload?: { fileId?: string },
): ActionResult => {
  const state = deps.shellService.getDocumentState();
  const ids = state.openFileIds;
  const targetId = payload?.fileId ?? ids.find((id) => id !== state.activeFileId) ?? ids[0] ?? null;
  if (!targetId) return notHandled('disabled');

  deps.shellService.setActiveDocument(targetId);
  getUIStore(deps).getState().closeBackstage();
  return handled();
};

/**
 * SHARE_DOCUMENT — there is no share backend yet (no collaboration link
 * service). The leaf surfaces a notification via the UIStore — never a silent
 * click. Once the share infrastructure lands, this handler swaps to the live
 * API; the action contract stays.
 */
export const SHARE_DOCUMENT: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const hostResult = await routeHostCommand(deps, 'share', { source: 'file-menu' });
  if (hostResult) return hostResult;

  const message = 'Sharing requires a connected workspace. Coming soon.';
  if (deps.workbook.notifications) {
    deps.workbook.notifications.info(message);
  } else if (typeof window !== 'undefined') {
    // Malformed test dependency fallback: keep the observable event for
    // harnesses that inject a workbook without the notification sub-API.
    window.dispatchEvent(
      new CustomEvent('mog:share-requested', { detail: { source: 'file-menu' } }),
    );
  }
  return handled();
};

/**
 * CLOSE_FILE — close the active document and the backstage view. Closing the
 * active file pops it out of `openFileIds` and clears `activeFileId` via the
 * shell's projectService.
 */
export const CLOSE_FILE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  // Close the backstage first so the user sees the result of closing the file.
  getUIStore(deps).getState().closeBackstage();
  await deps.shellService.closeActiveDocument();
  return handled();
};
