/**
 * Action Handlers - Barrel Export
 *
 * Exports all action handlers by category for use by the dispatcher.
 *
 * ARCHITECTURE:
 * - Each category file exports handlers as named exports matching ActionType
 * - This barrel re-exports them for easy consumption by dispatcher.ts
 *
 * Instances:
 * - Instance A: Selection handlers (30+ movement/selection actions) ✅
 * - Instance B: Editor + Clipboard handlers ✅
 * - Instance C: Formatting + Structure handlers ✅
 * - Instance D: UI + Workbook + Object handlers ✅
 *
 */

// =============================================================================
// Selection Handlers (Instance A)
// Decomposed into focused modules for better tree-shaking and code splitting.
// Each module handles a specific category of selection/navigation actions.
// =============================================================================

// Selection Handlers - exported from focused modules
export * as DataEdgeHandlers from './selection/data-edge';
export * as DifferencesHandlers from './selection/differences';
export * as ErrorsHandlers from './selection/errors';
export * as ExtensionHandlers from './selection/extension';
export * as FormulaAuditingHandlers from './selection/formula-auditing';
export * as GoToSpecialHandlers from './selection/go-to-special';
export * as HomeEndHandlers from './selection/home-end';
export * as ModesHandlers from './selection/modes';
export * as MovementHandlers from './selection/movement';
export * as PageNavigationHandlers from './selection/page-navigation';
export * as SelectAllHandlers from './selection/select-all';
export * as TabEnterHandlers from './selection/tab-enter';
export * as TableNavigationHandlers from './selection/table-navigation';
export * as TableProgressiveHandlers from './selection/table-progressive';

// =============================================================================
// Editor & Clipboard Handlers (Instance B)
// =============================================================================

export * as ClipboardHandlers from './clipboard';
export * as EditorHandlers from './editor';
export * as FormulasHandlers from './formulas';

// =============================================================================
// Formatting & Structure Handlers (Instance C)
// Formatting decomposed into focused modules
// =============================================================================

export * as BorderHandlers from './formatting/borders';
export * as CellFormatDialogHandlers from './formatting/cell-format-dialogs';
export * as ClearHandlers from './formatting/clear-operations';
export * as FontStyleHandlers from './formatting/font-styles';
export * as MergeHandlers from './formatting/merge-operations';
export * as NumberFormatHandlers from './formatting/number-formats';
export * as StructureHandlers from './structure';

// =============================================================================
// UI Handlers (Instance D)
// =============================================================================

export * as UIHandlers from './ui';

// =============================================================================
// Workbook Handlers (Instance D)
// =============================================================================

export * as WorkbookHandlers from './workbook';

// =============================================================================
// Object Handlers (Instance D)
// =============================================================================

export * as ObjectHandlers from './object';

// =============================================================================
// Comment Handlers
// =============================================================================

export * as CommentHandlers from './comments';

// =============================================================================
// Filter Handlers (Excel Parity Quickwin B4)
// =============================================================================

export * as FilterHandlers from './filter';

// =============================================================================
// Navigation Handlers (Excel Parity Quickwins E1/E4)
// =============================================================================

export * as NavigationHandlers from './navigation';

// =============================================================================
// Chart Handlers (Charts)
// =============================================================================

export * as ChartHandlers from './charts';

// =============================================================================
// Conditional Formatting Handlers
// =============================================================================

export * as ConditionalFormattingHandlers from './conditional-formatting';

// =============================================================================
// Table Handlers
// =============================================================================

export * as TableHandlers from './table';

// =============================================================================
// Slicer Handlers
// =============================================================================

export * as SlicerHandlers from './slicer';

// =============================================================================
// Ink Handlers (Wave 5: Ink Actions & UI System)
// =============================================================================

export * as InkHandlers from './ink';

// =============================================================================
// Split View Handlers
// =============================================================================

export * as SplitHandlers from './split';

// =============================================================================
// Diagram Handlers (Excel Parity: Diagram Diagrams)
// =============================================================================

export * as DiagramHandlers from './diagram';

// =============================================================================
// TextEffect Handlers (Excel Parity: TextEffect)
// =============================================================================

export * as TextEffectHandlers from './text-effects';

// =============================================================================
// Equation Handlers (Excel Parity: Equation)
// =============================================================================

export * as EquationHandlers from './equation';

// =============================================================================
// Fill Handlers
// =============================================================================

export * as FillHandlers from './fill';

// =============================================================================
// Print/Export Handlers
// =============================================================================

export * as PrintExportHandlers from './print-export';

// =============================================================================
// Direct exports for convenience (used by tests and some consumers)
// =============================================================================

// Clipboard handlers
export {
  CLEAR_CLIPBOARD,
  COPY,
  CUT,
  PASTE,
  PASTE_FORMATTING,
  PASTE_FORMULAS,
  PASTE_TRANSPOSE,
  PASTE_VALUES,
} from './clipboard';

// Editor handlers
export { CANCEL_EDIT, CLEAR_AND_EDIT, COMMIT_EDIT, EDIT_CELL, START_FORMULA } from './editor';

// Chart handlers
export {
  CLEAR_ALL_CHART_ERRORS,
  CLEAR_CHART_ERROR,
  CREATE_CHART,
  DELETE_CHART,
  HIDE_CHART_TOOLTIP,
  SET_CHART_EDITOR_TAB,
  SET_CHART_ERROR,
  SHOW_CHART_TOOLTIP,
} from './charts';

// Fill handlers
export {
  APPLY_AUTOFILL_OPTION,
  CLOSE_FILL_SERIES_DIALOG,
  DOUBLE_CLICK_FILL_HANDLE,
  EXECUTE_FILL_COPY_CELLS,
  EXECUTE_FILL_DAYS,
  EXECUTE_FILL_FORMATTING_ONLY,
  EXECUTE_FILL_GROWTH_TREND,
  EXECUTE_FILL_LINEAR_TREND,
  EXECUTE_FILL_MONTHS,
  EXECUTE_FILL_SERIES,
  EXECUTE_FILL_SERIES_CONTEXT,
  EXECUTE_FILL_WEEKDAYS,
  EXECUTE_FILL_WITHOUT_FORMATTING,
  EXECUTE_FILL_YEARS,
  FLASH_FILL,
  HIDE_AUTOFILL_OPTIONS,
  HIDE_FILL_CONTEXT_MENU,
  OPEN_FILL_SERIES_DIALOG,
  SHOW_AUTOFILL_OPTIONS,
  SHOW_FILL_CONTEXT_MENU,
  findAdjacentDataExtent,
  findColumnExtent,
} from './fill';

// Ink handlers
export {
  ACTIVATE_INK_MODE,
  ADD_INK_STROKE,
  CLEAR_ALL_INK,
  CLEAR_DRAWING,
  DEACTIVATE_INK_MODE,
  DELETE_SELECTED_STROKES,
  ERASE_INK_AT_POINT,
  MOVE_SELECTED_STROKES,
  SELECT_ALL_STROKES,
  SET_INK_COLOR,
  SET_INK_THICKNESS,
  SET_INK_TOOL,
  SET_INK_WIDTH,
  TOGGLE_INK_MODE_DEFAULT,
  TOGGLE_INK_TOOL,
  TOGGLE_LASSO_SELECTION,
  UNDO_INK_STROKE,
} from './ink';

// Split handlers
export {
  FREEZE_FIRST_COLUMN,
  FREEZE_PANES,
  FREEZE_TOP_ROW,
  SPLIT_VIEW,
  UNFREEZE_PANES,
  UNSPLIT_VIEW,
} from './split';

// Table handlers
export {
  CONVERT_TO_RANGE,
  DELETE_TABLE,
  RESIZE_TABLE,
  SET_TABLE_STYLE,
  TOGGLE_TABLE_HEADER_ROW,
  TOGGLE_TABLE_TOTALS_ROW,
} from './table';

// INSERT_TABLE is defined in formatting/cell-format-dialogs.ts
export { INSERT_TABLE } from './formatting/cell-format-dialogs';

// Print/Export handlers
export { CLEAR_PRINT_AREA, EXPORT_PDF, EXPORT_TO_PDF, SET_PRINT_AREA } from './print-export';

// PRINT is in ui/file-handlers.ts (re-exported via ui/index.ts)
export { PRINT } from './ui';
