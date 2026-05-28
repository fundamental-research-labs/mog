/**
 * UI Action Handlers - Barrel Export
 *
 * Re-exports all UI-related action handlers from focused modules.
 * This file replaces the monolithic ui.ts (2108 lines) with organized sub-modules.
 *
 * Module Organization:
 * - dialog-handlers.ts: All dialog open/close actions (~52 handlers)
 * - view-handlers.ts: View toggles, zoom, ribbon modes (~14 handlers)
 * - file-handlers.ts: File ops, backstage, find, calculation (~19 handlers)
 * - context-range-handlers.ts: Context menu, range selection (~5 handlers)
 * - misc-handlers.ts: Validation, colors, accessibility, error/array, proofing (~14 handlers)
 *
 */

// =============================================================================
// Dialog Handlers
// =============================================================================

export {
  APPLY_MORE_COLORS_BORDER,
  APPLY_MORE_COLORS_FILL,
  APPLY_MORE_COLORS_FONT,
  APPLY_PAGE_SETUP,
  CLOSE_COLUMN_WIDTH_DIALOG,
  CLOSE_DV_DIALOG,
  CLOSE_FORMAT_CELLS_DIALOG,
  CLOSE_FUNCTION_ARGUMENTS_DIALOG,
  CLOSE_GO_TO_DIALOG,
  CLOSE_INSERT_FUNCTION_DIALOG,
  // Keyboard Shortcuts Dialog
  CLOSE_KEYBOARD_SHORTCUTS_DIALOG,
  CLOSE_MORE_COLORS_DIALOG,
  CLOSE_PAGE_SETUP_DIALOG,
  CLOSE_PRINT_PDF_DIALOG,
  CLOSE_ROW_HEIGHT_DIALOG,
  CLOSE_THESAURUS_DIALOG,
  CREATE_NAMES_EXECUTE,
  NAVIGATE_TO_REFERENCE,
  OPEN_COLUMN_WIDTH_DIALOG,
  OPEN_CUSTOM_SORT_DIALOG,
  OPEN_DEFINE_NAME_DIALOG,
  OPEN_DELETE_CELLS_DIALOG,
  OPEN_DROPDOWN,
  OPEN_DV_DIALOG,
  OPEN_FIND_DIALOG,
  OPEN_FIND_REPLACE_DIALOG,
  OPEN_FONT_DIALOG,
  OPEN_FORMAT_CELLS_DIALOG,
  OPEN_FUNCTION_ARGUMENTS_DIALOG,
  OPEN_GO_TO_DIALOG,
  OPEN_GO_TO_SPECIAL_DIALOG,
  OPEN_HYPERLINK_DIALOG,
  OPEN_INSERT_CELLS_DIALOG,
  OPEN_INSERT_FUNCTION_DIALOG,
  // Keyboard Shortcuts Dialog
  OPEN_KEYBOARD_SHORTCUTS_DIALOG,
  OPEN_MORE_COLORS_DIALOG,
  OPEN_NAME_MANAGER,
  OPEN_PAGE_SETUP_DIALOG,
  OPEN_PASTE_SPECIAL_DIALOG,
  OPEN_PIVOT_DIALOG,
  OPEN_PRINT_PDF_DIALOG,
  OPEN_PRINT_PREVIEW,
  OPEN_QUICK_RULE_DIALOG,
  OPEN_REMOVE_DUPLICATES_DIALOG,
  OPEN_ROW_HEIGHT_DIALOG,
  OPEN_SCHEMA_BROWSER,
  OPEN_WORKBOOK_LINKS_PANEL,
  OPEN_SHEET_SETTINGS_DIALOG,
  OPEN_SPARKLINE_DIALOG,
  OPEN_SPREAD_SETTINGS_DIALOG,
  OPEN_SUBTOTAL_DIALOG,
  OPEN_TEXT_TO_COLUMNS_DIALOG,
  OPEN_THESAURUS_DIALOG,
  REMOVE_HYPERLINK,
  SET_PAGE_MARGINS,
  SET_PAGE_ORIENTATION,
  SET_PAGE_SCALE,
  SET_PAPER_SIZE,
  THESAURUS_INSERT_WORD,
  // Page Layout dispatch: View-side sheet options
  TOGGLE_VIEW_GRIDLINES,
  TOGGLE_VIEW_HEADINGS,
} from './dialog-handlers';

// =============================================================================
// View Handlers
// =============================================================================

export {
  ACTIVATE_RIBBON_KEYTIPS,
  DEACTIVATE_RIBBON_KEYTIPS,
  FULL_SCREEN,
  HIDE_RIBBON_TEMPORARILY,
  SET_RIBBON_DISPLAY_MODE,
  SET_ZOOM,
  SHOW_RIBBON_TEMPORARILY,
  TOGGLE_AUTO_FILTER,
  TOGGLE_FORMULA_BAR_EXPAND,
  TOGGLE_FORMULA_VIEW,
  TOGGLE_EXTENSION_PANEL,
  TOGGLE_NL_BAR,
  TOGGLE_RIBBON,
  TOGGLE_RIBBON_TABS_MODE,
  TOGGLE_SCROLL_LOCK,
  ZOOM_IN,
  ZOOM_OUT,
  ZOOM_RESET,
} from './view-handlers';

// =============================================================================
// File Handlers
// =============================================================================

export {
  BROWSE_FILES,
  CALCULATE_ALL,
  CALCULATE_SHEET,
  CLOSE_BACKSTAGE,
  CLOSE_FILE,
  CLOSE_WORKBOOK,
  CREATE_NAMES_FROM_SELECTION,
  EXPORT_AS_CSV,
  EXPORT_AS_PDF,
  EXPORT_AS_XLSX,
  EXPORT_FILE,
  FIND_NEXT,
  FIND_PREVIOUS,
  NEW_WORKBOOK,
  OPEN,
  OPEN_BACKSTAGE,
  OPEN_COMMAND_PALETTE,
  OPEN_RECENT_FILE,
  PRINT,
  REFRESH_ALL_DATA,
  REFRESH_CONNECTION,
  REMOVE_DEPENDENT_ARROWS,
  REMOVE_PRECEDENT_ARROWS,
  REMOVE_TRACE_ARROWS,
  SAVE,
  SET_BACKSTAGE_PANEL,
  SHARE_DOCUMENT,
  TRACE_DEPENDENTS,
  TRACE_PRECEDENTS,
} from './file-handlers';

// =============================================================================
// Context Menu & Range Selection Handlers
// =============================================================================

export {
  CANCEL_RANGE_SELECTION,
  COMPLETE_RANGE_SELECTION,
  INVOKE_CONTEXT_MENU,
  START_RANGE_SELECTION_MODE,
  UPDATE_RANGE_SELECTION,
} from './context-range-handlers';

// =============================================================================
// Keytip Picker / Ribbon-Tab Handlers
// =============================================================================

export {
  CLOSE_BORDERS_PICKER,
  CLOSE_FILL_COLOR_PICKER,
  CLOSE_FONT_COLOR_PICKER,
  CLOSE_FONT_FAMILY_PICKER,
  CLOSE_NUMBER_FORMAT_DROPDOWN,
  CLOSE_RIBBON_DROPDOWN,
  FOCUS_FONT_SIZE_INPUT,
  OPEN_BORDERS_PICKER,
  OPEN_FILL_COLOR_PICKER,
  OPEN_FONT_COLOR_PICKER,
  OPEN_FONT_FAMILY_PICKER,
  OPEN_NUMBER_FORMAT_DROPDOWN,
  OPEN_RIBBON_DROPDOWN,
  SWITCH_RIBBON_TAB,
  TRIGGER_AUTOSUM,
} from './keytip-handlers';

// =============================================================================
// Misc Handlers (Validation, Colors, Accessibility, Errors, Proofing)
// =============================================================================

export {
  ANNOUNCE_CELL_FORMAT,
  CHECK_ACCESSIBILITY,
  CLOSE_ACCESSIBILITY_PANEL,
  HIDE_VALIDATION_CIRCLES,
  IGNORE_ERROR,
  NAVIGATE_TO_ACCESSIBILITY_ISSUE,
  OPEN_HELP,
  OPEN_QUICK_ANALYSIS,
  SELECT_ARRAY,
  SHOW_VALIDATION_CIRCLES,
  SHOW_WORKBOOK_STATISTICS,
  STOP_MACRO_RECORDING,
  TOGGLE_MACRO_RECORDING,
  TOGGLE_VALIDATION_CIRCLES,
  TRACE_ERROR,
  TRACK_RECENT_COLOR,
} from './misc-handlers';
