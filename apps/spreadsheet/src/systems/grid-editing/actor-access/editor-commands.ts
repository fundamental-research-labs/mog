/**
 * Editor Command Factory
 *
 * Type-safe wrappers around actor.send() for editor state machine events.
 *
 * Extracted from coordinator/actor-access/commands.ts
 *
 * @module systems/grid-editing/actor-access/editor-commands
 */

import type { EditorCommands } from '@mog-sdk/contracts/actors';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellEditorType } from '@mog-sdk/contracts/editor';
import type { Direction } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { RichTextSegment, TextFormat } from '@mog-sdk/contracts/rich-text';
import type { CellSchema } from '@mog-sdk/contracts/schema';

// =============================================================================
// TYPES
// =============================================================================

/** Minimal actor interface for sending events */
interface MinimalActor {
  send(event: any): void;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create editor commands from an editor actor.
 * Wraps actor.send() with type-safe methods for editor events.
 *
 * @param actor - The editor state machine actor
 * @returns EditorCommands interface implementation
 *
 * @see state-machines/src/editor-machine.ts for event definitions
 */
export function createEditorCommands(actor: MinimalActor): EditorCommands {
  return {
    activated: () => actor.send({ type: 'ACTIVATED' }),

    input: (value: string, cursorPosition: number) =>
      actor.send({ type: 'INPUT', value, cursorPosition }),

    setCursor: (position: number) => actor.send({ type: 'SET_CURSOR', position }),

    commit: (
      direction: Direction | 'none',
      commitKey?: 'tab' | 'shift-tab' | 'enter' | 'shift-enter',
    ) => actor.send({ type: 'COMMIT', direction, commitKey }),

    cancel: () => actor.send({ type: 'CANCEL' }),

    pickerCommit: (value: unknown, direction: Direction | 'none') =>
      actor.send({ type: 'PICKER_COMMIT', value, direction }),

    datePickerCommit: (isoDate: string, kind: 'date' | 'datetime', direction: Direction | 'none') =>
      actor.send({ type: 'DATE_PICKER_COMMIT', isoDate, kind, direction }),

    // -------------------------------------------------------------------------
    // IME Composition
    // -------------------------------------------------------------------------
    imeStart: () => actor.send({ type: 'IME_START' }),

    imeUpdate: (compositionText: string) => actor.send({ type: 'IME_UPDATE', compositionText }),

    imeEnd: (finalText: string) => actor.send({ type: 'IME_END', finalText }),

    imeCancelComposition: () => actor.send({ type: 'IME_CANCEL_COMPOSITION' }),

    // -------------------------------------------------------------------------
    // Cursor Movement (Edit Mode)
    // -------------------------------------------------------------------------
    cursorMoveLeft: () => actor.send({ type: 'CURSOR_MOVE_LEFT' }),

    cursorMoveRight: () => actor.send({ type: 'CURSOR_MOVE_RIGHT' }),

    cursorMoveWordLeft: () => actor.send({ type: 'CURSOR_MOVE_WORD_LEFT' }),

    cursorMoveWordRight: () => actor.send({ type: 'CURSOR_MOVE_WORD_RIGHT' }),

    cursorMoveStart: () => actor.send({ type: 'CURSOR_MOVE_START' }),

    cursorMoveEnd: () => actor.send({ type: 'CURSOR_MOVE_END' }),

    cursorUp: () => actor.send({ type: 'CURSOR_UP' }),

    cursorDown: () => actor.send({ type: 'CURSOR_DOWN' }),

    // -------------------------------------------------------------------------
    // Text Selection (Edit Mode)
    // -------------------------------------------------------------------------
    selectLeft: () => actor.send({ type: 'SELECT_LEFT' }),

    selectRight: () => actor.send({ type: 'SELECT_RIGHT' }),

    selectWordLeft: () => actor.send({ type: 'SELECT_WORD_LEFT' }),

    selectWordRight: () => actor.send({ type: 'SELECT_WORD_RIGHT' }),

    selectToStart: () => actor.send({ type: 'SELECT_TO_START' }),

    selectToEnd: () => actor.send({ type: 'SELECT_TO_END' }),

    selectAll: () => actor.send({ type: 'SELECT_ALL' }),

    // -------------------------------------------------------------------------
    // Text Deletion
    // -------------------------------------------------------------------------
    deleteWordForward: () => actor.send({ type: 'DELETE_WORD_FORWARD' }),

    deleteWordBackward: () => actor.send({ type: 'DELETE_WORD_BACKWARD' }),

    deleteToEndOfLine: () => actor.send({ type: 'DELETE_TO_END_OF_LINE' }),

    // -------------------------------------------------------------------------
    // Edit Mode Toggle
    // -------------------------------------------------------------------------
    toggleEditMode: () => actor.send({ type: 'TOGGLE_EDIT_MODE' }),

    insertNewline: () => actor.send({ type: 'INSERT_NEWLINE' }),

    // -------------------------------------------------------------------------
    // Formula Events
    // -------------------------------------------------------------------------
    formulaRangeSelected: (range: CellRange, color: string, structuredRef?: string) =>
      actor.send({ type: 'FORMULA_RANGE_SELECTED', range, color, structuredRef }),

    updateFormulaRange: (rangeIndex: number, newRange: CellRange) =>
      actor.send({ type: 'UPDATE_FORMULA_RANGE', rangeIndex, newRange }),

    cycleReference: () => actor.send({ type: 'CYCLE_REFERENCE' }),

    enterArrayFormula: () => actor.send({ type: 'ENTER_ARRAY_FORMULA' }),

    insertFunctionArgs: () => actor.send({ type: 'INSERT_FUNCTION_ARGS' }),

    // -------------------------------------------------------------------------
    // Autocomplete
    // -------------------------------------------------------------------------
    showSuggestions: () => actor.send({ type: 'SHOW_SUGGESTIONS' }),

    hideSuggestions: () => actor.send({ type: 'HIDE_SUGGESTIONS' }),

    selectSuggestion: (index: number) => actor.send({ type: 'SELECT_SUGGESTION', index }),

    acceptSuggestion: (name: string) => actor.send({ type: 'ACCEPT_SUGGESTION', name }),

    navigateSuggestion: (direction: 'up' | 'down') =>
      actor.send({ type: 'NAVIGATE_SUGGESTION', direction }),

    // -------------------------------------------------------------------------
    // Rich Text Events
    // -------------------------------------------------------------------------
    startRichTextEditing: (segments: RichTextSegment[]) =>
      actor.send({ type: 'START_RICH_TEXT_EDITING', segments }),

    inputRichText: (segments: RichTextSegment[]) =>
      actor.send({ type: 'INPUT_RICH_TEXT', segments }),

    applyCharFormat: (format: Partial<TextFormat>) =>
      actor.send({ type: 'APPLY_CHAR_FORMAT', format }),

    clearCharFormat: () => actor.send({ type: 'CLEAR_CHAR_FORMAT' }),

    charSelectionChanged: (start: number, end: number) =>
      actor.send({ type: 'CHAR_SELECTION_CHANGED', start, end }),

    // -------------------------------------------------------------------------
    // Picker Events
    // -------------------------------------------------------------------------
    setEditorType: (
      editorType: CellEditorType,
      cellSchema: CellSchema | null,
      enumItems: unknown[] | null,
    ) =>
      actor.send({
        type: 'SET_EDITOR_TYPE',
        editorType,
        cellSchema,
        enumItems,
      }),

    openPicker: () => actor.send({ type: 'OPEN_PICKER' }),

    closePicker: () => actor.send({ type: 'CLOSE_PICKER' }),

    pickerSelect: (value: unknown) => actor.send({ type: 'PICKER_SELECT', value }),

    // -------------------------------------------------------------------------
    // Dialog Events
    // -------------------------------------------------------------------------
    dialogOpened: (dialogId: string) => actor.send({ type: 'DIALOG_OPENED', dialogId }),

    dialogClosed: () => actor.send({ type: 'DIALOG_CLOSED' }),

    // -------------------------------------------------------------------------
    // Validation Events
    // -------------------------------------------------------------------------
    validationSuccess: () => actor.send({ type: 'VALIDATION_SUCCESS' }),

    validationError: (message: string) => actor.send({ type: 'VALIDATION_ERROR', message }),

    retry: () => actor.send({ type: 'RETRY' }),

    commitComplete: () => actor.send({ type: 'COMMIT_COMPLETE' }),

    // -------------------------------------------------------------------------
    // Remote Events
    // -------------------------------------------------------------------------
    remoteCellChanged: (cell: CellCoord, newValue: unknown) =>
      actor.send({ type: 'REMOTE_CELL_CHANGED', cell, newValue }),

    remoteCellDeleted: (cell: CellCoord) => actor.send({ type: 'REMOTE_CELL_DELETED', cell }),

    remoteSheetDeleted: (sheetId: string) => actor.send({ type: 'REMOTE_SHEET_DELETED', sheetId }),

    remoteSchemaChanged: (cell: CellCoord) => actor.send({ type: 'REMOTE_SCHEMA_CHANGED', cell }),

    structureChange: (
      sheetId: string,
      change: {
        type: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns';
        index: number;
        count: number;
      },
    ) => actor.send({ type: 'STRUCTURE_CHANGE', sheetId, change }),

    remoteStructureChange: (
      sheetId: string,
      operation: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns',
      startIndex: number,
      count: number,
    ) =>
      actor.send({
        type: 'REMOTE_STRUCTURE_CHANGE',
        sheetId,
        operation,
        startIndex,
        count,
      }),

    // -------------------------------------------------------------------------
    // Dependency Injection
    // -------------------------------------------------------------------------
    setFunctionRegistry: (registry: {
      getMetadata(name: string): { minArgs?: number; maxArgs?: number } | undefined;
    }) => actor.send({ type: 'SET_FUNCTION_REGISTRY', registry }),
  };
}
