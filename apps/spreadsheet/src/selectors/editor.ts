/**
 * Editor Actor Selectors
 *
 * Pure functions that extract data from editor state.
 * Copied from kernel/src/selectors/ during kernel export tightening.
 */

import type { EditorState } from '@mog-sdk/contracts/actors/editor';

export const editorSelectors = {
  // ===========================================================================
  // Value selectors - extract context values
  // ===========================================================================

  /** Get the current editor value */
  value: (state: EditorState): string => state.context.value,

  /** Get the cursor position within the value string */
  cursorPosition: (state: EditorState): number => state.context.cursorPosition,

  /** Get the sheet ID being edited */
  sheetId: (state: EditorState) => state.context.sheetId,

  /** Get the merged region bounds if editing a merged cell */
  mergeBounds: (state: EditorState) => state.context.mergeBounds,

  /** Get the selection anchor position */
  selectionAnchor: (state: EditorState): number => state.context.selectionAnchor,

  /** Check if there's an active text selection */
  hasSelection: (state: EditorState): boolean => state.context.hasSelection,

  /** Get the current formula range color */
  currentRangeColor: (state: EditorState): string => state.context.currentRangeColor,

  /** Get the range color index */
  rangeColorIndex: (state: EditorState): number => state.context.rangeColorIndex,

  /** Check if there's a conflict with remote changes */
  hasConflict: (state: EditorState): boolean => state.context.hasConflict,

  /** Get the validation error message */
  errorMessage: (state: EditorState) => state.context.errorMessage,

  /** Get the commit direction */
  commitDirection: (state: EditorState) => state.context.commitDirection,

  /** Get the IME composition text */
  compositionText: (state: EditorState): string => state.context.compositionText,

  /** Check if cell was remotely deleted */
  wasRemotelyDeleted: (state: EditorState): boolean => state.context.wasRemotelyDeleted,

  /** Check if sheet was deleted */
  wasSheetDeleted: (state: EditorState): boolean => state.context.wasSheetDeleted,

  /** Check if editing is paused for a dialog */
  pausedForDialog: (state: EditorState): boolean => state.context.pausedForDialog,

  /** Check if editing was cancelled due to structure change */
  wasStructurallyCancelled: (state: EditorState): boolean => state.context.wasStructurallyCancelled,

  /** Get the editor type (text, dropdown, checkbox, etc.) */
  editorType: (state: EditorState) => state.context.editorType,

  /** Get the cell schema */
  cellSchema: (state: EditorState) => state.context.cellSchema,

  /** Get the enum items for dropdown */
  enumItems: (state: EditorState) => state.context.enumItems,

  /** Check if picker is open */
  isPickerOpen: (state: EditorState): boolean => state.context.isPickerOpen,

  /** Check if suggestions popup is visible */
  isSuggestionsOpen: (state: EditorState): boolean => state.context.isSuggestionsOpen,

  /** Get the selected suggestion index */
  selectedSuggestionIndex: (state: EditorState): number => state.context.selectedSuggestionIndex,

  /** Check if argument hint is open */
  isArgumentHintOpen: (state: EditorState): boolean => state.context.isArgumentHintOpen,

  /** Check if this is an array formula */
  isArrayFormula: (state: EditorState): boolean => state.context.isArrayFormula,

  /**
   * Get the isEditMode context flag value.
   * This indicates whether the user is in Edit Mode (true) vs Enter Mode (false).
   * Note: This is different from isEditMode() state match which checks if currently
   * in an edit mode nested state. This flag is the mode SETTING for the UI.
   */
  editModeFlag: (state: EditorState): boolean => state.context.isEditMode,

  /** Get rich text segments */
  richTextSegments: (state: EditorState) => state.context.richTextSegments,

  /** Get character selection start */
  charSelectionStart: (state: EditorState): number => state.context.charSelectionStart,

  /** Get character selection end */
  charSelectionEnd: (state: EditorState): number => state.context.charSelectionEnd,

  /** Check if there's a character-level selection */
  hasCharSelection: (state: EditorState): boolean => state.context.hasCharSelection,

  /** Get current text format at cursor/selection */
  currentFormat: (state: EditorState) => state.context.currentFormat,

  /** Get formula context for autocomplete (function name, argument position, etc.) */
  formulaContext: (state: EditorState) => state.context.formulaContext,

  /** Get the selection ranges captured before the visible selection collapsed for editing. */
  editStartSelectionRanges: (state: EditorState) => state.context.editStartSelectionRanges,

  // ===========================================================================
  // State matching selectors - check machine state
  // ===========================================================================

  /** Check if editor is inactive (not editing) */
  isInactive: (state: EditorState): boolean => state.matches('inactive'),

  /** Check if editor is in any editing state (not inactive) */
  isEditing: (state: EditorState): boolean => !state.matches('inactive'),

  /** Check if editing a formula (in formulaEditing state) */
  isFormulaEditing: (state: EditorState): boolean => state.matches('formulaEditing'),

  /** Check if editing rich text */
  isRichTextEditing: (state: EditorState): boolean => state.matches('richTextEditing'),

  /**
   * Check if in Enter Mode (arrows commit and move selection, or insert formula refs).
   * This can be in editing, formulaEditing, or richTextEditing states.
   */
  isEnterMode: (state: EditorState): boolean =>
    state.matches('editing.enterMode') ||
    state.matches('formulaEditing.enterMode') ||
    state.matches('richTextEditing.enterMode'),

  /**
   * Check if in Edit Mode (arrows move cursor within text).
   * This can be in editing, formulaEditing, or richTextEditing states.
   */
  isEditMode: (state: EditorState): boolean =>
    state.matches('editing.editMode') ||
    state.matches('formulaEditing.editMode') ||
    state.matches('richTextEditing.editMode'),

  /** Check if IME composition is in progress */
  isImeComposing: (state: EditorState): boolean => state.matches('imeComposing'),

  /** Check if validating the value before commit */
  isValidating: (state: EditorState): boolean => state.matches('validating'),

  /** Check if committing the value */
  isCommitting: (state: EditorState): boolean => state.matches('committing'),

  /** Check if in error state (validation failed) */
  isError: (state: EditorState): boolean => state.matches('error'),

  /** Check if activating (preparing to edit) */
  isActivating: (state: EditorState): boolean => state.matches('activating'),
};
