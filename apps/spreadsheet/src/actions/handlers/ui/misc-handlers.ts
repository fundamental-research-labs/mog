/**
 * Miscellaneous UI Action Handlers
 *
 * This module contains handlers for:
 * - Validation circles (show/hide/toggle invalid data indicators)
 * - Recent colors tracking
 * - Accessibility announcements
 * - Error and array formula actions
 * - Proofing tools (thesaurus, statistics, accessibility)
 * - Macro recording
 * - Help
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import { type CellRange, sheetId } from '@mog-sdk/contracts/core';
import { parseA1Range } from '@mog/spreadsheet-utils/a1';
import type { ValidationCircleCell } from '../../../ui-store/slices/view/validation-circles';

// Import recent colors utility
import { addRecentColor, type ColorType } from '../../../infra/styles/recent-colors';

// Import help utility for F1 shortcut
import { openHelp } from '../../../infra/utils/help';

// Import dispatcher for action delegation (via indirection to avoid cycle)
import { dispatch } from '../../dispatcher-types';
import { getUIStore, handled, notHandled } from '../handler-utils';

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Get selection context (active cell and ranges) using the Actor Access Layer.
 *
 * MIGRATION: Uses deps.accessors.selection instead of direct actor access.
 */
function getSelectionContext(deps: ActionDependencies): {
  activeCell: { row: number; col: number } | null;
  ranges: CellRange[];
} {
  if (!deps.accessors?.selection) {
    return { activeCell: null, ranges: [] };
  }
  return {
    activeCell: deps.accessors.selection.getActiveCell() ?? null,
    ranges: deps.accessors.selection.getRanges() ?? [],
  };
}

/**
 * Helper to check if a value is an error.
 */
function isErrorValue(value: unknown): boolean {
  if (value instanceof Error) return true;
  if (typeof value === 'string') {
    const errorStrings = [
      '#VALUE!',
      '#REF!',
      '#NAME?',
      '#DIV/0!',
      '#N/A',
      '#NULL!',
      '#NUM!',
      '#SPILL!',
      '#CALC!',
    ];
    return errorStrings.includes(value);
  }
  // Check for error object format
  if (value && typeof value === 'object' && 'type' in value && value.type === 'error') {
    return true;
  }
  return false;
}

// =============================================================================
// Validation Circles Actions (F1: Circle Invalid Data)
// =============================================================================

/**
 * Scan every validation rule on the active sheet, evaluate each covered cell's
 * current value against its covering rule, and return the list of invalid cells.
 *
 * Reuses `ws.validations.validate(row, col, value)` — the public validation
 * adapter that delegates to Rust compute-core. This is the SAME evaluator the
 * editor commit pipeline uses (see CoordinatorProvider.tsx validateCellValue
 * and setupEditorCommitCoordination), so Circle Invalid Data and inline editor
 * validation cannot disagree by construction.
 *
 * Excel parity: scope is the active sheet only. Rules that don't cover a cell
 * (errorStyle 'none') are treated as trivially valid.
 */
async function scanInvalidCellsOnActiveSheet(
  deps: ActionDependencies,
): Promise<ValidationCircleCell[]> {
  const activeSheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(activeSheetId);

  const rules = await ws.validations.list();
  if (rules.length === 0) return [];

  // Dedup by (row,col): a cell may (in principle) be covered by multiple rules
  // after a future overlap relaxation. Today it's one rule per cell, but the
  // set keeps the invariant "one circle per cell" explicit.
  const invalid = new Set<string>();

  for (const rule of rules) {
    if (!rule.range) continue;
    let bounds: CellRange;
    try {
      bounds = parseA1Range(rule.range);
    } catch {
      // Malformed range — skip this rule rather than abort the whole scan.
      continue;
    }

    for (let row = bounds.startRow; row <= bounds.endRow; row++) {
      for (let col = bounds.startCol; col <= bounds.endCol; col++) {
        const key = `${row}:${col}`;
        if (invalid.has(key)) continue;

        // Read the cell's current computed value. null => empty cell; let the
        // rule's allowBlank decide (Rust evaluates that consistently for us).
        const raw = await ws.getValue(row, col);
        const stringified = raw == null ? '' : String(raw);

        const result = await ws.validations.validate(row, col, stringified);
        // errorStyle 'none' means no rule covers the cell — nothing to circle.
        if (result.errorStyle === 'none') continue;
        if (!result.valid) invalid.add(key);
      }
    }
  }

  return Array.from(invalid, (key) => {
    const [r, c] = key.split(':');
    return { row: Number(r), col: Number(c) };
  });
}

/**
 * Populate the validation-circle set for the active sheet. Safe to call when
 * circles are already visible — it re-scans and replaces the set for the
 * active sheet (other sheets untouched). If no invalid cells are found, keep
 * circles hidden and announce the empty result instead of switching the ribbon
 * into "Clear Circles" with nothing drawn.
 */
async function turnCirclesOn(deps: ActionDependencies): Promise<number> {
  const activeSheetId = deps.getActiveSheetId();
  const invalidCells = await scanInvalidCellsOnActiveSheet(deps);

  const uiStore = getUIStore(deps);
  const state = uiStore.getState();
  // Replace — not merge — the active-sheet subset so stale circles from a
  // previous scan (e.g. cells that became valid by import/paste without an
  // explicit edit) disappear on re-toggle.
  state.clearValidationCirclesForSheet(activeSheetId);
  if (invalidCells.length > 0) {
    state.addValidationCircles(activeSheetId, invalidCells);
    state.showValidationCircles();
  } else {
    state.hideValidationCircles();
    state.announce('No invalid data found', 'polite');
  }
  return invalidCells.length;
}

/**
 * Flip the visibility flag off AND drain the circle set across all sheets.
 * The overlay renderer keys off both the flag and the set; clearing the set
 * means the overlay has nothing to draw even if a future code path flips the
 * flag back on without re-scanning.
 */
function turnCirclesOff(deps: ActionDependencies): void {
  const state = getUIStore(deps).getState();
  state.hideValidationCircles();
  state.clearAllValidationCircles();
}

/**
 * Show validation circles around all cells with invalid data.
 * Circles appear as red dashed ovals around cells that fail validation.
 *
 * F1: Circle Invalid Data (Excel parity quickwin)
 */
export const SHOW_VALIDATION_CIRCLES: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  await turnCirclesOn(deps);
  return handled();
};

/**
 * Hide all validation circles and drain the circle set.
 */
export const HIDE_VALIDATION_CIRCLES: ActionHandler = (deps): ActionResult => {
  turnCirclesOff(deps);
  return handled();
};

/**
 * Toggle validation circles.
 *
 * - Visible -> hide AND drain the set (ribbon label becomes "Circle Invalid").
 * - Hidden -> scan the active sheet for invalid cells, populate the set, and
 * flip the flag on (ribbon label becomes "Clear Circles").
 *
 * The scan reuses `ws.validations.validate()` — the same Rust-backed validator
 * the editor commit pipeline calls — so there is exactly one definition of
 * "this value violates this rule" across the app.
 */
export const TOGGLE_VALIDATION_CIRCLES: AsyncActionHandler = async (
  deps,
): Promise<ActionResult> => {
  const visible = getUIStore(deps).getState().validationCirclesVisible;
  if (visible) {
    turnCirclesOff(deps);
  } else {
    await turnCirclesOn(deps);
  }
  return handled();
};

// =============================================================================
// Recent Colors Actions (Recent Colors)
// =============================================================================

/**
 * Track a color as recently used.
 * Persists to localStorage for future color picker suggestions.
 *
 * Recent Colors (Excel parity quickwin)
 *
 * @param deps - Action dependencies
 * @param payload - { type: 'fill' | 'font' | 'border', color: string }
 */
export const TRACK_RECENT_COLOR: ActionHandler = (
  _deps,
  payload?: { type: ColorType; color: string },
): ActionResult => {
  if (!payload?.type || !payload?.color) {
    return notHandled('disabled');
  }
  addRecentColor(payload.type, payload.color);
  return handled();
};

// =============================================================================
// Accessibility Actions ( Screen Reader Support)
// =============================================================================

/**
 * Announce cell format for screen readers (Alt+Shift+F).
 *
 * Announces the current cell's formatting information including:
 * - Font family (e.g., "Arial")
 * - Font size (e.g., "12pt")
 * - Bold, italic, underline status
 *
 * The announcement is triggered via the UIStore accessibility slice,
 * which sets a pending announcement that the AccessibilityAnnouncer
 * component will read via ARIA live regions.
 */
export const ANNOUNCE_CELL_FORMAT: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);
  const uiStore = getUIStore(deps);

  if (!activeCell) {
    uiStore.getState().announce('No cell selected', 'polite');
    return handled();
  }

  const ws = deps.workbook.getSheetById(sheetId);
  const format = await ws.formats.get(activeCell.row, activeCell.col);

  // Build format description
  const formatParts: string[] = [];

  // Add font family and size first
  if (format?.fontFamily) {
    formatParts.push(format.fontFamily);
  }
  if (format?.fontSize) {
    formatParts.push(`${format.fontSize} point`);
  }

  // Add style modifiers
  if (format?.bold) formatParts.push('bold');
  if (format?.italic) formatParts.push('italic');
  if (format?.underlineType && format.underlineType !== 'none') formatParts.push('underlined');

  // Build the announcement message
  let message: string;
  if (formatParts.length > 0) {
    message = `Cell format: ${formatParts.join(', ')}`;
  } else {
    message = 'Cell format: default formatting';
  }

  // Announce via UIStore accessibility slice
  uiStore.getState().announce(message, 'polite');

  return handled();
};

// =============================================================================
// Error and Array Formula Context Menu Actions
// =============================================================================

/**
 * TRACE_ERROR - Trace precedents for error cell.
 *
 * Shows dependency arrows to cells causing the error.
 * Delegates to TRACE_PRECEDENTS but specifically for error source.
 */
export const TRACE_ERROR: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const { activeCell, ranges } = getSelectionContext(deps);
  const uiStore = getUIStore(deps);

  if (!activeCell || ranges.length === 0) {
    return notHandled('disabled');
  }

  const sheetId = uiStore.getState().activeSheetId;

  const ws = deps.workbook.getSheetById(sheetId);
  const value = await ws.getDisplayValue(activeCell.row, activeCell.col);

  if (!isErrorValue(value)) {
    return notHandled('disabled');
  }

  // Dispatch TRACE_PRECEDENTS to show dependency arrows
  // The existing TRACE_PRECEDENTS handler will show arrows to cells feeding into this one
  await dispatch('TRACE_PRECEDENTS', deps);

  return handled();
};

/**
 * IGNORE_ERROR - Hide error indicator for cell.
 *
 * Stores in cell metadata that error should be hidden.
 * Error value still shown, but no green triangle indicator.
 */
export const IGNORE_ERROR: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const { activeCell, ranges } = getSelectionContext(deps);
  const uiStore = getUIStore(deps);

  if (!activeCell || ranges.length === 0) {
    return notHandled('disabled');
  }

  const sheetId = uiStore.getState().activeSheetId;

  const ws = deps.workbook.getSheetById(sheetId);
  const value = await ws.getDisplayValue(activeCell.row, activeCell.col);

  if (!isErrorValue(value)) {
    return notHandled('disabled');
  }

  // Set cell metadata to hide error indicator via cell format extensions
  // Use the Worksheet API to read current format, then update with ignoreError flag
  const cellFormat = await ws.formats.get(activeCell.row, activeCell.col);
  const currentExtensions = cellFormat?.extensions ?? {};
  await ws.formats.set(activeCell.row, activeCell.col, {
    extensions: { ...currentExtensions, ignoreError: true },
  });

  return handled();
};

/**
 * SELECT_ARRAY - Select entire array formula range.
 *
 * When in a spill range or legacy CSE array, select the entire array.
 * Queries projection data from Rust compute-core to find array boundaries.
 */
export const SELECT_ARRAY: ActionHandler = (): ActionResult => {
  // Array formula range detection is handled by Rust compute-core (async).
  // Sync stubs removed — disabled until async wiring is added.
  return notHandled('disabled');
};

// =============================================================================
// Quick Analysis Menu
// =============================================================================

/**
 * Open Quick Analysis menu.
 *
 * Quick Analysis Menu (Ctrl+Q)
 *
 * Shows the Quick Analysis menu near the selection, providing quick access to:
 * - Formatting options (conditional formatting, sparklines)
 * - Chart creation
 * - Totals (SUM, AVERAGE, COUNT, etc.)
 * - Tables (convert to table)
 *
 * routes through the UIStore slice
 * (`quickAnalysis.isOpen`, optional anchor). The legacy stringly-typed
 * UI escape hatch was unwired on web, leaving Ctrl+Q a silent no-op.
 */
export const OPEN_QUICK_ANALYSIS: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openQuickAnalysis();
  return handled();
};

// =============================================================================
// Proofing Group Actions
// =============================================================================

/**
 * Show Workbook Statistics.
 *
 * Shows statistics about the workbook (cell count, formula count, etc.)
 *
 * Uses direct UIStore access - handlers should be self-contained.
 */
export const SHOW_WORKBOOK_STATISTICS: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openWorkbookStatisticsDialog();
  return handled();
};

/**
 * Check Accessibility.
 *
 * Opens the accessibility checker panel and triggers a check.
 *
 * Uses direct UIStore access - handlers should be self-contained.
 * The actual check is performed by the useAccessibilityChecker hook.
 */
export const CHECK_ACCESSIBILITY: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openAccessibilityPanel();
  return handled();
};

/**
 * Close the Accessibility Checker panel.
 *
 * Closes the panel and resets the checker state.
 */
export const CLOSE_ACCESSIBILITY_PANEL: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeAccessibilityPanel();
  return handled();
};

/**
 * Navigate to an accessibility issue.
 *
 * Switches to the sheet containing the issue and selects the relevant
 * cell, range, or object.
 *
 * @param payload - { issueId: string }
 */
export const NAVIGATE_TO_ACCESSIBILITY_ISSUE: ActionHandler = (
  deps,
  payload?: { issueId: string },
): ActionResult => {
  if (!payload?.issueId) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  const state = uiStore.getState();
  const issue = state.accessibilityChecker.issues.find((i) => i.id === payload.issueId);

  if (!issue) {
    return notHandled('disabled');
  }

  // Select the issue in the UI
  state.selectAccessibilityIssue(payload.issueId);

  // Switch to the correct sheet if needed
  const currentSheetId = state.activeSheetId;
  if (issue.location.sheetId !== currentSheetId) {
    state.setActiveSheet(sheetId(issue.location.sheetId));
  }

  // Navigate based on location type
  const { location } = issue;

  if (location.type === 'cell' || location.type === 'range') {
    // Parse the A1 reference and select it
    if (location.ref && deps.commands?.selection) {
      const range = parseA1Range(location.ref);
      if (range) {
        deps.commands.selection.setSelection([range], { row: range.startRow, col: range.startCol });
      }
    }
  } else if (location.type === 'object' && location.objectId) {
    // TODO: Implement object selection for accessibility navigation
    // The floating object system doesn't expose a simple selectObject API
    // For now, we just switch to the correct sheet (done above)
    // Future: Look up object position and select its anchor cell
  } else if (location.type === 'sheet') {
    // Sheet is already switched above, nothing more to do
    // Optionally select A1
    if (deps.commands?.selection) {
      deps.commands.selection.setSelection([{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }], {
        row: 0,
        col: 0,
      });
    }
  }

  return handled();
};

// =============================================================================
// Macro Recording Actions
// =============================================================================

/**
 * Toggle macro recording state.
 *
 * Starts or stops macro recording.
 */
export const TOGGLE_MACRO_RECORDING: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().toggleMacroRecording?.();
  return handled();
};

/**
 * Stop macro recording.
 */
export const STOP_MACRO_RECORDING: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().stopMacroRecording?.();
  return handled();
};

// =============================================================================
// Help Actions
// =============================================================================

/**
 * Open Help (F1)
 *
 * Opens the help documentation in a new browser tab.
 * Triggered by the F1 keyboard shortcut or the Help button in the ribbon.
 */
export const OPEN_HELP: ActionHandler = (): ActionResult => {
  openHelp();
  return handled();
};
