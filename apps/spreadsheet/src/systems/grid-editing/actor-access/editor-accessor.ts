/**
 * Editor Actor Access Implementation
 *
 * Implements EditorAccessor using selectors.
 * THIS IS THE ONLY PLACE that calls actor.getSnapshot() for handlers.
 *
 * @module engine/state/coordinator/actor-access/editor
 */

import { editorSelectors } from '../../../selectors';
import type { EditorAccessor, EditorState } from '@mog-sdk/contracts/actors';

/**
 * Minimal actor interface for editor accessor.
 * Uses getSnapshot() to capture point-in-time state.
 */
type EditorActor = { getSnapshot(): EditorState };

/**
 * Creates an EditorAccessor for point-in-time reads in handlers.
 *
 * Each method delegates to the corresponding selector with a fresh snapshot.
 * This ensures handlers always get current state at the moment of call.
 *
 * @param actor - The XState editor actor
 * @returns EditorAccessor interface for handlers
 */
export function createEditorAccessor(actor: EditorActor): EditorAccessor {
  const snap = () => actor.getSnapshot();

  return {
    // ===========================================================================
    // Value Accessors
    // ===========================================================================

    getValue: () => editorSelectors.value(snap()),
    getCursorPosition: () => editorSelectors.cursorPosition(snap()),
    getSheetId: () => editorSelectors.sheetId(snap()),
    getMergeBounds: () => editorSelectors.mergeBounds(snap()),
    getSelectionAnchor: () => editorSelectors.selectionAnchor(snap()),
    hasSelection: () => editorSelectors.hasSelection(snap()),
    getCurrentRangeColor: () => editorSelectors.currentRangeColor(snap()),
    getRangeColorIndex: () => editorSelectors.rangeColorIndex(snap()),
    hasConflict: () => editorSelectors.hasConflict(snap()),
    getErrorMessage: () => editorSelectors.errorMessage(snap()),
    getCommitDirection: () => editorSelectors.commitDirection(snap()),
    getCompositionText: () => editorSelectors.compositionText(snap()),
    wasRemotelyDeleted: () => editorSelectors.wasRemotelyDeleted(snap()),
    wasSheetDeleted: () => editorSelectors.wasSheetDeleted(snap()),
    isPausedForDialog: () => editorSelectors.pausedForDialog(snap()),
    wasStructurallyCancelled: () => editorSelectors.wasStructurallyCancelled(snap()),
    getEditorType: () => editorSelectors.editorType(snap()),
    getEnumItems: () => editorSelectors.enumItems(snap()),
    isPickerOpen: () => editorSelectors.isPickerOpen(snap()),
    isSuggestionsOpen: () => editorSelectors.isSuggestionsOpen(snap()),
    getSelectedSuggestionIndex: () => editorSelectors.selectedSuggestionIndex(snap()),
    isArgumentHintOpen: () => editorSelectors.isArgumentHintOpen(snap()),
    isArrayFormula: () => editorSelectors.isArrayFormula(snap()),
    getRichTextSegments: () => editorSelectors.richTextSegments(snap()),
    getCharSelectionStart: () => editorSelectors.charSelectionStart(snap()),
    getCharSelectionEnd: () => editorSelectors.charSelectionEnd(snap()),
    hasCharSelection: () => editorSelectors.hasCharSelection(snap()),
    getCurrentFormat: () => editorSelectors.currentFormat(snap()),
    getFormulaContext: () => editorSelectors.formulaContext(snap()),
    getEditStartSelectionRanges: () => editorSelectors.editStartSelectionRanges(snap()),

    // ===========================================================================
    // State Matching Accessors
    // ===========================================================================

    isInactive: () => editorSelectors.isInactive(snap()),
    isEditing: () => editorSelectors.isEditing(snap()),
    isFormulaEditing: () => editorSelectors.isFormulaEditing(snap()),
    isRichTextEditing: () => editorSelectors.isRichTextEditing(snap()),
    isEnterMode: () => editorSelectors.isEnterMode(snap()),
    isEditMode: () => editorSelectors.isEditMode(snap()),
    isImeComposing: () => editorSelectors.isImeComposing(snap()),
    isValidating: () => editorSelectors.isValidating(snap()),
    isCommitting: () => editorSelectors.isCommitting(snap()),
    isError: () => editorSelectors.isError(snap()),
    isActivating: () => editorSelectors.isActivating(snap()),
  };
}
