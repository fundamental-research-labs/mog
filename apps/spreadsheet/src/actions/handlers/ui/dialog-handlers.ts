/**
 * Dialog Action Handlers
 *
 * Pure handler functions for dialog-related actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps) => ActionResult
 * - Dialog actions delegate to UIStore directly or to actor commands
 *
 * This file handles:
 * - Dialog open/close actions (Go To, Format Cells, Find/Replace, etc.)
 * - Page Setup dialog and related actions
 * - Data validation dialog
 * - More Colors dialog and apply actions
 * - Various other specialized dialogs
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
  ThesaurusInsertPayload,
} from '@mog-sdk/contracts/actions';
import type {
  CellFormat,
  CellRange,
  PageMargins,
  PaperSize,
  PrintSettings,
  SheetId,
} from '@mog-sdk/contracts/core';
import type { PrintTitles } from '@mog-sdk/contracts/events';

import { paperSizeToCode } from '../../../utils/paper-size';

import {
  deleteSelectedColumns,
  deleteSelectedRows,
  insertColumnLeftSelection,
  insertRowAboveSelection,
} from '../structure-row-column';

// Import recent colors utility
import { addRecentColor } from '../../../infra/styles/recent-colors';

// Import parsing utilities
import {
  cellRangeToA1 as rangeToA1,
  colToLetter,
  parseCellAddress,
  parseCellRange,
} from '@mog/spreadsheet-utils/a1';
import type { ParsedCellRange } from '@mog-sdk/contracts/utils';

import { useKeyboardShortcutsDialogStore } from '../../../dialogs/settings/keyboard-shortcuts-dialog-store';
import type { QuickRuleDialogType } from '../../../ui-store/slices/dialogs/cf-dialog';
import { isFormatCellsTabId, type FormatCellsTabId } from '../../../ui-store/slices/core/misc';

import {
  getRelativeCommandColumn,
  resolveDataDialogTarget,
  resolveTextToColumnsTarget,
} from '../../data-command-target';
import { getUIStore, handled, notHandled } from '../handler-utils';
import { beginEditSessionFromAction } from '../edit-entry';
import {
  isPickerBackedValidation,
  peekValidationEditorConfig,
} from '../../../systems/grid-editing/coordination/editor-validation-resolution';
import { requestFormulaBarRefresh } from '../../../infra/events/formula-bar-refresh';

// =============================================================================
// Type Guards
// =============================================================================

const PAPER_SIZES: readonly PaperSize[] = ['letter', 'legal', 'a4', 'a3', 'custom'];

function rangeFromParsedCellRange(parsedRange: ParsedCellRange): CellRange {
  return {
    startRow: parsedRange.startRow,
    startCol: parsedRange.startCol,
    endRow: parsedRange.endRow,
    endCol: parsedRange.endCol,
    ...(parsedRange.isFullColumn ? { isFullColumn: true } : {}),
    ...(parsedRange.isFullRow ? { isFullRow: true } : {}),
  };
}

function isPaperSize(value: string): value is PaperSize {
  return (PAPER_SIZES as readonly string[]).includes(value);
}

const QUICK_RULE_TYPES: readonly NonNullable<QuickRuleDialogType>[] = [
  'greaterThan',
  'lessThan',
  'between',
  'equalTo',
  'textContains',
  'duplicates',
  'dateOccurring',
  'blanks',
  'topItems',
  'bottomItems',
  'topPercent',
  'bottomPercent',
  'aboveAverage',
  'belowAverage',
];

function isQuickRuleDialogType(value: string): value is NonNullable<QuickRuleDialogType> {
  return (QUICK_RULE_TYPES as readonly string[]).includes(value);
}

interface OpenFormatCellsDialogPayload {
  initialTab?: FormatCellsTabId;
}

function getFormatCellsInitialTab(payload: unknown): FormatCellsTabId | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const initialTab = (payload as OpenFormatCellsDialogPayload).initialTab;
  return isFormatCellsTabId(initialTab) ? initialTab : undefined;
}

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
 * Helper: Extract the selected word or cell value for thesaurus lookup.
 *
 * Priority:
 * 1. If editing with character selection, return selected text
 * 2. If editing without character selection, return full editor value
 * 3. If not editing, return active cell's display value (not formula)
 *
 * Returns null for numeric values (thesaurus doesn't apply to numbers).
 */
async function getSelectedWordOrCellValue(deps: ActionDependencies): Promise<string | null> {
  // If editing, check for character selection first
  if (deps.accessors?.editor?.isEditing()) {
    // Check if there's a character selection (text highlighted)
    const hasCharSel = deps.accessors.editor.hasCharSelection?.() ?? false;
    if (hasCharSel) {
      // Compute selected text from value + selection bounds
      const value = deps.accessors.editor.getValue() ?? '';
      const start = deps.accessors.editor.getCharSelectionStart?.() ?? 0;
      const end = deps.accessors.editor.getCharSelectionEnd?.() ?? 0;
      const selectedText = value.slice(start, end);
      if (selectedText) return selectedText;
    }

    // No character selection - return full editor value
    return deps.accessors.editor.getValue() || null;
  }

  // If not editing, get active cell's DISPLAY value (not formula)
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);

  if (!activeCell) return null;

  const ws = deps.workbook.getSheetById(sheetId);
  const displayValue = await ws.getDisplayValue(activeCell.row, activeCell.col);

  // Don't open thesaurus for empty cells
  if (!displayValue) return null;

  // Don't open thesaurus for numbers
  const numCheck = Number(displayValue);
  if (!isNaN(numCheck) && displayValue.trim() !== '') return null;

  return displayValue;
}

// =============================================================================
// Go To Dialog Actions
// =============================================================================

/**
 * Open Go To Dialog (F5 / Ctrl+G)
 *
 * Opens the Go To dialog for quick cell navigation.
 * Uses direct UIStore access for reliable keyboard shortcut handling.
 *
 * Excel parity quickwin A7: Go To Dialog
 */
export const OPEN_GO_TO_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openGoToDialog();
  return handled();
};

/**
 * Close Go To Dialog
 */
export const CLOSE_GO_TO_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeGoToDialog();
  return handled();
};

/**
 * Navigate to Reference - Go To Dialog
 *
 * Navigates to the cell/range specified in pendingGoToReference.
 * Validates the reference and shows error if invalid.
 * Adds to recent locations on success.
 */
export const NAVIGATE_TO_REFERENCE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const { pendingGoToReference } = getUIStore(deps).getState().goToDialog;
  if (!pendingGoToReference) {
    return handled();
  }

  const reference = pendingGoToReference.trim();

  // Try parsing as single cell
  const parsed = parseCellAddress(reference);
  if (parsed) {
    // Handle sheet switching if needed
    if (parsed.sheetName) {
      const sheetNames = await deps.workbook.getSheetNames();
      const targetName = sheetNames.find(
        (n) => n.toLowerCase() === parsed.sheetName!.toLowerCase(),
      );
      if (targetName) {
        const targetSheet = await deps.workbook.getSheet(targetName);
        if (targetSheet) {
          getUIStore(deps).getState().setActiveSheet(targetSheet.getSheetId());
        }
      }
      // Sheet not found - could show error, but for now just skip sheet switch
    }

    // Navigate to cell via selection commands
    // MIGRATION: Uses deps.commands.selection instead of direct actor.send()
    if (deps.commands?.selection) {
      deps.commands.selection.setSelection(
        [
          {
            startRow: parsed.row,
            startCol: parsed.col,
            endRow: parsed.row,
            endCol: parsed.col,
          },
        ],
        { row: parsed.row, col: parsed.col },
      );
    }

    // Add to recent locations
    getUIStore(deps).getState().addRecentLocation(reference, parsed.sheetName);

    // Clear pending and close dialog
    getUIStore(deps).getState().clearPendingGoToReference();
    getUIStore(deps).getState().closeGoToDialog();
    return handled();
  }

  // Try parsing as range
  const rangeParsed = parseCellRange(reference);
  if (rangeParsed) {
    // Handle sheet switching if needed
    if (rangeParsed.sheetName) {
      const sheetNames = await deps.workbook.getSheetNames();
      const targetName = sheetNames.find(
        (n) => n.toLowerCase() === rangeParsed.sheetName!.toLowerCase(),
      );
      if (targetName) {
        const targetSheet = await deps.workbook.getSheet(targetName);
        if (targetSheet) {
          getUIStore(deps).getState().setActiveSheet(targetSheet.getSheetId());
        }
      }
    }

    // Navigate to range
    // MIGRATION: Uses deps.commands.selection instead of direct actor.send()
    if (deps.commands?.selection) {
      deps.commands.selection.setSelection([rangeFromParsedCellRange(rangeParsed)], {
        row: rangeParsed.startRow,
        col: rangeParsed.startCol,
      });
    }

    // Add to recent locations
    getUIStore(deps).getState().addRecentLocation(reference, rangeParsed.sheetName);

    // Clear pending and close dialog
    getUIStore(deps).getState().clearPendingGoToReference();
    getUIStore(deps).getState().closeGoToDialog();
    return handled();
  }

  // TODO: Try named ranges and tables when those domains are available
  // For now, just show an error by keeping the dialog open
  // The dialog will show "Invalid reference" error
  getUIStore(deps).getState().clearPendingGoToReference();
  return handled();
};

/**
 * Open Go To Special dialog.
 *
 * Excel parity 14.1: Go To Special Dialog
 *
 * Opens the Go To Special dialog which allows selecting cells by type
 * (blanks, formulas, constants, etc.).
 * Uses direct UIStore access - handlers should be self-contained.
 */
export const OPEN_GO_TO_SPECIAL_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openGoToSpecialDialog();
  return handled();
};

// =============================================================================
// Format Cells Dialog Actions
// =============================================================================

/**
 * Open Format Cells dialog (Ctrl+1).
 *
 * Excel parity quickwin A6: Format Cells Dialog
 *
 * Opens the Format Cells dialog for editing number formats, alignment,
 * fonts, borders, fill, and protection.
 * Uses direct UIStore access - handlers should be self-contained.
 */
export const OPEN_FORMAT_CELLS_DIALOG: ActionHandler = (deps, payload): ActionResult => {
  getUIStore(deps).getState().openFormatCellsDialog(getFormatCellsInitialTab(payload));
  return handled();
};

/**
 * Open Font dialog.
 *
 * Excel routes this command to the Font tab within Format Cells.
 */
export const OPEN_FONT_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openFormatCellsDialog('font');
  return handled();
};

/**
 * Close Format Cells dialog.
 *
 * Excel parity quickwin A6: Format Cells Dialog
 * Ensures dialog close goes through unified action system.
 */
export const CLOSE_FORMAT_CELLS_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeFormatCellsDialog();
  return handled();
};

// =============================================================================
// Insert/Delete Dialog Actions
// =============================================================================

/**
 * Open Insert Cells dialog.
 *
 * Context Menus - Item 4.1
 *
 * Opens the Insert Cells dialog when a cell range (not full row/column)
 * is right-clicked and the user selects "Insert...".
 */
export const OPEN_INSERT_CELLS_DIALOG: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const { ranges } = getSelectionContext(deps);
  if (ranges.length === 0) {
    return notHandled('disabled');
  }

  const range = ranges[0];

  // Excel behavior: when entire rows/columns are selected, skip the dialog
  // and directly insert rows/columns
  if (range.isFullRow) {
    return insertRowAboveSelection(deps);
  }
  if (range.isFullColumn) {
    return insertColumnLeftSelection(deps);
  }

  // Open the insert cells dialog with the first selection range
  getUIStore(deps).getState().openInsertCellsDialog(range);
  return handled();
};

/**
 * Open Delete Cells dialog.
 *
 * Opens the Delete Cells dialog when a cell range (not full row/column)
 * is right-clicked and the user selects "Delete...".
 */
export const OPEN_DELETE_CELLS_DIALOG: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const { ranges } = getSelectionContext(deps);
  if (ranges.length === 0) {
    return notHandled('disabled');
  }

  const range = ranges[0];

  // Excel behavior: when entire rows/columns are selected, skip the dialog
  // and directly delete rows/columns
  if (range.isFullRow) {
    return deleteSelectedRows(deps);
  }
  if (range.isFullColumn) {
    return deleteSelectedColumns(deps);
  }

  // Open the delete cells dialog with the first selection range
  getUIStore(deps).getState().openDeleteCellsDialog(range);
  return handled();
};

// =============================================================================
// Insert Function Dialog Actions
// =============================================================================

/**
 * Open Insert Function dialog OR Function Arguments dialog based on context.
 *
 * Excel parity quickwin A8: Context-aware Shift+F3 behavior
 * - If user is editing a formula (starts with '='), opens Function Arguments dialog
 * - Otherwise, opens Insert Function dialog
 *
 * This provides Excel-like behavior where Shift+F3 helps edit an existing
 * function when the cursor is inside one, or inserts a new function otherwise.
 */
export const OPEN_INSERT_FUNCTION_DIALOG: ActionHandler = (deps): ActionResult => {
  // Check if user is currently editing a formula
  // MIGRATION: Uses deps.accessors.editor instead of direct actor.getSnapshot()
  const isEditing = deps.accessors?.editor?.isEditing();
  const value = deps.accessors?.editor?.getValue() ?? '';

  // If editing a formula, open Function Arguments dialog instead
  if (isEditing && value.startsWith('=')) {
    getUIStore(deps).getState().openFunctionArgumentsDialog();
    return handled();
  }

  // Open Insert Function dialog via UIStore
  getUIStore(deps).getState().openInsertFunctionDialog();
  return handled();
};

/**
 * Close insert function dialog.
 */
export const CLOSE_INSERT_FUNCTION_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeInsertFunctionDialog();
  return handled();
};

// =============================================================================
// Function Arguments Dialog Actions
// =============================================================================

/**
 * Open function arguments dialog.
 * Shows argument editor for the current function at cursor position.
 *
 * Excel parity quickwin A8: Function Arguments Dialog
 */
export const OPEN_FUNCTION_ARGUMENTS_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openFunctionArgumentsDialog();
  return handled();
};

/**
 * Close function arguments dialog.
 */
export const CLOSE_FUNCTION_ARGUMENTS_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeFunctionArgumentsDialog();
  return handled();
};

// =============================================================================
// Name Manager Dialog Actions
// =============================================================================

/**
 * Open Name Manager dialog (Ctrl+F3).
 *
 *
 * Opens the Name Manager dialog for viewing and managing all defined names.
 * Uses direct UIStore access - handlers should be self-contained.
 */
export const OPEN_NAME_MANAGER: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openNameManagerDialog();
  return handled();
};

/**
 * Open Define Name dialog.
 *
 * Opens the Define Name dialog with optional initial values for creating a new named range.
 * Payload: { mode: 'create' | 'edit', initialRefersTo?: string, initialScope?: string, name?: string }
 */
export const OPEN_DEFINE_NAME_DIALOG: ActionHandler = (
  deps,
  payload?: {
    mode?: 'create' | 'edit';
    initialRefersTo?: string;
    initialScope?: SheetId;
    initialName?: string;
    editingNameId?: string;
  },
): ActionResult => {
  getUIStore(deps)
    .getState()
    .openDefineNameDialog({
      mode: payload?.mode ?? 'create',
      initialRefersTo: payload?.initialRefersTo,
      initialScope: payload?.initialScope,
      initialName: payload?.initialName,
      editingNameId: payload?.editingNameId,
    });
  return handled();
};

// =============================================================================
// Find/Replace Dialog Actions
// =============================================================================

/**
 * Ctrl+F - Open Find dialog.
 *
 * Find & Replace
 *
 * Sends OPEN event to find-replace actor with mode='find'.
 *
 * dropped the legacy stringly-typed UI fallback.
 * The find-replace command lives in the actor access layer; if the
 * actor isn't wired in (e.g. headless test deps without the
 * find-replace machine), the handler returns `notHandled('disabled')`
 * instead of relying on the unwired UI escape hatch.
 */
export const OPEN_FIND_DIALOG: ActionHandler = (deps): ActionResult => {
  if (!deps.commands.findReplace) {
    return notHandled('disabled');
  }
  deps.commands.findReplace.open(false); // showReplace=false for Find dialog
  return handled();
};

/**
 * Ctrl+H - Open Find & Replace dialog.
 *
 * Find & Replace
 *
 * Sends OPEN event to find-replace actor with mode='replace'.
 *
 * see OPEN_FIND_DIALOG.
 */
export const OPEN_FIND_REPLACE_DIALOG: ActionHandler = (deps): ActionResult => {
  if (!deps.commands.findReplace) {
    return notHandled('disabled');
  }
  deps.commands.findReplace.open(true); // showReplace=true for Find & Replace dialog
  return handled();
};

// =============================================================================
// Paste Special Dialog Actions
// =============================================================================

/**
 * Open Paste Special dialog (Ctrl+Alt+V).
 *
 * Opens the Paste Special dialog for pasting with options
 * (values, formulas, formats, etc.).
 * Uses direct UIStore access - handlers should be self-contained.
 */
export const OPEN_PASTE_SPECIAL_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openPasteSpecialDialog();
  return handled();
};

// =============================================================================
// Dropdown Actions
// =============================================================================

/**
 * Alt+Down - Open in-cell picker for validation-backed cells.
 *
 * Data Validation - Alt+Down opens dropdown picker
 *
 * Behavior:
 * - If editing a dropdown cell, opens the dropdown picker
 * - If not editing, check if active cell has list validation:
 * - If yes, start editing with dropdown type and open picker
 * - If no, return not handled
 */
export const OPEN_DROPDOWN: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  // MIGRATION: Uses deps.accessors.editor and deps.commands.editor instead of direct actor access
  if (!deps.accessors?.editor || !deps.commands?.editor) {
    return notHandled('disabled');
  }

  // Case 1: Already editing a picker-backed cell - just open the picker.
  if (
    deps.accessors.editor.isEditing() &&
    (deps.accessors.editor.getEditorType() === 'dropdown' ||
      deps.accessors.editor.getEditorType() === 'date')
  ) {
    deps.commands.editor.openPicker();
    return handled();
  }

  // Case 2: Not editing - check if active cell has list/date validation.
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);

  if (!activeCell) {
    return notHandled('disabled');
  }

  // Check if this cell has picker-backed validation without blocking edit entry
  // on cold dropdown item hydration.
  const ws = deps.workbook.getSheetById(sheetId);
  const validationResolution = peekValidationEditorConfig(ws, activeCell.row, activeCell.col);
  if (
    validationResolution.state === 'ready' &&
    !isPickerBackedValidation(ws.validations.peek(activeCell.row, activeCell.col))
  ) {
    return notHandled('disabled');
  }
  if (validationResolution.state === 'failed') return notHandled('disabled');

  // Auto-deactivate selection modes on edit start (Excel behavior).
  // routed through the selection actor.
  deps.commands.selection.exitAllModes();

  // Cell has list/date validation - start editing and open the matching picker.
  // The editor machine will detect the validation type and use the picker-backed mode.
  await beginEditSessionFromAction(deps, {
    sheetId,
    cell: activeCell,
    entryMode: 'typing',
    initialTextHint: '',
    openDropdown: true,
  });

  return handled();
};

// =============================================================================
// Custom Sort Dialog Actions
// =============================================================================

/**
 * Open Custom Sort dialog.
 *
 * Context Menus - Item 4.4
 *
 * Opens the sort dialog for multi-column sorting.
 * Uses direct UIStore access - handlers should be self-contained.
 */
export const OPEN_CUSTOM_SORT_DIALOG: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const { activeCell, ranges } = getSelectionContext(deps);
  if (ranges.length === 0) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.getSheetById(deps.getActiveSheetId());
  const target = await resolveDataDialogTarget(ws, ranges[0]);

  getUIStore(deps)
    .getState()
    .openSortDialog(target.range, target.hasHeaders, {
      type: 'custom',
      criterion: {
        sortBy: 'value',
        columnIndex: getRelativeCommandColumn(activeCell, target.range),
        direction: 'asc',
      },
    });
  return handled();
};

// =============================================================================
// More Colors Dialog Actions
// =============================================================================

/**
 * Open More Colors dialog.
 *
 * More Colors Dialog
 *
 * @param deps - Action dependencies
 * @param payload - { colorTarget: 'fill' | 'font' | 'border', currentColor?: string }
 */
export const OPEN_MORE_COLORS_DIALOG: ActionHandler = (
  deps,
  payload?: { colorTarget: 'fill' | 'font' | 'border'; currentColor?: string },
): ActionResult => {
  if (!payload?.colorTarget) {
    return notHandled('disabled');
  }

  getUIStore(deps).getState().openMoreColorsDialog(payload.colorTarget, payload.currentColor);
  return handled();
};

/**
 * Close More Colors dialog.
 *
 * More Colors Dialog
 */
export const CLOSE_MORE_COLORS_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeMoreColorsDialog();
  return handled();
};

/**
 * Apply fill color from More Colors dialog.
 *
 * More Colors Dialog
 *
 * Uses setFormat() to apply the background color to the selection.
 */
export const APPLY_MORE_COLORS_FILL: AsyncActionHandler = async (
  deps,
  payload?: { color: string },
): Promise<ActionResult> => {
  if (!payload?.color) {
    return notHandled('disabled');
  }

  const sheetId = deps.getActiveSheetId();
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) {
    return notHandled('disabled');
  }

  // Apply fill color to all selected ranges in a single IPC call
  const ws = deps.workbook.getSheetById(sheetId);
  await ws.formats.setRanges(
    ranges.map((r) => ({
      startRow: r.startRow,
      startCol: r.startCol,
      endRow: r.endRow,
      endCol: r.endCol,
    })),
    { backgroundColor: payload.color } as CellFormat,
  );

  // Track as recent color
  addRecentColor('fill', payload.color);

  return handled();
};

/**
 * Apply font color from More Colors dialog.
 *
 * More Colors Dialog
 *
 * Uses setFormat() to apply the font color to the selection.
 */
export const APPLY_MORE_COLORS_FONT: AsyncActionHandler = async (
  deps,
  payload?: { color: string },
): Promise<ActionResult> => {
  if (!payload?.color) {
    return notHandled('disabled');
  }

  const sheetId = deps.getActiveSheetId();
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) {
    return notHandled('disabled');
  }

  // Apply font color to all selected ranges in a single IPC call
  const ws = deps.workbook.getSheetById(sheetId);
  await ws.formats.setRanges(
    ranges.map((r) => ({
      startRow: r.startRow,
      startCol: r.startCol,
      endRow: r.endRow,
      endCol: r.endCol,
    })),
    { fontColor: payload.color } as CellFormat,
  );

  // Track as recent color
  addRecentColor('font', payload.color);

  return handled();
};

/**
 * Apply border color from More Colors dialog.
 *
 * More Colors Dialog
 *
 * Note: Border colors are typically applied through border styling,
 * not directly as a cell format. This handler stores the color for use
 * by the border tools.
 */
export const APPLY_MORE_COLORS_BORDER: ActionHandler = (
  _deps,
  payload?: { color: string },
): ActionResult => {
  if (!payload?.color) {
    return notHandled('disabled');
  }

  // Track as recent color for borders
  addRecentColor('border', payload.color);

  // Border color is typically stored in a pending state for use by border tools
  // The actual border application happens through APPLY_BORDERS action
  // For now, we just track the recent color
  return handled();
};

// =============================================================================
// Row/Column Resize Dialog Actions
// =============================================================================

/**
 * Open row height dialog.
 */
export const OPEN_ROW_HEIGHT_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openRowHeightDialog();
  return handled();
};

/**
 * Close row height dialog.
 */
export const CLOSE_ROW_HEIGHT_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeRowHeightDialog();
  return handled();
};

/**
 * Open column width dialog.
 */
export const OPEN_COLUMN_WIDTH_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openColumnWidthDialog();
  return handled();
};

/**
 * Close column width dialog.
 */
export const CLOSE_COLUMN_WIDTH_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeColumnWidthDialog();
  return handled();
};

// =============================================================================
// Page Setup Dialog Actions
// =============================================================================

/**
 * Open page setup dialog.
 * Opens the dedicated page setup dialog with optional initial tab selection.
 *
 * Excel parity quickwin A10: Page Setup Dialog
 */
export const OPEN_PAGE_SETUP_DIALOG: ActionHandler = (
  deps,
  payload?: { initialTab?: 'page' | 'margins' | 'headerFooter' | 'sheet' },
): ActionResult => {
  getUIStore(deps).getState().openPageSetupDialog(payload?.initialTab);
  return handled();
};

/**
 * Close page setup dialog.
 */
export const CLOSE_PAGE_SETUP_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closePageSetupDialog();
  return handled();
};

/**
 * Open print / PDF dialog.
 *
 * This is the full tabbed print settings dialog. `OPEN_PRINT_PREVIEW` is kept
 * as an alias because existing keyboard definitions route Ctrl+P through that
 * action name.
 */
export const OPEN_PRINT_PDF_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openPrintDialog();
  return handled();
};

export const OPEN_PRINT_PREVIEW = OPEN_PRINT_PDF_DIALOG;

/**
 * Close print / PDF dialog.
 */
export const CLOSE_PRINT_PDF_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closePrintDialog();
  return handled();
};

/**
 * Apply page setup settings.
 * Persists page setup configuration to the current sheet via Sheets domain.
 *
 * 15-PRINT-EXPORT: Updated to persist settings via Sheets.setPrintSettings()
 *
 * Payload: Partial<PrintSettings>
 * - paperSize: number | null (OOXML code: 1=Letter, 5=Legal, 9=A4, 8=A3)
 * - orientation: string | null ('portrait' | 'landscape')
 * - scale: number | null (as percentage, e.g., 100 = 100%)
 * - fitToWidth: number | null
 * - fitToHeight: number | null
 * - margins: PageMargins | null (top, bottom, left, right, header, footer)
 * - hCentered: boolean
 * - vCentered: boolean
 * - headerFooter: HeaderFooter
 * - gridlines: boolean
 * - headings: boolean
 */
type PageSetupPayload = Partial<PrintSettings> & {
  printTitles?: PrintTitles;
};

export const APPLY_PAGE_SETUP: AsyncActionHandler = async (
  deps,
  payload?: PageSetupPayload,
): Promise<ActionResult> => {
  // Close the dialog first
  getUIStore(deps).getState().closePageSetupDialog();

  // If no payload, we're just closing
  if (!payload) {
    return handled();
  }

  // Get the active sheet ID
  const activeSheetId = getUIStore(deps).getState().activeSheetId;

  if (!activeSheetId) {
    return { handled: false, error: 'No active sheet' };
  }

  const ws = deps.workbook.getSheetById(activeSheetId);
  const { printTitles, ...settings } = payload;
  await ws.print.setSettings(settings);
  if (printTitles) {
    await ws.print.clearPrintTitles();
    if (printTitles.repeatRows) {
      await ws.print.setPrintTitleRows(printTitles.repeatRows[0], printTitles.repeatRows[1]);
    }
    if (printTitles.repeatCols) {
      await ws.print.setPrintTitleColumns(printTitles.repeatCols[0], printTitles.repeatCols[1]);
    }
  }

  return handled();
};

// =============================================================================
// Page Layout Ribbon Quick Actions
// =============================================================================

/**
 * Set page orientation (portrait/landscape).
 * Quick action from Page Layout ribbon Orientation button/dropdown.
 *
 * Payload: { orientation: 'portrait' | 'landscape' }
 */
export const SET_PAGE_ORIENTATION: AsyncActionHandler = async (
  deps,
  payload?: { orientation: 'portrait' | 'landscape' },
): Promise<ActionResult> => {
  if (!payload?.orientation) {
    return { handled: false, error: 'No orientation specified' };
  }

  const activeSheetId = getUIStore(deps).getState().activeSheetId;

  if (!activeSheetId) {
    return { handled: false, error: 'No active sheet' };
  }

  const ws = deps.workbook.getSheetById(activeSheetId);
  await ws.print.setSettings({ orientation: payload.orientation });

  return handled();
};

/**
 * Set paper size.
 * Quick action from Page Layout ribbon Size button/dropdown.
 *
 * Payload: { paperSize: PaperSize }
 */
export const SET_PAPER_SIZE: AsyncActionHandler = async (
  deps,
  payload?: { paperSize: string },
): Promise<ActionResult> => {
  if (!payload?.paperSize || !isPaperSize(payload.paperSize)) {
    return { handled: false, error: 'No paper size specified' };
  }

  const activeSheetId = getUIStore(deps).getState().activeSheetId;

  if (!activeSheetId) {
    return { handled: false, error: 'No active sheet' };
  }

  // isPaperSize narrows payload.paperSize to PaperSize
  const size: PaperSize = payload.paperSize;
  const code = paperSizeToCode[size];

  const ws = deps.workbook.getSheetById(activeSheetId);
  await ws.print.setSettings({ paperSize: code });

  return handled();
};

/**
 * Set page margins preset.
 * Quick action from Page Layout ribbon Margins button/dropdown.
 *
 * Payload: { preset: 'normal' | 'wide' | 'narrow' | 'custom', margins?: PageMargins }
 */
export const SET_PAGE_MARGINS: AsyncActionHandler = async (
  deps,
  payload?: {
    preset: 'normal' | 'wide' | 'narrow' | 'custom';
    margins?: { top: number; right: number; bottom: number; left: number };
  },
): Promise<ActionResult> => {
  if (!payload?.preset) {
    return { handled: false, error: 'No margin preset specified' };
  }

  const activeSheetId = getUIStore(deps).getState().activeSheetId;

  if (!activeSheetId) {
    return { handled: false, error: 'No active sheet' };
  }

  const ws = deps.workbook.getSheetById(activeSheetId);

  // Read existing margins so we preserve header/footer values
  const existing = (await ws.print.getSettings()).margins;
  const headerMargin = existing?.header ?? 0.3;
  const footerMargin = existing?.footer ?? 0.3;

  // Excel margin presets (in inches) — only body margins change per preset
  let bodyMargins: { top: number; right: number; bottom: number; left: number };

  switch (payload.preset) {
    case 'normal':
      bodyMargins = { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7 };
      break;
    case 'wide':
      bodyMargins = { top: 1.0, right: 1.0, bottom: 1.0, left: 1.0 };
      break;
    case 'narrow':
      bodyMargins = { top: 0.75, right: 0.25, bottom: 0.75, left: 0.25 };
      break;
    case 'custom':
      if (!payload.margins) {
        return { handled: false, error: 'Custom margins require margins object' };
      }
      bodyMargins = payload.margins;
      break;
    default:
      return { handled: false, error: `Unknown margin preset: ${payload.preset}` };
  }

  const margins: PageMargins = {
    ...bodyMargins,
    header: headerMargin,
    footer: footerMargin,
  };

  await ws.print.setSettings({ margins });

  return handled();
};

/**
 * Set page scale.
 * Quick action from Page Layout ribbon Scale to Fit group.
 *
 * Payload: { scale: number } (percentage 10-400) OR { fitTo: { width?, height? } }
 */
export const SET_PAGE_SCALE: AsyncActionHandler = async (
  deps,
  payload?: { scale?: number; fitTo?: { width?: number; height?: number } },
): Promise<ActionResult> => {
  if (!payload || (!payload.scale && !payload.fitTo)) {
    return { handled: false, error: 'No scale or fitTo specified' };
  }

  const activeSheetId = getUIStore(deps).getState().activeSheetId;

  if (!activeSheetId) {
    return { handled: false, error: 'No active sheet' };
  }

  const updates: Partial<PrintSettings> = {};

  if (payload.scale !== undefined) {
    // Scale mode: set percentage, clear fitTo
    updates.scale = Math.max(10, Math.min(400, payload.scale));
    updates.fitToWidth = null;
    updates.fitToHeight = null;
  } else if (payload.fitTo) {
    // Fit to page mode: set fitTo, scale becomes secondary
    updates.fitToWidth = payload.fitTo.width ?? null;
    updates.fitToHeight = payload.fitTo.height ?? null;
  }

  const ws = deps.workbook.getSheetById(activeSheetId);
  await ws.print.setSettings(updates);

  return handled();
};

// =============================================================================
// View-side Sheet Options (Page Layout dispatch)
// =============================================================================
//
// The Page Layout ribbon's Sheet Options group exposes two pairs of toggles:
// View Gridlines / View Headings (worksheet view options) and Print Gridlines
// / Print Headings (print settings). These actions toggle the view-side pair.
// The print-side pair lives in `print-export.ts`.
//
// Logic moved from `chrome/toolbar/hooks/use-page-layout-actions.ts:317-327`.
// Read state for `aria-pressed` continues to come from the small
// `useSheetViewOptions` / `usePageLayoutViewOptions` hooks.

/**
 * TOGGLE_VIEW_GRIDLINES
 *
 * Toggle whether gridlines are shown in the worksheet view.
 * Reads the current value from the active worksheet, then writes the inverse.
 */
export const TOGGLE_VIEW_GRIDLINES: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const opts = await ws.view.getViewOptions();
  await ws.view.setGridlines(!opts.showGridlines);

  return handled();
};

/**
 * TOGGLE_VIEW_HEADINGS
 *
 * Toggle whether row + column headings are shown in the worksheet view.
 * Matches the hook's combined-headings semantics: a single boolean flips
 * both row and column headers together.
 */
export const TOGGLE_VIEW_HEADINGS: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const opts = await ws.view.getViewOptions();
  // Combined-row/col semantics: if either is currently shown, hide both;
  // if both are hidden, show both. Matches use-page-layout-actions.ts:322-327.
  const newValue = !(opts.showRowHeaders && opts.showColumnHeaders);
  await ws.view.setHeadings(newValue);

  return handled();
};

// =============================================================================
// Sparkline Dialog Actions
// =============================================================================

/**
 * Open sparkline dialog.
 *
 * Insert → Sparklines menu (Line, Column, Win/Loss buttons)
 *
 * Opens the Insert Sparkline dialog with optional sparkline type preset.
 * The dialog allows the user to select data range and location for sparklines.
 *
 * @param deps - Action dependencies
 * @param payload - Optional { type: 'line' | 'column' | 'winLoss' } to preset the sparkline type
 */
export const OPEN_SPARKLINE_DIALOG: ActionHandler = (
  deps,
  payload?: { type?: 'line' | 'column' | 'winLoss' },
): ActionResult => {
  // Get current selection to pre-fill data range
  const { activeCell, ranges } = getSelectionContext(deps);

  // Build data range string from selection (e.g., "A1:E1")
  let dataRange = '';
  if (ranges.length > 0) {
    dataRange = rangeToA1(ranges[0]);
  }

  // Location defaults to the cell to the right of the selection, or active cell
  let locationRange = '';
  if (activeCell) {
    // Default location: cell to the right of selection end
    const locationCol = ranges.length > 0 ? ranges[0].endCol + 1 : activeCell.col;
    locationRange = colToLetter(locationCol) + (activeCell.row + 1);
  }

  // Open the dialog with pre-filled ranges
  const uiStore = getUIStore(deps);
  uiStore.getState().openSparklineDialog(dataRange, locationRange);

  // If a sparkline type was specified, set it
  if (payload?.type) {
    uiStore.getState().setSparklineType(payload.type);
  }

  return handled();
};

// =============================================================================
// Data Validation Dialog Actions
// =============================================================================

/**
 * Open data validation dialog.
 * Opens the DV dialog for creating or editing data validation rules.
 *
 * Data Validation context menu
 * Auto-detect existing validation when no mode is provided.
 *
 * @param deps - Action dependencies
 * @param payload - Optional payload with mode ('create' | 'edit') and schemaId for edit mode
 */
export const OPEN_DV_DIALOG: AsyncActionHandler = async (
  deps,
  payload?: { mode?: 'create' | 'edit'; schemaId?: string },
): Promise<ActionResult> => {
  // If mode is explicitly provided, use it
  if (payload?.mode) {
    getUIStore(deps).getState().openDVDialog(payload.mode, payload.schemaId);
    return handled();
  }

  // Auto-detect: Check if active cell has existing validation
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);

  // Defensive: If no active cell or sheet, default to create mode
  if (!activeCell || !sheetId) {
    getUIStore(deps).getState().openDVDialog('create');
    return handled();
  }

  // Try to find existing validation, with error handling for robustness
  try {
    // Handle merged cells - check the anchor cell (top-left) for validation
    const ws = deps.workbook.getSheetById(sheetId);
    const mergeRange = await ws.structure.getMergeAtCell(activeCell.row, activeCell.col);
    const cellToCheck = mergeRange
      ? { row: mergeRange.startRow, col: mergeRange.startCol }
      : activeCell;

    const existingValidation = await ws.validations.get(cellToCheck.row, cellToCheck.col);
    if (existingValidation) {
      // Edit existing validation
      getUIStore(deps).getState().openDVDialog('edit', existingValidation.id);
      return handled();
    }
  } catch (error) {
    // If schema lookup fails, gracefully fallback to create mode
    console.warn('Failed to check for existing validation schema:', error);
  }

  // No existing validation - create new
  getUIStore(deps).getState().openDVDialog('create');
  return handled();
};

/**
 * Close data validation dialog.
 */
export const CLOSE_DV_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeDVDialog();
  return handled();
};

/**
 * Open pivot table dialog.
 * Opens the Create Pivot Table dialog.
 */
export const OPEN_PIVOT_DIALOG: ActionHandler = (deps): ActionResult => {
  const { ranges } = getSelectionContext(deps);

  // Convert selection to A1 range string (same pattern as OPEN_SPARKLINE_DIALOG)
  let sourceRange = '';
  if (ranges.length > 0) {
    sourceRange = rangeToA1(ranges[0]);
  }

  getUIStore(deps).getState().openPivotDialog(sourceRange);
  return handled();
};

// =============================================================================
// Data Tab Dialog Actions
// =============================================================================

/**
 * Open Subtotal dialog.
 *
 * Architecture Alignment: Data ribbon dialog actions via dispatch.
 */
export const OPEN_SUBTOTAL_DIALOG: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const { ranges } = getSelectionContext(deps);
  if (ranges.length === 0) {
    return notHandled('disabled');
  }
  const ws = deps.workbook.getSheetById(deps.getActiveSheetId());
  const target = await resolveDataDialogTarget(ws, ranges[0]);
  getUIStore(deps).getState().openSubtotalDialog({
    range: target.range,
    hasHeaders: target.hasHeaders,
  });
  return handled();
};

/**
 * Open Schema Browser panel.
 *
 * Opens the schema browser panel for a database connection.
 * If no connectionId is provided, auto-selects the first available connection.
 * Payload: { connectionId: string }
 */
export const OPEN_SCHEMA_BROWSER: ActionHandler = (
  deps,
  payload?: { connectionId?: string },
): ActionResult => {
  const connectionId = payload?.connectionId;
  if (connectionId) {
    getUIStore(deps).getState().openSchemaBrowser(connectionId);
  } else {
    // No connection specified: open panel without a selection.
    // The SchemaBrowser component will auto-select the first available connection.
    getUIStore(deps).getState().openSchemaBrowser();
  }
  return handled();
};

export const OPEN_WORKBOOK_LINKS_PANEL: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openWorkbookLinksPanel();
  return handled();
};

/**
 * Open Remove Duplicates dialog.
 *
 * Architecture Alignment: Data ribbon dialog actions via dispatch.
 */
export const OPEN_REMOVE_DUPLICATES_DIALOG: AsyncActionHandler = async (
  deps,
): Promise<ActionResult> => {
  const { ranges } = getSelectionContext(deps);
  if (ranges.length === 0) {
    return notHandled('disabled');
  }
  const ws = deps.workbook.getSheetById(deps.getActiveSheetId());
  const target = await resolveDataDialogTarget(ws, ranges[0]);
  getUIStore(deps).getState().openRemoveDuplicatesDialog({
    range: target.range,
    hasHeaders: target.hasHeaders,
  });
  return handled();
};

/**
 * Open Text to Columns dialog.
 *
 * Architecture Alignment: Data ribbon dialog actions via dispatch.
 */
export const OPEN_TEXT_TO_COLUMNS_DIALOG: AsyncActionHandler = async (
  deps,
): Promise<ActionResult> => {
  const { ranges } = getSelectionContext(deps);
  if (ranges.length === 0) {
    return notHandled('disabled');
  }
  const ws = deps.workbook.getSheetById(deps.getActiveSheetId());
  const target = await resolveTextToColumnsTarget(ws, ranges[0]);
  getUIStore(deps).getState().openTextToColumnsDialog({ range: target.range });
  return handled();
};

// =============================================================================
// Settings Dialog Actions
// =============================================================================

/**
 * Open Spread Settings dialog.
 *
 * Architecture Alignment: Settings dialog actions via dispatch.
 */
export const OPEN_SPREAD_SETTINGS_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openSpreadSettingsDialog();
  return handled();
};

/**
 * Open Sheet Settings dialog.
 *
 * Architecture Alignment: Settings dialog actions via dispatch.
 */
export const OPEN_SHEET_SETTINGS_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openSheetSettingsDialog();
  return handled();
};

// =============================================================================
// Conditional Formatting Quick Rule Dialog Actions
// =============================================================================

/**
 * Open Quick Rule dialog for conditional formatting.
 *
 * Architecture Alignment: CF quick rule dialog actions via dispatch.
 *
 * @param deps - Action dependencies
 * @param payload - { type: QuickRuleDialogType } The type of quick rule to create
 */
export const OPEN_QUICK_RULE_DIALOG: ActionHandler = (
  deps,
  payload?: { type: string },
): ActionResult => {
  if (!payload?.type || !isQuickRuleDialogType(payload.type)) {
    return notHandled('disabled');
  }
  getUIStore(deps).getState().openQuickRuleDialog(payload.type);
  return handled();
};

// =============================================================================
// Hyperlink Dialog Actions
// =============================================================================

/**
 * Open Hyperlink dialog (for insert or edit).
 *
 * Opens the hyperlink dialog for inserting or editing hyperlinks. The
 * existing URL (if any) is fetched from the kernel hyperlinks API rather
 * than read from the viewport buffer — `hyperlinkUrl` is intentionally
 * absent from the binary cell record (only `hasHyperlink` is there), so
 * any caller-supplied URL read off `viewport.getCellData(...).hyperlinkUrl`
 * would be `undefined`. Centralising the lookup here means every entry
 * point (toolbar, ribbon, context menu, Ctrl+K) opens the dialog in the
 * correct mode with the URL pre-populated.
 *
 * Payload: { row: number, col: number, existingHyperlink?: string }
 * - If `existingHyperlink` is supplied (e.g. by tests or programmatic
 * callers) it is used as-is without an extra round-trip.
 * - Otherwise the handler fetches the URL via `ws.hyperlinks.get`.
 */
export const OPEN_HYPERLINK_DIALOG: AsyncActionHandler = async (
  deps,
  payload?: { row: number; col: number; existingHyperlink?: string },
): Promise<ActionResult> => {
  const { activeCell } = getSelectionContext(deps);

  // Use payload if provided, otherwise use active cell
  const row = payload?.row ?? activeCell?.row ?? 0;
  const col = payload?.col ?? activeCell?.col ?? 0;

  let existingUrl: string | undefined = payload?.existingHyperlink;
  if (existingUrl === undefined) {
    try {
      const sheetId = deps.getActiveSheetId();
      const ws = deps.workbook.getSheetById(sheetId);
      const url = await ws.hyperlinks.get(row, col);
      existingUrl = url ?? undefined;
    } catch {
      // If lookup fails (e.g. no active sheet) fall back to insert mode.
      existingUrl = undefined;
    }
  }

  getUIStore(deps).getState().openHyperlinkDialog(row, col, existingUrl);
  return handled();
};

/**
 * Remove hyperlink from active cell.
 *
 * Removes the hyperlink from the active cell without deleting the cell content.
 */
export const REMOVE_HYPERLINK: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);

  if (!activeCell) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.getSheetById(sheetId);
  await ws.hyperlinks.remove(activeCell.row, activeCell.col);

  return handled();
};

// =============================================================================
// Thesaurus Dialog Actions
// =============================================================================

/**
 * Open Thesaurus dialog (Shift+F7).
 *
 * Opens the Thesaurus dialog for finding synonyms and antonyms.
 * Extracts the word to look up from:
 * 1. Selected text if editing with character selection
 * 2. Full editor value if editing without selection
 * 3. Active cell's display value if not editing
 *
 * Uses direct UIStore access - handlers should be self-contained.
 */
export const OPEN_THESAURUS_DIALOG: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const word = await getSelectedWordOrCellValue(deps);
  getUIStore(deps).getState().openThesaurusDialog(word);
  return handled();
};

/**
 * Close Thesaurus dialog.
 */
export const CLOSE_THESAURUS_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeThesaurusDialog?.();
  return handled();
};

/**
 * Insert a word from the Thesaurus dialog.
 *
 * Behavior:
 * 1. If editing with character selection, replace just the selection
 * 2. If editing without character selection, commit and replace cell
 * 3. If not editing, replace cell value
 */
export const THESAURUS_INSERT_WORD: AsyncActionHandler = async (
  deps,
  payload?: ThesaurusInsertPayload,
): Promise<ActionResult> => {
  if (!payload?.word) {
    return handled();
  }

  const { word } = payload;
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);

  if (!activeCell) {
    return notHandled('disabled');
  }

  // If editing with character selection, replace just the selection
  if (deps.accessors?.editor?.isEditing()) {
    const hasCharSel = deps.accessors.editor.hasCharSelection?.() ?? false;

    if (hasCharSel) {
      // Compute new value with replacement - logic stays in handler (THIN Actor Access Layer)
      const value = deps.accessors.editor.getValue() ?? '';
      const start = deps.accessors.editor.getCharSelectionStart?.() ?? 0;
      const end = deps.accessors.editor.getCharSelectionEnd?.() ?? 0;
      const newValue = value.slice(0, start) + word + value.slice(end);
      const newCursorPos = start + word.length;

      // Use existing input command to set new value. Pass the post-insert
      // cursor so the machine doesn't fall back to end-of-value before
      // setCursor corrects it.
      deps.commands?.editor?.input(newValue, newCursorPos);
      // Position cursor after inserted word
      deps.commands?.editor?.setCursor?.(newCursorPos);
      return handled();
    }

    // No character selection in editor - commit current edit, then replace cell
    deps.commands?.editor?.commit('none');
  }

  // Replace entire cell value
  const ws = deps.workbook.getSheetById(sheetId);
  await ws.setCell(activeCell.row, activeCell.col, word);
  requestFormulaBarRefresh({
    sheetIds: [sheetId],
    ranges: [
      {
        startRow: activeCell.row,
        startCol: activeCell.col,
        endRow: activeCell.row,
        endCol: activeCell.col,
      },
    ],
  });
  getUIStore(deps).getState().closeThesaurusDialog?.();
  return handled();
};

// =============================================================================
// Create Names from Selection Actions
// =============================================================================

/**
 * Execute Create Names from Selection.
 *
 * Creates named ranges from row/column labels in the selected range.
 * Called by the CreateNamesFromSelectionDialog after user selects options.
 *
 * Payload (inline type - not in separate payloads file):
 * - sheetId: SheetId - The sheet containing the selection
 * - range: CellRange - The selected range
 * - options: { topRow, leftColumn, bottomRow, rightColumn } - Which labels to use
 */
export const CREATE_NAMES_EXECUTE: AsyncActionHandler = async (
  deps,
  payload?: {
    sheetId: SheetId;
    range: CellRange;
    options: {
      topRow: boolean;
      leftColumn: boolean;
      bottomRow: boolean;
      rightColumn: boolean;
    };
  },
): Promise<ActionResult> => {
  if (!payload) {
    return handled();
  }

  const { sheetId, range, options } = payload;

  // Call workbook API to create names
  // Map handler payload field names to API field names
  const result = await deps.workbook.names.createFromSelection(sheetId, range, {
    top: options.topRow,
    left: options.leftColumn,
    bottom: options.bottomRow,
    right: options.rightColumn,
  });

  // Log result for user feedback (TODO: Show toast notification)
  if (result.success > 0 || result.skipped > 0) {
    const message =
      result.skipped > 0
        ? `Created ${result.success} named range(s). ${result.skipped} skipped (duplicates or invalid).`
        : `Created ${result.success} named range(s).`;
    console.log('[CREATE_NAMES_EXECUTE]', message);
  }

  return handled();
};

// =============================================================================
// Keyboard Shortcuts Dialog Actions
// =============================================================================

/**
 * Open Keyboard Shortcuts dialog.
 *
 * Unified Keyboard System - User Customization UI
 *
 * Opens the Keyboard Shortcuts dialog for viewing and customizing shortcuts.
 * Uses a separate Zustand store for dialog state (user preferences).
 */
export const OPEN_KEYBOARD_SHORTCUTS_DIALOG: ActionHandler = (): ActionResult => {
  useKeyboardShortcutsDialogStore.getState().open();
  return handled();
};

/**
 * Close Keyboard Shortcuts dialog.
 *
 * Unified Keyboard System - User Customization UI
 */
export const CLOSE_KEYBOARD_SHORTCUTS_DIALOG: ActionHandler = (): ActionResult => {
  useKeyboardShortcutsDialogStore.getState().close();
  return handled();
};
