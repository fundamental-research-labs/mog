/**
 * Unified Action System - Type Definitions
 *
 * These types define the unified action dispatch system that replaces
 * duplicate action implementations across keyboard, toolbar, and context menu.
 *
 * ARCHITECTURE:
 * - All input sources (keyboard, toolbar, context menu, AI agent) dispatch actions
 *   through a single handler system: dispatch(actionType, deps) → ActionResult
 * - Handlers are pure functions in engine/src/state/actions/handlers/
 * - This file contains ONLY types; all implementation is in engine/
 *
 * Package Boundary:
 * - Types in contracts/ (this file)
 * - Handlers in engine/ (handlers import Mutations, domain modules, etc.)
 * - This prevents contracts → engine → contracts circular dependency
 *
 */

import type { CellFormat } from '@mog/types-core';

// =============================================================================
// Action Payload Types
// =============================================================================

/** Payload for THESAURUS_INSERT_WORD action */
export interface ThesaurusInsertPayload {
  /** The synonym/antonym word to insert */
  word: string;
}

/**
 * Ribbon tab identifier — used by `SWITCH_RIBBON_TAB` action and the
 * unified keytip routing for `Alt+<letter>` chord shortcuts.
 *
 * The list mirrors `TabId` in `apps/spreadsheet/src/chrome/toolbar/primitives/TabbedToolbar.tsx`;
 * keep them in sync (TabbedToolbar is the consumer; the contract is the source of truth).
 *
 * Note: `'file'` is intentionally NOT a ribbon tab id. The File affordance is a
 * backstage trigger button rendered in the tab strip; `Alt+F` dispatches
 * `OPEN_BACKSTAGE` directly rather than going through `SWITCH_RIBBON_TAB`.
 */
export type RibbonTabId =
  | 'home'
  | 'insert'
  | 'draw'
  | 'page'
  | 'formulas'
  | 'data'
  | 'review'
  | 'view'
  | 'help'
  | 'table-design'
  | 'chart-design'
  | 'chart-format'
  | 'picture-tools'
  | 'slicer-tools'
  | 'sparkline-tools'
  | 'diagram-design'
  | 'diagram-format'
  | 'pivot-analyze'
  | 'pivot-design';

/** Payload for SWITCH_RIBBON_TAB action — typed argument carried via KeyboardShortcut.actionArg. */
export interface SwitchRibbonTabPayload {
  /** Target tab to activate. */
  tabId: RibbonTabId;
}

/**
 * Named ribbon dropdown / popover identifier.
 *
 * The `ribbonDropdowns` uiStore slice keeps the open-state of every ribbon
 * group/tab dropdown that needs to be openable from a typed keyboard chord
 * (Excel Alt+keytip flow). Each dropdown component reads/writes its slot
 * via this id; `OPEN_RIBBON_DROPDOWN` sets one slot to `true`.
 *
 * Adding a new dropdown: add the id here, register the corresponding
 * `KeyboardShortcut` chord in `keyboard/definitions/keytips-<tab>.ts`,
 * and wire the component's `<RibbonDropdown open={...} onOpenChange={...}>`
 * to the slice. The slice itself is dropdown-id agnostic — no slice change
 * required.
 */
export type RibbonDropdownId =
  // Home tab — Alignment group
  | 'home.merge'
  | 'home.orientation'
  // Home tab — Editing group
  | 'home.autosum'
  | 'home.fill'
  | 'home.clear'
  | 'home.sort-filter'
  | 'home.find-select'
  // Home tab — Cells group
  | 'home.insert'
  | 'home.delete'
  | 'home.format'
  // Home tab — Styles group
  | 'home.format-as-table'
  | 'home.cell-styles'
  | 'home.conditional-formatting'
  // Insert tab
  | 'insert.sparkline'
  | 'insert.shapes'
  // Formulas tab — function category dropdowns
  | 'formulas.financial'
  | 'formulas.logical'
  | 'formulas.text'
  | 'formulas.date-time'
  | 'formulas.math-trig'
  // Data tab
  | 'data.get-data'
  // Page tab (the user-visible label is "Page Layout"; the tab id and
  // dropdown id namespace are both `page` so the asymmetry between
  // `tabId === 'page'` and `dropdownId.startsWith('page-layout.')` —
  // an artefact of a half-applied rename — is gone.)
  | 'page.margins'
  | 'page.orientation'
  | 'page.size'
  | 'page.print-area'
  | 'page.breaks'
  // View tab
  | 'view.freeze-panes'
  | 'view.appearance-mode'
  // Table Design contextual tab
  | 'table-design.style-gallery';

/** Payload for OPEN_RIBBON_DROPDOWN / CLOSE_RIBBON_DROPDOWN actions. */
export interface RibbonDropdownPayload {
  /** Identifier for the named dropdown to open or close. */
  dropdownId: RibbonDropdownId;
}

type Exact<T, U> = [Exclude<T, U>, Exclude<U, T>] extends [never, never] ? true : false;
type Assert<T extends true> = T;

type CellFormatHorizontalAlign = Exclude<NonNullable<CellFormat['horizontalAlign']>, 'general'>;
type CellFormatVerticalAlign = NonNullable<CellFormat['verticalAlign']>;

export type CellHorizontalAlign =
  | 'left'
  | 'center'
  | 'right'
  | 'fill'
  | 'justify'
  | 'centerContinuous'
  | 'distributed';
export type CellVerticalAlign = 'top' | 'middle' | 'bottom' | 'justify' | 'distributed';

type _CellHorizontalAlignContractCheck = Assert<
  Exact<CellHorizontalAlign, CellFormatHorizontalAlign>
>;
type _CellVerticalAlignContractCheck = Assert<Exact<CellVerticalAlign, CellFormatVerticalAlign>>;

/** Payload for SET_HORIZONTAL_ALIGN. */
export interface SetHorizontalAlignPayload {
  /** Target horizontal alignment for the selected cells. */
  align: CellHorizontalAlign;
}

/** Payload for SET_VERTICAL_ALIGN. */
export interface SetVerticalAlignPayload {
  /** Target vertical alignment for the selected cells. */
  align: CellVerticalAlign;
}

export type PageSetupDialogTab = 'page' | 'margins' | 'headerFooter' | 'sheet';

/** Payload for OPEN_PAGE_SETUP_DIALOG. */
export interface OpenPageSetupDialogPayload {
  /** Optional initial tab to select when the dialog opens. */
  initialTab?: PageSetupDialogTab;
}

// =============================================================================
// Action Type Categories
// =============================================================================

/**
 * Selection actions - movement and selection operations.
 * Target: SelectionMachine
 */
export type SelectionActionType =
  // Movement
  | 'MOVE_UP'
  | 'MOVE_DOWN'
  | 'MOVE_LEFT'
  | 'MOVE_RIGHT'
  | 'MOVE_TO_EDGE_UP'
  | 'MOVE_TO_EDGE_DOWN'
  | 'MOVE_TO_EDGE_LEFT'
  | 'MOVE_TO_EDGE_RIGHT'
  | 'MOVE_TO_ROW_START'
  | 'MOVE_TO_ROW_END'
  | 'MOVE_TO_A1'
  | 'MOVE_TO_LAST_USED_CELL'
  // Table-aware navigation
  | 'MOVE_TO_TABLE_START'
  | 'MOVE_TO_TABLE_END'
  | 'MOVE_TO_TABLE_EDGE_UP'
  | 'MOVE_TO_TABLE_EDGE_DOWN'
  | 'MOVE_TO_TABLE_EDGE_LEFT'
  | 'MOVE_TO_TABLE_EDGE_RIGHT'
  | 'PAGE_UP'
  | 'PAGE_DOWN'
  | 'PAGE_LEFT'
  | 'PAGE_RIGHT'
  | 'TAB_FORWARD'
  | 'TAB_BACKWARD'
  | 'ENTER_NAVIGATE'
  | 'SHIFT_ENTER_NAVIGATE'
  // Selection extension
  | 'EXTEND_SELECTION_UP'
  | 'EXTEND_SELECTION_DOWN'
  | 'EXTEND_SELECTION_LEFT'
  | 'EXTEND_SELECTION_RIGHT'
  | 'EXTEND_TO_EDGE_UP'
  | 'EXTEND_TO_EDGE_DOWN'
  | 'EXTEND_TO_EDGE_LEFT'
  | 'EXTEND_TO_EDGE_RIGHT'
  | 'EXTEND_TO_ROW_START'
  | 'EXTEND_TO_A1'
  | 'EXTEND_TO_LAST_USED_CELL'
  // Selection commands
  | 'SELECT_ALL'
  | 'SELECT_CURRENT_REGION'
  | 'SELECT_ENTIRE_ROW'
  | 'SELECT_ENTIRE_COLUMN'
  | 'SELECT_PRECEDENTS'
  | 'SELECT_DEPENDENTS'
  | 'SELECT_VISIBLE_CELLS'
  | 'TOGGLE_ADD_TO_SELECTION'
  // Special selections (Go To Special)
  | 'SELECT_BLANKS'
  | 'SELECT_CONSTANTS'
  | 'SELECT_FORMULAS'
  | 'SELECT_NUMBERS'
  | 'SELECT_TEXT'
  | 'SELECT_LOGICALS'
  | 'SELECT_ERRORS'
  | 'SELECT_LAST_CELL'
  | 'SELECT_CELLS_WITH_CONDITIONAL_FORMATS'
  | 'SELECT_CELLS_WITH_DATA_VALIDATION'
  | 'SELECT_CELLS_WITH_SAME_VALIDATION'
  | 'SELECT_CELLS_WITH_COMMENTS'
  // Row/Column differences
  | 'SELECT_ROW_DIFFERENCES'
  | 'SELECT_COLUMN_DIFFERENCES'
  // Go To Special remaining options
  | 'SELECT_CURRENT_ARRAY'
  | 'SELECT_OBJECTS'
  // Corner rotation (Excel Parity 2.5)
  | 'ROTATE_SELECTION_CORNER'
  // Selection modes (Excel Parity 2.6 + 02-KEYBOARD-SHORTCUTS P1)
  | 'TOGGLE_EXTEND_SELECTION_MODE'
  | 'ACTIVATE_END_MODE'
  // Table progressive selection (Track 10.3)
  | 'CYCLE_TABLE_COLUMN_SELECTION'
  | 'CYCLE_TABLE_SELECTION'
  // Page-level selection extension (Shift+PageUp/PageDown)
  | 'EXTEND_SELECTION_PAGE_UP'
  | 'EXTEND_SELECTION_PAGE_DOWN'
  // Extend to row end (Shift+End)
  | 'EXTEND_TO_ROW_END'
  // Reduce selection to active cell (Shift+Backspace)
  | 'REDUCE_SELECTION'
  // Selection error display
  | 'SET_SELECTION_ERROR'
  | 'CLEAR_SELECTION_ERROR';

/**
 * Editor actions - cell editing operations.
 * Target: EditorMachine
 */
export type EditorActionType =
  // Editing lifecycle
  | 'EDIT_CELL'
  | 'COMMIT_AND_MOVE_DOWN'
  | 'COMMIT_AND_MOVE_UP'
  | 'COMMIT_AND_MOVE_LEFT'
  | 'COMMIT_AND_MOVE_RIGHT'
  | 'COMMIT_TAB'
  | 'COMMIT_SHIFT_TAB'
  | 'COMMIT_ENTER'
  | 'COMMIT_SHIFT_ENTER'
  | 'CANCEL_EDIT'
  | 'COMMIT_IN_PLACE'
  | 'PICKER_COMMIT'
  | 'DATE_PICKER_COMMIT'
  | 'INSERT_NEWLINE'
  | 'START_FORMULA'
  // Content modification
  | 'CLEAR_CONTENTS'
  | 'CLEAR_AND_EDIT'
  | 'DELETE_TO_END_OF_LINE'
  // Cursor navigation in multi-line cells (Edit Mode)
  | 'CURSOR_UP'
  | 'CURSOR_DOWN'
  // Word deletion (Edit Mode)
  | 'DELETE_WORD_FORWARD'
  | 'DELETE_WORD_BACKWARD'
  // Fill operations
  | 'FILL_DOWN'
  | 'FILL_RIGHT'
  | 'FILL_UP'
  | 'FILL_LEFT'
  | 'FILL_SELECTION'
  // Fill handle double-click (Track 5: Item 5.4)
  | 'DOUBLE_CLICK_FILL_HANDLE'
  // Clear operations
  | 'CLEAR_ALL'
  | 'CLEAR_FORMATS'
  | 'CLEAR_COMMENTS'
  // Sort operations (Stream A1 - Cell Identity Model)
  | 'SORT_ASCENDING'
  | 'SORT_DESCENDING'
  // Sort by color options
  | 'SORT_BY_CELL_COLOR'
  | 'SORT_BY_FONT_COLOR'
  // Special insertions
  | 'INSERT_CURRENT_DATE'
  | 'INSERT_CURRENT_TIME'
  | 'COPY_VALUE_FROM_ABOVE'
  | 'COPY_FORMULA_FROM_ABOVE'
  // Formula-specific
  | 'CYCLE_REFERENCE'
  | 'ENTER_ARRAY_FORMULA'
  | 'INSERT_FUNCTION_ARGS'
  | 'INSERT_FUNCTION' // FormulasRibbon: Insert specific function by name
  | 'PASTE_NAME_IN_FORMULA'
  | 'AUTO_SUM'
  // Insert aggregate function (AVERAGE/COUNT/MAX/MIN) — viewport-scan
  // variant used by the Editing ribbon group's AutoSum dropdown.
  // AUTO_SUM remains a separate action with smarter range detection.
  | 'INSERT_AUTO_FUNCTION'
  // F9 Partial Formula Evaluation
  | 'EVALUATE_FORMULA_SELECTION'
  // Enter Mode / Edit Mode
  | 'TOGGLE_EDIT_MODE'
  | 'FORMULA_SELECT_UP'
  | 'FORMULA_SELECT_DOWN'
  | 'FORMULA_SELECT_LEFT'
  | 'FORMULA_SELECT_RIGHT'
  | 'FORMULA_EXTEND_UP'
  | 'FORMULA_EXTEND_DOWN'
  | 'FORMULA_EXTEND_LEFT'
  | 'FORMULA_EXTEND_RIGHT'
  // T7: Ctrl+Arrow / Ctrl+Shift+Arrow during formula edit (point-mode
  // jump-to-data-edge / extend-to-data-edge — Excel parity).
  | 'FORMULA_MOVE_TO_EDGE_UP'
  | 'FORMULA_MOVE_TO_EDGE_DOWN'
  | 'FORMULA_MOVE_TO_EDGE_LEFT'
  | 'FORMULA_MOVE_TO_EDGE_RIGHT'
  | 'FORMULA_EXTEND_TO_EDGE_UP'
  | 'FORMULA_EXTEND_TO_EDGE_DOWN'
  | 'FORMULA_EXTEND_TO_EDGE_LEFT'
  | 'FORMULA_EXTEND_TO_EDGE_RIGHT'
  // Formula error dialog actions
  | 'EDIT_FORMULA_WITH_ERROR'
  | 'COMMIT_FORMULA_AS_TEXT'
  | 'OPEN_FORMULA_HELP'
  // Data validation dropdown
  | 'OPEN_CELL_PICKER'
  // Range box dragging for formula editing
  | 'UPDATE_FORMULA_RANGE'
  // Hyperlink insertion (Ctrl+K)
  | 'INSERT_HYPERLINK'
  // Cross-sheet formula character forwarding (H2: keyboard coordinator bypass fix)
  | 'INSERT_CHAR';

/**
 * Clipboard actions - copy/cut/paste operations.
 * Target: ClipboardMachine
 * G1/G2: Added CLEAR_CLIPBOARD for ESC key to clear clipboard state
 * G3: Added paste options button actions
 * Track 4: Added paste submenu options (PASTE_VALUES, PASTE_FORMULAS, etc.)
 * Track 3.4: Added paste size mismatch dialog actions
 */
export type ClipboardActionType =
  | 'COPY'
  | 'CUT'
  | 'PASTE'
  | 'CLEAR_CLIPBOARD'
  // G3: Paste Options Button
  | 'SHOW_PASTE_OPTIONS'
  | 'HIDE_PASTE_OPTIONS'
  | 'PASTE_WITH_OPTIONS'
  // Track 4: Context menu paste options
  | 'PASTE_VALUES'
  | 'PASTE_FORMULAS'
  | 'PASTE_FORMATTING'
  | 'PASTE_TRANSPOSE'
  // Paste Link/Picture options
  | 'PASTE_LINK'
  | 'PASTE_AS_PICTURE'
  | 'PASTE_AS_LINKED_PICTURE'
  // Track 3.4: Paste size mismatch warning dialog
  | 'SHOW_PASTE_SIZE_MISMATCH_DIALOG'
  | 'CONFIRM_PASTE_SIZE_MISMATCH'
  | 'CANCEL_PASTE_SIZE_MISMATCH'
  // Cut-paste overwrite confirmation dialog (Excel parity)
  | 'CONFIRM_PASTE_OVERWRITE'
  | 'CANCEL_PASTE_OVERWRITE';

/**
 * Formatting actions - cell formatting operations.
 * Target: Mutations layer (store)
 */
export type FormattingActionType =
  // Font style
  | 'TOGGLE_BOLD'
  | 'TOGGLE_ITALIC'
  | 'TOGGLE_UNDERLINE'
  | 'TOGGLE_STRIKETHROUGH'
  | 'APPLY_FONT_FORMAT'
  // Font size, family, and color (C1/C2/C3/C4)
  | 'SET_FONT_SIZE'
  | 'SET_FONT_FAMILY'
  | 'SET_FONT_COLOR' // Stream C4: Rich text character-level font color
  | 'SET_FONT_THEME' // Theme font reference (major/minor)
  | 'INCREASE_FONT_SIZE'
  | 'DECREASE_FONT_SIZE'
  // Parameterized formatting actions (toolbar unification)
  | 'SET_BACKGROUND_COLOR'
  | 'SET_HORIZONTAL_ALIGN'
  | 'SET_VERTICAL_ALIGN'
  | 'SET_TEXT_ROTATION'
  | 'INCREASE_INDENT'
  | 'DECREASE_INDENT'
  // Alignment
  | 'TOGGLE_WRAP_TEXT'
  | 'APPLY_ALIGNMENT_FORMAT'
  // Fill
  | 'APPLY_FILL_FORMAT'
  // Protection
  | 'APPLY_PROTECTION_FORMAT'
  // Number formats
  | 'SET_NUMBER_FORMAT' // Parameterized: dispatch('SET_NUMBER_FORMAT', { format: '#,##0.00' })
  | 'APPLY_NUMBER_FORMAT'
  | 'FORMAT_GENERAL'
  | 'FORMAT_NUMBER'
  | 'FORMAT_TIME'
  | 'FORMAT_DATE'
  | 'FORMAT_CURRENCY'
  | 'FORMAT_PERCENTAGE'
  | 'FORMAT_SCIENTIFIC'
  | 'FORMAT_COMMA'
  // Text effects (Track 9.11)
  | 'TOGGLE_SUPERSCRIPT'
  | 'TOGGLE_SUBSCRIPT'
  // Decimal adjustments
  | 'INCREASE_DECIMALS'
  | 'DECREASE_DECIMALS'
  // Borders - existing
  | 'APPLY_BORDERS'
  | 'APPLY_OUTLINE_BORDER'
  | 'REMOVE_BORDERS'
  // Borders - additional presets (Track 9.1)
  | 'SET_ALL_BORDERS'
  | 'SET_INSIDE_BORDERS'
  | 'SET_INSIDE_HORIZONTAL_BORDERS'
  | 'SET_INSIDE_VERTICAL_BORDERS'
  // Borders - individual edges (Track 9.1)
  | 'SET_TOP_BORDER'
  | 'SET_BOTTOM_BORDER'
  | 'SET_LEFT_BORDER'
  | 'SET_RIGHT_BORDER'
  | 'SET_DIAGONAL_UP_BORDER'
  | 'SET_DIAGONAL_DOWN_BORDER'
  | 'SET_DIAGONAL_BOTH_BORDER'
  // Borders - compound actions (Track 9.1)
  | 'SET_TOP_AND_BOTTOM_BORDERS'
  | 'SET_TOP_AND_THICK_BOTTOM_BORDERS'
  | 'SET_TOP_AND_DOUBLE_BOTTOM_BORDERS'
  // Clear operations (Track 9.5)
  | 'CLEAR_HYPERLINKS'
  | 'CLEAR_CONDITIONAL_FORMATTING'
  | 'CLEAR_DATA_VALIDATION'
  | 'CLEAR_OUTLINE'
  // Structure
  | 'INSERT_TABLE'
  | 'TOGGLE_MERGE'
  // Merge operations
  | 'MERGE_ACROSS'
  | 'MERGE_AND_CENTER'
  | 'UNMERGE_CELLS'
  // Plain merge (no center) — symmetric with Excel's "Merge Cells" command.
  // Mirrors MERGE_AND_CENTER's data-loss warning flow but does NOT apply
  // center alignment (that's MERGE_AND_CENTER's distinguishing behavior).
  | 'MERGE_CELLS'
  | 'CONFIRM_MERGE_WITH_DATA_LOSS'
  | 'CANCEL_MERGE'
  // Draw Border Tools
  | 'ACTIVATE_DRAW_BORDER'
  | 'ACTIVATE_DRAW_BORDER_GRID'
  | 'ACTIVATE_ERASE_BORDER'
  | 'DEACTIVATE_DRAW_BORDER';

/**
 * Structure actions - insert/delete rows/columns.
 * Target: Mutations layer (store)
 */
export type StructureActionType =
  | 'INSERT_ROW_ABOVE'
  | 'INSERT_ROW_BELOW'
  | 'INSERT_COLUMN_LEFT'
  | 'INSERT_COLUMN_RIGHT'
  | 'DELETE_ROWS'
  | 'DELETE_COLUMNS'
  // Insert/delete cells with shift (not entire rows/columns)
  | 'INSERT_CELLS'
  | 'INSERT_CELLS_SHIFT_DOWN'
  | 'INSERT_CUT_CELLS'
  | 'INSERT_CUT_CELLS_SHIFT_DOWN'
  | 'DELETE_CELLS'
  | 'HIDE_ROW'
  | 'UNHIDE_ROW'
  | 'HIDE_COLUMN'
  | 'UNHIDE_COLUMN'
  // AutoFit (CellsGroup ribbon dropdown)
  | 'AUTO_FIT_ROW_HEIGHT'
  | 'AUTO_FIT_COLUMN_WIDTH'
  // Apply explicit dimensions from Row Height / Column Width dialogs
  | 'APPLY_ROW_HEIGHT'
  | 'APPLY_COLUMN_WIDTH'
  // Page break actions
  | 'INSERT_HORIZONTAL_PAGE_BREAK'
  | 'REMOVE_HORIZONTAL_PAGE_BREAK'
  | 'INSERT_VERTICAL_PAGE_BREAK'
  | 'REMOVE_VERTICAL_PAGE_BREAK'
  | 'UNDO'
  | 'REDO';

/**
 * Navigation actions - pane focus and viewport navigation.
 * Target: PaneFocusMachine and SelectionMachine
 * Track 4: Added OPEN_HYPERLINK for context menu
 * Track 7.1: Added TOGGLE_END_MODE for End Mode navigation
 */
export type NavigationActionType =
  | 'FOCUS_NEXT_PANE'
  | 'FOCUS_PREVIOUS_PANE'
  | 'SCROLL_TO_ACTIVE_CELL'
  | 'OPEN_HYPERLINK'
  // Track 7.1: End Mode Navigation
  | 'TOGGLE_END_MODE'
  // Search box (Ctrl+F fallback)
  | 'OPEN_SEARCH_BOX';

/**
 * UI actions - dialogs and view controls.
 * Target: UI layer callbacks
 */
export type UIActionType =
  // Error and array formula context menu actions
  | 'TRACE_ERROR'
  | 'IGNORE_ERROR'
  | 'SELECT_ARRAY'
  // Dialogs
  | 'OPEN_GO_TO_DIALOG'
  | 'CLOSE_GO_TO_DIALOG'
  | 'NAVIGATE_TO_REFERENCE'
  | 'OPEN_GO_TO_SPECIAL_DIALOG'
  | 'OPEN_FORMAT_CELLS_DIALOG'
  | 'CLOSE_FORMAT_CELLS_DIALOG'
  | 'OPEN_INSERT_CELLS_DIALOG'
  | 'OPEN_DELETE_CELLS_DIALOG'
  | 'OPEN_INSERT_FUNCTION_DIALOG'
  | 'CLOSE_INSERT_FUNCTION_DIALOG'
  | 'OPEN_FUNCTION_ARGUMENTS_DIALOG'
  | 'CLOSE_FUNCTION_ARGUMENTS_DIALOG'
  | 'OPEN_NAME_MANAGER'
  // Define Name dialog
  | 'OPEN_DEFINE_NAME_DIALOG'
  | 'OPEN_FIND_DIALOG'
  | 'OPEN_FIND_REPLACE_DIALOG'
  | 'OPEN_PASTE_SPECIAL_DIALOG'
  | 'OPEN_DROPDOWN'
  | 'OPEN_CUSTOM_SORT_DIALOG'
  | 'INVOKE_CONTEXT_MENU'
  // Row/column resize dialogs
  | 'OPEN_ROW_HEIGHT_DIALOG'
  | 'CLOSE_ROW_HEIGHT_DIALOG'
  | 'OPEN_COLUMN_WIDTH_DIALOG'
  | 'CLOSE_COLUMN_WIDTH_DIALOG'
  // Hyperlink dialog and actions
  | 'OPEN_HYPERLINK_DIALOG'
  | 'REMOVE_HYPERLINK'
  // Fill Series Dialog (Excel parity quickwin A9)
  | 'OPEN_FILL_SERIES_DIALOG'
  | 'CLOSE_FILL_SERIES_DIALOG'
  | 'EXECUTE_FILL_SERIES'
  // Page Setup Dialog (Excel parity quickwin A10)
  | 'OPEN_PAGE_SETUP_DIALOG'
  | 'CLOSE_PAGE_SETUP_DIALOG'
  | 'APPLY_PAGE_SETUP'
  // Page Layout ribbon quick actions
  | 'SET_PAGE_ORIENTATION'
  | 'SET_PAPER_SIZE'
  | 'SET_PAGE_MARGINS'
  | 'SET_PAGE_SCALE'
  // View-side sheet options
  // Distinct from chart-axis TOGGLE_GRIDLINES; these toggle the worksheet
  // view options (workbook-side gridlines/headings rendering).
  | 'TOGGLE_VIEW_GRIDLINES'
  | 'TOGGLE_VIEW_HEADINGS'
  // Backstage (Excel parity quickwin A1)
  | 'OPEN_BACKSTAGE'
  | 'CLOSE_BACKSTAGE'
  | 'SET_BACKSTAGE_PANEL'
  // View toggles
  | 'TOGGLE_FORMULA_VIEW'
  | 'TOGGLE_SHOW_FORMULAS' // FormulasRibbon: Toggle formula display mode (Ctrl+`)
  | 'TOGGLE_FORMULA_BAR_EXPAND'
  | 'TOGGLE_AUTO_FILTER'
  | 'TOGGLE_RIBBON'
  // Ribbon display modes
  | 'SET_RIBBON_DISPLAY_MODE'
  | 'TOGGLE_RIBBON_TABS_MODE'
  | 'SHOW_RIBBON_TEMPORARILY'
  | 'HIDE_RIBBON_TEMPORARILY'
  // KeyTip activation (F10 menu activation)
  | 'ACTIVATE_RIBBON_KEYTIPS'
  | 'DEACTIVATE_RIBBON_KEYTIPS'
  // Unified keytip router T4: ribbon tab switch via typed `actionArg: { tabId }`
  | 'SWITCH_RIBBON_TAB'
  // Unified keytip router T4: ribbon picker open actions (back uiStore slices)
  | 'OPEN_BORDERS_PICKER'
  | 'CLOSE_BORDERS_PICKER'
  | 'OPEN_FILL_COLOR_PICKER'
  | 'CLOSE_FILL_COLOR_PICKER'
  | 'OPEN_FONT_COLOR_PICKER'
  | 'CLOSE_FONT_COLOR_PICKER'
  | 'OPEN_FONT_FAMILY_PICKER'
  | 'CLOSE_FONT_FAMILY_PICKER'
  | 'OPEN_NUMBER_FORMAT_DROPDOWN'
  | 'CLOSE_NUMBER_FORMAT_DROPDOWN'
  // Focus-only command (no slice — actor-access focus seam)
  | 'FOCUS_FONT_SIZE_INPUT'
  // Zoom (G5: Zoom Slider)
  | 'ZOOM_IN'
  | 'ZOOM_OUT'
  | 'SET_ZOOM'
  | 'FULL_SCREEN'
  // Page Break Preview
  | 'TOGGLE_PAGE_BREAK_PREVIEW'
  // File operations
  | 'SAVE'
  | 'OPEN'
  | 'NEW_WORKBOOK'
  | 'CLOSE_WORKBOOK'
  | 'PRINT'
  // Find operations
  | 'FIND_NEXT'
  | 'FIND_PREVIOUS'
  // Calculate
  | 'CALCULATE_ALL'
  | 'CALCULATE_ALL_FORCE'
  | 'CALCULATE_REBUILD_DEPENDENCIES'
  | 'CALCULATE_SHEET'
  | 'SET_CALCULATION_MODE' // FormulasRibbon: Set auto/manual calculation mode
  | 'CREATE_NAMES_FROM_SELECTION'
  | 'CREATE_NAMES_EXECUTE' // Execute create names from selection
  // Data refresh
  | 'REFRESH_ALL_DATA'
  | 'REFRESH_CONNECTION'
  // Formula Auditing (Stream B2)
  | 'TRACE_PRECEDENTS'
  | 'TRACE_DEPENDENTS'
  | 'REMOVE_TRACE_ARROWS'
  | 'REMOVE_PRECEDENT_ARROWS'
  | 'REMOVE_DEPENDENT_ARROWS'
  // Validation UI (F1: Circle Invalid Data)
  | 'SHOW_VALIDATION_CIRCLES'
  | 'HIDE_VALIDATION_CIRCLES'
  | 'TOGGLE_VALIDATION_CIRCLES'
  // Sparkline Dialog (Insert → Sparklines menu)
  | 'OPEN_SPARKLINE_DIALOG'
  // Data Validation Dialog (Track 11.5)
  | 'OPEN_DV_DIALOG'
  | 'CLOSE_DV_DIALOG'
  // Pivot table dialog
  | 'OPEN_PIVOT_DIALOG'
  // Data Tab Dialogs (Architecture Alignment)
  | 'OPEN_SUBTOTAL_DIALOG'
  | 'OPEN_SCHEMA_BROWSER'
  | 'OPEN_WORKBOOK_LINKS_PANEL'
  | 'OPEN_REMOVE_DUPLICATES_DIALOG'
  | 'OPEN_TEXT_TO_COLUMNS_DIALOG'
  // Settings Dialogs (Architecture Alignment)
  | 'OPEN_SPREAD_SETTINGS_DIALOG'
  | 'OPEN_SHEET_SETTINGS_DIALOG'
  // Conditional Formatting Quick Rule Dialog (Architecture Alignment)
  | 'OPEN_QUICK_RULE_DIALOG'
  // Preferences (D5: Recent Colors)
  | 'TRACK_RECENT_COLOR'
  // More Colors Dialog (Track 14.5)
  | 'OPEN_MORE_COLORS_DIALOG'
  | 'CLOSE_MORE_COLORS_DIALOG'
  | 'APPLY_MORE_COLORS_FILL'
  | 'APPLY_MORE_COLORS_FONT'
  | 'APPLY_MORE_COLORS_BORDER'
  // Range selection mode
  | 'START_RANGE_SELECTION_MODE'
  | 'UPDATE_RANGE_SELECTION'
  | 'COMPLETE_RANGE_SELECTION'
  | 'CANCEL_RANGE_SELECTION'
  // Help
  | 'OPEN_HELP'
  // Keyboard Shortcuts
  | 'OPEN_KEYBOARD_SHORTCUTS_DIALOG'
  | 'CLOSE_KEYBOARD_SHORTCUTS_DIALOG'
  // Accessibility screen-reader support
  | 'READ_ACTIVE_CELL'
  | 'OPEN_ACCESSIBILITY_GUIDE'
  | 'ANNOUNCE_CELL_FORMAT'
  // Quick Analysis menu
  | 'OPEN_QUICK_ANALYSIS'
  // Proofing group
  | 'OPEN_THESAURUS_DIALOG'
  | 'CLOSE_THESAURUS_DIALOG'
  | 'THESAURUS_INSERT_WORD'
  | 'SHOW_WORKBOOK_STATISTICS'
  | 'CHECK_ACCESSIBILITY'
  | 'CLOSE_ACCESSIBILITY_PANEL'
  | 'NAVIGATE_TO_ACCESSIBILITY_ISSUE'
  // Macro recording
  | 'TOGGLE_MACRO_RECORDING'
  | 'STOP_MACRO_RECORDING'
  // Export File (Ctrl+Shift+S)
  | 'EXPORT_FILE'
  // File menu (Backstage) leaves — issue #115
  | 'EXPORT_AS_XLSX'
  | 'EXPORT_AS_CSV'
  | 'EXPORT_AS_PDF'
  | 'BROWSE_FILES'
  | 'OPEN_RECENT_FILE'
  | 'SHARE_DOCUMENT'
  | 'CLOSE_FILE'
  // Command Palette (Ctrl+Shift+P)
  | 'OPEN_COMMAND_PALETTE'
  // Zoom Reset (Ctrl+0)
  | 'ZOOM_RESET'
  // Scroll Lock toggle (ScrollLock / Ctrl+Alt+L)
  | 'TOGGLE_SCROLL_LOCK'
  // Extension Panel toggle (Ctrl+Shift+E)
  | 'TOGGLE_EXTENSION_PANEL'
  // NL Formula Bar toggle (Ctrl+Shift+I)
  | 'TOGGLE_NL_BAR'
  // Threaded comments panel
  | 'OPEN_THREADED_COMMENTS'
  // Font dialog (Ctrl+Shift+F)
  | 'OPEN_FONT_DIALOG'
  // Print preview
  | 'OPEN_PRINT_PREVIEW'
  | 'OPEN_PRINT_PDF_DIALOG'
  | 'CLOSE_PRINT_PDF_DIALOG'
  // Outline/Objects visibility toggles
  | 'TOGGLE_OUTLINE_SYMBOLS'
  | 'TOGGLE_OBJECTS_VISIBILITY'
  // T4b unified keytip router: ribbon dropdown openers (back uiStore slice).
  // Each `dropdownId` corresponds to a named popover/menu owned by a ribbon
  // group/tab; the consuming component reads its open-state from the
  // `ribbonDropdowns` slice and renders the dropdown as a controlled component.
  | 'OPEN_RIBBON_DROPDOWN'
  | 'CLOSE_RIBBON_DROPDOWN'
  // T4b unified keytip router: AutoSum quick-trigger (Alt+M,A on Formulas tab)
  | 'TRIGGER_AUTOSUM'
  | 'TOGGLE_SHEET_PROTECTION';

/**
 * Workbook actions - sheet navigation and management.
 * Target: Workbook callbacks
 */
export type WorkbookActionType =
  | 'PREVIOUS_SHEET'
  | 'NEXT_SHEET'
  | 'INSERT_SHEET'
  | 'DELETE_SHEET'
  // Delete-sheet confirmation dialog (shown when sheet has data)
  | 'OPEN_DELETE_SHEET_CONFIRM_DIALOG'
  | 'CLOSE_DELETE_SHEET_CONFIRM_DIALOG'
  | 'CONFIRM_DELETE_SHEET'
  | 'MOVE_SHEET'
  | 'COPY_SHEET_TO_POSITION'
  // Protection dialog actions
  | 'OPEN_PROTECT_SHEET_DIALOG'
  | 'CLOSE_PROTECT_SHEET_DIALOG'
  | 'OPEN_UNPROTECT_SHEET_DIALOG'
  | 'CLOSE_UNPROTECT_SHEET_DIALOG'
  | 'PROTECT_SHEET'
  | 'UNPROTECT_SHEET'
  | 'OPEN_PROTECT_WORKBOOK_DIALOG'
  | 'CLOSE_PROTECT_WORKBOOK_DIALOG'
  | 'PROTECT_WORKBOOK'
  | 'UNPROTECT_WORKBOOK'
  | 'SELECT_ALL_SHEETS'
  | 'GROUP'
  | 'UNGROUP'
  | 'SHOW_DETAIL'
  | 'HIDE_DETAIL'
  // Save As (Ctrl+Shift+S / F12)
  | 'SAVE_AS';

/**
 * Object actions - floating object operations.
 * Target: ObjectInteractionMachine
 */
export type ObjectActionType =
  | 'DELETE_OBJECT'
  | 'DESELECT_OBJECT'
  | 'NUDGE_OBJECT_UP'
  | 'NUDGE_OBJECT_DOWN'
  | 'NUDGE_OBJECT_LEFT'
  | 'NUDGE_OBJECT_RIGHT'
  | 'NUDGE_OBJECT_UP_FINE'
  | 'NUDGE_OBJECT_DOWN_FINE'
  | 'NUDGE_OBJECT_LEFT_FINE'
  | 'NUDGE_OBJECT_RIGHT_FINE'
  | 'DUPLICATE_OBJECT'
  // Picture dialog actions (Excel parity quickwin B2)
  | 'OPEN_FORMAT_PICTURE_DIALOG'
  | 'CLOSE_FORMAT_PICTURE_DIALOG'
  | 'OPEN_EDIT_ALT_TEXT_DIALOG'
  | 'CLOSE_EDIT_ALT_TEXT_DIALOG'
  | 'SAVE_PICTURE_AS_FILE'
  | 'INSERT_PICTURE'
  | 'UPDATE_PICTURE'
  | 'INSERT_ICON'
  | 'INSERT_3D_MODEL'
  // Change/reset picture
  | 'CHANGE_PICTURE'
  | 'RESET_PICTURE'
  // Shape-specific actions
  | 'INSERT_SHAPE'
  | 'START_SHAPE_INSERT'
  | 'INSERT_TEXTBOX'
  | 'INSERT_FORM_CONTROL_CHECKBOX'
  | 'INSERT_FORM_CONTROL_COMBOBOX'
  | 'FLIP_SHAPE_HORIZONTAL'
  | 'FLIP_SHAPE_VERTICAL'
  | 'SET_SHAPE_FILL'
  | 'SET_SHAPE_OUTLINE'
  | 'SET_SHAPE_TEXT'
  | 'SET_SHAPE_SHADOW'
  | 'COPY_SHAPE'
  | 'CUT_SHAPE'
  | 'PASTE_SHAPE'
  // Arrange group actions
  | 'BRING_OBJECT_TO_FRONT'
  | 'BRING_OBJECT_FORWARD'
  | 'SEND_OBJECT_TO_BACK'
  | 'SEND_OBJECT_BACKWARD'
  | 'ALIGN_OBJECTS_LEFT'
  | 'ALIGN_OBJECTS_CENTER'
  | 'ALIGN_OBJECTS_RIGHT'
  | 'ALIGN_OBJECTS_TOP'
  | 'ALIGN_OBJECTS_MIDDLE'
  | 'ALIGN_OBJECTS_BOTTOM'
  | 'GROUP_OBJECTS'
  | 'UNGROUP_OBJECTS'
  | 'ROTATE_OBJECT_RIGHT_90'
  | 'ROTATE_OBJECT_LEFT_90'
  | 'FLIP_OBJECT_VERTICAL'
  | 'FLIP_OBJECT_HORIZONTAL';

/**
 * Comment actions - comment operations.
 * Target: Comment machine + Comments domain module
 */
export type CommentActionType =
  | 'INSERT_COMMENT'
  | 'EDIT_COMMENT'
  | 'DELETE_COMMENT'
  | 'SHOW_HIDE_COMMENTS'
  | 'NEXT_COMMENT'
  | 'PREVIOUS_COMMENT'
  | 'TOGGLE_SHOW_ALL_COMMENTS'; // Show All Comments toggle in Review tab

/**
 * Format Painter actions - copy and apply formatting.
 * Target: UIStore (format painter slice) + Mutations
 *
 * Excel Parity Quickwin D1: Format Painter
 */
export type FormatPainterActionType =
  | 'START_FORMAT_PAINTER'
  | 'STOP_FORMAT_PAINTER'
  | 'LOCK_FORMAT_PAINTER'
  | 'APPLY_FORMAT_PAINTER'
  // Ribbon-tier toggle/double-click variants. These
  // handlers internally read selection + validation schemas and dispatch
  // the lower-level START/STOP/LOCK actions. Removes the ribbon-side hook
  // wrapper that previously orchestrated the same flow.
  | 'TOGGLE_FORMAT_PAINTER'
  | 'TOGGLE_FORMAT_PAINTER_LOCKED';

/**
 * Filter actions - filter dropdown operations.
 * Target: Filters domain + UIStore
 *
 * Excel Parity Quickwin B4: Filter Dropdown Panel
 * Track 4: Added context menu filter actions
 *
 * Uses Draft + Apply pattern:
 * 1. Store pending config in UIStore (setPendingFilterConfig, etc.)
 * 2. Dispatch action to apply (reads from UIStore)
 */
export type FilterActionType =
  | 'APPLY_NUMBER_FILTER'
  | 'APPLY_TEXT_FILTER'
  | 'APPLY_COLOR_FILTER'
  | 'APPLY_TOP10_FILTER'
  | 'OPEN_TOP10_DIALOG'
  | 'CLOSE_TOP10_DIALOG'
  | 'CLEAR_COLUMN_FILTER'
  // Track 4: Context menu filter actions
  | 'FILTER_BY_SELECTED_VALUE'
  | 'FILTER_BY_COLOR'
  | 'FILTER_BY_FONT_COLOR' // Filter by font color
  | 'CLEAR_FILTER'
  // Track 14.3: Custom AutoFilter Dialog
  | 'OPEN_CUSTOM_AUTOFILTER_DIALOG'
  | 'CLOSE_CUSTOM_AUTOFILTER_DIALOG'
  | 'APPLY_CUSTOM_AUTOFILTER'
  // Advanced Filter dialog
  | 'OPEN_ADVANCED_FILTER_DIALOG'
  | 'CLOSE_ADVANCED_FILTER_DIALOG'
  | 'APPLY_ADVANCED_FILTER'
  // Sort & Filter group actions
  | 'CLEAR_ALL_FILTERS' // Clear filters on all columns in sheet
  | 'REAPPLY_FILTERS'; // Re-run current filters after data change

/**
 * AutoFill actions - autofill options button operations.
 * Target: UIStore (autofill options slice) + FillCoordinator
 *
 * Excel Parity Track 5.5: AutoFill Options Button
 */
export type AutoFillActionType =
  | 'SHOW_AUTOFILL_OPTIONS'
  | 'HIDE_AUTOFILL_OPTIONS'
  | 'APPLY_AUTOFILL_OPTION';

/**
 * Fill Context Menu actions - right-click drag fill handle operations.
 * Target: UIStore (fill context menu slice) + FillCoordinator
 *
 * Track 5.6: Right-Click Drag Fill Context Menu
 */
export type FillContextMenuActionType =
  | 'SHOW_FILL_CONTEXT_MENU'
  | 'HIDE_FILL_CONTEXT_MENU'
  | 'EXECUTE_FILL_COPY_CELLS'
  | 'EXECUTE_FILL_SERIES_CONTEXT_MENU' // Note: Different from dialog's EXECUTE_FILL_SERIES
  | 'EXECUTE_FILL_FORMATTING_ONLY'
  | 'EXECUTE_FILL_WITHOUT_FORMATTING'
  | 'EXECUTE_FILL_DAYS'
  | 'EXECUTE_FILL_WEEKDAYS'
  | 'EXECUTE_FILL_MONTHS'
  | 'EXECUTE_FILL_YEARS'
  | 'EXECUTE_FILL_LINEAR_TREND'
  | 'EXECUTE_FILL_GROWTH_TREND';

/**
 * Flash Fill actions - pattern recognition and application.
 * Target: UIStore (flash fill slice) + FlashFillCoordinator
 *
 * Flash Fill (Ctrl+E)
 */
export type FlashFillActionType =
  | 'FLASH_FILL' // Trigger Flash Fill analysis and application (Ctrl+E)
  | 'SHOW_FLASH_FILL_PREVIEW' // Display ghosted preview of detected pattern
  | 'ACCEPT_FLASH_FILL' // Accept and apply the Flash Fill preview
  | 'REJECT_FLASH_FILL'; // Dismiss the Flash Fill preview

/**
 * Custom Lists actions - user-defined fill lists management.
 * Target: UIStore (custom lists dialog slice) + Workbook domain (Yjs storage)
 *
 * Custom Lists
 */
export type CustomListsActionType =
  | 'OPEN_CUSTOM_LISTS_DIALOG' // Opens the custom lists management dialog
  | 'CLOSE_CUSTOM_LISTS_DIALOG' // Closes the custom lists dialog
  | 'ADD_CUSTOM_LIST' // Adds a new user-defined custom list
  | 'EDIT_CUSTOM_LIST' // Edits an existing custom list
  | 'DELETE_CUSTOM_LIST'; // Deletes a user-defined custom list

/**
 * Repeat Action types - F4 repeat last action feature.
 * Target: UIStore (repeat action slice) + Dispatcher tracking
 *
 * Track 7.4: F4 Repeat Last Action
 */
export type RepeatActionType = 'REPEAT_LAST_ACTION';

/**
 * Drag-Drop actions - cell drag-drop overwrite warning dialog operations.
 * Target: UIStore (drag-drop-overwrite-dialog slice) + DragDropCoordinator
 *
 * Overwrite warning on drag-drop
 */
export type DragDropActionType =
  | 'SHOW_DRAG_DROP_OVERWRITE_DIALOG' // Opens dialog with pending drop info
  | 'CONFIRM_DRAG_DROP_OVERWRITE' // User confirms overwrite, execute pending drop
  | 'CANCEL_DRAG_DROP_OVERWRITE'; // User cancels, clear pending drop info

/**
 * Paste Validation actions - paste validation summary dialog operations.
 * Target: UIStore (paste-validation slice) + ClipboardCoordinator
 *
 * Batch paste validation UI
 */
export type PasteValidationActionType =
  | 'SHOW_PASTE_VALIDATION_SUMMARY' // Show dialog summarizing validation results after paste
  | 'CLOSE_PASTE_VALIDATION_SUMMARY' // Close the paste validation summary dialog
  | 'CONFIRM_PASTE_WITH_INVALID' // User confirms keeping invalid pasted values
  | 'REVERT_INVALID_PASTE' // User reverts paste that contained invalid values
  | 'HIGHLIGHT_INVALID_CELLS'; // Highlight cells that failed validation after paste

/**
 * Conditional Formatting actions - CF rule management.
 * Target: CondFormatCache + Mutations layer + UIStore (CF dialog slices)
 *
 * Track 12: Conditional Formatting Architecture Alignment
 */
export type ConditionalFormattingActionType =
  // Rule CRUD operations
  | 'CREATE_CF_RULE'
  | 'UPDATE_CF_RULE'
  | 'DELETE_CF_RULE'
  | 'REORDER_CF_RULES'
  // Dialog actions
  | 'OPEN_CF_RULES_MANAGER'
  | 'CLOSE_CF_RULES_MANAGER'
  | 'OPEN_CF_DIALOG'
  | 'CLOSE_CF_DIALOG'
  // CF menu action (for keyboard shortcut)
  | 'OPEN_CF_MENU';

/**
 * Table Total Row actions - total row function dropdown operations.
 * Target: UIStore (total row dropdown slice) + Tables domain
 *
 * Track 10.9: Total Row Function Dropdown
 */
export type TotalRowActionType =
  | 'OPEN_TOTAL_ROW_DROPDOWN'
  | 'CLOSE_TOTAL_ROW_DROPDOWN'
  | 'SET_TOTAL_ROW_FUNCTION';

/**
 * Table actions - table operations and dialogs.
 * Target: Tables domain + UIStore + Mutations layer
 *
 * Tables Excel compatibility
 */
export type TableActionType =
  // Table operations
  | 'REMOVE_DUPLICATES'
  | 'CONVERT_TO_RANGE'
  | 'TOGGLE_FILTER_BUTTONS'
  | 'INSERT_TABLE_ROW_ABOVE'
  | 'INSERT_TABLE_ROW_BELOW'
  | 'INSERT_TABLE_COLUMN_LEFT'
  | 'INSERT_TABLE_COLUMN_RIGHT'
  // Table row/column deletion
  | 'DELETE_TABLE_ROWS'
  | 'DELETE_TABLE_COLUMNS'
  // Custom table style operations
  | 'CREATE_CUSTOM_TABLE_STYLE'
  | 'MODIFY_TABLE_STYLE'
  | 'DUPLICATE_TABLE_STYLE'
  | 'DELETE_CUSTOM_TABLE_STYLE'
  | 'RESIZE_TABLE'
  // Dialog actions (CRITICAL: use dispatch pattern)
  | 'CLOSE_REMOVE_DUPLICATES_DIALOG'
  | 'OPEN_CUSTOM_TABLE_STYLE_DIALOG'
  | 'CLOSE_CUSTOM_TABLE_STYLE_DIALOG'
  | 'OPEN_RESIZE_TABLE_DIALOG'
  | 'CLOSE_RESIZE_TABLE_DIALOG'
  | 'OPEN_CONVERT_TO_RANGE_DIALOG'
  | 'CLOSE_CONVERT_TO_RANGE_DIALOG'
  // Table click selection
  | 'SELECT_TABLE_COLUMN'
  | 'SELECT_TABLE_ROW'
  | 'SELECT_TABLE_DATA'
  | 'SELECT_FULL_TABLE'
  // AutoCorrect options
  | 'TOGGLE_AUTO_CALCULATED_COLUMNS'
  | 'OVERWRITE_CALCULATED_COLUMN'
  | 'TOGGLE_TABLE_AUTO_EXPAND'
  // Table toggle/delete operations (keytip-routed)
  | 'DELETE_TABLE'
  | 'TOGGLE_TABLE_HEADER_ROW'
  | 'TOGGLE_TABLE_TOTALS_ROW'
  | 'TOGGLE_TABLE_BANDED_ROWS';

/**
 * Print/Export actions - print preview, page breaks, PDF export.
 * Target: UIStore (print slices) + Sheets domain (print settings)
 *
 * Printing/export Excel compatibility
 */
export type PrintExportActionType =
  // PDF Export
  | 'EXPORT_PDF'
  // Page Break Preview Mode
  | 'TOGGLE_PAGE_BREAK_PREVIEW'
  // Print Area Management
  | 'SET_PRINT_AREA'
  | 'CLEAR_PRINT_AREA'
  | 'ADD_TO_PRINT_AREA'
  // Page Break Management
  | 'RESET_PAGE_BREAKS'
  // Print-side sheet options
  // Toggle whether gridlines / row+col headings are included in printed output.
  | 'TOGGLE_PRINT_GRIDLINES'
  | 'TOGGLE_PRINT_HEADINGS'
  // Backstage Print View
  | 'SET_PRINT_SCOPE' // { scope: 'active_sheet' | 'workbook' | 'selection' }
  | 'SET_PRINT_PAGE_RANGE' // { from?: number, to?: number }
  // Quick Print
  | 'QUICK_PRINT'; // Uses current settings, default printer

/**
 * Chart actions - chart-specific operations.
 * Target: ChartMachine + Charts domain module + UIStore (chart slices)
 *
 * Track 13: Charts - Z-Order, Copy/Paste, Multi-Select
 * Keyboard shortcuts and clipboard integration
 */
export type ChartActionType =
  // Selection/Focus (13.9: Multi-Select)
  | 'SELECT_CHART'
  | 'DESELECT_CHART'
  | 'DESELECT_ALL_CHARTS'
  | 'ADD_CHART_TO_SELECTION'
  | 'TOGGLE_CHART_SELECTION'
  // Z-Order (13.3: Z-Order Commands)
  | 'BRING_CHART_TO_FRONT'
  | 'SEND_CHART_TO_BACK'
  | 'BRING_CHART_FORWARD'
  | 'SEND_CHART_BACKWARD'
  // Clipboard (13.4: Chart Copy/Paste)
  | 'COPY_CHART'
  | 'CUT_CHART'
  | 'PASTE_CHART'
  // Navigation (Keyboard shortcuts)
  | 'CYCLE_NEXT_CHART'
  | 'CYCLE_PREVIOUS_CHART'
  // Chart Creation (F11/Alt+F1)
  | 'CREATE_CHART_SHEET'
  | 'CREATE_EMBEDDED_CHART'
  // Editing
  | 'EDIT_CHART'
  | 'EDIT_CHART_TITLE'
  | 'CHANGE_CHART_TYPE'
  | 'DUPLICATE_CHART'
  | 'SAVE_CHART_AS_IMAGE'
  | 'DELETE_CHART'
  // Select Data dialog
  | 'OPEN_SELECT_DATA_DIALOG'
  | 'CLOSE_SELECT_DATA_DIALOG'
  | 'APPLY_SELECT_DATA'
  // Insert Chart Wizard dialog
  | 'OPEN_INSERT_CHART_WIZARD_DIALOG'
  | 'CLOSE_INSERT_CHART_WIZARD_DIALOG'
  | 'INSERT_CHART_FROM_WIZARD'
  // Nudge chart position (arrow keys)
  | 'NUDGE_CHART_UP'
  | 'NUDGE_CHART_DOWN'
  | 'NUDGE_CHART_LEFT'
  | 'NUDGE_CHART_RIGHT'
  // Chart context menu enhancements
  | 'RESET_CHART_STYLE'
  | 'OPEN_MOVE_CHART_DIALOG'
  | 'OPEN_FORMAT_CHART_AREA'
  // Element-specific chart context menu
  | 'OPEN_FORMAT_PLOT_AREA'
  | 'OPEN_FORMAT_DATA_SERIES'
  | 'ADD_DATA_LABELS'
  | 'ADD_TRENDLINE'
  | 'OPEN_FORMAT_AXIS'
  | 'TOGGLE_GRIDLINES'
  | 'OPEN_FORMAT_LEGEND'
  | 'OPEN_FORMAT_CHART_TITLE'
  // Chart UI Slice Actions
  | 'SHOW_CHART_TOOLTIP'
  | 'HIDE_CHART_TOOLTIP'
  | 'SET_CHART_ERROR'
  | 'CLEAR_CHART_ERROR'
  | 'CLEAR_ALL_CHART_ERRORS'
  | 'SET_CHART_EDITOR_TAB'
  // Chart Canvas Rendering - Title Editor
  | 'OPEN_CHART_TITLE_EDITOR'
  | 'CLOSE_CHART_TITLE_EDITOR';

/**
 * Data Analysis Dialog actions - Goal Seek, Consolidate, Error Checking, etc.
 * Target: UIStore (dialog slices) + Analysis operations
 *
 * Data analysis dialogs
 */
export type DataAnalysisDialogActionType =
  // Goal Seek Dialog
  | 'OPEN_GOAL_SEEK_DIALOG'
  | 'CLOSE_GOAL_SEEK_DIALOG'
  | 'EXECUTE_GOAL_SEEK'
  | 'APPLY_GOAL_SEEK_RESULT'
  | 'CANCEL_GOAL_SEEK'
  | 'OPEN_FORECAST_SHEET_DIALOG'
  // Consolidate Dialog
  | 'OPEN_CONSOLIDATE_DIALOG'
  | 'CLOSE_CONSOLIDATE_DIALOG'
  | 'EXECUTE_CONSOLIDATE'
  // Spelling Dialog
  | 'OPEN_SPELLING_DIALOG'
  | 'CLOSE_SPELLING_DIALOG'
  | 'SPELL_CHECK_NEXT'
  | 'SPELL_CHECK_CHANGE'
  | 'SPELL_CHECK_CHANGE_ALL'
  | 'SPELL_CHECK_IGNORE'
  | 'SPELL_CHECK_IGNORE_ALL'
  | 'SPELL_CHECK_ADD_TO_DICTIONARY'
  // Watch Window
  | 'OPEN_WATCH_WINDOW'
  | 'CLOSE_WATCH_WINDOW'
  | 'TOGGLE_WATCH_WINDOW'
  | 'ADD_WATCH'
  | 'DELETE_WATCH'
  | 'DELETE_ALL_WATCHES'
  // Error Checking Dialog
  | 'OPEN_ERROR_CHECKING_DIALOG'
  | 'CLOSE_ERROR_CHECKING_DIALOG'
  | 'ERROR_CHECK_NEXT'
  | 'ERROR_CHECK_PREVIOUS'
  | 'ERROR_CHECK_IGNORE'
  | 'ERROR_CHECK_EDIT_IN_FORMULA_BAR'
  // Evaluate Formula Dialog
  | 'OPEN_EVALUATE_FORMULA_DIALOG'
  | 'CLOSE_EVALUATE_FORMULA_DIALOG'
  | 'EVALUATE_NEXT_STEP'
  | 'EVALUATE_STEP_IN'
  | 'EVALUATE_STEP_OUT'
  | 'EVALUATE_RESTART'
  // Data Table Dialog
  | 'OPEN_DATA_TABLE_DIALOG'
  | 'CLOSE_DATA_TABLE_DIALOG'
  | 'EXECUTE_DATA_TABLE'
  | 'CANCEL_DATA_TABLE'
  // Scenario Manager Dialog (What-If Analysis)
  | 'OPEN_SCENARIO_MANAGER_DIALOG'
  | 'CLOSE_SCENARIO_MANAGER_DIALOG'
  | 'CREATE_SCENARIO'
  | 'UPDATE_SCENARIO'
  | 'DELETE_SCENARIO'
  | 'APPLY_SCENARIO'
  | 'RESTORE_ORIGINAL_VALUES';

/**
 * Ink actions - ink/drawing operations.
 * Target: Drawing Manager + UIStore (ink slice)
 *
 * Wave 5: Ink Actions & UI System
 */
export type InkActionType =
  // Mode activation
  | 'ACTIVATE_INK_MODE'
  | 'DEACTIVATE_INK_MODE'
  | 'TOGGLE_INK_TOOL'
  | 'TOGGLE_INK_MODE_DEFAULT'
  // Tool settings
  | 'SET_INK_TOOL'
  | 'SET_INK_COLOR'
  | 'SET_INK_WIDTH'
  | 'SET_INK_OPACITY'
  // Drawing operations
  | 'CLEAR_DRAWING'
  | 'DELETE_SELECTED_STROKES'
  | 'SELECT_ALL_STROKES'
  | 'INSERT_DRAWING'
  // Selection
  | 'TOGGLE_LASSO_SELECTION'
  // Transform operations
  | 'MOVE_SELECTED_STROKES'
  | 'TRANSFORM_SELECTED_STROKES'
  // Recognition
  | 'RECOGNIZE_INK_AS_SHAPE'
  | 'RECOGNIZE_INK_AS_TEXT';

/**
 * Slicer actions - slicer control operations.
 * Target: Slicers domain + UIStore
 *
 * Slicer context menu
 * Tables Excel compatibility - Item 20: Slicer Connections Dialog
 */
export type SlicerActionType =
  // Insert (from Insert ribbon)
  | 'OPEN_INSERT_SLICER_DIALOG'
  // Clipboard
  | 'CUT_SLICER'
  | 'COPY_SLICER'
  | 'PASTE_SLICER'
  // Settings/Properties
  | 'OPEN_SLICER_SETTINGS'
  | 'CLOSE_SLICER_SETTINGS'
  | 'OPEN_SLICER_REPORT_CONNECTIONS'
  | 'CLOSE_SLICER_REPORT_CONNECTIONS'
  | 'OPEN_SLICER_SIZE_PROPERTIES'
  | 'CLOSE_SLICER_SIZE_PROPERTIES'
  // Slicer connections dialog
  | 'OPEN_SLICER_CONNECTIONS'
  | 'UPDATE_SLICER_CONNECTIONS'
  | 'CLOSE_SLICER_CONNECTIONS_DIALOG'
  // Z-Order
  | 'BRING_SLICER_TO_FRONT'
  | 'SEND_SLICER_TO_BACK'
  | 'BRING_SLICER_FORWARD'
  | 'SEND_SLICER_BACKWARD'
  // Delete
  | 'DELETE_SLICER';

/**
 * Split View actions - split viewport operations.
 * Target: SheetMeta (Yjs) + UIStore (split slice)
 *
 */
export type SplitActionType =
  | 'TOGGLE_SPLIT'
  | 'SET_SPLIT_POSITION'
  | 'REMOVE_SPLIT'
  | 'FOCUS_NEXT_SPLIT_VIEWPORT'
  | 'FOCUS_PREV_SPLIT_VIEWPORT'
  | 'FREEZE_PANES'
  | 'FREEZE_TOP_ROW'
  | 'FREEZE_FIRST_COLUMN'
  | 'UNFREEZE_PANES';

/**
 * Diagram actions - Diagram diagram operations.
 * Target: DiagramBridge + FloatingObjectManager + UIStore
 *
 */
export type DiagramActionType =
  // UI/Dialog actions
  | 'OPEN_DIAGRAM_DIALOG'
  | 'CLOSE_DIAGRAM_DIALOG'
  | 'DIAGRAM_SELECT_NODE'
  | 'DIAGRAM_DESELECT_NODE'
  | 'TOGGLE_DIAGRAM_TEXT_PANE'
  | 'DIAGRAM_STOP_EDITING'
  // Lifecycle
  | 'DIAGRAM_INSERT'
  | 'DIAGRAM_DELETE'
  // Node operations
  | 'DIAGRAM_ADD_NODE'
  | 'DIAGRAM_REMOVE_NODE'
  | 'DIAGRAM_UPDATE_NODE'
  // Node hierarchy operations (promote/demote/move)
  | 'DIAGRAM_PROMOTE_NODE'
  | 'DIAGRAM_DEMOTE_NODE'
  | 'DIAGRAM_MOVE_NODE_UP'
  | 'DIAGRAM_MOVE_NODE_DOWN'
  // Style operations
  | 'DIAGRAM_UPDATE_STYLE'
  | 'DIAGRAM_UPDATE_LAYOUT';

/**
 * TextEffect actions - TextEffect object operations.
 * Target: TextEffectMutations + FloatingObjectManager + UIStore
 *
 */
export type TextEffectActionType =
  // Lifecycle
  | 'INSERT_TEXT_EFFECT'
  | 'DELETE_TEXT_EFFECT'
  // Style operations
  | 'UPDATE_TEXT_EFFECT_WARP'
  | 'UPDATE_TEXT_EFFECT_FILL'
  | 'UPDATE_TEXT_EFFECT_OUTLINE'
  | 'UPDATE_TEXT_EFFECT_EFFECTS'
  | 'UPDATE_TEXT_EFFECT_FORMAT' // Text format (bold, italic, fontSize)
  // Text editing
  | 'EDIT_TEXT_EFFECT_TEXT'
  | 'COMMIT_TEXT_EFFECT_TEXT'
  | 'CANCEL_TEXT_EFFECT_EDIT'
  // Conversion
  | 'CONVERT_TO_TEXT_EFFECT'
  | 'CONVERT_TO_TEXTBOX'
  // Gallery
  | 'OPEN_TEXT_EFFECT_GALLERY'
  | 'CLOSE_TEXT_EFFECT_GALLERY'
  | 'SET_TEXT_EFFECT_GALLERY_PRESET';

/**
 * Equation actions - equation insertion and editing operations.
 * Target: Floating Object Manager / UIStore
 *
 */
export type EquationActionType =
  | 'INSERT_EQUATION'
  | 'EDIT_EQUATION'
  | 'UPDATE_EQUATION'
  | 'DELETE_EQUATION'
  | 'OPEN_EQUATION_DIALOG'
  | 'CLOSE_EQUATION_DIALOG';

/**
 * View actions - keyboard shortcuts for alternate views (Kanban, Gallery, Calendar, Timeline).
 * Target: View-specific interaction handlers
 */
export type ViewActionType =
  // Kanban view
  | 'KANBAN_MOVE_UP'
  | 'KANBAN_MOVE_DOWN'
  | 'KANBAN_MOVE_LEFT'
  | 'KANBAN_MOVE_RIGHT'
  | 'KANBAN_EDIT'
  | 'KANBAN_DELETE'
  | 'KANBAN_DESELECT'
  | 'KANBAN_NEW_CARD'
  | 'KANBAN_SELECT_ALL'
  // Gallery view
  | 'GALLERY_MOVE_UP'
  | 'GALLERY_MOVE_DOWN'
  | 'GALLERY_MOVE_LEFT'
  | 'GALLERY_MOVE_RIGHT'
  | 'GALLERY_EDIT'
  | 'GALLERY_DELETE'
  | 'GALLERY_DESELECT'
  | 'GALLERY_SELECT_ALL'
  // Calendar view
  | 'CALENDAR_DELETE'
  | 'CALENDAR_DESELECT'
  | 'CALENDAR_SELECT_ALL'
  // Timeline view
  | 'TIMELINE_DELETE'
  | 'TIMELINE_DESELECT'
  | 'TIMELINE_SELECT_ALL';

// =============================================================================
// Union of All Action Types
// =============================================================================

/**
 * All possible action types in the unified action system.
 * This is the complete set of actions that can be dispatched.
 */
export type ActionType =
  | SelectionActionType
  | EditorActionType
  | ClipboardActionType
  | FormattingActionType
  | StructureActionType
  | NavigationActionType
  | UIActionType
  | WorkbookActionType
  | ObjectActionType
  | CommentActionType
  | FormatPainterActionType
  | FilterActionType
  | AutoFillActionType
  | FillContextMenuActionType
  | FlashFillActionType
  | CustomListsActionType
  | RepeatActionType
  | DragDropActionType
  | PasteValidationActionType
  | TotalRowActionType
  | TableActionType
  | ChartActionType
  | SlicerActionType
  | SplitActionType
  | InkActionType
  | ConditionalFormattingActionType
  | PrintExportActionType
  | DataAnalysisDialogActionType
  | DiagramActionType
  | TextEffectActionType
  | EquationActionType
  | ViewActionType;

// =============================================================================
// Action Payload Map (Unified Keytip Router T4)
// =============================================================================

/**
 * Typed payload contract for actions that take a structured argument.
 *
 * `KeyboardShortcut.actionArg` reads its type from this map via the
 * conditional `A extends keyof KeyboardActionPayload ? ... : never` pattern,
 * so chord shortcuts carry a typed payload end-to-end (matcher → coordinator
 * → dispatcher → handler) rather than `unknown`.
 *
 * Add an entry here for every action that takes a structured arg. Actions
 * not in this map cannot set `actionArg` — TypeScript narrows the field to
 * `never`.
 *
 */
export interface KeyboardActionPayload {
  SWITCH_RIBBON_TAB: SwitchRibbonTabPayload;
  OPEN_RIBBON_DROPDOWN: RibbonDropdownPayload;
  CLOSE_RIBBON_DROPDOWN: RibbonDropdownPayload;
  SET_HORIZONTAL_ALIGN: SetHorizontalAlignPayload;
  SET_VERTICAL_ALIGN: SetVerticalAlignPayload;
  OPEN_PAGE_SETUP_DIALOG: OpenPageSetupDialogPayload;
  TOGGLE_SHEET_PROTECTION: void;
  CONVERT_TO_RANGE: void;
  DELETE_TABLE: void;
  TOGGLE_TABLE_HEADER_ROW: void;
  TOGGLE_TABLE_TOTALS_ROW: void;
  TOGGLE_TABLE_BANDED_ROWS: void;
}
