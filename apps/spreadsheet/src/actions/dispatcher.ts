/**
 * Action Dispatcher
 *
 * Central dispatch function for the unified action system.
 * All input sources (keyboard, toolbar, context menu, AI) call dispatch()
 * to execute actions through a single handler system.
 *
 * ARCHITECTURE:
 * ```
 * Input Sources (keyboard, toolbar, context menu, AI)
 * │
 * ▼ dispatch(actionType, deps)
 * ┌─────────────────────────────────────────────┐
 * │ HANDLER_MAP[actionType](deps) → ActionResult │
 * └─────────────────────────────────────────────┘
 * │
 * ┌──────────┼──────────┐
 * ▼ ▼ ▼
 * XState Actors Mutations UIStore
 * ```
 *
 * Benefits:
 * - Single source of truth for each action
 * - Type-safe dispatch (ActionType union)
 * - Complete handler map ensures no missing handlers
 * - Testable: handlers are pure functions with injected deps
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  ActionType,
  AnyActionHandler,
} from '@mog-sdk/contracts/actions';

// =============================================================================
// Handler Imports
// =============================================================================

// Instance A: Selection handlers (direct submodule imports)
import * as DataEdgeHandlers from './handlers/selection/data-edge';
import * as DifferencesHandlers from './handlers/selection/differences';
import * as ErrorsHandlers from './handlers/selection/errors';
import * as ExtensionHandlers from './handlers/selection/extension';
import * as FormulaAuditingHandlers from './handlers/selection/formula-auditing';
import * as GoToSpecialHandlers from './handlers/selection/go-to-special';
import * as HomeEndHandlers from './handlers/selection/home-end';
import * as ModesHandlers from './handlers/selection/modes';
import * as ReduceHandlers from './handlers/selection/reduce';
import * as MovementHandlers from './handlers/selection/movement';
import * as PageNavigationHandlers from './handlers/selection/page-navigation';
import * as SelectAllHandlers from './handlers/selection/select-all';
import * as TabEnterHandlers from './handlers/selection/tab-enter';
import * as TableNavigationHandlers from './handlers/selection/table-navigation';
import * as TableProgressiveHandlers from './handlers/selection/table-progressive';

// Instance B: Editor + Clipboard handlers
import * as ClipboardHandlers from './handlers/clipboard';
import * as EditorHandlers from './handlers/editor';

// FormulasRibbon action handlers (FormulasRibbon Action System Violation fix)
import * as FormulasHandlers from './handlers/formulas';

// Instance C: Formatting + Structure handlers
import * as BorderHandlers from './handlers/formatting/borders';
import * as CellFormatDialogHandlers from './handlers/formatting/cell-format-dialogs';
import * as ClearHandlers from './handlers/formatting/clear-operations';
import * as FontStyleHandlers from './handlers/formatting/font-styles';
import * as MergeHandlers from './handlers/formatting/merge-operations';
import * as NumberFormatHandlers from './handlers/formatting/number-formats';
import * as StructureHandlers from './handlers/structure';

// Instance D: UI + Workbook + Object handlers
import * as ObjectHandlers from './handlers/object';
import * as UIHandlers from './handlers/ui';
import * as WorkbookHandlers from './handlers/workbook';

// Comment handlers
import * as CommentHandlers from './handlers/comments';

// Excel Parity Quickwin B3: Sheet operations handlers
import * as SheetHandlers from './handlers/sheets';

// Excel Parity Quickwin A9: Fill Series Dialog handlers
import * as FillHandlers from './handlers/fill';

// Format Painter handlers
import * as FormatPainterHandlers from './handlers/format-painter';

// Excel Parity Quickwin B4: Filter Dropdown handlers
import * as FilterHandlers from './handlers/filter';

// Excel Parity Quickwins E1/E4: Navigation handlers
import * as NavigationHandlers from './handlers/navigation';

// Chart handlers
import * as ChartHandlers from './handlers/charts';

// Conditional Formatting handlers
import * as ConditionalFormattingHandlers from './handlers/conditional-formatting';

// Total Row Function Dropdown handlers
import * as TotalRowHandlers from './handlers/total-row';

// F4 Repeat Last Action handler
import * as RepeatHandlers from './handlers/repeat';

import * as DragDropHandlers from './handlers/drag-drop';

import * as DrawBorderHandlers from './handlers/formatting/draw-border';

import * as PrintExportHandlers from './handlers/print-export';

import * as TableHandlers from './handlers/table';

// Slicer Context Menu handlers
import * as SlicerHandlers from './handlers/slicer';

import * as DataAnalysisHandlers from './handlers/data-analysis';

import * as PasteValidationHandlers from './handlers/paste-validation';

// Wave 5: Ink Action handlers
import * as InkHandlers from './handlers/ink';

import * as SplitHandlers from './handlers/split';

// Excel Parity: Diagram handlers
import * as DiagramHandlers from './handlers/diagram';

// Excel Parity: TextEffect handlers
import * as TextEffectHandlers from './handlers/text-effects';

// Excel Parity: Equation handlers
import * as EquationHandlers from './handlers/equation';

// Repeatable actions tracking
import type { RepeatActionSlice } from '../ui-store/slices/editing/repeat-action';
import { isDispatcherReadOnlyActionBlocked } from './dispatcher-read-only';
import { registerDispatchImpl } from './dispatcher-types';
import { isRepeatableAction } from './repeatable';
export { setDispatcherReadOnly } from './dispatcher-read-only';

// =============================================================================
// Read-Only Mode Safety Net
// =============================================================================

// =============================================================================
// Placeholder Handler (for incremental migration)
// =============================================================================

/**
 * Placeholder handler for actions not yet migrated.
 * Returns { handled: false, reason: 'not_implemented' }.
 */
const notImplemented: ActionHandler = (): ActionResult => ({
  handled: false,
  reason: 'not_implemented',
});

// =============================================================================
// Handler Map
// =============================================================================

/**
 * Maps every ActionType to its handler function.
 *
 * IMPORTANT: This map MUST be complete. TypeScript enforces that every
 * ActionType has a corresponding handler. Missing handlers cause compile errors.
 */
export const HANDLER_MAP: Record<ActionType, AnyActionHandler> = {
  // ===========================================================================
  // Selection Actions ✅
  // ===========================================================================
  // Basic movement
  MOVE_UP: MovementHandlers.MOVE_UP,
  MOVE_DOWN: MovementHandlers.MOVE_DOWN,
  MOVE_LEFT: MovementHandlers.MOVE_LEFT,
  MOVE_RIGHT: MovementHandlers.MOVE_RIGHT,
  // Data-edge navigation (Ctrl+Arrow)
  MOVE_TO_EDGE_UP: DataEdgeHandlers.MOVE_TO_EDGE_UP,
  MOVE_TO_EDGE_DOWN: DataEdgeHandlers.MOVE_TO_EDGE_DOWN,
  MOVE_TO_EDGE_LEFT: DataEdgeHandlers.MOVE_TO_EDGE_LEFT,
  MOVE_TO_EDGE_RIGHT: DataEdgeHandlers.MOVE_TO_EDGE_RIGHT,
  // Home/End navigation
  MOVE_TO_ROW_START: HomeEndHandlers.MOVE_TO_ROW_START,
  MOVE_TO_ROW_END: HomeEndHandlers.MOVE_TO_ROW_END,
  MOVE_TO_A1: HomeEndHandlers.MOVE_TO_A1,
  MOVE_TO_LAST_USED_CELL: HomeEndHandlers.MOVE_TO_LAST_USED_CELL,
  // Table-aware navigation
  MOVE_TO_TABLE_START: TableNavigationHandlers.MOVE_TO_TABLE_START,
  MOVE_TO_TABLE_END: TableNavigationHandlers.MOVE_TO_TABLE_END,
  MOVE_TO_TABLE_EDGE_UP: TableNavigationHandlers.MOVE_TO_TABLE_EDGE_UP,
  MOVE_TO_TABLE_EDGE_DOWN: TableNavigationHandlers.MOVE_TO_TABLE_EDGE_DOWN,
  MOVE_TO_TABLE_EDGE_LEFT: TableNavigationHandlers.MOVE_TO_TABLE_EDGE_LEFT,
  MOVE_TO_TABLE_EDGE_RIGHT: TableNavigationHandlers.MOVE_TO_TABLE_EDGE_RIGHT,
  // Page navigation
  PAGE_UP: PageNavigationHandlers.PAGE_UP,
  PAGE_DOWN: PageNavigationHandlers.PAGE_DOWN,
  PAGE_LEFT: PageNavigationHandlers.PAGE_LEFT,
  PAGE_RIGHT: PageNavigationHandlers.PAGE_RIGHT,
  // Tab/Enter navigation
  TAB_FORWARD: TabEnterHandlers.TAB_FORWARD,
  TAB_BACKWARD: TabEnterHandlers.TAB_BACKWARD,
  ENTER_NAVIGATE: TabEnterHandlers.ENTER_NAVIGATE,
  SHIFT_ENTER_NAVIGATE: TabEnterHandlers.SHIFT_ENTER_NAVIGATE,
  // Selection extension (Shift+Arrow)
  EXTEND_SELECTION_UP: ExtensionHandlers.EXTEND_SELECTION_UP,
  EXTEND_SELECTION_DOWN: ExtensionHandlers.EXTEND_SELECTION_DOWN,
  EXTEND_SELECTION_LEFT: ExtensionHandlers.EXTEND_SELECTION_LEFT,
  EXTEND_SELECTION_RIGHT: ExtensionHandlers.EXTEND_SELECTION_RIGHT,
  // Data-edge extension (Ctrl+Shift+Arrow)
  EXTEND_TO_EDGE_UP: DataEdgeHandlers.EXTEND_TO_EDGE_UP,
  EXTEND_TO_EDGE_DOWN: DataEdgeHandlers.EXTEND_TO_EDGE_DOWN,
  EXTEND_TO_EDGE_LEFT: DataEdgeHandlers.EXTEND_TO_EDGE_LEFT,
  EXTEND_TO_EDGE_RIGHT: DataEdgeHandlers.EXTEND_TO_EDGE_RIGHT,
  // Page navigation extension (Shift+PageUp/PageDown)
  EXTEND_SELECTION_PAGE_UP: PageNavigationHandlers.EXTEND_SELECTION_PAGE_UP,
  EXTEND_SELECTION_PAGE_DOWN: PageNavigationHandlers.EXTEND_SELECTION_PAGE_DOWN,
  // Home/End extension
  EXTEND_TO_ROW_START: HomeEndHandlers.EXTEND_TO_ROW_START,
  EXTEND_TO_ROW_END: HomeEndHandlers.EXTEND_TO_ROW_END,
  EXTEND_TO_A1: HomeEndHandlers.EXTEND_TO_A1,
  EXTEND_TO_LAST_USED_CELL: HomeEndHandlers.EXTEND_TO_LAST_USED_CELL,
  // Select commands
  SELECT_ALL: SelectAllHandlers.SELECT_ALL,
  SELECT_CURRENT_REGION: SelectAllHandlers.SELECT_CURRENT_REGION,
  SELECT_ENTIRE_ROW: SelectAllHandlers.SELECT_ENTIRE_ROW,
  SELECT_ENTIRE_COLUMN: SelectAllHandlers.SELECT_ENTIRE_COLUMN,
  SELECT_PRECEDENTS: FormulaAuditingHandlers.SELECT_PRECEDENTS,
  SELECT_DEPENDENTS: FormulaAuditingHandlers.SELECT_DEPENDENTS,
  SELECT_VISIBLE_CELLS: FormulaAuditingHandlers.SELECT_VISIBLE_CELLS,
  TOGGLE_ADD_TO_SELECTION: ModesHandlers.TOGGLE_ADD_TO_SELECTION,
  // Go To Special selections
  SELECT_BLANKS: GoToSpecialHandlers.SELECT_BLANKS,
  SELECT_CONSTANTS: GoToSpecialHandlers.SELECT_CONSTANTS,
  SELECT_FORMULAS: GoToSpecialHandlers.SELECT_FORMULAS,
  SELECT_NUMBERS: GoToSpecialHandlers.SELECT_NUMBERS,
  SELECT_TEXT: GoToSpecialHandlers.SELECT_TEXT,
  SELECT_LOGICALS: GoToSpecialHandlers.SELECT_LOGICALS,
  SELECT_ERRORS: GoToSpecialHandlers.SELECT_ERRORS,
  SELECT_LAST_CELL: GoToSpecialHandlers.SELECT_LAST_CELL,
  SELECT_CELLS_WITH_CONDITIONAL_FORMATS: GoToSpecialHandlers.SELECT_CELLS_WITH_CONDITIONAL_FORMATS,
  SELECT_CELLS_WITH_DATA_VALIDATION: GoToSpecialHandlers.SELECT_CELLS_WITH_DATA_VALIDATION,
  SELECT_CELLS_WITH_SAME_VALIDATION: GoToSpecialHandlers.SELECT_CELLS_WITH_SAME_VALIDATION,
  SELECT_CELLS_WITH_COMMENTS: GoToSpecialHandlers.SELECT_CELLS_WITH_COMMENTS,
  // Row/Column differences
  SELECT_ROW_DIFFERENCES: DifferencesHandlers.SELECT_ROW_DIFFERENCES,
  SELECT_COLUMN_DIFFERENCES: DifferencesHandlers.SELECT_COLUMN_DIFFERENCES,
  // Go To Special remaining options
  SELECT_CURRENT_ARRAY: GoToSpecialHandlers.SELECT_CURRENT_ARRAY,
  SELECT_OBJECTS: GoToSpecialHandlers.SELECT_OBJECTS,
  // Corner rotation
  ROTATE_SELECTION_CORNER: ModesHandlers.ROTATE_SELECTION_CORNER,
  // Selection modes (Excel Parity 2.6 + )
  TOGGLE_EXTEND_SELECTION_MODE: ModesHandlers.TOGGLE_EXTEND_SELECTION_MODE,
  ACTIVATE_END_MODE: ModesHandlers.ACTIVATE_END_MODE,
  // Table progressive selection
  CYCLE_TABLE_COLUMN_SELECTION: TableProgressiveHandlers.CYCLE_TABLE_COLUMN_SELECTION,
  CYCLE_TABLE_SELECTION: TableProgressiveHandlers.CYCLE_TABLE_SELECTION,
  // Selection error display
  SET_SELECTION_ERROR: ErrorsHandlers.SET_SELECTION_ERROR,
  CLEAR_SELECTION_ERROR: ErrorsHandlers.CLEAR_SELECTION_ERROR,
  REDUCE_SELECTION: ReduceHandlers.REDUCE_SELECTION,

  // ===========================================================================
  // Editor Actions ✅
  // ===========================================================================
  EDIT_CELL: EditorHandlers.EDIT_CELL,
  COMMIT_AND_MOVE_DOWN: EditorHandlers.COMMIT_AND_MOVE_DOWN,
  COMMIT_AND_MOVE_UP: EditorHandlers.COMMIT_AND_MOVE_UP,
  COMMIT_AND_MOVE_LEFT: EditorHandlers.COMMIT_AND_MOVE_LEFT,
  COMMIT_AND_MOVE_RIGHT: EditorHandlers.COMMIT_AND_MOVE_RIGHT,
  COMMIT_TAB: EditorHandlers.COMMIT_TAB,
  COMMIT_SHIFT_TAB: EditorHandlers.COMMIT_SHIFT_TAB,
  COMMIT_ENTER: EditorHandlers.COMMIT_ENTER,
  COMMIT_SHIFT_ENTER: EditorHandlers.COMMIT_SHIFT_ENTER,
  CANCEL_EDIT: EditorHandlers.CANCEL_EDIT,
  COMMIT_IN_PLACE: EditorHandlers.COMMIT_IN_PLACE,
  PICKER_COMMIT: EditorHandlers.PICKER_COMMIT,
  DATE_PICKER_COMMIT: EditorHandlers.DATE_PICKER_COMMIT,
  INSERT_NEWLINE: EditorHandlers.INSERT_NEWLINE,
  INSERT_CHAR: EditorHandlers.INSERT_CHAR,
  START_FORMULA: EditorHandlers.START_FORMULA,
  CLEAR_CONTENTS: EditorHandlers.CLEAR_CONTENTS,
  CLEAR_AND_EDIT: EditorHandlers.CLEAR_AND_EDIT,
  DELETE_TO_END_OF_LINE: EditorHandlers.DELETE_TO_END_OF_LINE,
  // Cursor navigation in multi-line cells (Edit Mode)
  CURSOR_UP: EditorHandlers.CURSOR_UP,
  CURSOR_DOWN: EditorHandlers.CURSOR_DOWN,
  // Word deletion (Edit Mode)
  DELETE_WORD_FORWARD: EditorHandlers.DELETE_WORD_FORWARD,
  DELETE_WORD_BACKWARD: EditorHandlers.DELETE_WORD_BACKWARD,
  FILL_DOWN: EditorHandlers.FILL_DOWN,
  FILL_RIGHT: EditorHandlers.FILL_RIGHT,
  FILL_UP: EditorHandlers.FILL_UP,
  FILL_LEFT: EditorHandlers.FILL_LEFT,
  FILL_SELECTION: EditorHandlers.FILL_SELECTION,
  // Double-click fill handle
  DOUBLE_CLICK_FILL_HANDLE: FillHandlers.DOUBLE_CLICK_FILL_HANDLE,
  CLEAR_ALL: EditorHandlers.CLEAR_ALL,
  CLEAR_FORMATS: EditorHandlers.CLEAR_FORMATS,
  CLEAR_COMMENTS: EditorHandlers.CLEAR_COMMENTS,
  // Sort operations (Cell Identity Model)
  SORT_ASCENDING: EditorHandlers.SORT_ASCENDING,
  SORT_DESCENDING: EditorHandlers.SORT_DESCENDING,
  // Sort by Color options
  SORT_BY_CELL_COLOR: EditorHandlers.SORT_BY_CELL_COLOR,
  SORT_BY_FONT_COLOR: EditorHandlers.SORT_BY_FONT_COLOR,
  INSERT_CURRENT_DATE: EditorHandlers.INSERT_CURRENT_DATE,
  INSERT_CURRENT_TIME: EditorHandlers.INSERT_CURRENT_TIME,
  COPY_VALUE_FROM_ABOVE: EditorHandlers.COPY_VALUE_FROM_ABOVE,
  COPY_FORMULA_FROM_ABOVE: EditorHandlers.COPY_FORMULA_FROM_ABOVE,
  CYCLE_REFERENCE: EditorHandlers.CYCLE_REFERENCE,
  ENTER_ARRAY_FORMULA: EditorHandlers.ENTER_ARRAY_FORMULA,
  INSERT_FUNCTION_ARGS: EditorHandlers.INSERT_FUNCTION_ARGS,
  INSERT_FUNCTION: FormulasHandlers.INSERT_FUNCTION,
  PASTE_NAME_IN_FORMULA: FormulasHandlers.PASTE_NAME_IN_FORMULA,
  AUTO_SUM: EditorHandlers.AUTO_SUM,
  INSERT_AUTO_FUNCTION: EditorHandlers.INSERT_AUTO_FUNCTION,
  // F9 Partial Formula Evaluation
  EVALUATE_FORMULA_SELECTION: EditorHandlers.EVALUATE_FORMULA_SELECTION,
  // Enter Mode / Edit Mode
  TOGGLE_EDIT_MODE: EditorHandlers.TOGGLE_EDIT_MODE,
  FORMULA_SELECT_UP: EditorHandlers.FORMULA_SELECT_UP,
  FORMULA_SELECT_DOWN: EditorHandlers.FORMULA_SELECT_DOWN,
  FORMULA_SELECT_LEFT: EditorHandlers.FORMULA_SELECT_LEFT,
  FORMULA_SELECT_RIGHT: EditorHandlers.FORMULA_SELECT_RIGHT,
  FORMULA_EXTEND_UP: EditorHandlers.FORMULA_EXTEND_UP,
  FORMULA_EXTEND_DOWN: EditorHandlers.FORMULA_EXTEND_DOWN,
  FORMULA_EXTEND_LEFT: EditorHandlers.FORMULA_EXTEND_LEFT,
  FORMULA_EXTEND_RIGHT: EditorHandlers.FORMULA_EXTEND_RIGHT,
  // Ctrl+Arrow / Ctrl+Shift+Arrow during formula edit (point-mode
  // jump and extend to data edge — Excel parity).
  FORMULA_MOVE_TO_EDGE_UP: EditorHandlers.FORMULA_MOVE_TO_EDGE_UP,
  FORMULA_MOVE_TO_EDGE_DOWN: EditorHandlers.FORMULA_MOVE_TO_EDGE_DOWN,
  FORMULA_MOVE_TO_EDGE_LEFT: EditorHandlers.FORMULA_MOVE_TO_EDGE_LEFT,
  FORMULA_MOVE_TO_EDGE_RIGHT: EditorHandlers.FORMULA_MOVE_TO_EDGE_RIGHT,
  FORMULA_EXTEND_TO_EDGE_UP: EditorHandlers.FORMULA_EXTEND_TO_EDGE_UP,
  FORMULA_EXTEND_TO_EDGE_DOWN: EditorHandlers.FORMULA_EXTEND_TO_EDGE_DOWN,
  FORMULA_EXTEND_TO_EDGE_LEFT: EditorHandlers.FORMULA_EXTEND_TO_EDGE_LEFT,
  FORMULA_EXTEND_TO_EDGE_RIGHT: EditorHandlers.FORMULA_EXTEND_TO_EDGE_RIGHT,
  // Formula error dialog actions
  EDIT_FORMULA_WITH_ERROR: EditorHandlers.EDIT_FORMULA_WITH_ERROR,
  COMMIT_FORMULA_AS_TEXT: EditorHandlers.COMMIT_FORMULA_AS_TEXT,
  OPEN_FORMULA_HELP: EditorHandlers.OPEN_FORMULA_HELP,
  // Data validation dropdown
  OPEN_CELL_PICKER: EditorHandlers.OPEN_CELL_PICKER,
  // Range box dragging for formula editing
  UPDATE_FORMULA_RANGE: EditorHandlers.UPDATE_FORMULA_RANGE,
  // Hyperlink insertion. Keep INSERT_HYPERLINK as the keyboard/legacy alias
  // for the canonical dialog action used by ribbon and context-menu entrypoints.
  INSERT_HYPERLINK: UIHandlers.OPEN_HYPERLINK_DIALOG,

  // ===========================================================================
  // Clipboard Actions ✅
  // G1/G2: Added CLEAR_CLIPBOARD for ESC to clear marching ants
  // G3: Added paste options button actions
  // ===========================================================================
  COPY: ClipboardHandlers.COPY,
  CUT: ClipboardHandlers.CUT,
  PASTE: ClipboardHandlers.PASTE,
  CLEAR_CLIPBOARD: ClipboardHandlers.CLEAR_CLIPBOARD,
  // G3: Paste Options Button
  SHOW_PASTE_OPTIONS: ClipboardHandlers.SHOW_PASTE_OPTIONS,
  HIDE_PASTE_OPTIONS: ClipboardHandlers.HIDE_PASTE_OPTIONS,
  PASTE_WITH_OPTIONS: ClipboardHandlers.PASTE_WITH_OPTIONS,
  // Context Menu Paste Options
  PASTE_VALUES: ClipboardHandlers.PASTE_VALUES,
  PASTE_FORMULAS: ClipboardHandlers.PASTE_FORMULAS,
  PASTE_FORMATTING: ClipboardHandlers.PASTE_FORMATTING,
  PASTE_TRANSPOSE: ClipboardHandlers.PASTE_TRANSPOSE,
  // Paste Link/Picture Options
  PASTE_LINK: ClipboardHandlers.PASTE_LINK,
  PASTE_AS_PICTURE: ClipboardHandlers.PASTE_AS_PICTURE,
  PASTE_AS_LINKED_PICTURE: ClipboardHandlers.PASTE_AS_LINKED_PICTURE,
  // Paste Size Mismatch Warning Dialog
  SHOW_PASTE_SIZE_MISMATCH_DIALOG: ClipboardHandlers.SHOW_PASTE_SIZE_MISMATCH_DIALOG,
  CONFIRM_PASTE_SIZE_MISMATCH: ClipboardHandlers.CONFIRM_PASTE_SIZE_MISMATCH,
  CANCEL_PASTE_SIZE_MISMATCH: ClipboardHandlers.CANCEL_PASTE_SIZE_MISMATCH,
  // Cut-Paste Overwrite Confirmation Dialog (Excel/Sheets parity)
  CONFIRM_PASTE_OVERWRITE: ClipboardHandlers.CONFIRM_PASTE_OVERWRITE,
  CANCEL_PASTE_OVERWRITE: ClipboardHandlers.CANCEL_PASTE_OVERWRITE,

  // ===========================================================================
  // Formatting Actions ✅
  // Decomposed into focused modules
  // ===========================================================================

  // Font styles (font-styles.ts) - 14 handlers
  TOGGLE_BOLD: FontStyleHandlers.TOGGLE_BOLD,
  TOGGLE_ITALIC: FontStyleHandlers.TOGGLE_ITALIC,
  TOGGLE_UNDERLINE: FontStyleHandlers.TOGGLE_UNDERLINE,
  TOGGLE_STRIKETHROUGH: FontStyleHandlers.TOGGLE_STRIKETHROUGH,
  TOGGLE_WRAP_TEXT: FontStyleHandlers.TOGGLE_WRAP_TEXT,
  SET_FONT_SIZE: FontStyleHandlers.SET_FONT_SIZE,
  SET_FONT_FAMILY: FontStyleHandlers.SET_FONT_FAMILY,
  SET_FONT_COLOR: FontStyleHandlers.SET_FONT_COLOR,
  SET_FONT_THEME: FontStyleHandlers.SET_FONT_THEME,
  INCREASE_FONT_SIZE: FontStyleHandlers.INCREASE_FONT_SIZE,
  DECREASE_FONT_SIZE: FontStyleHandlers.DECREASE_FONT_SIZE,
  APPLY_FONT_FORMAT: FontStyleHandlers.APPLY_FONT_FORMAT,
  // Text effects
  TOGGLE_SUPERSCRIPT: FontStyleHandlers.TOGGLE_SUPERSCRIPT,
  TOGGLE_SUBSCRIPT: FontStyleHandlers.TOGGLE_SUBSCRIPT,

  // Direct formatting actions (toolbar unification)
  SET_BACKGROUND_COLOR: FontStyleHandlers.SET_BACKGROUND_COLOR,
  SET_HORIZONTAL_ALIGN: CellFormatDialogHandlers.SET_HORIZONTAL_ALIGN,
  SET_VERTICAL_ALIGN: CellFormatDialogHandlers.SET_VERTICAL_ALIGN,
  SET_TEXT_ROTATION: CellFormatDialogHandlers.SET_TEXT_ROTATION,
  INCREASE_INDENT: CellFormatDialogHandlers.INCREASE_INDENT,
  DECREASE_INDENT: CellFormatDialogHandlers.DECREASE_INDENT,

  // Cell format dialogs (cell-format-dialogs.ts) - 4 handlers
  APPLY_ALIGNMENT_FORMAT: CellFormatDialogHandlers.APPLY_ALIGNMENT_FORMAT,
  APPLY_FILL_FORMAT: CellFormatDialogHandlers.APPLY_FILL_FORMAT,
  APPLY_PROTECTION_FORMAT: CellFormatDialogHandlers.APPLY_PROTECTION_FORMAT,
  INSERT_TABLE: CellFormatDialogHandlers.INSERT_TABLE,

  // Number formats (number-formats.ts) - 12 handlers
  SET_NUMBER_FORMAT: NumberFormatHandlers.SET_NUMBER_FORMAT,
  FORMAT_GENERAL: NumberFormatHandlers.FORMAT_GENERAL,
  FORMAT_NUMBER: NumberFormatHandlers.FORMAT_NUMBER,
  FORMAT_TIME: NumberFormatHandlers.FORMAT_TIME,
  FORMAT_DATE: NumberFormatHandlers.FORMAT_DATE,
  FORMAT_CURRENCY: NumberFormatHandlers.FORMAT_CURRENCY,
  FORMAT_PERCENTAGE: NumberFormatHandlers.FORMAT_PERCENTAGE,
  FORMAT_SCIENTIFIC: NumberFormatHandlers.FORMAT_SCIENTIFIC,
  FORMAT_COMMA: NumberFormatHandlers.FORMAT_COMMA,
  APPLY_NUMBER_FORMAT: NumberFormatHandlers.APPLY_NUMBER_FORMAT,
  INCREASE_DECIMALS: NumberFormatHandlers.INCREASE_DECIMALS,
  DECREASE_DECIMALS: NumberFormatHandlers.DECREASE_DECIMALS,

  // Borders (borders.ts) - 17 handlers
  APPLY_BORDERS: BorderHandlers.APPLY_BORDERS,
  APPLY_OUTLINE_BORDER: BorderHandlers.APPLY_OUTLINE_BORDER,
  REMOVE_BORDERS: BorderHandlers.REMOVE_BORDERS,
  SET_ALL_BORDERS: BorderHandlers.SET_ALL_BORDERS,
  SET_INSIDE_BORDERS: BorderHandlers.SET_INSIDE_BORDERS,
  SET_INSIDE_HORIZONTAL_BORDERS: BorderHandlers.SET_INSIDE_HORIZONTAL_BORDERS,
  SET_INSIDE_VERTICAL_BORDERS: BorderHandlers.SET_INSIDE_VERTICAL_BORDERS,
  SET_TOP_BORDER: BorderHandlers.SET_TOP_BORDER,
  SET_BOTTOM_BORDER: BorderHandlers.SET_BOTTOM_BORDER,
  SET_LEFT_BORDER: BorderHandlers.SET_LEFT_BORDER,
  SET_RIGHT_BORDER: BorderHandlers.SET_RIGHT_BORDER,
  SET_DIAGONAL_UP_BORDER: BorderHandlers.SET_DIAGONAL_UP_BORDER,
  SET_DIAGONAL_DOWN_BORDER: BorderHandlers.SET_DIAGONAL_DOWN_BORDER,
  SET_DIAGONAL_BOTH_BORDER: BorderHandlers.SET_DIAGONAL_BOTH_BORDER,
  SET_TOP_AND_BOTTOM_BORDERS: BorderHandlers.SET_TOP_AND_BOTTOM_BORDERS,
  SET_TOP_AND_THICK_BOTTOM_BORDERS: BorderHandlers.SET_TOP_AND_THICK_BOTTOM_BORDERS,
  SET_TOP_AND_DOUBLE_BOTTOM_BORDERS: BorderHandlers.SET_TOP_AND_DOUBLE_BOTTOM_BORDERS,

  // Clear operations (clear-operations.ts) - 4 handlers
  CLEAR_HYPERLINKS: ClearHandlers.CLEAR_HYPERLINKS,
  CLEAR_CONDITIONAL_FORMATTING: ClearHandlers.CLEAR_CONDITIONAL_FORMATTING,
  CLEAR_DATA_VALIDATION: ClearHandlers.CLEAR_DATA_VALIDATION,
  CLEAR_OUTLINE: ClearHandlers.CLEAR_OUTLINE,

  // Merge operations (merge-operations.ts) - 7 handlers
  TOGGLE_MERGE: MergeHandlers.TOGGLE_MERGE,
  MERGE_ACROSS: MergeHandlers.MERGE_ACROSS,
  MERGE_AND_CENTER: MergeHandlers.MERGE_AND_CENTER,
  UNMERGE_CELLS: MergeHandlers.UNMERGE_CELLS,
  MERGE_CELLS: MergeHandlers.MERGE_CELLS,
  CONFIRM_MERGE_WITH_DATA_LOSS: MergeHandlers.CONFIRM_MERGE_WITH_DATA_LOSS,
  CANCEL_MERGE: MergeHandlers.CANCEL_MERGE,

  // Draw Border Tools - 4 handlers
  ACTIVATE_DRAW_BORDER: DrawBorderHandlers.ACTIVATE_DRAW_BORDER,
  ACTIVATE_DRAW_BORDER_GRID: DrawBorderHandlers.ACTIVATE_DRAW_BORDER_GRID,
  ACTIVATE_ERASE_BORDER: DrawBorderHandlers.ACTIVATE_ERASE_BORDER,
  DEACTIVATE_DRAW_BORDER: DrawBorderHandlers.DEACTIVATE_DRAW_BORDER,

  // ===========================================================================
  // Structure Actions ✅
  // ===========================================================================
  INSERT_ROW_ABOVE: StructureHandlers.INSERT_ROW_ABOVE,
  INSERT_ROW_BELOW: StructureHandlers.INSERT_ROW_BELOW,
  INSERT_COLUMN_LEFT: StructureHandlers.INSERT_COLUMN_LEFT,
  INSERT_COLUMN_RIGHT: StructureHandlers.INSERT_COLUMN_RIGHT,
  DELETE_ROWS: StructureHandlers.DELETE_ROWS,
  DELETE_COLUMNS: StructureHandlers.DELETE_COLUMNS,
  // Insert/Delete cells with shift
  INSERT_CELLS: StructureHandlers.INSERT_CELLS,
  INSERT_CELLS_SHIFT_DOWN: StructureHandlers.INSERT_CELLS_SHIFT_DOWN,
  INSERT_CUT_CELLS: StructureHandlers.INSERT_CUT_CELLS,
  INSERT_CUT_CELLS_SHIFT_DOWN: StructureHandlers.INSERT_CUT_CELLS_SHIFT_DOWN,
  DELETE_CELLS: StructureHandlers.DELETE_CELLS,
  HIDE_ROW: StructureHandlers.HIDE_ROW,
  UNHIDE_ROW: StructureHandlers.UNHIDE_ROW,
  HIDE_COLUMN: StructureHandlers.HIDE_COLUMN,
  UNHIDE_COLUMN: StructureHandlers.UNHIDE_COLUMN,
  AUTO_FIT_ROW_HEIGHT: StructureHandlers.AUTO_FIT_ROW_HEIGHT,
  AUTO_FIT_COLUMN_WIDTH: StructureHandlers.AUTO_FIT_COLUMN_WIDTH,
  APPLY_ROW_HEIGHT: StructureHandlers.APPLY_ROW_HEIGHT,
  APPLY_COLUMN_WIDTH: StructureHandlers.APPLY_COLUMN_WIDTH,
  // Page Break actions
  INSERT_HORIZONTAL_PAGE_BREAK: StructureHandlers.INSERT_HORIZONTAL_PAGE_BREAK,
  REMOVE_HORIZONTAL_PAGE_BREAK: StructureHandlers.REMOVE_HORIZONTAL_PAGE_BREAK,
  INSERT_VERTICAL_PAGE_BREAK: StructureHandlers.INSERT_VERTICAL_PAGE_BREAK,
  REMOVE_VERTICAL_PAGE_BREAK: StructureHandlers.REMOVE_VERTICAL_PAGE_BREAK,
  UNDO: StructureHandlers.UNDO,
  REDO: StructureHandlers.REDO,

  // ===========================================================================
  // UI Actions ✅
  // ===========================================================================
  // Dialogs
  OPEN_GO_TO_DIALOG: UIHandlers.OPEN_GO_TO_DIALOG,
  CLOSE_GO_TO_DIALOG: UIHandlers.CLOSE_GO_TO_DIALOG,
  NAVIGATE_TO_REFERENCE: UIHandlers.NAVIGATE_TO_REFERENCE,
  OPEN_GO_TO_SPECIAL_DIALOG: UIHandlers.OPEN_GO_TO_SPECIAL_DIALOG,
  OPEN_FORMAT_CELLS_DIALOG: UIHandlers.OPEN_FORMAT_CELLS_DIALOG,
  CLOSE_FORMAT_CELLS_DIALOG: UIHandlers.CLOSE_FORMAT_CELLS_DIALOG,
  OPEN_INSERT_CELLS_DIALOG: UIHandlers.OPEN_INSERT_CELLS_DIALOG,
  OPEN_DELETE_CELLS_DIALOG: UIHandlers.OPEN_DELETE_CELLS_DIALOG,
  OPEN_INSERT_FUNCTION_DIALOG: UIHandlers.OPEN_INSERT_FUNCTION_DIALOG,
  CLOSE_INSERT_FUNCTION_DIALOG: UIHandlers.CLOSE_INSERT_FUNCTION_DIALOG,
  OPEN_FUNCTION_ARGUMENTS_DIALOG: UIHandlers.OPEN_FUNCTION_ARGUMENTS_DIALOG,
  CLOSE_FUNCTION_ARGUMENTS_DIALOG: UIHandlers.CLOSE_FUNCTION_ARGUMENTS_DIALOG,
  OPEN_NAME_MANAGER: UIHandlers.OPEN_NAME_MANAGER,
  // Define Name Dialog
  OPEN_DEFINE_NAME_DIALOG: UIHandlers.OPEN_DEFINE_NAME_DIALOG,
  OPEN_FIND_DIALOG: UIHandlers.OPEN_FIND_DIALOG,
  OPEN_FIND_REPLACE_DIALOG: UIHandlers.OPEN_FIND_REPLACE_DIALOG,
  OPEN_PASTE_SPECIAL_DIALOG: UIHandlers.OPEN_PASTE_SPECIAL_DIALOG,
  OPEN_DROPDOWN: UIHandlers.OPEN_DROPDOWN,
  OPEN_CUSTOM_SORT_DIALOG: UIHandlers.OPEN_CUSTOM_SORT_DIALOG,
  INVOKE_CONTEXT_MENU: UIHandlers.INVOKE_CONTEXT_MENU,
  OPEN_HYPERLINK_DIALOG: UIHandlers.OPEN_HYPERLINK_DIALOG,
  REMOVE_HYPERLINK: UIHandlers.REMOVE_HYPERLINK,
  // Fill Series Dialog (Excel parity quickwin A9)
  OPEN_FILL_SERIES_DIALOG: FillHandlers.OPEN_FILL_SERIES_DIALOG,
  CLOSE_FILL_SERIES_DIALOG: FillHandlers.CLOSE_FILL_SERIES_DIALOG,
  EXECUTE_FILL_SERIES: FillHandlers.EXECUTE_FILL_SERIES,
  // Page Setup Dialog (Excel parity quickwin A10)
  OPEN_PAGE_SETUP_DIALOG: UIHandlers.OPEN_PAGE_SETUP_DIALOG,
  CLOSE_PAGE_SETUP_DIALOG: UIHandlers.CLOSE_PAGE_SETUP_DIALOG,
  APPLY_PAGE_SETUP: UIHandlers.APPLY_PAGE_SETUP,
  // Page Layout ribbon quick actions
  SET_PAGE_ORIENTATION: UIHandlers.SET_PAGE_ORIENTATION,
  SET_PAPER_SIZE: UIHandlers.SET_PAPER_SIZE,
  SET_PAGE_MARGINS: UIHandlers.SET_PAGE_MARGINS,
  SET_PAGE_SCALE: UIHandlers.SET_PAGE_SCALE,
  // Page Layout dispatch: view-side sheet options
  TOGGLE_VIEW_GRIDLINES: UIHandlers.TOGGLE_VIEW_GRIDLINES,
  TOGGLE_VIEW_HEADINGS: UIHandlers.TOGGLE_VIEW_HEADINGS,
  // Backstage (Excel parity quickwin A1)
  OPEN_BACKSTAGE: UIHandlers.OPEN_BACKSTAGE,
  CLOSE_BACKSTAGE: UIHandlers.CLOSE_BACKSTAGE,
  SET_BACKSTAGE_PANEL: UIHandlers.SET_BACKSTAGE_PANEL,
  // View toggles
  TOGGLE_FORMULA_VIEW: UIHandlers.TOGGLE_FORMULA_VIEW,
  TOGGLE_SHOW_FORMULAS: FormulasHandlers.TOGGLE_SHOW_FORMULAS,
  TOGGLE_FORMULA_BAR_EXPAND: UIHandlers.TOGGLE_FORMULA_BAR_EXPAND,
  TOGGLE_NL_BAR: UIHandlers.TOGGLE_NL_BAR,
  TOGGLE_AUTO_FILTER: UIHandlers.TOGGLE_AUTO_FILTER,
  TOGGLE_RIBBON: UIHandlers.TOGGLE_RIBBON,
  // Ribbon Display Modes
  SET_RIBBON_DISPLAY_MODE: UIHandlers.SET_RIBBON_DISPLAY_MODE,
  TOGGLE_RIBBON_TABS_MODE: UIHandlers.TOGGLE_RIBBON_TABS_MODE,
  SHOW_RIBBON_TEMPORARILY: UIHandlers.SHOW_RIBBON_TEMPORARILY,
  HIDE_RIBBON_TEMPORARILY: UIHandlers.HIDE_RIBBON_TEMPORARILY,
  // KeyTip activation (F10 menu activation)
  ACTIVATE_RIBBON_KEYTIPS: UIHandlers.ACTIVATE_RIBBON_KEYTIPS,
  DEACTIVATE_RIBBON_KEYTIPS: UIHandlers.DEACTIVATE_RIBBON_KEYTIPS,
  // Unified Keytip Router: ribbon tab switch + Home-tab pickers
  SWITCH_RIBBON_TAB: UIHandlers.SWITCH_RIBBON_TAB,
  OPEN_BORDERS_PICKER: UIHandlers.OPEN_BORDERS_PICKER,
  CLOSE_BORDERS_PICKER: UIHandlers.CLOSE_BORDERS_PICKER,
  OPEN_FILL_COLOR_PICKER: UIHandlers.OPEN_FILL_COLOR_PICKER,
  CLOSE_FILL_COLOR_PICKER: UIHandlers.CLOSE_FILL_COLOR_PICKER,
  OPEN_FONT_COLOR_PICKER: UIHandlers.OPEN_FONT_COLOR_PICKER,
  CLOSE_FONT_COLOR_PICKER: UIHandlers.CLOSE_FONT_COLOR_PICKER,
  OPEN_FONT_FAMILY_PICKER: UIHandlers.OPEN_FONT_FAMILY_PICKER,
  CLOSE_FONT_FAMILY_PICKER: UIHandlers.CLOSE_FONT_FAMILY_PICKER,
  OPEN_NUMBER_FORMAT_DROPDOWN: UIHandlers.OPEN_NUMBER_FORMAT_DROPDOWN,
  CLOSE_NUMBER_FORMAT_DROPDOWN: UIHandlers.CLOSE_NUMBER_FORMAT_DROPDOWN,
  FOCUS_FONT_SIZE_INPUT: UIHandlers.FOCUS_FONT_SIZE_INPUT,
  // Unified Keytip Router: named ribbon-dropdown openers + tab actions
  OPEN_RIBBON_DROPDOWN: UIHandlers.OPEN_RIBBON_DROPDOWN,
  CLOSE_RIBBON_DROPDOWN: UIHandlers.CLOSE_RIBBON_DROPDOWN,
  TRIGGER_AUTOSUM: UIHandlers.TRIGGER_AUTOSUM,
  // Zoom (G5: Zoom Slider)
  ZOOM_IN: UIHandlers.ZOOM_IN,
  ZOOM_OUT: UIHandlers.ZOOM_OUT,
  ZOOM_RESET: UIHandlers.ZOOM_RESET,
  SET_ZOOM: UIHandlers.SET_ZOOM,
  FULL_SCREEN: UIHandlers.FULL_SCREEN,
  // Scroll Lock
  TOGGLE_SCROLL_LOCK: UIHandlers.TOGGLE_SCROLL_LOCK,
  // Outline/Objects visibility
  TOGGLE_OUTLINE_SYMBOLS: notImplemented,
  TOGGLE_OBJECTS_VISIBILITY: notImplemented,
  // Extension Panel
  TOGGLE_EXTENSION_PANEL: UIHandlers.TOGGLE_EXTENSION_PANEL,
  // Threaded comments
  OPEN_THREADED_COMMENTS: notImplemented,
  // Font dialog
  OPEN_FONT_DIALOG: UIHandlers.OPEN_FONT_DIALOG,
  // Print preview / PDF dialog
  OPEN_PRINT_PREVIEW: UIHandlers.OPEN_PRINT_PREVIEW,
  OPEN_PRINT_PDF_DIALOG: UIHandlers.OPEN_PRINT_PDF_DIALOG,
  CLOSE_PRINT_PDF_DIALOG: UIHandlers.CLOSE_PRINT_PDF_DIALOG,
  // File operations
  SAVE: UIHandlers.SAVE,
  EXPORT_FILE: UIHandlers.EXPORT_FILE,
  OPEN: UIHandlers.OPEN,
  OPEN_COMMAND_PALETTE: UIHandlers.OPEN_COMMAND_PALETTE,
  NEW_WORKBOOK: UIHandlers.NEW_WORKBOOK,
  CLOSE_WORKBOOK: UIHandlers.CLOSE_WORKBOOK,
  PRINT: UIHandlers.PRINT,
  // File menu leaves (issue #115)
  EXPORT_AS_XLSX: UIHandlers.EXPORT_AS_XLSX,
  EXPORT_AS_CSV: UIHandlers.EXPORT_AS_CSV,
  EXPORT_AS_PDF: UIHandlers.EXPORT_AS_PDF,
  BROWSE_FILES: UIHandlers.BROWSE_FILES,
  OPEN_RECENT_FILE: UIHandlers.OPEN_RECENT_FILE,
  SHARE_DOCUMENT: UIHandlers.SHARE_DOCUMENT,
  CLOSE_FILE: UIHandlers.CLOSE_FILE,
  // Find operations
  FIND_NEXT: UIHandlers.FIND_NEXT,
  FIND_PREVIOUS: UIHandlers.FIND_PREVIOUS,
  // Calculation
  CALCULATE_ALL: UIHandlers.CALCULATE_ALL,
  CALCULATE_ALL_FORCE: notImplemented,
  CALCULATE_REBUILD_DEPENDENCIES: notImplemented,
  CALCULATE_SHEET: UIHandlers.CALCULATE_SHEET,
  SET_CALCULATION_MODE: FormulasHandlers.SET_CALCULATION_MODE,
  CREATE_NAMES_FROM_SELECTION: UIHandlers.CREATE_NAMES_FROM_SELECTION,
  CREATE_NAMES_EXECUTE: UIHandlers.CREATE_NAMES_EXECUTE,
  // Data Refresh
  REFRESH_ALL_DATA: UIHandlers.REFRESH_ALL_DATA,
  REFRESH_CONNECTION: UIHandlers.REFRESH_CONNECTION,
  // Formula Auditing
  TRACE_PRECEDENTS: UIHandlers.TRACE_PRECEDENTS,
  TRACE_DEPENDENTS: UIHandlers.TRACE_DEPENDENTS,
  REMOVE_TRACE_ARROWS: UIHandlers.REMOVE_TRACE_ARROWS,
  REMOVE_PRECEDENT_ARROWS: UIHandlers.REMOVE_PRECEDENT_ARROWS,
  REMOVE_DEPENDENT_ARROWS: UIHandlers.REMOVE_DEPENDENT_ARROWS,

  // Validation Circles (F1: Circle Invalid Data)
  SHOW_VALIDATION_CIRCLES: UIHandlers.SHOW_VALIDATION_CIRCLES,
  HIDE_VALIDATION_CIRCLES: UIHandlers.HIDE_VALIDATION_CIRCLES,
  TOGGLE_VALIDATION_CIRCLES: UIHandlers.TOGGLE_VALIDATION_CIRCLES,

  // Sparkline Dialog (Insert → Sparklines menu)
  OPEN_SPARKLINE_DIALOG: UIHandlers.OPEN_SPARKLINE_DIALOG,

  // Data Validation Dialog
  OPEN_DV_DIALOG: UIHandlers.OPEN_DV_DIALOG,
  CLOSE_DV_DIALOG: UIHandlers.CLOSE_DV_DIALOG,

  // Pivot Table Dialog
  OPEN_PIVOT_DIALOG: UIHandlers.OPEN_PIVOT_DIALOG,

  // Data Tab Dialogs (Architecture Alignment)
  OPEN_SUBTOTAL_DIALOG: UIHandlers.OPEN_SUBTOTAL_DIALOG,
  OPEN_SCHEMA_BROWSER: UIHandlers.OPEN_SCHEMA_BROWSER,
  OPEN_WORKBOOK_LINKS_PANEL: UIHandlers.OPEN_WORKBOOK_LINKS_PANEL,
  OPEN_REMOVE_DUPLICATES_DIALOG: UIHandlers.OPEN_REMOVE_DUPLICATES_DIALOG,
  OPEN_TEXT_TO_COLUMNS_DIALOG: UIHandlers.OPEN_TEXT_TO_COLUMNS_DIALOG,

  // Settings Dialogs (Architecture Alignment)
  OPEN_SPREAD_SETTINGS_DIALOG: UIHandlers.OPEN_SPREAD_SETTINGS_DIALOG,
  OPEN_SHEET_SETTINGS_DIALOG: UIHandlers.OPEN_SHEET_SETTINGS_DIALOG,

  // Conditional Formatting Quick Rule Dialog (Architecture Alignment)
  OPEN_QUICK_RULE_DIALOG: UIHandlers.OPEN_QUICK_RULE_DIALOG,

  // Recent Colors (Recent Colors)
  TRACK_RECENT_COLOR: UIHandlers.TRACK_RECENT_COLOR,

  // More Colors Dialog
  OPEN_MORE_COLORS_DIALOG: UIHandlers.OPEN_MORE_COLORS_DIALOG,
  CLOSE_MORE_COLORS_DIALOG: UIHandlers.CLOSE_MORE_COLORS_DIALOG,
  APPLY_MORE_COLORS_FILL: UIHandlers.APPLY_MORE_COLORS_FILL,
  APPLY_MORE_COLORS_FONT: UIHandlers.APPLY_MORE_COLORS_FONT,
  APPLY_MORE_COLORS_BORDER: UIHandlers.APPLY_MORE_COLORS_BORDER,

  // Help
  OPEN_HELP: UIHandlers.OPEN_HELP,

  // Keyboard Shortcuts Dialog
  OPEN_KEYBOARD_SHORTCUTS_DIALOG: UIHandlers.OPEN_KEYBOARD_SHORTCUTS_DIALOG,
  CLOSE_KEYBOARD_SHORTCUTS_DIALOG: UIHandlers.CLOSE_KEYBOARD_SHORTCUTS_DIALOG,

  // Quick Analysis Menu
  OPEN_QUICK_ANALYSIS: UIHandlers.OPEN_QUICK_ANALYSIS,

  // Proofing Group
  OPEN_THESAURUS_DIALOG: UIHandlers.OPEN_THESAURUS_DIALOG,
  CLOSE_THESAURUS_DIALOG: UIHandlers.CLOSE_THESAURUS_DIALOG,
  THESAURUS_INSERT_WORD: UIHandlers.THESAURUS_INSERT_WORD,
  SHOW_WORKBOOK_STATISTICS: UIHandlers.SHOW_WORKBOOK_STATISTICS,
  CHECK_ACCESSIBILITY: UIHandlers.CHECK_ACCESSIBILITY,
  CLOSE_ACCESSIBILITY_PANEL: UIHandlers.CLOSE_ACCESSIBILITY_PANEL,
  NAVIGATE_TO_ACCESSIBILITY_ISSUE: UIHandlers.NAVIGATE_TO_ACCESSIBILITY_ISSUE,

  // Macro Recording
  TOGGLE_MACRO_RECORDING: UIHandlers.TOGGLE_MACRO_RECORDING,
  STOP_MACRO_RECORDING: UIHandlers.STOP_MACRO_RECORDING,

  // Range Selection Mode
  START_RANGE_SELECTION_MODE: UIHandlers.START_RANGE_SELECTION_MODE,
  UPDATE_RANGE_SELECTION: UIHandlers.UPDATE_RANGE_SELECTION,
  COMPLETE_RANGE_SELECTION: UIHandlers.COMPLETE_RANGE_SELECTION,
  CANCEL_RANGE_SELECTION: UIHandlers.CANCEL_RANGE_SELECTION,

  // Accessibility
  READ_ACTIVE_CELL: notImplemented,
  OPEN_ACCESSIBILITY_GUIDE: notImplemented,
  ANNOUNCE_CELL_FORMAT: UIHandlers.ANNOUNCE_CELL_FORMAT,

  // Row/Column Resize Dialogs
  OPEN_ROW_HEIGHT_DIALOG: UIHandlers.OPEN_ROW_HEIGHT_DIALOG,
  CLOSE_ROW_HEIGHT_DIALOG: UIHandlers.CLOSE_ROW_HEIGHT_DIALOG,
  OPEN_COLUMN_WIDTH_DIALOG: UIHandlers.OPEN_COLUMN_WIDTH_DIALOG,
  CLOSE_COLUMN_WIDTH_DIALOG: UIHandlers.CLOSE_COLUMN_WIDTH_DIALOG,

  // Error and Array Formula Context Menu Actions
  TRACE_ERROR: UIHandlers.TRACE_ERROR,
  IGNORE_ERROR: UIHandlers.IGNORE_ERROR,
  SELECT_ARRAY: UIHandlers.SELECT_ARRAY,

  // ===========================================================================
  // Workbook Actions ✅
  // ===========================================================================
  // Sheet navigation
  PREVIOUS_SHEET: WorkbookHandlers.PREVIOUS_SHEET,
  NEXT_SHEET: WorkbookHandlers.NEXT_SHEET,
  INSERT_SHEET: WorkbookHandlers.INSERT_SHEET,
  DELETE_SHEET: WorkbookHandlers.DELETE_SHEET,
  // Delete-sheet confirmation flow
  OPEN_DELETE_SHEET_CONFIRM_DIALOG: SheetHandlers.OPEN_DELETE_SHEET_CONFIRM_DIALOG,
  CLOSE_DELETE_SHEET_CONFIRM_DIALOG: SheetHandlers.CLOSE_DELETE_SHEET_CONFIRM_DIALOG,
  CONFIRM_DELETE_SHEET: SheetHandlers.CONFIRM_DELETE_SHEET,
  // Sheet operations (Excel Parity Quickwin B3)
  MOVE_SHEET: SheetHandlers.MOVE_SHEET,
  COPY_SHEET_TO_POSITION: SheetHandlers.COPY_SHEET_TO_POSITION,
  // Protection dialogs
  OPEN_PROTECT_SHEET_DIALOG: SheetHandlers.OPEN_PROTECT_SHEET_DIALOG,
  CLOSE_PROTECT_SHEET_DIALOG: SheetHandlers.CLOSE_PROTECT_SHEET_DIALOG,
  OPEN_UNPROTECT_SHEET_DIALOG: SheetHandlers.OPEN_UNPROTECT_SHEET_DIALOG,
  CLOSE_UNPROTECT_SHEET_DIALOG: SheetHandlers.CLOSE_UNPROTECT_SHEET_DIALOG,
  PROTECT_SHEET: SheetHandlers.PROTECT_SHEET,
  UNPROTECT_SHEET: SheetHandlers.UNPROTECT_SHEET,
  TOGGLE_SHEET_PROTECTION: SheetHandlers.TOGGLE_SHEET_PROTECTION,
  OPEN_PROTECT_WORKBOOK_DIALOG: SheetHandlers.OPEN_PROTECT_WORKBOOK_DIALOG,
  CLOSE_PROTECT_WORKBOOK_DIALOG: SheetHandlers.CLOSE_PROTECT_WORKBOOK_DIALOG,
  PROTECT_WORKBOOK: SheetHandlers.PROTECT_WORKBOOK,
  UNPROTECT_WORKBOOK: SheetHandlers.UNPROTECT_WORKBOOK,
  SELECT_ALL_SHEETS: SheetHandlers.SELECT_ALL_SHEETS,
  // Save As
  SAVE_AS: notImplemented,
  // Grouping operations
  GROUP: WorkbookHandlers.GROUP,
  UNGROUP: WorkbookHandlers.UNGROUP,
  SHOW_DETAIL: WorkbookHandlers.SHOW_DETAIL,
  HIDE_DETAIL: WorkbookHandlers.HIDE_DETAIL,

  // ===========================================================================
  // Object Actions ✅
  // ===========================================================================
  // Object deletion/selection
  DELETE_OBJECT: ObjectHandlers.DELETE_OBJECT,
  DESELECT_OBJECT: ObjectHandlers.DESELECT_OBJECT,
  // Standard nudge (grid snapping)
  NUDGE_OBJECT_UP: ObjectHandlers.NUDGE_OBJECT_UP,
  NUDGE_OBJECT_DOWN: ObjectHandlers.NUDGE_OBJECT_DOWN,
  NUDGE_OBJECT_LEFT: ObjectHandlers.NUDGE_OBJECT_LEFT,
  NUDGE_OBJECT_RIGHT: ObjectHandlers.NUDGE_OBJECT_RIGHT,
  // Fine nudge (pixel movement)
  NUDGE_OBJECT_UP_FINE: ObjectHandlers.NUDGE_OBJECT_UP_FINE,
  NUDGE_OBJECT_DOWN_FINE: ObjectHandlers.NUDGE_OBJECT_DOWN_FINE,
  NUDGE_OBJECT_LEFT_FINE: ObjectHandlers.NUDGE_OBJECT_LEFT_FINE,
  NUDGE_OBJECT_RIGHT_FINE: ObjectHandlers.NUDGE_OBJECT_RIGHT_FINE,
  // Duplication
  DUPLICATE_OBJECT: ObjectHandlers.DUPLICATE_OBJECT,
  // Picture dialog actions (Excel Parity Quickwin B2)
  OPEN_FORMAT_PICTURE_DIALOG: ObjectHandlers.OPEN_FORMAT_PICTURE_DIALOG,
  CLOSE_FORMAT_PICTURE_DIALOG: ObjectHandlers.CLOSE_FORMAT_PICTURE_DIALOG,
  OPEN_EDIT_ALT_TEXT_DIALOG: ObjectHandlers.OPEN_EDIT_ALT_TEXT_DIALOG,
  CLOSE_EDIT_ALT_TEXT_DIALOG: ObjectHandlers.CLOSE_EDIT_ALT_TEXT_DIALOG,
  SAVE_PICTURE_AS_FILE: ObjectHandlers.SAVE_PICTURE_AS_FILE,
  INSERT_PICTURE: ObjectHandlers.INSERT_PICTURE,
  UPDATE_PICTURE: ObjectHandlers.UPDATE_PICTURE,
  INSERT_ICON: ObjectHandlers.INSERT_ICON,
  INSERT_3D_MODEL: ObjectHandlers.INSERT_3D_MODEL,
  // Change/Reset Picture
  CHANGE_PICTURE: ObjectHandlers.CHANGE_PICTURE,
  RESET_PICTURE: ObjectHandlers.RESET_PICTURE,
  // Shape-specific actions
  INSERT_SHAPE: ObjectHandlers.INSERT_SHAPE,
  START_SHAPE_INSERT: ObjectHandlers.START_SHAPE_INSERT,
  INSERT_TEXTBOX: ObjectHandlers.INSERT_TEXTBOX,
  INSERT_FORM_CONTROL_CHECKBOX: ObjectHandlers.INSERT_FORM_CONTROL_CHECKBOX,
  INSERT_FORM_CONTROL_COMBOBOX: ObjectHandlers.INSERT_FORM_CONTROL_COMBOBOX,
  FLIP_SHAPE_HORIZONTAL: ObjectHandlers.FLIP_SHAPE_HORIZONTAL,
  FLIP_SHAPE_VERTICAL: ObjectHandlers.FLIP_SHAPE_VERTICAL,
  SET_SHAPE_FILL: ObjectHandlers.SET_SHAPE_FILL,
  SET_SHAPE_OUTLINE: ObjectHandlers.SET_SHAPE_OUTLINE,
  SET_SHAPE_TEXT: ObjectHandlers.SET_SHAPE_TEXT,
  SET_SHAPE_SHADOW: ObjectHandlers.SET_SHAPE_SHADOW,
  COPY_SHAPE: ObjectHandlers.COPY_SHAPE,
  CUT_SHAPE: ObjectHandlers.CUT_SHAPE,
  PASTE_SHAPE: ObjectHandlers.PASTE_SHAPE,
  // Arrange group actions
  BRING_OBJECT_TO_FRONT: ObjectHandlers.BRING_OBJECT_TO_FRONT,
  BRING_OBJECT_FORWARD: ObjectHandlers.BRING_OBJECT_FORWARD,
  SEND_OBJECT_TO_BACK: ObjectHandlers.SEND_OBJECT_TO_BACK,
  SEND_OBJECT_BACKWARD: ObjectHandlers.SEND_OBJECT_BACKWARD,
  ALIGN_OBJECTS_LEFT: ObjectHandlers.ALIGN_OBJECTS_LEFT,
  ALIGN_OBJECTS_CENTER: ObjectHandlers.ALIGN_OBJECTS_CENTER,
  ALIGN_OBJECTS_RIGHT: ObjectHandlers.ALIGN_OBJECTS_RIGHT,
  ALIGN_OBJECTS_TOP: ObjectHandlers.ALIGN_OBJECTS_TOP,
  ALIGN_OBJECTS_MIDDLE: ObjectHandlers.ALIGN_OBJECTS_MIDDLE,
  ALIGN_OBJECTS_BOTTOM: ObjectHandlers.ALIGN_OBJECTS_BOTTOM,
  GROUP_OBJECTS: ObjectHandlers.GROUP_OBJECTS,
  UNGROUP_OBJECTS: ObjectHandlers.UNGROUP_OBJECTS,
  ROTATE_OBJECT_RIGHT_90: ObjectHandlers.ROTATE_OBJECT_RIGHT_90,
  ROTATE_OBJECT_LEFT_90: ObjectHandlers.ROTATE_OBJECT_LEFT_90,
  FLIP_OBJECT_VERTICAL: ObjectHandlers.FLIP_OBJECT_VERTICAL,
  FLIP_OBJECT_HORIZONTAL: ObjectHandlers.FLIP_OBJECT_HORIZONTAL,

  // ===========================================================================
  // Comment Actions ✅
  // ===========================================================================
  INSERT_COMMENT: CommentHandlers.INSERT_COMMENT,
  EDIT_COMMENT: CommentHandlers.EDIT_COMMENT,
  DELETE_COMMENT: CommentHandlers.DELETE_COMMENT,
  SHOW_HIDE_COMMENTS: CommentHandlers.SHOW_HIDE_COMMENTS,
  NEXT_COMMENT: CommentHandlers.NEXT_COMMENT,
  PREVIOUS_COMMENT: CommentHandlers.PREVIOUS_COMMENT,
  TOGGLE_SHOW_ALL_COMMENTS: CommentHandlers.TOGGLE_SHOW_ALL_COMMENTS,

  // ===========================================================================
  // Format Painter Actions ✅
  // ===========================================================================
  START_FORMAT_PAINTER: FormatPainterHandlers.START_FORMAT_PAINTER,
  STOP_FORMAT_PAINTER: FormatPainterHandlers.STOP_FORMAT_PAINTER,
  LOCK_FORMAT_PAINTER: FormatPainterHandlers.LOCK_FORMAT_PAINTER,
  APPLY_FORMAT_PAINTER: FormatPainterHandlers.APPLY_FORMAT_PAINTER,
  // Insert ribbon dispatch: ribbon-tier toggle + double-click variants
  TOGGLE_FORMAT_PAINTER: FormatPainterHandlers.TOGGLE_FORMAT_PAINTER,
  TOGGLE_FORMAT_PAINTER_LOCKED: FormatPainterHandlers.TOGGLE_FORMAT_PAINTER_LOCKED,

  // Context Menu Filter Actions
  FILTER_BY_SELECTED_VALUE: FilterHandlers.FILTER_BY_SELECTED_VALUE,
  FILTER_BY_COLOR: FilterHandlers.FILTER_BY_COLOR,
  FILTER_BY_FONT_COLOR: FilterHandlers.FILTER_BY_FONT_COLOR,
  CLEAR_FILTER: FilterHandlers.CLEAR_FILTER,
  // Advanced Filter Dialog
  OPEN_ADVANCED_FILTER_DIALOG: FilterHandlers.OPEN_ADVANCED_FILTER_DIALOG,
  CLOSE_ADVANCED_FILTER_DIALOG: FilterHandlers.CLOSE_ADVANCED_FILTER_DIALOG,
  APPLY_ADVANCED_FILTER: FilterHandlers.APPLY_ADVANCED_FILTER,
  // Sort & Filter group actions
  CLEAR_ALL_FILTERS: FilterHandlers.CLEAR_ALL_FILTERS,
  REAPPLY_FILTERS: FilterHandlers.REAPPLY_FILTERS,

  // ===========================================================================
  // Navigation Actions (Excel Parity Quickwins E1/E4 +) ✅
  // ===========================================================================
  FOCUS_NEXT_PANE: NavigationHandlers.FOCUS_NEXT_PANE,
  FOCUS_PREVIOUS_PANE: NavigationHandlers.FOCUS_PREVIOUS_PANE,
  SCROLL_TO_ACTIVE_CELL: NavigationHandlers.SCROLL_TO_ACTIVE_CELL,
  // Context Menu - Open Hyperlink
  OPEN_HYPERLINK: NavigationHandlers.OPEN_HYPERLINK,
  // End Mode Navigation
  TOGGLE_END_MODE: NavigationHandlers.TOGGLE_END_MODE,
  // Search box
  OPEN_SEARCH_BOX: notImplemented,

  // ===========================================================================
  // AutoFill Options Actions (AutoFill Options Button)
  // ===========================================================================
  SHOW_AUTOFILL_OPTIONS: FillHandlers.SHOW_AUTOFILL_OPTIONS,
  HIDE_AUTOFILL_OPTIONS: FillHandlers.HIDE_AUTOFILL_OPTIONS,
  APPLY_AUTOFILL_OPTION: FillHandlers.APPLY_AUTOFILL_OPTION,

  // ===========================================================================
  // Fill Context Menu Actions (Right-Click Drag Fill)
  // ===========================================================================
  SHOW_FILL_CONTEXT_MENU: FillHandlers.SHOW_FILL_CONTEXT_MENU,
  HIDE_FILL_CONTEXT_MENU: FillHandlers.HIDE_FILL_CONTEXT_MENU,
  EXECUTE_FILL_COPY_CELLS: FillHandlers.EXECUTE_FILL_COPY_CELLS,
  // Note: EXECUTE_FILL_SERIES is already registered above for Fill Series Dialog.
  // The context menu's "Fill Series" option also dispatches EXECUTE_FILL_SERIES,
  // which will use the same handler. However, the handler checks for pendingOptions
  // from fillSeriesDialog, so context menu should use EXECUTE_FILL_SERIES_CONTEXT.
  EXECUTE_FILL_SERIES_CONTEXT_MENU: FillHandlers.EXECUTE_FILL_SERIES_CONTEXT,
  EXECUTE_FILL_FORMATTING_ONLY: FillHandlers.EXECUTE_FILL_FORMATTING_ONLY,
  EXECUTE_FILL_WITHOUT_FORMATTING: FillHandlers.EXECUTE_FILL_WITHOUT_FORMATTING,
  EXECUTE_FILL_DAYS: FillHandlers.EXECUTE_FILL_DAYS,
  EXECUTE_FILL_WEEKDAYS: FillHandlers.EXECUTE_FILL_WEEKDAYS,
  EXECUTE_FILL_MONTHS: FillHandlers.EXECUTE_FILL_MONTHS,
  EXECUTE_FILL_YEARS: FillHandlers.EXECUTE_FILL_YEARS,
  EXECUTE_FILL_LINEAR_TREND: FillHandlers.EXECUTE_FILL_LINEAR_TREND,
  EXECUTE_FILL_GROWTH_TREND: FillHandlers.EXECUTE_FILL_GROWTH_TREND,

  // ===========================================================================
  // Repeat Last Action (F4 Repeat Last Action)
  // ===========================================================================
  REPEAT_LAST_ACTION: RepeatHandlers.REPEAT_LAST_ACTION,

  // ===========================================================================
  // Chart Actions (Charts)
  // ===========================================================================
  EDIT_CHART: ChartHandlers.EDIT_CHART,
  EDIT_CHART_TITLE: ChartHandlers.EDIT_CHART_TITLE,
  CHANGE_CHART_TYPE: ChartHandlers.CHANGE_CHART_TYPE,
  DUPLICATE_CHART: ChartHandlers.DUPLICATE_CHART,
  SAVE_CHART_AS_IMAGE: ChartHandlers.SAVE_CHART_AS_IMAGE,
  DELETE_CHART: ChartHandlers.DELETE_CHART,
  // Select Data Dialog
  OPEN_SELECT_DATA_DIALOG: ChartHandlers.OPEN_SELECT_DATA_DIALOG,
  CLOSE_SELECT_DATA_DIALOG: ChartHandlers.CLOSE_SELECT_DATA_DIALOG,
  APPLY_SELECT_DATA: ChartHandlers.APPLY_SELECT_DATA,
  // 13.9: Multi-Select Charts
  SELECT_CHART: ChartHandlers.SELECT_CHART,
  DESELECT_CHART: ChartHandlers.DESELECT_CHART,
  DESELECT_ALL_CHARTS: ChartHandlers.DESELECT_ALL_CHARTS,
  ADD_CHART_TO_SELECTION: ChartHandlers.ADD_CHART_TO_SELECTION,
  TOGGLE_CHART_SELECTION: ChartHandlers.TOGGLE_CHART_SELECTION,
  // 13.3: Z-Order Commands
  BRING_CHART_TO_FRONT: ChartHandlers.BRING_CHART_TO_FRONT,
  SEND_CHART_TO_BACK: ChartHandlers.SEND_CHART_TO_BACK,
  BRING_CHART_FORWARD: ChartHandlers.BRING_CHART_FORWARD,
  SEND_CHART_BACKWARD: ChartHandlers.SEND_CHART_BACKWARD,
  // 13.4: Chart Copy/Paste
  COPY_CHART: ChartHandlers.COPY_CHART,
  CUT_CHART: ChartHandlers.CUT_CHART,
  PASTE_CHART: ChartHandlers.PASTE_CHART,
  // Chart Navigation (Tab cycling)
  CYCLE_NEXT_CHART: ChartHandlers.CYCLE_NEXT_CHART,
  CYCLE_PREVIOUS_CHART: ChartHandlers.CYCLE_PREVIOUS_CHART,
  // Chart Creation (F11/Alt+F1)
  CREATE_CHART_SHEET: ChartHandlers.CREATE_CHART_SHEET,
  CREATE_EMBEDDED_CHART: ChartHandlers.CREATE_EMBEDDED_CHART,
  // Insert Chart Wizard Dialog
  OPEN_INSERT_CHART_WIZARD_DIALOG: ChartHandlers.OPEN_INSERT_CHART_WIZARD_DIALOG,
  CLOSE_INSERT_CHART_WIZARD_DIALOG: ChartHandlers.CLOSE_INSERT_CHART_WIZARD_DIALOG,
  INSERT_CHART_FROM_WIZARD: ChartHandlers.INSERT_CHART_FROM_WIZARD,
  // Nudge Chart Position (Arrow Keys)
  NUDGE_CHART_UP: ChartHandlers.NUDGE_CHART_UP,
  NUDGE_CHART_DOWN: ChartHandlers.NUDGE_CHART_DOWN,
  NUDGE_CHART_LEFT: ChartHandlers.NUDGE_CHART_LEFT,
  NUDGE_CHART_RIGHT: ChartHandlers.NUDGE_CHART_RIGHT,
  // Chart Context Menu Enhancements
  RESET_CHART_STYLE: ChartHandlers.RESET_CHART_STYLE,
  OPEN_MOVE_CHART_DIALOG: ChartHandlers.OPEN_MOVE_CHART_DIALOG,
  OPEN_FORMAT_CHART_AREA: ChartHandlers.OPEN_FORMAT_CHART_AREA,
  // Element-Specific Chart Context Menu
  OPEN_FORMAT_PLOT_AREA: ChartHandlers.OPEN_FORMAT_PLOT_AREA,
  OPEN_FORMAT_DATA_SERIES: ChartHandlers.OPEN_FORMAT_DATA_SERIES,
  ADD_DATA_LABELS: ChartHandlers.ADD_DATA_LABELS,
  ADD_TRENDLINE: ChartHandlers.ADD_TRENDLINE,
  OPEN_FORMAT_AXIS: ChartHandlers.OPEN_FORMAT_AXIS,
  TOGGLE_GRIDLINES: ChartHandlers.TOGGLE_GRIDLINES,
  OPEN_FORMAT_LEGEND: ChartHandlers.OPEN_FORMAT_LEGEND,
  OPEN_FORMAT_CHART_TITLE: ChartHandlers.OPEN_FORMAT_CHART_TITLE,
  // Chart UI Slice Actions
  SHOW_CHART_TOOLTIP: ChartHandlers.SHOW_CHART_TOOLTIP,
  HIDE_CHART_TOOLTIP: ChartHandlers.HIDE_CHART_TOOLTIP,
  SET_CHART_ERROR: ChartHandlers.SET_CHART_ERROR,
  CLEAR_CHART_ERROR: ChartHandlers.CLEAR_CHART_ERROR,
  CLEAR_ALL_CHART_ERRORS: ChartHandlers.CLEAR_ALL_CHART_ERRORS,
  SET_CHART_EDITOR_TAB: ChartHandlers.SET_CHART_EDITOR_TAB,
  // Chart Canvas Rendering - Title Editor
  OPEN_CHART_TITLE_EDITOR: ChartHandlers.OPEN_CHART_TITLE_EDITOR,
  CLOSE_CHART_TITLE_EDITOR: ChartHandlers.CLOSE_CHART_TITLE_EDITOR,

  // ===========================================================================
  // Conditional Formatting Actions
  // ===========================================================================
  // Rule CRUD
  CREATE_CF_RULE: ConditionalFormattingHandlers.CREATE_CF_RULE,
  UPDATE_CF_RULE: ConditionalFormattingHandlers.UPDATE_CF_RULE,
  DELETE_CF_RULE: ConditionalFormattingHandlers.DELETE_CF_RULE,
  REORDER_CF_RULES: ConditionalFormattingHandlers.REORDER_CF_RULES,
  // Dialog actions
  OPEN_CF_RULES_MANAGER: ConditionalFormattingHandlers.OPEN_CF_RULES_MANAGER,
  CLOSE_CF_RULES_MANAGER: ConditionalFormattingHandlers.CLOSE_CF_RULES_MANAGER,
  OPEN_CF_DIALOG: ConditionalFormattingHandlers.OPEN_CF_DIALOG,
  CLOSE_CF_DIALOG: ConditionalFormattingHandlers.CLOSE_CF_DIALOG,
  // CF menu (keyboard shortcut)
  OPEN_CF_MENU: ConditionalFormattingHandlers.OPEN_CF_MENU,

  // ===========================================================================
  // Total Row Actions (Total Row Function Dropdown)
  // ===========================================================================
  OPEN_TOTAL_ROW_DROPDOWN: TotalRowHandlers.OPEN_TOTAL_ROW_DROPDOWN,
  CLOSE_TOTAL_ROW_DROPDOWN: TotalRowHandlers.CLOSE_TOTAL_ROW_DROPDOWN,
  SET_TOTAL_ROW_FUNCTION: TotalRowHandlers.SET_TOTAL_ROW_FUNCTION,

  // ===========================================================================
  // Drag-Drop Actions
  // ===========================================================================
  SHOW_DRAG_DROP_OVERWRITE_DIALOG: DragDropHandlers.SHOW_DRAG_DROP_OVERWRITE_DIALOG,
  CONFIRM_DRAG_DROP_OVERWRITE: DragDropHandlers.CONFIRM_DRAG_DROP_OVERWRITE,
  CANCEL_DRAG_DROP_OVERWRITE: DragDropHandlers.CANCEL_DRAG_DROP_OVERWRITE,

  // ===========================================================================
  // Flash Fill Actions (Ctrl+E)
  // ===========================================================================
  FLASH_FILL: FillHandlers.FLASH_FILL,
  SHOW_FLASH_FILL_PREVIEW: FillHandlers.SHOW_FLASH_FILL_PREVIEW,
  ACCEPT_FLASH_FILL: FillHandlers.ACCEPT_FLASH_FILL,
  REJECT_FLASH_FILL: FillHandlers.REJECT_FLASH_FILL,

  // ===========================================================================
  // Custom Lists Actions
  // ===========================================================================
  OPEN_CUSTOM_LISTS_DIALOG: FillHandlers.OPEN_CUSTOM_LISTS_DIALOG,
  CLOSE_CUSTOM_LISTS_DIALOG: FillHandlers.CLOSE_CUSTOM_LISTS_DIALOG,
  ADD_CUSTOM_LIST: FillHandlers.ADD_CUSTOM_LIST,
  EDIT_CUSTOM_LIST: FillHandlers.EDIT_CUSTOM_LIST,
  DELETE_CUSTOM_LIST: FillHandlers.DELETE_CUSTOM_LIST,

  // ===========================================================================
  // Table Actions
  // ===========================================================================
  // Table operations
  REMOVE_DUPLICATES: TableHandlers.REMOVE_DUPLICATES,
  CONVERT_TO_RANGE: TableHandlers.CONVERT_TO_RANGE,
  TOGGLE_FILTER_BUTTONS: TableHandlers.TOGGLE_FILTER_BUTTONS,
  INSERT_TABLE_ROW_ABOVE: TableHandlers.INSERT_TABLE_ROW_ABOVE,
  INSERT_TABLE_ROW_BELOW: TableHandlers.INSERT_TABLE_ROW_BELOW,
  INSERT_TABLE_COLUMN_LEFT: TableHandlers.INSERT_TABLE_COLUMN_LEFT,
  INSERT_TABLE_COLUMN_RIGHT: TableHandlers.INSERT_TABLE_COLUMN_RIGHT,
  // Table row/column deletion
  DELETE_TABLE_ROWS: TableHandlers.DELETE_TABLE_ROWS,
  DELETE_TABLE_COLUMNS: TableHandlers.DELETE_TABLE_COLUMNS,
  // Custom table style operations
  CREATE_CUSTOM_TABLE_STYLE: TableHandlers.CREATE_CUSTOM_TABLE_STYLE,
  MODIFY_TABLE_STYLE: TableHandlers.MODIFY_TABLE_STYLE,
  DUPLICATE_TABLE_STYLE: TableHandlers.DUPLICATE_TABLE_STYLE,
  DELETE_CUSTOM_TABLE_STYLE: TableHandlers.DELETE_CUSTOM_TABLE_STYLE,
  RESIZE_TABLE: TableHandlers.RESIZE_TABLE,
  // Dialog actions
  CLOSE_REMOVE_DUPLICATES_DIALOG: TableHandlers.CLOSE_REMOVE_DUPLICATES_DIALOG,
  OPEN_CUSTOM_TABLE_STYLE_DIALOG: TableHandlers.OPEN_CUSTOM_TABLE_STYLE_DIALOG,
  CLOSE_CUSTOM_TABLE_STYLE_DIALOG: TableHandlers.CLOSE_CUSTOM_TABLE_STYLE_DIALOG,
  OPEN_RESIZE_TABLE_DIALOG: TableHandlers.OPEN_RESIZE_TABLE_DIALOG,
  CLOSE_RESIZE_TABLE_DIALOG: TableHandlers.CLOSE_RESIZE_TABLE_DIALOG,
  OPEN_CONVERT_TO_RANGE_DIALOG: TableHandlers.OPEN_CONVERT_TO_RANGE_DIALOG,
  CLOSE_CONVERT_TO_RANGE_DIALOG: TableHandlers.CLOSE_CONVERT_TO_RANGE_DIALOG,
  // Table Click Selection
  SELECT_TABLE_COLUMN: TableHandlers.SELECT_TABLE_COLUMN,
  SELECT_TABLE_ROW: TableHandlers.SELECT_TABLE_ROW,
  SELECT_TABLE_DATA: TableHandlers.SELECT_TABLE_DATA,
  SELECT_FULL_TABLE: TableHandlers.SELECT_FULL_TABLE,
  // Table toggle/delete operations (keytip-routed)
  DELETE_TABLE: TableHandlers.DELETE_TABLE,
  TOGGLE_TABLE_HEADER_ROW: TableHandlers.TOGGLE_TABLE_HEADER_ROW,
  TOGGLE_TABLE_TOTALS_ROW: TableHandlers.TOGGLE_TABLE_TOTALS_ROW,
  TOGGLE_TABLE_BANDED_ROWS: TableHandlers.TOGGLE_TABLE_BANDED_ROWS,
  // AutoCorrect Options
  TOGGLE_AUTO_CALCULATED_COLUMNS: TableHandlers.TOGGLE_AUTO_CALCULATED_COLUMNS,
  OVERWRITE_CALCULATED_COLUMN: TableHandlers.OVERWRITE_CALCULATED_COLUMN,
  TOGGLE_TABLE_AUTO_EXPAND: TableHandlers.TOGGLE_TABLE_AUTO_EXPAND,

  // ===========================================================================
  // Print/Export Actions
  // ===========================================================================
  EXPORT_PDF: PrintExportHandlers.EXPORT_PDF,
  TOGGLE_PAGE_BREAK_PREVIEW: PrintExportHandlers.TOGGLE_PAGE_BREAK_PREVIEW,
  SET_PRINT_AREA: PrintExportHandlers.SET_PRINT_AREA,
  CLEAR_PRINT_AREA: PrintExportHandlers.CLEAR_PRINT_AREA,
  ADD_TO_PRINT_AREA: PrintExportHandlers.ADD_TO_PRINT_AREA,
  RESET_PAGE_BREAKS: PrintExportHandlers.RESET_PAGE_BREAKS,
  // Page Layout dispatch: print-side sheet options
  TOGGLE_PRINT_GRIDLINES: PrintExportHandlers.TOGGLE_PRINT_GRIDLINES,
  TOGGLE_PRINT_HEADINGS: PrintExportHandlers.TOGGLE_PRINT_HEADINGS,
  // Backstage Print View
  SET_PRINT_SCOPE: PrintExportHandlers.SET_PRINT_SCOPE,
  SET_PRINT_PAGE_RANGE: PrintExportHandlers.SET_PRINT_PAGE_RANGE,
  // Quick Print
  QUICK_PRINT: PrintExportHandlers.QUICK_PRINT,

  // ===========================================================================
  // Slicer Actions
  // ===========================================================================
  // Insert (from Insert ribbon)
  OPEN_INSERT_SLICER_DIALOG: SlicerHandlers.OPEN_INSERT_SLICER_DIALOG,
  // Clipboard
  CUT_SLICER: SlicerHandlers.CUT_SLICER,
  COPY_SLICER: SlicerHandlers.COPY_SLICER,
  PASTE_SLICER: SlicerHandlers.PASTE_SLICER,
  // Settings/Properties
  OPEN_SLICER_SETTINGS: SlicerHandlers.OPEN_SLICER_SETTINGS,
  CLOSE_SLICER_SETTINGS: SlicerHandlers.CLOSE_SLICER_SETTINGS,
  OPEN_SLICER_REPORT_CONNECTIONS: SlicerHandlers.OPEN_SLICER_REPORT_CONNECTIONS,
  CLOSE_SLICER_REPORT_CONNECTIONS: SlicerHandlers.CLOSE_SLICER_REPORT_CONNECTIONS,
  // Slicer Connections Dialog
  OPEN_SLICER_CONNECTIONS: SlicerHandlers.OPEN_SLICER_CONNECTIONS,
  UPDATE_SLICER_CONNECTIONS: SlicerHandlers.UPDATE_SLICER_CONNECTIONS,
  CLOSE_SLICER_CONNECTIONS_DIALOG: SlicerHandlers.CLOSE_SLICER_CONNECTIONS_DIALOG,
  OPEN_SLICER_SIZE_PROPERTIES: SlicerHandlers.OPEN_SLICER_SIZE_PROPERTIES,
  CLOSE_SLICER_SIZE_PROPERTIES: SlicerHandlers.CLOSE_SLICER_SIZE_PROPERTIES,
  // Z-Order
  BRING_SLICER_TO_FRONT: SlicerHandlers.BRING_SLICER_TO_FRONT,
  SEND_SLICER_TO_BACK: SlicerHandlers.SEND_SLICER_TO_BACK,
  BRING_SLICER_FORWARD: SlicerHandlers.BRING_SLICER_FORWARD,
  SEND_SLICER_BACKWARD: SlicerHandlers.SEND_SLICER_BACKWARD,
  // Delete
  DELETE_SLICER: SlicerHandlers.DELETE_SLICER,

  // ===========================================================================
  // Split View Actions
  // ===========================================================================
  TOGGLE_SPLIT: SplitHandlers.TOGGLE_SPLIT,
  SET_SPLIT_POSITION: SplitHandlers.SET_SPLIT_POSITION,
  REMOVE_SPLIT: SplitHandlers.REMOVE_SPLIT,
  FOCUS_NEXT_SPLIT_VIEWPORT: SplitHandlers.FOCUS_NEXT_SPLIT_VIEWPORT,
  FOCUS_PREV_SPLIT_VIEWPORT: SplitHandlers.FOCUS_PREV_SPLIT_VIEWPORT,
  FREEZE_PANES: SplitHandlers.FREEZE_PANES,
  FREEZE_TOP_ROW: SplitHandlers.FREEZE_TOP_ROW,
  FREEZE_FIRST_COLUMN: SplitHandlers.FREEZE_FIRST_COLUMN,
  UNFREEZE_PANES: SplitHandlers.UNFREEZE_PANES,

  // ===========================================================================
  // Data Analysis Dialog Actions
  // ===========================================================================
  // Goal Seek Dialog
  OPEN_GOAL_SEEK_DIALOG: DataAnalysisHandlers.OPEN_GOAL_SEEK_DIALOG,
  CLOSE_GOAL_SEEK_DIALOG: DataAnalysisHandlers.CLOSE_GOAL_SEEK_DIALOG,
  EXECUTE_GOAL_SEEK: DataAnalysisHandlers.EXECUTE_GOAL_SEEK,
  APPLY_GOAL_SEEK_RESULT: DataAnalysisHandlers.APPLY_GOAL_SEEK_RESULT,
  CANCEL_GOAL_SEEK: DataAnalysisHandlers.CANCEL_GOAL_SEEK,
  OPEN_FORECAST_SHEET_DIALOG: DataAnalysisHandlers.OPEN_FORECAST_SHEET_DIALOG,
  // Consolidate Dialog
  OPEN_CONSOLIDATE_DIALOG: DataAnalysisHandlers.OPEN_CONSOLIDATE_DIALOG,
  CLOSE_CONSOLIDATE_DIALOG: DataAnalysisHandlers.CLOSE_CONSOLIDATE_DIALOG,
  EXECUTE_CONSOLIDATE: DataAnalysisHandlers.EXECUTE_CONSOLIDATE,
  // Spelling Dialog
  OPEN_SPELLING_DIALOG: DataAnalysisHandlers.OPEN_SPELLING_DIALOG,
  CLOSE_SPELLING_DIALOG: DataAnalysisHandlers.CLOSE_SPELLING_DIALOG,
  SPELL_CHECK_NEXT: DataAnalysisHandlers.SPELL_CHECK_NEXT,
  SPELL_CHECK_CHANGE: DataAnalysisHandlers.SPELL_CHECK_CHANGE,
  SPELL_CHECK_CHANGE_ALL: DataAnalysisHandlers.SPELL_CHECK_CHANGE_ALL,
  SPELL_CHECK_IGNORE: DataAnalysisHandlers.SPELL_CHECK_IGNORE,
  SPELL_CHECK_IGNORE_ALL: DataAnalysisHandlers.SPELL_CHECK_IGNORE_ALL,
  SPELL_CHECK_ADD_TO_DICTIONARY: DataAnalysisHandlers.SPELL_CHECK_ADD_TO_DICTIONARY,
  // Watch Window
  OPEN_WATCH_WINDOW: DataAnalysisHandlers.OPEN_WATCH_WINDOW,
  CLOSE_WATCH_WINDOW: DataAnalysisHandlers.CLOSE_WATCH_WINDOW,
  TOGGLE_WATCH_WINDOW: DataAnalysisHandlers.TOGGLE_WATCH_WINDOW,
  ADD_WATCH: DataAnalysisHandlers.ADD_WATCH,
  DELETE_WATCH: DataAnalysisHandlers.DELETE_WATCH,
  DELETE_ALL_WATCHES: DataAnalysisHandlers.DELETE_ALL_WATCHES,
  // Error Checking Dialog
  OPEN_ERROR_CHECKING_DIALOG: DataAnalysisHandlers.OPEN_ERROR_CHECKING_DIALOG,
  CLOSE_ERROR_CHECKING_DIALOG: DataAnalysisHandlers.CLOSE_ERROR_CHECKING_DIALOG,
  ERROR_CHECK_NEXT: DataAnalysisHandlers.ERROR_CHECK_NEXT,
  ERROR_CHECK_PREVIOUS: DataAnalysisHandlers.ERROR_CHECK_PREVIOUS,
  ERROR_CHECK_IGNORE: DataAnalysisHandlers.ERROR_CHECK_IGNORE,
  ERROR_CHECK_EDIT_IN_FORMULA_BAR: DataAnalysisHandlers.ERROR_CHECK_EDIT_IN_FORMULA_BAR,
  // Evaluate Formula Dialog
  OPEN_EVALUATE_FORMULA_DIALOG: DataAnalysisHandlers.OPEN_EVALUATE_FORMULA_DIALOG,
  CLOSE_EVALUATE_FORMULA_DIALOG: DataAnalysisHandlers.CLOSE_EVALUATE_FORMULA_DIALOG,
  EVALUATE_NEXT_STEP: DataAnalysisHandlers.EVALUATE_NEXT_STEP,
  EVALUATE_STEP_IN: DataAnalysisHandlers.EVALUATE_STEP_IN,
  EVALUATE_STEP_OUT: DataAnalysisHandlers.EVALUATE_STEP_OUT,
  EVALUATE_RESTART: DataAnalysisHandlers.EVALUATE_RESTART,
  // Data Table Dialog
  OPEN_DATA_TABLE_DIALOG: DataAnalysisHandlers.OPEN_DATA_TABLE_DIALOG,
  CLOSE_DATA_TABLE_DIALOG: DataAnalysisHandlers.CLOSE_DATA_TABLE_DIALOG,
  EXECUTE_DATA_TABLE: DataAnalysisHandlers.EXECUTE_DATA_TABLE,
  CANCEL_DATA_TABLE: DataAnalysisHandlers.CANCEL_DATA_TABLE,
  // Scenario Manager Dialog
  OPEN_SCENARIO_MANAGER_DIALOG: DataAnalysisHandlers.OPEN_SCENARIO_MANAGER_DIALOG,
  CLOSE_SCENARIO_MANAGER_DIALOG: DataAnalysisHandlers.CLOSE_SCENARIO_MANAGER_DIALOG,
  CREATE_SCENARIO: DataAnalysisHandlers.CREATE_SCENARIO,
  UPDATE_SCENARIO: DataAnalysisHandlers.UPDATE_SCENARIO,
  DELETE_SCENARIO: DataAnalysisHandlers.DELETE_SCENARIO,
  APPLY_SCENARIO: DataAnalysisHandlers.APPLY_SCENARIO,
  RESTORE_ORIGINAL_VALUES: DataAnalysisHandlers.RESTORE_ORIGINAL_VALUES,

  // ===========================================================================
  // Paste Validation Actions
  // ===========================================================================
  SHOW_PASTE_VALIDATION_SUMMARY: PasteValidationHandlers.SHOW_PASTE_VALIDATION_SUMMARY,
  CLOSE_PASTE_VALIDATION_SUMMARY: PasteValidationHandlers.CLOSE_PASTE_VALIDATION_SUMMARY,
  CONFIRM_PASTE_WITH_INVALID: PasteValidationHandlers.CONFIRM_PASTE_WITH_INVALID,
  REVERT_INVALID_PASTE: PasteValidationHandlers.REVERT_INVALID_PASTE,
  HIGHLIGHT_INVALID_CELLS: PasteValidationHandlers.HIGHLIGHT_INVALID_CELLS,

  // ===========================================================================
  // Ink Actions (Wave 5: Ink Actions & UI System)
  // ===========================================================================
  // Mode activation
  ACTIVATE_INK_MODE: InkHandlers.ACTIVATE_INK_MODE,
  DEACTIVATE_INK_MODE: InkHandlers.DEACTIVATE_INK_MODE,
  TOGGLE_INK_TOOL: InkHandlers.TOGGLE_INK_TOOL,
  TOGGLE_INK_MODE_DEFAULT: InkHandlers.TOGGLE_INK_MODE_DEFAULT,
  // Tool settings
  SET_INK_TOOL: InkHandlers.SET_INK_TOOL,
  SET_INK_COLOR: InkHandlers.SET_INK_COLOR,
  SET_INK_WIDTH: InkHandlers.SET_INK_WIDTH,
  SET_INK_OPACITY: InkHandlers.SET_INK_OPACITY,
  // Drawing operations
  CLEAR_DRAWING: InkHandlers.CLEAR_DRAWING,
  DELETE_SELECTED_STROKES: InkHandlers.DELETE_SELECTED_STROKES,
  SELECT_ALL_STROKES: InkHandlers.SELECT_ALL_STROKES,
  INSERT_DRAWING: InkHandlers.INSERT_DRAWING,
  // Selection
  TOGGLE_LASSO_SELECTION: InkHandlers.TOGGLE_LASSO_SELECTION,
  // Transform operations
  MOVE_SELECTED_STROKES: InkHandlers.MOVE_SELECTED_STROKES,
  TRANSFORM_SELECTED_STROKES: InkHandlers.TRANSFORM_SELECTED_STROKES,
  // Recognition
  RECOGNIZE_INK_AS_SHAPE: InkHandlers.RECOGNIZE_INK_AS_SHAPE,
  RECOGNIZE_INK_AS_TEXT: InkHandlers.RECOGNIZE_INK_AS_TEXT,

  // ===========================================================================
  // Diagram Actions (Excel Parity: Diagram Diagrams)
  // ===========================================================================
  // UI/Dialog actions
  OPEN_DIAGRAM_DIALOG: DiagramHandlers.OPEN_DIAGRAM_DIALOG,
  CLOSE_DIAGRAM_DIALOG: DiagramHandlers.CLOSE_DIAGRAM_DIALOG,
  DIAGRAM_SELECT_NODE: DiagramHandlers.DIAGRAM_SELECT_NODE,
  DIAGRAM_DESELECT_NODE: DiagramHandlers.DIAGRAM_DESELECT_NODE,
  TOGGLE_DIAGRAM_TEXT_PANE: DiagramHandlers.TOGGLE_DIAGRAM_TEXT_PANE,
  DIAGRAM_STOP_EDITING: DiagramHandlers.DIAGRAM_STOP_EDITING,
  // Lifecycle
  DIAGRAM_INSERT: DiagramHandlers.DIAGRAM_INSERT,
  DIAGRAM_DELETE: DiagramHandlers.DIAGRAM_DELETE,
  // Node operations
  DIAGRAM_ADD_NODE: DiagramHandlers.DIAGRAM_ADD_NODE,
  DIAGRAM_REMOVE_NODE: DiagramHandlers.DIAGRAM_REMOVE_NODE,
  DIAGRAM_UPDATE_NODE: DiagramHandlers.DIAGRAM_UPDATE_NODE,
  // Node hierarchy operations (promote/demote/move)
  DIAGRAM_PROMOTE_NODE: DiagramHandlers.DIAGRAM_PROMOTE_NODE,
  DIAGRAM_DEMOTE_NODE: DiagramHandlers.DIAGRAM_DEMOTE_NODE,
  DIAGRAM_MOVE_NODE_UP: DiagramHandlers.DIAGRAM_MOVE_NODE_UP,
  DIAGRAM_MOVE_NODE_DOWN: DiagramHandlers.DIAGRAM_MOVE_NODE_DOWN,
  // Style operations
  DIAGRAM_UPDATE_STYLE: DiagramHandlers.DIAGRAM_UPDATE_STYLE,
  DIAGRAM_UPDATE_LAYOUT: DiagramHandlers.DIAGRAM_UPDATE_LAYOUT,

  // ===========================================================================
  // TextEffect Actions (Excel Parity: TextEffect)
  // ===========================================================================
  // Lifecycle
  INSERT_TEXT_EFFECT: TextEffectHandlers.INSERT_TEXT_EFFECT,
  DELETE_TEXT_EFFECT: TextEffectHandlers.DELETE_TEXT_EFFECT,
  // Style operations
  UPDATE_TEXT_EFFECT_WARP: TextEffectHandlers.UPDATE_TEXT_EFFECT_WARP,
  UPDATE_TEXT_EFFECT_FILL: TextEffectHandlers.UPDATE_TEXT_EFFECT_FILL,
  UPDATE_TEXT_EFFECT_OUTLINE: TextEffectHandlers.UPDATE_TEXT_EFFECT_OUTLINE,
  UPDATE_TEXT_EFFECT_EFFECTS: TextEffectHandlers.UPDATE_TEXT_EFFECT_EFFECTS,
  UPDATE_TEXT_EFFECT_FORMAT: TextEffectHandlers.UPDATE_TEXT_EFFECT_FORMAT,
  // Text editing
  EDIT_TEXT_EFFECT_TEXT: TextEffectHandlers.EDIT_TEXT_EFFECT_TEXT,
  COMMIT_TEXT_EFFECT_TEXT: TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT,
  CANCEL_TEXT_EFFECT_EDIT: TextEffectHandlers.CANCEL_TEXT_EFFECT_EDIT,
  // Conversion
  CONVERT_TO_TEXT_EFFECT: TextEffectHandlers.CONVERT_TO_TEXT_EFFECT,
  CONVERT_TO_TEXTBOX: TextEffectHandlers.CONVERT_TO_TEXTBOX,
  // Gallery
  OPEN_TEXT_EFFECT_GALLERY: TextEffectHandlers.OPEN_TEXT_EFFECT_GALLERY,
  CLOSE_TEXT_EFFECT_GALLERY: TextEffectHandlers.CLOSE_TEXT_EFFECT_GALLERY,
  SET_TEXT_EFFECT_GALLERY_PRESET: TextEffectHandlers.SET_TEXT_EFFECT_GALLERY_PRESET,

  // ===========================================================================
  // Equation Actions (Excel Parity: Equation)
  // ===========================================================================
  INSERT_EQUATION: EquationHandlers.INSERT_EQUATION,
  EDIT_EQUATION: EquationHandlers.EDIT_EQUATION,
  UPDATE_EQUATION: EquationHandlers.UPDATE_EQUATION,
  DELETE_EQUATION: EquationHandlers.DELETE_EQUATION,
  OPEN_EQUATION_DIALOG: EquationHandlers.OPEN_EQUATION_DIALOG,
  CLOSE_EQUATION_DIALOG: EquationHandlers.CLOSE_EQUATION_DIALOG,

  // ===========================================================================
  // View Actions (Kanban, Gallery, Calendar, Timeline)
  // ===========================================================================
  // Kanban view
  KANBAN_MOVE_UP: notImplemented,
  KANBAN_MOVE_DOWN: notImplemented,
  KANBAN_MOVE_LEFT: notImplemented,
  KANBAN_MOVE_RIGHT: notImplemented,
  KANBAN_EDIT: notImplemented,
  KANBAN_DELETE: notImplemented,
  KANBAN_DESELECT: notImplemented,
  KANBAN_NEW_CARD: notImplemented,
  KANBAN_SELECT_ALL: notImplemented,
  // Gallery view
  GALLERY_MOVE_UP: notImplemented,
  GALLERY_MOVE_DOWN: notImplemented,
  GALLERY_MOVE_LEFT: notImplemented,
  GALLERY_MOVE_RIGHT: notImplemented,
  GALLERY_EDIT: notImplemented,
  GALLERY_DELETE: notImplemented,
  GALLERY_DESELECT: notImplemented,
  GALLERY_SELECT_ALL: notImplemented,
  // Calendar view
  CALENDAR_DELETE: notImplemented,
  CALENDAR_DESELECT: notImplemented,
  CALENDAR_SELECT_ALL: notImplemented,
  // Timeline view
  TIMELINE_DELETE: notImplemented,
  TIMELINE_DESELECT: notImplemented,
  TIMELINE_SELECT_ALL: notImplemented,
};

// =============================================================================
// Dispatch Function
// =============================================================================

/**
 * Dispatch an action to its handler.
 *
 * This is the single entry point for all action execution.
 * All input sources (keyboard, toolbar, context menu, AI) should use this function.
 *
 * @param action - The action type to dispatch
 * @param deps - Dependencies needed by handlers
 * @returns ActionResult indicating success/failure
 *
 * @example
 * ```typescript
 * import { dispatch } from './actions';
 *
 * // In toolbar button handler:
 * const result = dispatch('TOGGLE_BOLD', deps);
 *
 * // In keyboard handler:
 * const result = dispatch('MOVE_DOWN', deps);
 *
 * // In context menu handler:
 * const result = dispatch('CUT', deps);
 * ```
 */
export function dispatch(
  action: ActionType,
  deps: ActionDependencies,
  payload?: any,
): ActionResult | Promise<ActionResult> {
  // Safety net: block mutating actions in read-only mode.
  // This catches any UI paths missed by the primary gates (editor machine, keyboard, clipboard).
  // Agent mutations bypass dispatch() entirely (OSExecutionContext → kernel), so they are unaffected.
  if (isDispatcherReadOnlyActionBlocked(action)) {
    return { handled: false, reason: 'wrong_context' as const };
  }

  const handler = HANDLER_MAP[action];

  const _dtStart = performance.now();

  if (!handler) {
    const notFoundResult = {
      handled: false,
      reason: 'not_found' as const,
      error: `No handler found for action: ${action}`,
    };
    (window as any).__OS_DEVTOOLS__?.reportAction?.(
      action,
      performance.now() - _dtStart,
      notFoundResult,
      payload,
    );
    return notFoundResult;
  }

  try {
    // Pass payload to handler - handlers that need it will accept it as second parameter
    const result = handler(deps, payload);

    // Handle async handlers
    if (result instanceof Promise) {
      return result
        .then((asyncResult) => {
          // Track repeatable actions for async handlers
          if (
            asyncResult.handled &&
            isRepeatableAction(action) &&
            action !== 'REPEAT_LAST_ACTION'
          ) {
            const uiStore = deps.uiStore as { getState: () => RepeatActionSlice } | undefined;
            if (uiStore) {
              uiStore.getState().setLastRepeatableAction({
                actionType: action as ActionType,
                payload: payload as Record<string, unknown> | undefined,
                timestamp: Date.now(),
              });
            }
          }

          // Pull-path: process receipts directly via coordinator (no EventBus round-trip)
          if (asyncResult.receipts?.length && deps.coordinator) {
            const coordinator = deps.coordinator as {
              processReceipts: (r: NonNullable<ActionResult['receipts']>) => void;
            };
            coordinator.processReceipts(asyncResult.receipts);
          }

          (window as any).__OS_DEVTOOLS__?.reportAction?.(
            action,
            performance.now() - _dtStart,
            asyncResult,
            payload,
          );
          return asyncResult;
        })
        .catch((error) => {
          console.error(`[dispatcher] async action "${action}" rejected:`, error);
          const errorResult = {
            handled: false,
            error: error instanceof Error ? error.message : String(error),
          };
          (window as any).__OS_DEVTOOLS__?.reportAction?.(
            action,
            performance.now() - _dtStart,
            errorResult,
            payload,
          );
          return errorResult;
        });
    }

    // Pull-path: process receipts directly via coordinator (no EventBus round-trip)
    const syncResult = result as ActionResult;
    if (syncResult.receipts?.length && deps.coordinator) {
      const coordinator = deps.coordinator as {
        processReceipts: (r: NonNullable<ActionResult['receipts']>) => void;
      };
      coordinator.processReceipts(syncResult.receipts);
    }

    // Track repeatable actions for F4 repeat functionality
    // Store the action in UIStore after successful execution
    // Note: Don't track REPEAT_LAST_ACTION itself to avoid infinite recursion
    if (result.handled && isRepeatableAction(action) && action !== 'REPEAT_LAST_ACTION') {
      const uiStore = deps.uiStore as { getState: () => RepeatActionSlice } | undefined;
      if (uiStore) {
        uiStore.getState().setLastRepeatableAction({
          actionType: action,
          payload,
          timestamp: Date.now(),
        });
      }
    }

    (window as any).__OS_DEVTOOLS__?.reportAction?.(
      action,
      performance.now() - _dtStart,
      result,
      payload,
    );
    return result;
  } catch (error) {
    console.error(`[dispatcher] sync action "${action}" threw:`, error);
    const errorResult = {
      handled: false,
      error: error instanceof Error ? error.message : String(error),
    };
    (window as any).__OS_DEVTOOLS__?.reportAction?.(
      action,
      performance.now() - _dtStart,
      errorResult,
      payload,
    );
    return errorResult;
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Check if an action is implemented (has a real handler, not placeholder).
 *
 * Useful for UI to show disabled states or hide unavailable actions.
 */
export function isActionImplemented(action: ActionType): boolean {
  return HANDLER_MAP[action] !== notImplemented;
}

/**
 * Get all implemented actions.
 *
 * Useful for debugging and testing.
 */
export function getImplementedActions(): ActionType[] {
  return (Object.keys(HANDLER_MAP) as ActionType[]).filter(
    (action) => HANDLER_MAP[action] !== notImplemented,
  );
}

/**
 * Get all unimplemented actions.
 *
 * Useful for tracking migration progress.
 */
export function getUnimplementedActions(): ActionType[] {
  return (Object.keys(HANDLER_MAP) as ActionType[]).filter(
    (action) => HANDLER_MAP[action] === notImplemented,
  );
}

/**
 * Get implementation statistics.
 */
export function getImplementationStats(): {
  total: number;
  implemented: number;
  percentage: number;
} {
  const total = Object.keys(HANDLER_MAP).length;
  const implemented = getImplementedActions().length;
  return {
    total,
    implemented,
    percentage: Math.round((implemented / total) * 100),
  };
}

// =============================================================================
// Dispatcher Registration
// =============================================================================

// Register the concrete dispatch function with the handler-facing indirection
// module so that handlers can re-dispatch actions without importing this file
// directly (which would form a cycle with the handler imports above).
registerDispatchImpl(dispatch);
