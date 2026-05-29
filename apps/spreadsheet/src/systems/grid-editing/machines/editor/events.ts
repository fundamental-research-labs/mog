/**
 * Editor Machine Events
 *
 * Event factory and event creation utilities for the editor machine.
 * Provides the `EditorEvents` namespace with methods to create properly-typed
 * events for all editor operations.
 *
 * Extracted from editor-machine.ts as part of decomposition.
 */

import type { CellEditorType } from '@mog-sdk/contracts/editor';
import type { RichTextSegment, TextFormat } from '@mog-sdk/contracts/rich-text';
import type { CellSchema } from '@mog-sdk/contracts/schema';

import type { CellCoord, CellRange, Direction } from '../../../shared/types';
import type { StructureChange } from '../../../shared/utils';
import type { EditorEntryMode, EditorEvent } from './types';

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the editor machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const EditorEvents = {
  // Lifecycle events
  startEditing: (
    cell: CellCoord,
    sheetId: string,
    initialValue?: string,
    mergedRegion?: CellRange,
    entryMode?: EditorEntryMode,
    cursorPosition?: number,
    formulaInputIsLiteral?: boolean,
    openDropdown?: boolean,
    preEditSelectionRanges?: CellRange[],
  ): EditorEvent => ({
    type: 'START_EDITING',
    cell,
    sheetId,
    initialValue,
    mergedRegion,
    entryMode,
    cursorPosition,
    formulaInputIsLiteral,
    openDropdown,
    preEditSelectionRanges,
  }),

  activated: (): EditorEvent => ({
    type: 'ACTIVATED',
  }),

  // Input events
  input: (value: string, cursorPosition: number): EditorEvent => ({
    type: 'INPUT',
    value,
    cursorPosition,
  }),

  setCursor: (position: number): EditorEvent => ({
    type: 'SET_CURSOR',
    position,
  }),

  // IME events
  imeStart: (): EditorEvent => ({
    type: 'IME_START',
  }),

  imeUpdate: (compositionText: string): EditorEvent => ({
    type: 'IME_UPDATE',
    compositionText,
  }),

  imeEnd: (finalText: string): EditorEvent => ({
    type: 'IME_END',
    finalText,
  }),

  // Commit/cancel events
  commit: (direction: Direction | 'none'): EditorEvent => ({
    type: 'COMMIT',
    direction,
  }),

  cancel: (): EditorEvent => ({
    type: 'CANCEL',
  }),

  pickerCommit: (value: unknown, direction: Direction | 'none'): EditorEvent => ({
    type: 'PICKER_COMMIT',
    value,
    direction,
  }),

  // Formula events
  /**
   * Extended with optional structuredRef for table references.
   * @param range - The selected range
   * @param color - Color for range highlighting
   * @param structuredRef - Optional structured reference text (e.g., [@Column] or TableName[Column])
   */
  formulaRangeSelected: (
    range: CellRange,
    color: string,
    structuredRef?: string,
    sheetId?: string,
    sheetName?: string,
  ): EditorEvent => ({
    type: 'FORMULA_RANGE_SELECTED',
    range,
    color,
    ...(structuredRef ? { structuredRef } : {}),
    ...(sheetId ? { sheetId } : {}),
    ...(sheetName ? { sheetName } : {}),
  }),

  // C.3/H.3: Update formula range reference after drag-resize
  updateFormulaRange: (rangeIndex: number, newRange: CellRange): EditorEvent => ({
    type: 'UPDATE_FORMULA_RANGE',
    rangeIndex,
    newRange,
  }),

  // Validation events
  validationSuccess: (): EditorEvent => ({
    type: 'VALIDATION_SUCCESS',
  }),

  validationError: (message: string): EditorEvent => ({
    type: 'VALIDATION_ERROR',
    message,
  }),

  commitComplete: (): EditorEvent => ({
    type: 'COMMIT_COMPLETE',
  }),

  retry: (): EditorEvent => ({
    type: 'RETRY',
  }),

  // Remote collaboration events
  remoteCellChanged: (cell: CellCoord, newValue: unknown): EditorEvent => ({
    type: 'REMOTE_CELL_CHANGED',
    cell,
    newValue,
  }),

  remoteCellDeleted: (cell: CellCoord): EditorEvent => ({
    type: 'REMOTE_CELL_DELETED',
    cell,
  }),

  remoteSheetDeleted: (sheetId: string): EditorEvent => ({
    type: 'REMOTE_SHEET_DELETED',
    sheetId,
  }),

  remoteSchemaChanged: (cell: CellCoord): EditorEvent => ({
    type: 'REMOTE_SCHEMA_CHANGED',
    cell,
  }),

  // Dialog events
  dialogOpened: (dialogId: string): EditorEvent => ({
    type: 'DIALOG_OPENED',
    dialogId,
  }),

  dialogClosed: (): EditorEvent => ({
    type: 'DIALOG_CLOSED',
  }),

  // Cell dropdowns / In-Cell pickers
  setEditorType: (
    editorType: CellEditorType,
    cellSchema: CellSchema | null,
    enumItems: unknown[] | null,
  ): EditorEvent => ({
    type: 'SET_EDITOR_TYPE',
    editorType,
    cellSchema,
    enumItems,
  }),

  clearPendingPickerIntent: (): EditorEvent => ({
    type: 'CLEAR_PENDING_PICKER_INTENT',
  }),

  openPicker: (): EditorEvent => ({
    type: 'OPEN_PICKER',
  }),

  closePicker: (): EditorEvent => ({
    type: 'CLOSE_PICKER',
  }),

  pickerSelect: (value: unknown): EditorEvent => ({
    type: 'PICKER_SELECT',
    value,
  }),

  // Structure change events
  structureChange: (sheetId: string, change: StructureChange): EditorEvent => ({
    type: 'STRUCTURE_CHANGE',
    sheetId,
    change,
  }),

  remoteStructureChange: (
    sheetId: string,
    operation: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns',
    startIndex: number,
    count: number,
  ): EditorEvent => ({
    type: 'REMOTE_STRUCTURE_CHANGE',
    sheetId,
    operation,
    startIndex,
    count,
  }),

  // Formula editing: F4 to cycle absolute/relative references
  cycleReference: (): EditorEvent => ({
    type: 'CYCLE_REFERENCE',
  }),

  // Array formula entry (Ctrl+Shift+Enter)
  enterArrayFormula: (): EditorEvent => ({
    type: 'ENTER_ARRAY_FORMULA',
  }),

  // Insert function arguments (Ctrl+Shift+A)
  insertFunctionArgs: (): EditorEvent => ({
    type: 'INSERT_FUNCTION_ARGS',
  }),

  // Autocomplete events
  showSuggestions: (): EditorEvent => ({
    type: 'SHOW_SUGGESTIONS',
  }),

  hideSuggestions: (): EditorEvent => ({
    type: 'HIDE_SUGGESTIONS',
  }),

  selectSuggestion: (index: number): EditorEvent => ({
    type: 'SELECT_SUGGESTION',
    index,
  }),

  acceptSuggestion: (name: string): EditorEvent => ({
    type: 'ACCEPT_SUGGESTION',
    name,
  }),

  navigateSuggestion: (direction: 'up' | 'down'): EditorEvent => ({
    type: 'NAVIGATE_SUGGESTION',
    direction,
  }),

  // Toggle between Enter Mode and Edit Mode
  toggleEditMode: (): EditorEvent => ({
    type: 'TOGGLE_EDIT_MODE',
  }),

  // Cursor movement events
  cursorMoveLeft: (): EditorEvent => ({ type: 'CURSOR_MOVE_LEFT' }),
  cursorMoveRight: (): EditorEvent => ({ type: 'CURSOR_MOVE_RIGHT' }),
  cursorMoveWordLeft: (): EditorEvent => ({ type: 'CURSOR_MOVE_WORD_LEFT' }),
  cursorMoveWordRight: (): EditorEvent => ({ type: 'CURSOR_MOVE_WORD_RIGHT' }),
  cursorMoveStart: (): EditorEvent => ({ type: 'CURSOR_MOVE_START' }),
  cursorMoveEnd: (): EditorEvent => ({ type: 'CURSOR_MOVE_END' }),

  // Text selection events
  selectLeft: (): EditorEvent => ({ type: 'SELECT_LEFT' }),
  selectRight: (): EditorEvent => ({ type: 'SELECT_RIGHT' }),
  selectWordLeft: (): EditorEvent => ({ type: 'SELECT_WORD_LEFT' }),
  selectWordRight: (): EditorEvent => ({ type: 'SELECT_WORD_RIGHT' }),
  selectToStart: (): EditorEvent => ({ type: 'SELECT_TO_START' }),
  selectToEnd: (): EditorEvent => ({ type: 'SELECT_TO_END' }),
  selectAll: (): EditorEvent => ({ type: 'SELECT_ALL' }),

  // Alt+Enter: Insert newline in cell (8.5 Multi-Line Editing)
  insertNewline: (): EditorEvent => ({ type: 'INSERT_NEWLINE' }),

  // B.1: Cursor navigation in multi-line cells (Edit Mode)
  cursorUp: (): EditorEvent => ({ type: 'CURSOR_UP' }),
  cursorDown: (): EditorEvent => ({ type: 'CURSOR_DOWN' }),

  // B.3: Word deletion (Edit Mode)
  deleteWordForward: (): EditorEvent => ({ type: 'DELETE_WORD_FORWARD' }),
  deleteWordBackward: (): EditorEvent => ({ type: 'DELETE_WORD_BACKWARD' }),

  // Ctrl+K: Delete to end of line
  deleteToEndOfLine: (): EditorEvent => ({ type: 'DELETE_TO_END_OF_LINE' }),

  // Rich Text Editing Events
  charSelectionChanged: (start: number, end: number): EditorEvent => ({
    type: 'CHAR_SELECTION_CHANGED',
    start,
    end,
  }),

  applyCharFormat: (format: Partial<TextFormat>): EditorEvent => ({
    type: 'APPLY_CHAR_FORMAT',
    format,
  }),

  clearCharFormat: (): EditorEvent => ({
    type: 'CLEAR_CHAR_FORMAT',
  }),

  inputRichText: (segments: RichTextSegment[]): EditorEvent => ({
    type: 'INPUT_RICH_TEXT',
    segments,
  }),

  startRichTextEditing: (segments: RichTextSegment[]): EditorEvent => ({
    type: 'START_RICH_TEXT_EDITING',
    segments,
  }),
} as const;
