/**
 * Keyboard Actions - Machine Events
 *
 * These types define all keyboard-triggered events that are sent to XState machines.
 * The KeyboardCoordinator dispatches these events based on the shortcut registry.
 *
 * ARCHITECTURE:
 * - Each action type maps to an event that a specific machine handles
 * - The coordinator routes events to the correct machine based on action type
 * - Actions are discriminated unions for type-safe dispatch
 *
 */

// =============================================================================
// Action Target Routing
// =============================================================================

/**
 * Target handler for keyboard actions.
 * Used by KeyboardCoordinator to route events.
 */
export type ActionTarget =
  | 'selection' // SelectionMachine
  | 'editor' // EditorMachine
  | 'clipboard' // ClipboardMachine
  | 'store' // SpreadsheetStore (formatting, undo/redo)
  | 'ui' // UI layer (dialogs, view toggles)
  | 'workbook' // Workbook operations (sheets)
  | 'object'; // FloatingObjectManager

// =============================================================================
// Selection Machine Events
// =============================================================================

export type SelectionKeyboardAction =
  // Movement
  | { type: 'MOVE_UP' }
  | { type: 'MOVE_DOWN' }
  | { type: 'MOVE_LEFT' }
  | { type: 'MOVE_RIGHT' }
  | { type: 'MOVE_TO_EDGE_UP' }
  | { type: 'MOVE_TO_EDGE_DOWN' }
  | { type: 'MOVE_TO_EDGE_LEFT' }
  | { type: 'MOVE_TO_EDGE_RIGHT' }
  | { type: 'MOVE_TO_ROW_START' }
  | { type: 'MOVE_TO_ROW_END' }
  | { type: 'MOVE_TO_A1' }
  | { type: 'MOVE_TO_LAST_USED_CELL' }
  | { type: 'PAGE_UP' }
  | { type: 'PAGE_DOWN' }
  | { type: 'PAGE_LEFT' }
  | { type: 'PAGE_RIGHT' }
  | { type: 'TAB_FORWARD' }
  | { type: 'TAB_BACKWARD' }
  | { type: 'ENTER_NAVIGATE' }
  | { type: 'SHIFT_ENTER_NAVIGATE' }
  // Selection extension
  | { type: 'EXTEND_SELECTION_UP' }
  | { type: 'EXTEND_SELECTION_DOWN' }
  | { type: 'EXTEND_SELECTION_LEFT' }
  | { type: 'EXTEND_SELECTION_RIGHT' }
  | { type: 'EXTEND_TO_EDGE_UP' }
  | { type: 'EXTEND_TO_EDGE_DOWN' }
  | { type: 'EXTEND_TO_EDGE_LEFT' }
  | { type: 'EXTEND_TO_EDGE_RIGHT' }
  | { type: 'EXTEND_TO_ROW_START' }
  | { type: 'EXTEND_TO_A1' }
  | { type: 'EXTEND_TO_LAST_USED_CELL' }
  // Selection commands
  | { type: 'SELECT_ALL' }
  | { type: 'SELECT_CURRENT_REGION' }
  | { type: 'SELECT_ENTIRE_ROW' }
  | { type: 'SELECT_ENTIRE_COLUMN' }
  | { type: 'SELECT_PRECEDENTS' }
  | { type: 'SELECT_DEPENDENTS' }
  | { type: 'SELECT_VISIBLE_CELLS' }
  | { type: 'TOGGLE_ADD_TO_SELECTION' }
  // Special selections (Go To Special functionality)
  | { type: 'SELECT_BLANKS' }
  | { type: 'SELECT_CONSTANTS' }
  | { type: 'SELECT_FORMULAS' }
  | { type: 'SELECT_NUMBERS' }
  | { type: 'SELECT_TEXT' }
  | { type: 'SELECT_LOGICALS' }
  | { type: 'SELECT_ERRORS' }
  // Row/Column differences
  | { type: 'SELECT_ROW_DIFFERENCES' }
  | { type: 'SELECT_COLUMN_DIFFERENCES' };

// =============================================================================
// Editor Machine Events
// =============================================================================

export type EditorKeyboardAction =
  // Editing lifecycle
  | { type: 'EDIT_CELL' }
  | { type: 'COMMIT_AND_MOVE_DOWN' }
  | { type: 'COMMIT_AND_MOVE_UP' }
  | { type: 'COMMIT_AND_MOVE_LEFT' }
  | { type: 'COMMIT_AND_MOVE_RIGHT' }
  | { type: 'CANCEL_EDIT' }
  | { type: 'INSERT_NEWLINE' }
  | { type: 'START_FORMULA' }
  // Content modification
  | { type: 'CLEAR_CONTENTS' }
  | { type: 'CLEAR_AND_EDIT' }
  | { type: 'DELETE_TO_END_OF_LINE' }
  // Fill operations
  | { type: 'FILL_DOWN' }
  | { type: 'FILL_RIGHT' }
  | { type: 'FILL_SELECTION' }
  // Special insertions
  | { type: 'INSERT_CURRENT_DATE' }
  | { type: 'INSERT_CURRENT_TIME' }
  | { type: 'COPY_VALUE_FROM_ABOVE' }
  | { type: 'COPY_FORMULA_FROM_ABOVE' }
  // Formula-specific
  | { type: 'CYCLE_REFERENCE' }
  | { type: 'ENTER_ARRAY_FORMULA' }
  | { type: 'INSERT_FUNCTION_ARGS' }
  | { type: 'PASTE_NAME_IN_FORMULA' }
  | { type: 'AUTO_SUM' };

// =============================================================================
// Clipboard Machine Events
// =============================================================================

export type ClipboardKeyboardAction =
  | { type: 'COPY' }
  | { type: 'CUT' }
  | { type: 'PASTE' }
  | { type: 'OPEN_PASTE_SPECIAL_DIALOG' };

// =============================================================================
// Formatting Actions (via SpreadsheetStore, not machine)
// =============================================================================

export type FormattingKeyboardAction =
  // Font style
  | { type: 'TOGGLE_BOLD' }
  | { type: 'TOGGLE_ITALIC' }
  | { type: 'TOGGLE_UNDERLINE' }
  | { type: 'TOGGLE_STRIKETHROUGH' }
  // Font size
  | { type: 'INCREASE_FONT_SIZE' }
  | { type: 'DECREASE_FONT_SIZE' }
  // Number formats
  | { type: 'FORMAT_GENERAL' }
  | { type: 'FORMAT_NUMBER' }
  | { type: 'FORMAT_TIME' }
  | { type: 'FORMAT_DATE' }
  | { type: 'FORMAT_CURRENCY' }
  | { type: 'FORMAT_PERCENTAGE' }
  | { type: 'FORMAT_SCIENTIFIC' }
  // Borders
  | { type: 'APPLY_OUTLINE_BORDER' }
  | { type: 'REMOVE_BORDERS' }
  // Structure
  | { type: 'INSERT_TABLE' }
  | { type: 'TOGGLE_MERGE' };

// =============================================================================
// Dialog/UI Actions (coordinator dispatches to UI layer)
// =============================================================================

export type DialogKeyboardAction =
  | { type: 'OPEN_GO_TO_DIALOG' }
  | { type: 'OPEN_GO_TO_SPECIAL_DIALOG' }
  | { type: 'OPEN_FORMAT_CELLS_DIALOG' }
  | { type: 'OPEN_FONT_DIALOG' }
  | { type: 'OPEN_INSERT_FUNCTION_DIALOG' }
  | { type: 'OPEN_NAME_MANAGER' }
  | { type: 'OPEN_FIND_DIALOG' }
  | { type: 'OPEN_FIND_REPLACE_DIALOG' }
  | { type: 'OPEN_PASTE_SPECIAL_DIALOG' }
  | { type: 'OPEN_DROPDOWN' };

// =============================================================================
// View/Workbook Actions
// =============================================================================

export type ViewKeyboardAction =
  | { type: 'TOGGLE_FORMULA_VIEW' }
  | { type: 'TOGGLE_FORMULA_BAR_EXPAND' }
  | { type: 'TOGGLE_AUTO_FILTER' }
  | { type: 'TOGGLE_RIBBON' }
  | { type: 'TOGGLE_RIBBON_TABS_MODE' } // Ctrl+F1
  | { type: 'ZOOM_IN' }
  | { type: 'ZOOM_OUT' }
  | { type: 'FULL_SCREEN' }
  | { type: 'HIDE_ROW' }
  | { type: 'UNHIDE_ROW' }
  | { type: 'HIDE_COLUMN' }
  | { type: 'UNHIDE_COLUMN' };

export type WorkbookKeyboardAction =
  | { type: 'PREVIOUS_SHEET' }
  | { type: 'NEXT_SHEET' }
  | { type: 'INSERT_SHEET' }
  | { type: 'GROUP' }
  | { type: 'UNGROUP' }
  | { type: 'SHOW_DETAIL' }
  | { type: 'HIDE_DETAIL' };

export type FileKeyboardAction =
  | { type: 'SAVE' }
  | { type: 'OPEN' }
  | { type: 'NEW_WORKBOOK' }
  | { type: 'PRINT' }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export type DataKeyboardAction =
  | { type: 'FIND_NEXT' }
  | { type: 'FIND_PREVIOUS' }
  | { type: 'CALCULATE_ALL' }
  | { type: 'CALCULATE_SHEET' }
  | { type: 'CREATE_NAMES_FROM_SELECTION' }
  // F9 Partial Formula Evaluation
  | { type: 'EVALUATE_FORMULA_SELECTION' };

// =============================================================================
// Object Actions (floating objects context)
// =============================================================================

export type ObjectKeyboardAction =
  | { type: 'DELETE_OBJECT' }
  | { type: 'DESELECT_OBJECT' }
  | { type: 'NUDGE_OBJECT_UP' }
  | { type: 'NUDGE_OBJECT_DOWN' }
  | { type: 'NUDGE_OBJECT_LEFT' }
  | { type: 'NUDGE_OBJECT_RIGHT' }
  | { type: 'NUDGE_OBJECT_UP_FINE' }
  | { type: 'NUDGE_OBJECT_DOWN_FINE' }
  | { type: 'NUDGE_OBJECT_LEFT_FINE' }
  | { type: 'NUDGE_OBJECT_RIGHT_FINE' }
  | { type: 'DUPLICATE_OBJECT' };

// =============================================================================
// Navigation Actions (E1/E4: Pane Navigation & Scroll to Active Cell)
// =============================================================================

export type NavigationKeyboardAction =
  | { type: 'FOCUS_NEXT_PANE' }
  | { type: 'FOCUS_PREVIOUS_PANE' }
  | { type: 'SCROLL_TO_ACTIVE_CELL' };

// =============================================================================
// Union of All Actions
// =============================================================================

export type KeyboardAction =
  | SelectionKeyboardAction
  | EditorKeyboardAction
  | ClipboardKeyboardAction
  | FormattingKeyboardAction
  | DialogKeyboardAction
  | ViewKeyboardAction
  | WorkbookKeyboardAction
  | FileKeyboardAction
  | DataKeyboardAction
  | ObjectKeyboardAction
  | NavigationKeyboardAction;

// =============================================================================
// Action Routing Map
// =============================================================================

/**
 * Maps action types to their target machine/handler.
 * Used by KeyboardCoordinator to route events.
 */
export const ACTION_TARGET_MAP: Record<string, ActionTarget> = {
  // ===========================================================================
  // Selection machine
  // ===========================================================================
  MOVE_UP: 'selection',
  MOVE_DOWN: 'selection',
  MOVE_LEFT: 'selection',
  MOVE_RIGHT: 'selection',
  MOVE_TO_EDGE_UP: 'selection',
  MOVE_TO_EDGE_DOWN: 'selection',
  MOVE_TO_EDGE_LEFT: 'selection',
  MOVE_TO_EDGE_RIGHT: 'selection',
  MOVE_TO_ROW_START: 'selection',
  MOVE_TO_ROW_END: 'selection',
  MOVE_TO_A1: 'selection',
  MOVE_TO_LAST_USED_CELL: 'selection',
  PAGE_UP: 'selection',
  PAGE_DOWN: 'selection',
  PAGE_LEFT: 'selection',
  PAGE_RIGHT: 'selection',
  TAB_FORWARD: 'selection',
  TAB_BACKWARD: 'selection',
  ENTER_NAVIGATE: 'selection',
  SHIFT_ENTER_NAVIGATE: 'selection',
  EXTEND_SELECTION_UP: 'selection',
  EXTEND_SELECTION_DOWN: 'selection',
  EXTEND_SELECTION_LEFT: 'selection',
  EXTEND_SELECTION_RIGHT: 'selection',
  EXTEND_TO_EDGE_UP: 'selection',
  EXTEND_TO_EDGE_DOWN: 'selection',
  EXTEND_TO_EDGE_LEFT: 'selection',
  EXTEND_TO_EDGE_RIGHT: 'selection',
  EXTEND_TO_ROW_START: 'selection',
  EXTEND_TO_A1: 'selection',
  EXTEND_TO_LAST_USED_CELL: 'selection',
  SELECT_ALL: 'selection',
  SELECT_CURRENT_REGION: 'store', // Needs store access to find contiguous region
  SELECT_ENTIRE_ROW: 'selection',
  SELECT_ENTIRE_COLUMN: 'selection',
  SELECT_PRECEDENTS: 'store', // Needs store access to query dependency graph
  SELECT_DEPENDENTS: 'store', // Needs store access to query dependency graph
  SELECT_VISIBLE_CELLS: 'selection',
  TOGGLE_ADD_TO_SELECTION: 'selection',
  // Special selections (Go To Special) - need store access to scan cells
  SELECT_BLANKS: 'store',
  SELECT_CONSTANTS: 'store',
  SELECT_FORMULAS: 'store',
  SELECT_NUMBERS: 'store',
  SELECT_TEXT: 'store',
  SELECT_LOGICALS: 'store',
  SELECT_ERRORS: 'store',
  // Row/Column differences
  SELECT_ROW_DIFFERENCES: 'store',
  SELECT_COLUMN_DIFFERENCES: 'store',

  // ===========================================================================
  // Editor machine
  // ===========================================================================
  EDIT_CELL: 'editor',
  COMMIT_AND_MOVE_DOWN: 'editor',
  COMMIT_AND_MOVE_UP: 'editor',
  COMMIT_AND_MOVE_LEFT: 'editor',
  COMMIT_AND_MOVE_RIGHT: 'editor',
  CANCEL_EDIT: 'editor',
  INSERT_NEWLINE: 'editor',
  START_FORMULA: 'editor',
  CLEAR_CONTENTS: 'editor',
  CLEAR_AND_EDIT: 'editor',
  DELETE_TO_END_OF_LINE: 'editor',
  FILL_DOWN: 'editor',
  FILL_RIGHT: 'editor',
  FILL_SELECTION: 'editor',
  INSERT_CURRENT_DATE: 'editor',
  INSERT_CURRENT_TIME: 'editor',
  COPY_VALUE_FROM_ABOVE: 'editor',
  COPY_FORMULA_FROM_ABOVE: 'editor',
  CYCLE_REFERENCE: 'editor',
  ENTER_ARRAY_FORMULA: 'editor',
  INSERT_FUNCTION_ARGS: 'editor',
  PASTE_NAME_IN_FORMULA: 'editor',
  AUTO_SUM: 'editor',

  // ===========================================================================
  // Clipboard machine
  // ===========================================================================
  COPY: 'clipboard',
  CUT: 'clipboard',
  PASTE: 'clipboard',

  // ===========================================================================
  // Store (formatting, undo/redo)
  // ===========================================================================
  TOGGLE_BOLD: 'store',
  TOGGLE_ITALIC: 'store',
  TOGGLE_UNDERLINE: 'store',
  TOGGLE_STRIKETHROUGH: 'store',
  INCREASE_FONT_SIZE: 'store',
  DECREASE_FONT_SIZE: 'store',
  FORMAT_GENERAL: 'store',
  FORMAT_NUMBER: 'store',
  FORMAT_TIME: 'store',
  FORMAT_DATE: 'store',
  FORMAT_CURRENCY: 'store',
  FORMAT_PERCENTAGE: 'store',
  FORMAT_SCIENTIFIC: 'store',
  APPLY_OUTLINE_BORDER: 'store',
  REMOVE_BORDERS: 'store',
  INSERT_TABLE: 'store',
  TOGGLE_MERGE: 'store',
  UNDO: 'store',
  REDO: 'store',
  HIDE_ROW: 'store',
  UNHIDE_ROW: 'store',
  HIDE_COLUMN: 'store',
  UNHIDE_COLUMN: 'store',

  // ===========================================================================
  // UI layer (dialogs, view toggles)
  // ===========================================================================
  OPEN_GO_TO_DIALOG: 'ui',
  OPEN_GO_TO_SPECIAL_DIALOG: 'ui',
  OPEN_FORMAT_CELLS_DIALOG: 'ui',
  OPEN_FONT_DIALOG: 'ui',
  OPEN_INSERT_FUNCTION_DIALOG: 'ui',
  OPEN_NAME_MANAGER: 'ui',
  OPEN_FIND_DIALOG: 'ui',
  OPEN_FIND_REPLACE_DIALOG: 'ui',
  OPEN_PASTE_SPECIAL_DIALOG: 'ui',
  OPEN_DROPDOWN: 'ui',
  TOGGLE_FORMULA_VIEW: 'ui',
  TOGGLE_FORMULA_BAR_EXPAND: 'ui',
  TOGGLE_AUTO_FILTER: 'ui',
  TOGGLE_RIBBON: 'ui',
  TOGGLE_RIBBON_TABS_MODE: 'ui', // Ribbon tabs mode
  ZOOM_IN: 'ui',
  ZOOM_OUT: 'ui',
  FULL_SCREEN: 'ui',
  SAVE: 'ui',
  OPEN: 'ui',
  NEW_WORKBOOK: 'ui',
  PRINT: 'ui',
  FIND_NEXT: 'ui',
  FIND_PREVIOUS: 'ui',
  CALCULATE_ALL: 'store', // Force recalculation via store
  CALCULATE_SHEET: 'store', // Force recalculation via store
  CREATE_NAMES_FROM_SELECTION: 'ui',
  // F9 Partial Formula Evaluation
  EVALUATE_FORMULA_SELECTION: 'store', // Evaluates selected portion in formula editing

  // ===========================================================================
  // Workbook operations
  // ===========================================================================
  PREVIOUS_SHEET: 'workbook',
  NEXT_SHEET: 'workbook',
  INSERT_SHEET: 'workbook',
  GROUP: 'workbook',
  UNGROUP: 'workbook',
  SHOW_DETAIL: 'workbook',
  HIDE_DETAIL: 'workbook',

  // ===========================================================================
  // Object operations (floating objects)
  // ===========================================================================
  DELETE_OBJECT: 'object',
  DESELECT_OBJECT: 'object',
  NUDGE_OBJECT_UP: 'object',
  NUDGE_OBJECT_DOWN: 'object',
  NUDGE_OBJECT_LEFT: 'object',
  NUDGE_OBJECT_RIGHT: 'object',
  NUDGE_OBJECT_UP_FINE: 'object',
  NUDGE_OBJECT_DOWN_FINE: 'object',
  NUDGE_OBJECT_LEFT_FINE: 'object',
  NUDGE_OBJECT_RIGHT_FINE: 'object',
  DUPLICATE_OBJECT: 'object',

  // ===========================================================================
  // Navigation operations (E1/E4: Pane Navigation & Scroll to Active Cell)
  // ===========================================================================
  FOCUS_NEXT_PANE: 'ui',
  FOCUS_PREVIOUS_PANE: 'ui',
  SCROLL_TO_ACTIVE_CELL: 'ui',
};
