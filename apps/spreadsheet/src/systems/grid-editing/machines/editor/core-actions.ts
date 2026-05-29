/**
 * Editor Machine Core Actions
 *
 * Core action handlers for the editor state machine including:
 * - Lifecycle actions: initialization, reset, commit direction storage
 * - Input handling: text input, cursor positioning, IME composition, newline insertion
 * - Remote collaboration: conflict markers, deletion flags
 * - Dialog coordination: pause/resume for validation dialogs
 *
 * These are pure context transformations with no side effects.
 * Each action is an XState v5 assign() action.
 */

import { FORMULA_RANGE_COLORS } from '@mog-sdk/contracts/machines';
import { assign } from 'xstate';
import { initialEditorContext } from './types';

// =============================================================================
// HELPER FUNCTIONS (extracted from editor-machine.ts)
// =============================================================================

/**
 * Insert text at cursor position and return new value and cursor position.
 * Used for IME composition and formula range insertion.
 */
function insertRangeAtCursor(
  value: string,
  cursorPosition: number,
  rangeText: string,
): { newValue: string; newCursorPosition: number } {
  const before = value.slice(0, cursorPosition);
  const after = value.slice(cursorPosition);
  const newValue = before + rangeText + after;
  return {
    newValue,
    newCursorPosition: cursorPosition + rangeText.length,
  };
}

// =============================================================================
// LIFECYCLE ACTIONS
// =============================================================================

/**
 * Initialize editing context from START_EDITING event.
 * Sets up initial value, cursor position, edit mode, and sheet metadata.
 *
 * NOTE: editingCell is NOT stored in context. The cell being edited is
 * derived from selection.activeCell via coordinator.getEditingCell().
 * The event includes the cell for validation purposes only.
 *
 * @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
 */
export const initializeEditing = assign(({ event }) => {
  if (event.type !== 'START_EDITING') {
    return {};
  }

  // Determine Edit Mode vs Enter Mode from entryMode
  // F2, double-click, formula bar → Edit Mode (arrows move cursor)
  // typing (default) → Enter Mode (arrows commit and move)
  const entryMode = event.entryMode ?? 'typing';
  const isEditMode =
    entryMode === 'F2' || entryMode === 'doubleClick' || entryMode === 'formulaBar';

  // Determine cursor position:
  // - If explicitly provided (e.g., double-click with position), use it
  // - Edit Mode: cursor at end of value
  // - Enter Mode: cursor at end (typing replaces content anyway)
  const initialValue = event.initialValue ?? '';
  const cursorPosition = event.cursorPosition ?? initialValue.length;

  return {
    isEditMode,
    editingCell: event.cell,
    sheetId: event.sheetId,
    mergeBounds: event.mergedRegion ?? null,
    value: initialValue,
    formulaInputIsLiteral: event.formulaInputIsLiteral ?? false,
    cursorPosition,
    hasConflict: false,
    errorMessage: null,
    wasRemotelyDeleted: false,
    wasSheetDeleted: false,
    rangeColorIndex: 0,
    currentRangeColor: FORMULA_RANGE_COLORS[0],
    editStartSelectionRanges: event.preEditSelectionRanges ?? null,
    commitActiveCell: null,
    commitSelectionRanges: null,
    // Data Validation - Store openDropdown flag for later
    pendingOpenDropdown: event.openDropdown ?? false,
  };
});

/**
 * Reset context to initial state.
 * Used when exiting editing or after errors.
 * Includes picker state and all other context properties.
 */
export const resetContext = assign(initialEditorContext);

/**
 * Store commit direction for post-commit navigation.
 * The coordinator uses this to move selection after commit.
 */
export const storeCommitDirection = assign({
  commitDirection: ({ event }) => (event.type === 'COMMIT' ? event.direction : null),
  datePickerCommit: null,
  commitKey: ({ event }) => (event.type === 'COMMIT' ? (event.commitKey ?? null) : null),
});

/**
 * Store commit direction as 'none' for blur-triggered commits.
 * BLUR events have no direction — always commit in place.
 */
export const storeBlurAsCommit = assign({
  commitDirection: 'none' as const,
  datePickerCommit: null,
});

/**
 * Apply picker commit — atomically set value and commit direction.
 * Single compound action for PICKER_COMMIT events.
 */
export const applyPickerCommit = assign({
  value: ({ event }: { event: { type: string; value?: unknown } }) =>
    event.type === 'PICKER_COMMIT' ? String(event.value) : undefined,
  commitDirection: ({ event }: { event: { type: string; direction?: string } }) =>
    event.type === 'PICKER_COMMIT' ? (event.direction ?? 'down') : 'down',
  datePickerCommit: null,
});

export const applyDatePickerCommit = assign({
  commitDirection: ({ event }: { event: { type: string; direction?: string } }) =>
    event.type === 'DATE_PICKER_COMMIT' ? (event.direction ?? 'down') : 'down',
  datePickerCommit: ({
    event,
  }: {
    event: { type: string; isoDate?: string; kind?: 'date' | 'datetime' };
  }) =>
    event.type === 'DATE_PICKER_COMMIT' && event.isoDate && event.kind
      ? { isoDate: event.isoDate, kind: event.kind }
      : null,
});

// =============================================================================
// INPUT ACTIONS
// =============================================================================

/**
 * Update value from INPUT event.
 *
 * The cursor position MUST be carried by the INPUT event (mirrored from the
 * DOM textarea's actual `selectionStart`). Inventing a cursor position here —
 * e.g. `event.value.length` — corrupts every mid-string edit because the
 * `useLayoutEffect` in `InlineCellEditor` then writes that invented cursor
 * back onto the DOM with `setSelectionRange`, racing the user's next
 * keystroke. The machine is authoritative for cursor state for *programmatic*
 * moves (selectAll, formula range insert, moveCursorLeft, etc.); during
 * native typing it must mirror the DOM rather than guess.
 *
 */
export const updateValue = assign({
  value: ({ event }) => (event.type === 'INPUT' ? event.value : ''),
  cursorPosition: ({ event }) => (event.type === 'INPUT' ? event.cursorPosition : 0),
  // Clear formula point mode tracking — user typed something (operator, letter, etc.)
  // so the next arrow key should insert a NEW reference, not replace the previous one.
  formulaRefInsertStart: null,
  formulaRefInsertEnd: null,
});

/**
 * Set cursor position from SET_CURSOR event.
 * Used by UI components to update cursor location.
 */
export const setCursor = assign({
  cursorPosition: ({ event }) => (event.type === 'SET_CURSOR' ? event.position : 0),
});

/**
 * Start IME composition.
 * Initializes compositionText for tracking IME input.
 */
export const startIMEComposition = assign({
  compositionText: '',
});

/**
 * Update IME composition text during composition.
 * Tracks intermediate IME state before final commit.
 */
export const updateIMEComposition = assign({
  compositionText: ({ event }) => (event.type === 'IME_UPDATE' ? event.compositionText : ''),
});

/**
 * Commit IME composition to value.
 *
 * Uses context.compositionText (from IME_UPDATE events) instead of event.finalText
 * for cross-browser consistency. Browser behavior for CompositionEvent.data varies:
 * - Chrome: contains the committed text (e.g., "你好")
 * - Firefox: may contain only the final character (e.g., "好")
 * - Safari: may be empty in some cases
 *
 * By using compositionText tracked in context, we get consistent behavior.
 */
export const commitIMEComposition = assign(({ context }) => {
  // Use compositionText already tracked in context - consistent across browsers
  // Don't rely on event.data which varies by browser
  const { newValue, newCursorPosition } = insertRangeAtCursor(
    context.value,
    context.cursorPosition,
    context.compositionText,
  );
  return {
    value: newValue,
    cursorPosition: newCursorPosition,
    compositionText: '', // Clear for next composition
  };
});

/**
 * Cancel IME composition without committing.
 *
 * F.2: Two-step ESC cancel - first ESC cancels composition and returns to editing.
 * The compositionText is discarded (not added to value).
 *
 */
export const cancelIMEComposition = assign({
  compositionText: '', // Clear composition text without adding to value
});

/**
 * Insert a newline at the current cursor position (Alt+Enter).
 * If there's a selection, replace it with a newline.
 *
 */
export const insertNewlineAtCursor = assign(({ context }) => {
  const { value, cursorPosition, selectionAnchor, hasSelection } = context;

  // If there's a selection, replace it with newline
  if (hasSelection) {
    const start = Math.min(cursorPosition, selectionAnchor);
    const end = Math.max(cursorPosition, selectionAnchor);
    const newValue = value.substring(0, start) + '\n' + value.substring(end);
    return {
      value: newValue,
      cursorPosition: start + 1,
      selectionAnchor: start + 1,
      hasSelection: false,
    };
  }

  // No selection - insert at cursor
  const newValue = value.substring(0, cursorPosition) + '\n' + value.substring(cursorPosition);

  return {
    value: newValue,
    cursorPosition: cursorPosition + 1,
    selectionAnchor: cursorPosition + 1,
  };
});

// =============================================================================
// REMOTE COLLABORATION ACTIONS
// =============================================================================

/**
 * Mark that there's a conflict with remote changes.
 * Sets hasConflict flag for UI to display warning.
 */
export const setConflict = assign({
  hasConflict: true,
});

/**
 * Reset context and mark that cell was remotely deleted.
 * Sets wasRemotelyDeleted flag for UI notification.
 */
export const resetWithRemotelyDeleted = assign({
  ...initialEditorContext,
  wasRemotelyDeleted: true,
});

/**
 * Reset context and mark that sheet was deleted.
 * Sets wasSheetDeleted flag for UI notification.
 */
export const resetWithSheetDeleted = assign({
  ...initialEditorContext,
  wasSheetDeleted: true,
});

/**
 * Cancel editing due to structure change.
 * Sets wasStructurallyCancelled flag so UI can show appropriate notification.
 */
export const cancelForStructureChange = assign({
  ...initialEditorContext,
  wasStructurallyCancelled: true,
});

// =============================================================================
// DIALOG COORDINATION ACTIONS
// =============================================================================

/**
 * Mark that editing is paused for a dialog.
 * Used when validation or error dialogs are open.
 */
export const setPausedForDialog = assign({
  pausedForDialog: true,
});

/**
 * Clear the paused flag when dialog closes.
 * Resumes normal editing state.
 */
export const clearPausedForDialog = assign({
  pausedForDialog: false,
});

// =============================================================================
// ERROR HANDLING ACTIONS
// =============================================================================

/**
 * Set validation error message.
 * Used when validation fails in the error state.
 */
export const setValidationError = assign({
  errorMessage: ({ event }) => (event.type === 'VALIDATION_ERROR' ? event.message : null),
});

/**
 * Clear error message for retry.
 * Used when recovering from error state.
 */
export const clearError = assign({
  errorMessage: null,
});

// =============================================================================
// MODE CONTROL ACTIONS
// =============================================================================

/**
 * Force editor into Enter Mode.
 * Used when transitioning from formula editing back to regular editing.
 */
export const setEnterMode = assign({
  isEditMode: false,
});

// =============================================================================
// DEPENDENCY INJECTION ACTIONS
// =============================================================================

/**
 * Set the function registry for formula argument hints.
 * Called by coordinator during initialization to inject the registry.
 *
 * This decouples machines from calculator-engine by using dependency injection.
 * The registry is used by insertFunctionArgs to generate argument placeholders.
 *
 */
export const setFunctionRegistry = assign({
  functionRegistry: ({ event }) => (event.type === 'SET_FUNCTION_REGISTRY' ? event.registry : null),
});

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Export all core actions as a single object for use in machine config.
 * This allows importing the entire set at once.
 */
export const coreActions = {
  // Lifecycle
  initializeEditing,
  resetContext,
  storeCommitDirection,
  storeBlurAsCommit,
  applyPickerCommit,
  applyDatePickerCommit,

  // Input
  updateValue,
  setCursor,
  startIMEComposition,
  updateIMEComposition,
  commitIMEComposition,
  cancelIMEComposition,
  insertNewlineAtCursor,

  // Remote Collaboration
  setConflict,
  resetWithRemotelyDeleted,
  resetWithSheetDeleted,
  cancelForStructureChange,

  // Dialog Coordination
  setPausedForDialog,
  clearPausedForDialog,

  // Error Handling
  setValidationError,
  clearError,

  // Mode Control
  setEnterMode,

  // Dependency Injection
  setFunctionRegistry,
};
