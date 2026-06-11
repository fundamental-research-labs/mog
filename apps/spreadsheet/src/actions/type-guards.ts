/**
 * Action Type Guard Functions
 *
 * Extracted from @mog-sdk/contracts/actions/types.
 */

import type {
  ActionType,
  AutoFillActionType,
  ChartActionType,
  ClipboardActionType,
  CommentActionType,
  ConditionalFormattingActionType,
  DataAnalysisDialogActionType,
  DragDropActionType,
  EditorActionType,
  FillContextMenuActionType,
  FilterActionType,
  FlashFillActionType,
  FormattingActionType,
  InkActionType,
  NavigationActionType,
  ObjectActionType,
  PasteValidationActionType,
  PrintExportActionType,
  RepeatActionType,
  SelectionActionType,
  SlicerActionType,
  SplitActionType,
  StructureActionType,
  TableActionType,
  TotalRowActionType,
  UIActionType,
  WorkbookActionType,
} from '@mog-sdk/contracts/actions';

export function isSelectionAction(action: string): action is SelectionActionType {
  const selectionActions: Set<string> = new Set([
    'MOVE_UP',
    'MOVE_DOWN',
    'MOVE_LEFT',
    'MOVE_RIGHT',
    'MOVE_TO_EDGE_UP',
    'MOVE_TO_EDGE_DOWN',
    'MOVE_TO_EDGE_LEFT',
    'MOVE_TO_EDGE_RIGHT',
    'MOVE_TO_ROW_START',
    'MOVE_TO_ROW_END',
    'MOVE_TO_A1',
    'MOVE_TO_LAST_USED_CELL',
    'MOVE_TO_TABLE_START',
    'MOVE_TO_TABLE_END',
    'MOVE_TO_TABLE_EDGE_UP',
    'MOVE_TO_TABLE_EDGE_DOWN',
    'MOVE_TO_TABLE_EDGE_LEFT',
    'MOVE_TO_TABLE_EDGE_RIGHT',
    'PAGE_UP',
    'PAGE_DOWN',
    'PAGE_LEFT',
    'PAGE_RIGHT',
    'TAB_FORWARD',
    'TAB_BACKWARD',
    'ENTER_NAVIGATE',
    'SHIFT_ENTER_NAVIGATE',
    'EXTEND_SELECTION_UP',
    'EXTEND_SELECTION_DOWN',
    'EXTEND_SELECTION_LEFT',
    'EXTEND_SELECTION_RIGHT',
    'EXTEND_SELECTION_PAGE_UP',
    'EXTEND_SELECTION_PAGE_DOWN',
    'EXTEND_TO_EDGE_UP',
    'EXTEND_TO_EDGE_DOWN',
    'EXTEND_TO_EDGE_LEFT',
    'EXTEND_TO_EDGE_RIGHT',
    'EXTEND_TO_ROW_START',
    'EXTEND_TO_ROW_END',
    'EXTEND_TO_A1',
    'EXTEND_TO_LAST_USED_CELL',
    'SELECT_ALL',
    'SELECT_CURRENT_REGION',
    'SELECT_ENTIRE_ROW',
    'SELECT_ENTIRE_COLUMN',
    'SELECT_PRECEDENTS',
    'SELECT_DEPENDENTS',
    'SELECT_VISIBLE_CELLS',
    'TOGGLE_ADD_TO_SELECTION',
    'SELECT_BLANKS',
    'SELECT_CONSTANTS',
    'SELECT_FORMULAS',
    'SELECT_NUMBERS',
    'SELECT_TEXT',
    'SELECT_LOGICALS',
    'SELECT_ERRORS',
    'SELECT_LAST_CELL',
    'SELECT_CELLS_WITH_CONDITIONAL_FORMATS',
    'SELECT_CELLS_WITH_DATA_VALIDATION',
    'SELECT_CELLS_WITH_SAME_VALIDATION',
    'SELECT_CELLS_WITH_COMMENTS',
    'SELECT_ROW_DIFFERENCES',
    'SELECT_COLUMN_DIFFERENCES',
    'SELECT_CURRENT_ARRAY',
    'SELECT_OBJECTS',
    'ROTATE_SELECTION_CORNER',
    'TOGGLE_EXTEND_SELECTION_MODE',
    'ACTIVATE_END_MODE',
    'CYCLE_TABLE_COLUMN_SELECTION',
    'CYCLE_TABLE_SELECTION',
    'SET_SELECTION_ERROR',
    'CLEAR_SELECTION_ERROR',
    'REDUCE_SELECTION',
  ]);
  return selectionActions.has(action);
}

export function isEditorAction(action: string): action is EditorActionType {
  const editorActions: Set<string> = new Set([
    'EDIT_CELL',
    'COMMIT_AND_MOVE_DOWN',
    'COMMIT_AND_MOVE_UP',
    'COMMIT_AND_MOVE_LEFT',
    'COMMIT_AND_MOVE_RIGHT',
    'COMMIT_TAB',
    'COMMIT_SHIFT_TAB',
    'COMMIT_ENTER',
    'COMMIT_SHIFT_ENTER',
    'CANCEL_EDIT',
    'COMMIT_IN_PLACE',
    'PICKER_COMMIT',
    'DATE_PICKER_COMMIT',
    'INSERT_NEWLINE',
    'START_FORMULA',
    'CLEAR_CONTENTS',
    'CLEAR_AND_EDIT',
    'DELETE_TO_END_OF_LINE',
    'CURSOR_UP',
    'CURSOR_DOWN',
    'DELETE_WORD_FORWARD',
    'DELETE_WORD_BACKWARD',
    'FILL_DOWN',
    'FILL_RIGHT',
    'FILL_UP',
    'FILL_LEFT',
    'FILL_SELECTION',
    'DOUBLE_CLICK_FILL_HANDLE',
    'CLEAR_ALL',
    'CLEAR_FORMATS',
    'CLEAR_COMMENTS',
    'SORT_ASCENDING',
    'SORT_DESCENDING',
    'SORT_BY_CELL_COLOR',
    'SORT_BY_FONT_COLOR',
    'INSERT_CURRENT_DATE',
    'INSERT_CURRENT_TIME',
    'COPY_VALUE_FROM_ABOVE',
    'COPY_FORMULA_FROM_ABOVE',
    'CYCLE_REFERENCE',
    'ENTER_ARRAY_FORMULA',
    'INSERT_FUNCTION_ARGS',
    'INSERT_FUNCTION',
    'PASTE_NAME_IN_FORMULA',
    'AUTO_SUM',
    'INSERT_AUTO_FUNCTION',
    'EVALUATE_FORMULA_SELECTION',
    'TOGGLE_EDIT_MODE',
    'FORMULA_SELECT_UP',
    'FORMULA_SELECT_DOWN',
    'FORMULA_SELECT_LEFT',
    'FORMULA_SELECT_RIGHT',
    'FORMULA_EXTEND_UP',
    'FORMULA_EXTEND_DOWN',
    'FORMULA_EXTEND_LEFT',
    'FORMULA_EXTEND_RIGHT',
    'FORMULA_MOVE_TO_EDGE_UP',
    'FORMULA_MOVE_TO_EDGE_DOWN',
    'FORMULA_MOVE_TO_EDGE_LEFT',
    'FORMULA_MOVE_TO_EDGE_RIGHT',
    'FORMULA_EXTEND_TO_EDGE_UP',
    'FORMULA_EXTEND_TO_EDGE_DOWN',
    'FORMULA_EXTEND_TO_EDGE_LEFT',
    'FORMULA_EXTEND_TO_EDGE_RIGHT',
    'EDIT_FORMULA_WITH_ERROR',
    'COMMIT_FORMULA_AS_TEXT',
    'OPEN_FORMULA_HELP',
    'OPEN_CELL_PICKER',
    'UPDATE_FORMULA_RANGE',
    'INSERT_HYPERLINK',
    'INSERT_CHAR',
  ]);
  return editorActions.has(action);
}

export function isClipboardAction(action: string): action is ClipboardActionType {
  const clipboardActions: Set<string> = new Set([
    'COPY',
    'CUT',
    'PASTE',
    'CLEAR_CLIPBOARD',
    'SHOW_PASTE_OPTIONS',
    'HIDE_PASTE_OPTIONS',
    'PASTE_WITH_OPTIONS',
    'PASTE_VALUES',
    'PASTE_FORMULAS',
    'PASTE_FORMATTING',
    'PASTE_TRANSPOSE',
    'PASTE_LINK',
    'PASTE_AS_PICTURE',
    'PASTE_AS_LINKED_PICTURE',
    'SHOW_PASTE_SIZE_MISMATCH_DIALOG',
    'CONFIRM_PASTE_SIZE_MISMATCH',
    'CANCEL_PASTE_SIZE_MISMATCH',
    'CONFIRM_PASTE_OVERWRITE',
    'CANCEL_PASTE_OVERWRITE',
  ]);
  return clipboardActions.has(action);
}

export function isFormattingAction(action: string): action is FormattingActionType {
  const formattingActions: Set<string> = new Set([
    'TOGGLE_BOLD',
    'TOGGLE_ITALIC',
    'TOGGLE_UNDERLINE',
    'TOGGLE_STRIKETHROUGH',
    'APPLY_FONT_FORMAT',
    'SET_FONT_SIZE',
    'SET_FONT_FAMILY',
    'SET_FONT_THEME',
    'INCREASE_FONT_SIZE',
    'DECREASE_FONT_SIZE',
    'SET_BACKGROUND_COLOR',
    'SET_HORIZONTAL_ALIGN',
    'SET_VERTICAL_ALIGN',
    'SET_TEXT_ROTATION',
    'INCREASE_INDENT',
    'DECREASE_INDENT',
    'TOGGLE_WRAP_TEXT',
    'APPLY_ALIGNMENT_FORMAT',
    'APPLY_FILL_FORMAT',
    'APPLY_PROTECTION_FORMAT',
    'APPLY_NUMBER_FORMAT',
    'FORMAT_GENERAL',
    'FORMAT_NUMBER',
    'FORMAT_TIME',
    'FORMAT_DATE',
    'FORMAT_CURRENCY',
    'FORMAT_PERCENTAGE',
    'FORMAT_SCIENTIFIC',
    'FORMAT_COMMA',
    'TOGGLE_SUPERSCRIPT',
    'TOGGLE_SUBSCRIPT',
    'INCREASE_DECIMALS',
    'DECREASE_DECIMALS',
    'APPLY_BORDERS',
    'APPLY_OUTLINE_BORDER',
    'REMOVE_BORDERS',
    'SET_ALL_BORDERS',
    'SET_INSIDE_BORDERS',
    'SET_INSIDE_HORIZONTAL_BORDERS',
    'SET_INSIDE_VERTICAL_BORDERS',
    'SET_TOP_BORDER',
    'SET_BOTTOM_BORDER',
    'SET_LEFT_BORDER',
    'SET_RIGHT_BORDER',
    'SET_DIAGONAL_UP_BORDER',
    'SET_DIAGONAL_DOWN_BORDER',
    'SET_DIAGONAL_BOTH_BORDER',
    'SET_TOP_AND_BOTTOM_BORDERS',
    'SET_TOP_AND_THICK_BOTTOM_BORDERS',
    'SET_TOP_AND_DOUBLE_BOTTOM_BORDERS',
    'CLEAR_HYPERLINKS',
    'CLEAR_CONDITIONAL_FORMATTING',
    'CLEAR_DATA_VALIDATION',
    'CLEAR_OUTLINE',
    'INSERT_TABLE',
    'TOGGLE_MERGE',
    'MERGE_ACROSS',
    'MERGE_AND_CENTER',
    'UNMERGE_CELLS',
    'MERGE_CELLS',
    'CONFIRM_MERGE_WITH_DATA_LOSS',
    'CANCEL_MERGE',
    'ACTIVATE_DRAW_BORDER',
    'ACTIVATE_DRAW_BORDER_GRID',
    'ACTIVATE_ERASE_BORDER',
    'DEACTIVATE_DRAW_BORDER',
  ]);
  return formattingActions.has(action);
}

export function isStructureAction(action: string): action is StructureActionType {
  const structureActions: Set<string> = new Set([
    'INSERT_ROW_ABOVE',
    'INSERT_ROW_BELOW',
    'INSERT_COLUMN_LEFT',
    'INSERT_COLUMN_RIGHT',
    'DELETE_ROWS',
    'DELETE_COLUMNS',
    'INSERT_CELLS',
    'INSERT_CELLS_SHIFT_DOWN',
    'INSERT_CUT_CELLS',
    'INSERT_CUT_CELLS_SHIFT_DOWN',
    'DELETE_CELLS',
    'HIDE_ROW',
    'UNHIDE_ROW',
    'HIDE_COLUMN',
    'UNHIDE_COLUMN',
    'AUTO_FIT_ROW_HEIGHT',
    'AUTO_FIT_COLUMN_WIDTH',
    'APPLY_ROW_HEIGHT',
    'APPLY_COLUMN_WIDTH',
    'INSERT_HORIZONTAL_PAGE_BREAK',
    'REMOVE_HORIZONTAL_PAGE_BREAK',
    'INSERT_VERTICAL_PAGE_BREAK',
    'REMOVE_VERTICAL_PAGE_BREAK',
    'UNDO',
    'REDO',
  ]);
  return structureActions.has(action);
}

export function isNavigationAction(action: string): action is NavigationActionType {
  const navigationActions: Set<string> = new Set([
    'FOCUS_NEXT_PANE',
    'FOCUS_PREVIOUS_PANE',
    'SCROLL_TO_ACTIVE_CELL',
    'OPEN_HYPERLINK',
    'TOGGLE_END_MODE',
  ]);
  return navigationActions.has(action);
}

export function isUIAction(action: string): action is UIActionType {
  const uiActions: Set<string> = new Set([
    'TRACE_ERROR',
    'IGNORE_ERROR',
    'SELECT_ARRAY',
    'OPEN_GO_TO_DIALOG',
    'CLOSE_GO_TO_DIALOG',
    'NAVIGATE_TO_REFERENCE',
    'OPEN_GO_TO_SPECIAL_DIALOG',
    'OPEN_FORMAT_CELLS_DIALOG',
    'OPEN_FONT_DIALOG',
    'CLOSE_FORMAT_CELLS_DIALOG',
    'OPEN_INSERT_CELLS_DIALOG',
    'OPEN_DELETE_CELLS_DIALOG',
    'OPEN_INSERT_FUNCTION_DIALOG',
    'CLOSE_INSERT_FUNCTION_DIALOG',
    'OPEN_FUNCTION_ARGUMENTS_DIALOG',
    'CLOSE_FUNCTION_ARGUMENTS_DIALOG',
    'OPEN_NAME_MANAGER',
    'OPEN_DEFINE_NAME_DIALOG',
    'OPEN_FIND_DIALOG',
    'OPEN_FIND_REPLACE_DIALOG',
    'OPEN_PASTE_SPECIAL_DIALOG',
    'OPEN_DROPDOWN',
    'OPEN_CUSTOM_SORT_DIALOG',
    'INVOKE_CONTEXT_MENU',
    'OPEN_ROW_HEIGHT_DIALOG',
    'CLOSE_ROW_HEIGHT_DIALOG',
    'OPEN_COLUMN_WIDTH_DIALOG',
    'CLOSE_COLUMN_WIDTH_DIALOG',
    'OPEN_HYPERLINK_DIALOG',
    'REMOVE_HYPERLINK',
    'OPEN_FILL_SERIES_DIALOG',
    'CLOSE_FILL_SERIES_DIALOG',
    'EXECUTE_FILL_SERIES',
    'OPEN_PAGE_SETUP_DIALOG',
    'CLOSE_PAGE_SETUP_DIALOG',
    'APPLY_PAGE_SETUP',
    'SET_PAGE_ORIENTATION',
    'SET_PAPER_SIZE',
    'SET_PAGE_MARGINS',
    'SET_PAGE_SCALE',
    // View-side sheet options (Page Layout dispatch)
    'TOGGLE_VIEW_GRIDLINES',
    'TOGGLE_VIEW_HEADINGS',
    'OPEN_BACKSTAGE',
    'CLOSE_BACKSTAGE',
    'SET_BACKSTAGE_PANEL',
    'TOGGLE_FORMULA_VIEW',
    'TOGGLE_SHOW_FORMULAS',
    'TOGGLE_FORMULA_BAR_EXPAND',
    'TOGGLE_NL_BAR',
    'TOGGLE_AUTO_FILTER',
    'TOGGLE_RIBBON',
    'SET_RIBBON_DISPLAY_MODE',
    'TOGGLE_RIBBON_TABS_MODE',
    'SHOW_RIBBON_TEMPORARILY',
    'HIDE_RIBBON_TEMPORARILY',
    'ZOOM_IN',
    'ZOOM_OUT',
    'SET_ZOOM',
    'FULL_SCREEN',
    'TOGGLE_PAGE_BREAK_PREVIEW',
    'SAVE',
    'OPEN',
    'NEW_WORKBOOK',
    'CLOSE_WORKBOOK',
    'PRINT',
    'OPEN_PRINT_PREVIEW',
    'OPEN_PRINT_PDF_DIALOG',
    'CLOSE_PRINT_PDF_DIALOG',
    'EXPORT_AS_XLSX',
    'EXPORT_AS_CSV',
    'EXPORT_AS_PDF',
    'BROWSE_FILES',
    'OPEN_RECENT_FILE',
    'SHARE_DOCUMENT',
    'CLOSE_FILE',
    'FIND_NEXT',
    'FIND_PREVIOUS',
    'CALCULATE_ALL',
    'CALCULATE_SHEET',
    'SET_CALCULATION_MODE',
    'CREATE_NAMES_FROM_SELECTION',
    'TRACE_PRECEDENTS',
    'TRACE_DEPENDENTS',
    'REMOVE_TRACE_ARROWS',
    'REMOVE_PRECEDENT_ARROWS',
    'REMOVE_DEPENDENT_ARROWS',
    'SHOW_VALIDATION_CIRCLES',
    'HIDE_VALIDATION_CIRCLES',
    'TOGGLE_VALIDATION_CIRCLES',
    'OPEN_SPARKLINE_DIALOG',
    'OPEN_DV_DIALOG',
    'CLOSE_DV_DIALOG',
    'OPEN_PIVOT_DIALOG',
    'OPEN_SUBTOTAL_DIALOG',
    'OPEN_SCHEMA_BROWSER',
    'OPEN_WORKBOOK_LINKS_PANEL',
    'OPEN_REMOVE_DUPLICATES_DIALOG',
    'OPEN_TEXT_TO_COLUMNS_DIALOG',
    'OPEN_SPREAD_SETTINGS_DIALOG',
    'OPEN_SHEET_SETTINGS_DIALOG',
    'OPEN_QUICK_RULE_DIALOG',
    'TRACK_RECENT_COLOR',
    'OPEN_MORE_COLORS_DIALOG',
    'CLOSE_MORE_COLORS_DIALOG',
    'APPLY_MORE_COLORS_FILL',
    'APPLY_MORE_COLORS_FONT',
    'APPLY_MORE_COLORS_BORDER',
    'START_RANGE_SELECTION_MODE',
    'UPDATE_RANGE_SELECTION',
    'COMPLETE_RANGE_SELECTION',
    'CANCEL_RANGE_SELECTION',
    'OPEN_HELP',
    'OPEN_KEYBOARD_SHORTCUTS_DIALOG',
    'CLOSE_KEYBOARD_SHORTCUTS_DIALOG',
    'ANNOUNCE_CELL_FORMAT',
    'OPEN_QUICK_ANALYSIS',
    'OPEN_THESAURUS_DIALOG',
    'CLOSE_THESAURUS_DIALOG',
    'THESAURUS_INSERT_WORD',
    'SHOW_WORKBOOK_STATISTICS',
    'CHECK_ACCESSIBILITY',
    'CLOSE_ACCESSIBILITY_PANEL',
    'NAVIGATE_TO_ACCESSIBILITY_ISSUE',
    'TOGGLE_MACRO_RECORDING',
    'STOP_MACRO_RECORDING',
    // Unified keytip router: ribbon dropdown openers and tab-specific actions
    'OPEN_RIBBON_DROPDOWN',
    'CLOSE_RIBBON_DROPDOWN',
    'TRIGGER_AUTOSUM',
    'TOGGLE_SHEET_PROTECTION',
  ]);
  return uiActions.has(action);
}

export function isWorkbookAction(action: string): action is WorkbookActionType {
  const workbookActions: Set<string> = new Set([
    'PREVIOUS_SHEET',
    'NEXT_SHEET',
    'INSERT_SHEET',
    'DELETE_SHEET',
    'OPEN_DELETE_SHEET_CONFIRM_DIALOG',
    'CLOSE_DELETE_SHEET_CONFIRM_DIALOG',
    'CONFIRM_DELETE_SHEET',
    'MOVE_SHEET',
    'COPY_SHEET_TO_POSITION',
    'OPEN_PROTECT_SHEET_DIALOG',
    'CLOSE_PROTECT_SHEET_DIALOG',
    'OPEN_UNPROTECT_SHEET_DIALOG',
    'CLOSE_UNPROTECT_SHEET_DIALOG',
    'PROTECT_SHEET',
    'UNPROTECT_SHEET',
    'OPEN_PROTECT_WORKBOOK_DIALOG',
    'CLOSE_PROTECT_WORKBOOK_DIALOG',
    'PROTECT_WORKBOOK',
    'UNPROTECT_WORKBOOK',
    'SELECT_ALL_SHEETS',
    'GROUP',
    'UNGROUP',
    'SHOW_DETAIL',
    'HIDE_DETAIL',
  ]);
  return workbookActions.has(action);
}

export function isObjectAction(action: string): action is ObjectActionType {
  const objectActions: Set<string> = new Set([
    'DELETE_OBJECT',
    'DESELECT_OBJECT',
    'NUDGE_OBJECT_UP',
    'NUDGE_OBJECT_DOWN',
    'NUDGE_OBJECT_LEFT',
    'NUDGE_OBJECT_RIGHT',
    'NUDGE_OBJECT_UP_FINE',
    'NUDGE_OBJECT_DOWN_FINE',
    'NUDGE_OBJECT_LEFT_FINE',
    'NUDGE_OBJECT_RIGHT_FINE',
    'DUPLICATE_OBJECT',
    'OPEN_FORMAT_PICTURE_DIALOG',
    'CLOSE_FORMAT_PICTURE_DIALOG',
    'OPEN_EDIT_ALT_TEXT_DIALOG',
    'CLOSE_EDIT_ALT_TEXT_DIALOG',
    'SAVE_PICTURE_AS_FILE',
    'INSERT_PICTURE',
    'UPDATE_PICTURE',
    'CHANGE_PICTURE',
    'RESET_PICTURE',
    'INSERT_SHAPE',
    'START_SHAPE_INSERT',
    'INSERT_TEXTBOX',
    'INSERT_FORM_CONTROL_CHECKBOX',
    'INSERT_FORM_CONTROL_COMBOBOX',
    'FLIP_SHAPE_HORIZONTAL',
    'FLIP_SHAPE_VERTICAL',
    'SET_SHAPE_FILL',
    'SET_SHAPE_OUTLINE',
    'SET_SHAPE_TEXT',
    'SET_SHAPE_SHADOW',
    'COPY_SHAPE',
    'CUT_SHAPE',
    'PASTE_SHAPE',
    'BRING_OBJECT_TO_FRONT',
    'BRING_OBJECT_FORWARD',
    'SEND_OBJECT_TO_BACK',
    'SEND_OBJECT_BACKWARD',
    'ALIGN_OBJECTS_LEFT',
    'ALIGN_OBJECTS_CENTER',
    'ALIGN_OBJECTS_RIGHT',
    'ALIGN_OBJECTS_TOP',
    'ALIGN_OBJECTS_MIDDLE',
    'ALIGN_OBJECTS_BOTTOM',
    'GROUP_OBJECTS',
    'UNGROUP_OBJECTS',
    'ROTATE_OBJECT_RIGHT_90',
    'ROTATE_OBJECT_LEFT_90',
    'FLIP_OBJECT_VERTICAL',
    'FLIP_OBJECT_HORIZONTAL',
  ]);
  return objectActions.has(action);
}

export function isCommentAction(action: string): action is CommentActionType {
  const commentActions: Set<string> = new Set([
    'INSERT_COMMENT',
    'EDIT_COMMENT',
    'DELETE_COMMENT',
    'SHOW_HIDE_COMMENTS',
    'NEXT_COMMENT',
    'PREVIOUS_COMMENT',
    'TOGGLE_SHOW_ALL_COMMENTS',
  ]);
  return commentActions.has(action);
}

export function isFilterAction(action: string): action is FilterActionType {
  const filterActions: Set<string> = new Set([
    'APPLY_NUMBER_FILTER',
    'APPLY_TEXT_FILTER',
    'APPLY_COLOR_FILTER',
    'APPLY_TOP10_FILTER',
    'OPEN_TOP10_DIALOG',
    'CLOSE_TOP10_DIALOG',
    'CLEAR_COLUMN_FILTER',
    'FILTER_BY_SELECTED_VALUE',
    'FILTER_BY_COLOR',
    'FILTER_BY_FONT_COLOR',
    'CLEAR_FILTER',
    'OPEN_CUSTOM_AUTOFILTER_DIALOG',
    'CLOSE_CUSTOM_AUTOFILTER_DIALOG',
    'APPLY_CUSTOM_AUTOFILTER',
    'OPEN_ADVANCED_FILTER_DIALOG',
    'CLOSE_ADVANCED_FILTER_DIALOG',
    'APPLY_ADVANCED_FILTER',
    'CLEAR_ALL_FILTERS',
    'REAPPLY_FILTERS',
  ]);
  return filterActions.has(action);
}

export function isAutoFillAction(action: string): action is AutoFillActionType {
  const autoFillActions: Set<string> = new Set([
    'SHOW_AUTOFILL_OPTIONS',
    'HIDE_AUTOFILL_OPTIONS',
    'APPLY_AUTOFILL_OPTION',
  ]);
  return autoFillActions.has(action);
}

export function isFillContextMenuAction(action: string): action is FillContextMenuActionType {
  const fillContextMenuActions: Set<string> = new Set([
    'SHOW_FILL_CONTEXT_MENU',
    'HIDE_FILL_CONTEXT_MENU',
    'EXECUTE_FILL_COPY_CELLS',
    'EXECUTE_FILL_SERIES_CONTEXT_MENU',
    'EXECUTE_FILL_FORMATTING_ONLY',
    'EXECUTE_FILL_WITHOUT_FORMATTING',
    'EXECUTE_FILL_DAYS',
    'EXECUTE_FILL_WEEKDAYS',
    'EXECUTE_FILL_MONTHS',
    'EXECUTE_FILL_YEARS',
    'EXECUTE_FILL_LINEAR_TREND',
    'EXECUTE_FILL_GROWTH_TREND',
  ]);
  return fillContextMenuActions.has(action);
}

export function isFlashFillAction(action: string): action is FlashFillActionType {
  const flashFillActions: Set<string> = new Set([
    'FLASH_FILL',
    'SHOW_FLASH_FILL_PREVIEW',
    'ACCEPT_FLASH_FILL',
    'REJECT_FLASH_FILL',
  ]);
  return flashFillActions.has(action);
}

export function isRepeatAction(action: string): action is RepeatActionType {
  return action === 'REPEAT_LAST_ACTION';
}

export function isDragDropAction(action: string): action is DragDropActionType {
  const dragDropActions: Set<string> = new Set([
    'SHOW_DRAG_DROP_OVERWRITE_DIALOG',
    'CONFIRM_DRAG_DROP_OVERWRITE',
    'CANCEL_DRAG_DROP_OVERWRITE',
  ]);
  return dragDropActions.has(action);
}

export function isPasteValidationAction(action: string): action is PasteValidationActionType {
  const pasteValidationActions: Set<string> = new Set([
    'SHOW_PASTE_VALIDATION_SUMMARY',
    'CLOSE_PASTE_VALIDATION_SUMMARY',
    'CONFIRM_PASTE_WITH_INVALID',
    'REVERT_INVALID_PASTE',
    'HIGHLIGHT_INVALID_CELLS',
  ]);
  return pasteValidationActions.has(action);
}

export function isChartAction(action: string): action is ChartActionType {
  const chartActions: Set<string> = new Set([
    'SELECT_CHART',
    'DESELECT_CHART',
    'DESELECT_ALL_CHARTS',
    'ADD_CHART_TO_SELECTION',
    'TOGGLE_CHART_SELECTION',
    'BRING_CHART_TO_FRONT',
    'SEND_CHART_TO_BACK',
    'BRING_CHART_FORWARD',
    'SEND_CHART_BACKWARD',
    'COPY_CHART',
    'CUT_CHART',
    'PASTE_CHART',
    'CYCLE_NEXT_CHART',
    'CYCLE_PREVIOUS_CHART',
    'CREATE_CHART_SHEET',
    'CREATE_EMBEDDED_CHART',
    'EDIT_CHART',
    'EDIT_CHART_TITLE',
    'CHANGE_CHART_TYPE',
    'DUPLICATE_CHART',
    'SAVE_CHART_AS_IMAGE',
    'DELETE_CHART',
    'OPEN_SELECT_DATA_DIALOG',
    'CLOSE_SELECT_DATA_DIALOG',
    'APPLY_SELECT_DATA',
    'OPEN_INSERT_CHART_WIZARD_DIALOG',
    'CLOSE_INSERT_CHART_WIZARD_DIALOG',
    'INSERT_CHART_FROM_WIZARD',
    'NUDGE_CHART_UP',
    'NUDGE_CHART_DOWN',
    'NUDGE_CHART_LEFT',
    'NUDGE_CHART_RIGHT',
    'RESET_CHART_STYLE',
    'OPEN_MOVE_CHART_DIALOG',
    'OPEN_FORMAT_CHART_AREA',
    'OPEN_FORMAT_PLOT_AREA',
    'OPEN_FORMAT_DATA_SERIES',
    'ADD_DATA_LABELS',
    'ADD_TRENDLINE',
    'OPEN_FORMAT_AXIS',
    'TOGGLE_GRIDLINES',
    'OPEN_FORMAT_LEGEND',
    'OPEN_FORMAT_CHART_TITLE',
    'SHOW_CHART_TOOLTIP',
    'HIDE_CHART_TOOLTIP',
    'SET_CHART_ERROR',
    'CLEAR_CHART_ERROR',
    'CLEAR_ALL_CHART_ERRORS',
    'SET_CHART_EDITOR_TAB',
    'OPEN_CHART_TITLE_EDITOR',
    'CLOSE_CHART_TITLE_EDITOR',
  ]);
  return chartActions.has(action);
}

export function isSlicerAction(action: string): action is SlicerActionType {
  const slicerActions: Set<string> = new Set([
    'OPEN_INSERT_SLICER_DIALOG',
    'CUT_SLICER',
    'COPY_SLICER',
    'PASTE_SLICER',
    'OPEN_SLICER_SETTINGS',
    'CLOSE_SLICER_SETTINGS',
    'OPEN_SLICER_REPORT_CONNECTIONS',
    'CLOSE_SLICER_REPORT_CONNECTIONS',
    'OPEN_SLICER_SIZE_PROPERTIES',
    'CLOSE_SLICER_SIZE_PROPERTIES',
    'OPEN_SLICER_CONNECTIONS',
    'UPDATE_SLICER_CONNECTIONS',
    'CLOSE_SLICER_CONNECTIONS_DIALOG',
    'BRING_SLICER_TO_FRONT',
    'SEND_SLICER_TO_BACK',
    'BRING_SLICER_FORWARD',
    'SEND_SLICER_BACKWARD',
    'DELETE_SLICER',
  ]);
  return slicerActions.has(action);
}

export function isInkAction(action: string): action is InkActionType {
  const inkActions: Set<string> = new Set([
    'ACTIVATE_INK_MODE',
    'DEACTIVATE_INK_MODE',
    'TOGGLE_INK_TOOL',
    'TOGGLE_INK_MODE_DEFAULT',
    'SET_INK_TOOL',
    'SET_INK_COLOR',
    'SET_INK_WIDTH',
    'SET_INK_OPACITY',
    'CLEAR_DRAWING',
    'DELETE_SELECTED_STROKES',
    'SELECT_ALL_STROKES',
    'INSERT_DRAWING',
    'TOGGLE_LASSO_SELECTION',
    'MOVE_SELECTED_STROKES',
    'TRANSFORM_SELECTED_STROKES',
    'RECOGNIZE_INK_AS_SHAPE',
    'RECOGNIZE_INK_AS_TEXT',
  ]);
  return inkActions.has(action);
}

export function isConditionalFormattingAction(
  action: string,
): action is ConditionalFormattingActionType {
  const cfActions: Set<string> = new Set([
    'CREATE_CF_RULE',
    'UPDATE_CF_RULE',
    'DELETE_CF_RULE',
    'REORDER_CF_RULES',
    'OPEN_CF_RULES_MANAGER',
    'CLOSE_CF_RULES_MANAGER',
    'OPEN_CF_DIALOG',
    'CLOSE_CF_DIALOG',
    'OPEN_CF_MENU',
  ]);
  return cfActions.has(action);
}

export function isTotalRowAction(action: string): action is TotalRowActionType {
  const totalRowActions: Set<string> = new Set([
    'OPEN_TOTAL_ROW_DROPDOWN',
    'CLOSE_TOTAL_ROW_DROPDOWN',
    'SET_TOTAL_ROW_FUNCTION',
  ]);
  return totalRowActions.has(action);
}

export function isPrintExportAction(action: string): action is PrintExportActionType {
  const printExportActions: Set<string> = new Set([
    'EXPORT_PDF',
    'TOGGLE_PAGE_BREAK_PREVIEW',
    'SET_PRINT_AREA',
    'CLEAR_PRINT_AREA',
    'ADD_TO_PRINT_AREA',
    'RESET_PAGE_BREAKS',
    'SET_PRINT_SCOPE',
    'SET_PRINT_PAGE_RANGE',
    'QUICK_PRINT',
    // Print-side sheet options (Page Layout dispatch)
    'TOGGLE_PRINT_GRIDLINES',
    'TOGGLE_PRINT_HEADINGS',
  ]);
  return printExportActions.has(action);
}

export function isTableAction(action: string): action is TableActionType {
  const tableActions: Set<string> = new Set([
    'REMOVE_DUPLICATES',
    'CONVERT_TO_RANGE',
    'TOGGLE_FILTER_BUTTONS',
    'INSERT_TABLE_ROW_ABOVE',
    'INSERT_TABLE_ROW_BELOW',
    'INSERT_TABLE_COLUMN_LEFT',
    'INSERT_TABLE_COLUMN_RIGHT',
    'DELETE_TABLE_ROWS',
    'DELETE_TABLE_COLUMNS',
    'CREATE_CUSTOM_TABLE_STYLE',
    'MODIFY_TABLE_STYLE',
    'DUPLICATE_TABLE_STYLE',
    'DELETE_CUSTOM_TABLE_STYLE',
    'RESIZE_TABLE',
    'CLOSE_REMOVE_DUPLICATES_DIALOG',
    'OPEN_CUSTOM_TABLE_STYLE_DIALOG',
    'CLOSE_CUSTOM_TABLE_STYLE_DIALOG',
    'OPEN_RESIZE_TABLE_DIALOG',
    'CLOSE_RESIZE_TABLE_DIALOG',
    'OPEN_CONVERT_TO_RANGE_DIALOG',
    'CLOSE_CONVERT_TO_RANGE_DIALOG',
    'SELECT_TABLE_COLUMN',
    'SELECT_TABLE_ROW',
    'SELECT_TABLE_DATA',
    'SELECT_FULL_TABLE',
    'TOGGLE_AUTO_CALCULATED_COLUMNS',
    'OVERWRITE_CALCULATED_COLUMN',
    'TOGGLE_TABLE_AUTO_EXPAND',
    'DELETE_TABLE',
    'TOGGLE_TABLE_HEADER_ROW',
    'TOGGLE_TABLE_TOTALS_ROW',
    'TOGGLE_TABLE_BANDED_ROWS',
  ]);
  return tableActions.has(action);
}

export function isDataAnalysisDialogAction(action: string): action is DataAnalysisDialogActionType {
  const dataAnalysisActions: Set<string> = new Set([
    'OPEN_GOAL_SEEK_DIALOG',
    'CLOSE_GOAL_SEEK_DIALOG',
    'EXECUTE_GOAL_SEEK',
    'CANCEL_GOAL_SEEK',
    'OPEN_FORECAST_SHEET_DIALOG',
    'OPEN_CONSOLIDATE_DIALOG',
    'CLOSE_CONSOLIDATE_DIALOG',
    'EXECUTE_CONSOLIDATE',
    'OPEN_SPELLING_DIALOG',
    'CLOSE_SPELLING_DIALOG',
    'SPELL_CHECK_NEXT',
    'SPELL_CHECK_CHANGE',
    'SPELL_CHECK_CHANGE_ALL',
    'SPELL_CHECK_IGNORE',
    'SPELL_CHECK_IGNORE_ALL',
    'SPELL_CHECK_ADD_TO_DICTIONARY',
    'OPEN_WATCH_WINDOW',
    'CLOSE_WATCH_WINDOW',
    'TOGGLE_WATCH_WINDOW',
    'ADD_WATCH',
    'DELETE_WATCH',
    'DELETE_ALL_WATCHES',
    'OPEN_ERROR_CHECKING_DIALOG',
    'CLOSE_ERROR_CHECKING_DIALOG',
    'ERROR_CHECK_NEXT',
    'ERROR_CHECK_PREVIOUS',
    'ERROR_CHECK_IGNORE',
    'ERROR_CHECK_EDIT_IN_FORMULA_BAR',
    'OPEN_EVALUATE_FORMULA_DIALOG',
    'CLOSE_EVALUATE_FORMULA_DIALOG',
    'EVALUATE_NEXT_STEP',
    'EVALUATE_STEP_IN',
    'EVALUATE_STEP_OUT',
    'EVALUATE_RESTART',
  ]);
  return dataAnalysisActions.has(action);
}

export function isSplitAction(action: string): action is SplitActionType {
  const splitActions: Set<string> = new Set([
    'TOGGLE_SPLIT',
    'SET_SPLIT_POSITION',
    'REMOVE_SPLIT',
    'FOCUS_NEXT_SPLIT_VIEWPORT',
    'FOCUS_PREV_SPLIT_VIEWPORT',
    'FREEZE_PANES',
    'FREEZE_TOP_ROW',
    'FREEZE_FIRST_COLUMN',
    'UNFREEZE_PANES',
  ]);
  return splitActions.has(action);
}

export function isValidActionType(action: string): action is ActionType {
  return (
    isSelectionAction(action) ||
    isEditorAction(action) ||
    isClipboardAction(action) ||
    isFormattingAction(action) ||
    isStructureAction(action) ||
    isNavigationAction(action) ||
    isUIAction(action) ||
    isWorkbookAction(action) ||
    isObjectAction(action) ||
    isCommentAction(action) ||
    isFilterAction(action) ||
    isAutoFillAction(action) ||
    isFillContextMenuAction(action) ||
    isFlashFillAction(action) ||
    isRepeatAction(action) ||
    isDragDropAction(action) ||
    isPasteValidationAction(action) ||
    isTotalRowAction(action) ||
    isTableAction(action) ||
    isChartAction(action) ||
    isSlicerAction(action) ||
    isInkAction(action) ||
    isConditionalFormattingAction(action) ||
    isPrintExportAction(action) ||
    isDataAnalysisDialogAction(action) ||
    isSplitAction(action)
  );
}
