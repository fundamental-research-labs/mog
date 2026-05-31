/**
 * Editor Hook
 *
 * React hook that wraps the editor state machine actor.
 * Provides type-safe access to cell editing state and actions.
 *
 * Issue 2: Cell Dropdowns / In-Cell Pickers
 * Adds picker state (editorType, isPickerOpen, enumItems) and actions
 * (openPicker, closePicker, selectPickerItem).
 *
 * ARCHITECTURE: Uses selectors from contracts for reactive reads and commands for writes.
 *
 * PERFORMANCE NOTE: This hook subscribes to full editor state and re-renders on any change.
 * For components that only need a subset of state or actions, prefer the granular hooks:
 * - useEditorState() - Only state flags needed for rendering
 * - useEditorActions() - Only stable action functions (no re-renders)
 * - useEditorModeIndicator() - Only isEditing and isEditMode flags
 *
 * @see ARCHITECTURE.md - State Machine 3: Cell Editor
 * @see Issue-2-Cell-Dropdowns-InCell-Pickers.md - Picker architecture
 */

import { useSelector } from '@xstate/react';
import { useMemo } from 'react';

import { editorSelectors } from '../../selectors';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { CellEditorType } from '@mog-sdk/contracts/editor';
import type { Direction, EditorSnapshot } from '@mog-sdk/contracts/machines';
import type { MutationResult } from '@mog-sdk/contracts/protection';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { CellSchema } from '@mog-sdk/contracts/schema';

import type { EditorEntryMode } from '../../systems/grid-editing/machines/editor/types';
import { useCoordinator } from '../shared/use-coordinator';
import { useEditorActions } from './use-editor-actions';

// =============================================================================
// INTERNAL STATE SLICE TYPE FOR SELECTOR
// =============================================================================

/**
 * State slice containing all fields used by useEditor().
 * This enables granular subscription instead of subscribing to full state.
 */
interface UseEditorStateSlice {
  isEditing: boolean;
  isFormulaEditing: boolean;
  sheetId: string | null;
  mergeBounds: CellRange | null;
  value: string;
  hasConflict: boolean;
  isImeComposing: boolean;
  editorType: CellEditorType;
  isValidating: boolean;
  isCommitting: boolean;
  isError: boolean;
  isEditMode: boolean;
  cursorPosition: number;
  errorMessage: string | null;
  currentRangeColor: string;
  wasRemotelyDeleted: boolean;
  wasSheetDeleted: boolean;
  cellSchema: CellSchema | null;
  enumItems: unknown[] | null;
  isPickerOpen: boolean;
}

// =============================================================================
// SELECTOR FUNCTION
// =============================================================================

/**
 * Selector that extracts only the fields needed by useEditor().
 * This prevents re-renders from unrelated state machine transitions.
 */
function selectEditorState(
  state: Parameters<typeof editorSelectors.isEditing>[0],
): UseEditorStateSlice {
  return {
    isEditing: editorSelectors.isEditing(state),
    isFormulaEditing: editorSelectors.isFormulaEditing(state),
    sheetId: editorSelectors.sheetId(state),
    mergeBounds: editorSelectors.mergeBounds(state),
    value: editorSelectors.value(state),
    hasConflict: editorSelectors.hasConflict(state),
    isImeComposing: editorSelectors.isImeComposing(state),
    editorType: editorSelectors.editorType(state),
    isValidating: editorSelectors.isValidating(state),
    isCommitting: editorSelectors.isCommitting(state),
    isError: editorSelectors.isError(state),
    isEditMode: editorSelectors.editModeFlag(state),
    cursorPosition: editorSelectors.cursorPosition(state),
    errorMessage: editorSelectors.errorMessage(state),
    currentRangeColor: editorSelectors.currentRangeColor(state),
    wasRemotelyDeleted: editorSelectors.wasRemotelyDeleted(state),
    wasSheetDeleted: editorSelectors.wasSheetDeleted(state),
    cellSchema: editorSelectors.cellSchema(state),
    enumItems: editorSelectors.enumItems(state),
    isPickerOpen: editorSelectors.isPickerOpen(state),
  };
}

// =============================================================================
// EQUALITY FUNCTION
// =============================================================================

/**
 * Custom equality function for editor state comparison.
 * Only returns true (preventing re-render) if all tracked fields are identical.
 */
function useEditorStateEqual(a: UseEditorStateSlice, b: UseEditorStateSlice): boolean {
  // Compare mergeBounds by value (same coords = same merge region)
  const mergeBoundsEqual =
    a.mergeBounds === b.mergeBounds ||
    (a.mergeBounds !== null &&
      b.mergeBounds !== null &&
      a.mergeBounds.startRow === b.mergeBounds.startRow &&
      a.mergeBounds.startCol === b.mergeBounds.startCol &&
      a.mergeBounds.endRow === b.mergeBounds.endRow &&
      a.mergeBounds.endCol === b.mergeBounds.endCol);

  // Compare cellSchema by reference (schemas are typically stable objects)
  // Compare enumItems by reference (arrays are typically stable or recreated)
  return (
    a.isEditing === b.isEditing &&
    a.isFormulaEditing === b.isFormulaEditing &&
    a.sheetId === b.sheetId &&
    mergeBoundsEqual &&
    a.value === b.value &&
    a.hasConflict === b.hasConflict &&
    a.isImeComposing === b.isImeComposing &&
    a.editorType === b.editorType &&
    a.isValidating === b.isValidating &&
    a.isCommitting === b.isCommitting &&
    a.isError === b.isError &&
    a.isEditMode === b.isEditMode &&
    a.cursorPosition === b.cursorPosition &&
    a.errorMessage === b.errorMessage &&
    a.currentRangeColor === b.currentRangeColor &&
    a.wasRemotelyDeleted === b.wasRemotelyDeleted &&
    a.wasSheetDeleted === b.wasSheetDeleted &&
    a.cellSchema === b.cellSchema &&
    a.enumItems === b.enumItems &&
    a.isPickerOpen === b.isPickerOpen
  );
}

// =============================================================================
// MINIMAL MODE INDICATOR HOOK
// =============================================================================

/**
 * Return type for the minimal mode indicator hook.
 * Only contains the state needed for rendering the mode indicator in StatusBar.
 */
export interface UseEditorModeIndicatorReturn {
  /** Whether any editing is in progress */
  isEditing: boolean;
  /**
   * Whether in Edit Mode (true) or Enter Mode (false).
   * Edit Mode: Arrow keys move cursor within text.
   * Enter Mode: Arrow keys commit and move selection (or insert formula refs).
   */
  isEditMode: boolean;
}

/**
 * Minimal hook that only subscribes to editor mode indicator state.
 *
 * Performance optimization: Components that only need to display the mode
 * indicator (Ready/Enter/Edit) should use this hook instead of the full
 * useEditor() hook to avoid re-renders from unrelated editor state changes.
 *
 * @example
 * ```tsx
 * function ModeIndicator() {
 * const { isEditing, isEditMode } = useEditorModeIndicator;
 * const mode = isEditing ? (isEditMode ? 'Edit' : 'Enter') : 'Ready';
 * return <span>{mode}</span>;
 * }
 * ```
 */
export function useEditorModeIndicator(): UseEditorModeIndicatorReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.editor;

  // Use a single selector that returns both values to minimize subscriptions
  return useSelector(actor, (state) => ({
    isEditing: editorSelectors.isEditing(state),
    isEditMode: editorSelectors.editModeFlag(state),
  }));
}

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseEditorReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Whether any editing is in progress */
  isEditing: boolean;

  /** Whether currently editing a formula (value starts with =) */
  isFormulaEditing: boolean;

  /** Whether IME composition is in progress (CJK input) */
  isIMEComposing: boolean;

  /** Whether validating the cell value before commit */
  isValidating: boolean;

  /** Whether committing the edit */
  isCommitting: boolean;

  /** Whether in error state */
  hasError: boolean;

  /**
   * Whether in Edit Mode (true) or Enter Mode (false).
   *
   * Edit Mode: Arrow keys move cursor within text.
   * Enter Mode: Arrow keys commit and move selection (or insert formula refs).
   *
   */
  isEditMode: boolean;

  /** The cell currently being edited */
  editingCell: CellCoord | null;

  /** Current editor value */
  value: string;

  /** Cursor position within the value */
  cursorPosition: number;

  /** Whether a remote user modified this cell while editing */
  hasConflict: boolean;

  /** Error message if validation failed */
  errorMessage: string | null;

  /** Current color for formula range highlighting */
  currentRangeColor: string;

  /** Whether cell was deleted by remote user */
  wasRemotelyDeleted: boolean;

  /** Whether sheet was deleted by remote user */
  wasSheetDeleted: boolean;

  /** Full snapshot for advanced usage */
  snapshot: EditorSnapshot;

  // ═══════════════════════════════════════════════════════════════════════════
  // EDITING ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start editing a cell.
   * Returns MutationResult - check success before proceeding.
   * If the cell is protected, returns { success: false, reason: '...' }
   *
   * @param cell - The cell to edit
   * @param sheetId - The sheet ID
   * @param initialValue - Initial value to show in editor
   * @param entryMode - How editing was initiated (determines Enter Mode vs Edit Mode)
   * - 'F2', 'doubleClick', 'formulaBar' → Edit Mode (arrows move cursor)
   * - 'typing' (default) → Enter Mode (arrows commit and move)
   * @param cursorPosition - Initial cursor position (for double-click at specific position)
   *
   */
  startEditing: (
    cell: CellCoord,
    sheetId: SheetId,
    initialValue?: string,
    entryMode?: EditorEntryMode,
    cursorPosition?: number,
    openDropdown?: boolean,
  ) => Promise<MutationResult>;

  /**
   * Check if a cell can be edited (protection check).
   * Use this for preemptive UI feedback (disable buttons, etc.)
   */
  canEditCell: (cell: CellCoord, sheetId: SheetId) => Promise<MutationResult>;

  /** Update the editor value */
  input: (value: string, cursorPosition: number) => void;

  /** Set cursor position */
  setCursor: (position: number) => void;

  /** Mirror a DOM text selection */
  setTextSelection: (cursorPosition: number, selectionAnchor: number) => void;

  /** Commit the edit with optional direction to move selection */
  commit: (direction: Direction | 'none') => void;

  /**
   * Commit the edit using a semantic key.
   * Issue 8: Settings Panel - Enter key direction is configurable.
   *
   * Preferred over commit() for keyboard-initiated commits as it respects
   * the enterKeyDirection workbook setting.
   *
   * @param commitKey - The key that triggered the commit
   * - 'enter': Uses enterKeyDirection setting
   * - 'shift-enter': Opposite of enterKeyDirection
   * - 'tab': Always moves right
   * - 'shift-tab': Always moves left
   */
  commitWithKey: (commitKey: 'enter' | 'shift-enter' | 'tab' | 'shift-tab') => void;

  /** Cancel the edit */
  cancel: () => void;

  /** Retry after validation error */
  retry: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // IME ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Signal IME composition start */
  imeStart: () => void;

  /** Update IME composition text */
  imeUpdate: (compositionText: string) => void;

  /** End IME composition */
  imeEnd: (finalText: string) => void;

  /**
   * Cancel IME composition without committing.
   * F.2: Two-step ESC cancel - first ESC cancels composition and returns to editing.
   */
  imeCancelComposition: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // TEXT SELECTION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Select all text in the editor (Ctrl+A) */
  selectAllText: () => void;

  /** Extend selection one character to the right (Shift+Right) */
  selectRight: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // FORMULA ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Insert a formula range reference (called by coordinator when range selected) */
  insertFormulaRange: (range: CellRange, color: string) => void;

  /**
   * Update a formula range reference after drag-resize.
   * C.3/H.3: Range box dragging to edit formula references.
   *
   * @param rangeIndex - Index of the reference in the formula
   * @param newRange - The new range coordinates after drag
   */
  updateFormulaRange: (rangeIndex: number, newRange: CellRange) => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // PICKER STATE & ACTIONS (Issue 2: Cell Dropdowns / In-Cell Pickers)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * The resolved editor type for the current cell.
   * Determines which input control to render (text, dropdown, checkbox, etc.)
   * Set by coordinator when editing starts based on cell schema.
   */
  editorType: CellEditorType;

  /**
   * The cell's schema (if any) for validation/dropdown items.
   * Null if no schema applies to the cell.
   */
  cellSchema: CellSchema | null;

  /**
   * Resolved enum items for dropdown picker.
   * From static enum constraint or resolved enumSource.
   * Null if not a dropdown cell.
   */
  enumItems: unknown[] | null;

  /**
   * Whether the picker (dropdown, date picker, etc.) is currently open.
   * Ephemeral UI state - not synced to collaborators.
   */
  isPickerOpen: boolean;

  /**
   * Whether this is a dropdown cell (editorType === 'dropdown').
   * Convenience helper for rendering.
   */
  isDropdownCell: boolean;

  /**
   * Whether this is a date cell (editorType === 'date').
   * Convenience helper for rendering.
   * Issue 2: Cell Dropdowns / In-Cell Pickers
   */
  isDateCell: boolean;

  /**
   * Whether this is a slider cell (editorType === 'slider').
   * Convenience helper for rendering.
   * Issue 2: Cell Dropdowns / In-Cell Pickers
   */
  isSliderCell: boolean;

  /** Open the picker (dropdown, date picker, etc.) */
  openPicker: () => void;

  /** Close the picker */
  closePicker: () => void;

  /**
   * Select an item from the picker.
   * Updates the value and closes the picker.
   * Component should call commit() afterward if auto-commit is desired.
   */
  selectPickerItem: (value: unknown) => void;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing and controlling the editor state machine.
 *
 * @example
 * ```tsx
 * function CellEditor() {
 * const {
 * isEditing,
 * editingCell,
 * value,
 * input,
 * commit,
 * cancel,
 * } = useEditor;
 *
 * if (!isEditing || !editingCell) return null;
 *
 * return (
 * <input
 * value={value}
 * onChange={(e) => input(e.target.value)}
 * onKeyDown={(e) => {
 * if (e.key === 'Enter') commit(e.shiftKey ? 'up' : 'down');
 * if (e.key === 'Tab') commit(e.shiftKey ? 'left' : 'right');
 * if (e.key === 'Escape') cancel;
 * }}
 * />
 * );
 * }
 * ```
 */
export function useEditor(): UseEditorReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.editor;

  // Get stable action references from the granular hook
  // This avoids duplicating all the action definitions
  const actions = useEditorActions();

  // Subscribe to ONLY the fields we need with custom equality function.
  // This prevents re-renders when unrelated editor state changes.
  // PERFORMANCE FIX: Replaced identity selector `(s) => s` which caused
  // re-renders on EVERY XState transition with a granular selector.
  const stateSlice = useSelector(actor, selectEditorState, useEditorStateEqual);

  // Derive editingCell from coordinator (single source of truth)
  // @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
  const editingCell = useMemo(
    () => (stateSlice.isEditing ? coordinator.grid.getEditorSnapshot().editingCell : null),
    [stateSlice.isEditing, coordinator],
  );

  // Derive snapshot - editingCell is included but is DERIVED from selection.activeCell
  // Using state slice instead of calling selectors on raw state
  // @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
  const snapshot: EditorSnapshot = useMemo(
    () => ({
      isEditing: stateSlice.isEditing,
      isFormulaEditing: stateSlice.isFormulaEditing,
      // editingCell is derived from selection.activeCell (single source of truth)
      editingCell,
      sheetId: stateSlice.sheetId,
      mergeBounds: stateSlice.mergeBounds,
      value: stateSlice.value,
      hasConflict: stateSlice.hasConflict,
      isIMEComposing: stateSlice.isImeComposing,
    }),
    [stateSlice, editingCell],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE (using state slice for state, actions from useEditorActions)
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // State - using state slice instead of calling selectors on raw state
      isEditing: stateSlice.isEditing,
      isFormulaEditing: stateSlice.isFormulaEditing,
      isIMEComposing: stateSlice.isImeComposing,
      isValidating: stateSlice.isValidating,
      isCommitting: stateSlice.isCommitting,
      hasError: stateSlice.isError,
      // Edit Mode vs Enter Mode @see ENTER-EDIT-MODE.md
      // Note: We use editModeFlag selector which returns the context flag value,
      // not isEditMode() which checks state matching. The flag is the mode SETTING for UI.
      isEditMode: stateSlice.isEditMode,
      // editingCell is derived from coordinator.grid.getEditingCell() (single source of truth)
      // @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
      editingCell,
      value: stateSlice.value,
      cursorPosition: stateSlice.cursorPosition,
      hasConflict: stateSlice.hasConflict,
      errorMessage: stateSlice.errorMessage,
      currentRangeColor: stateSlice.currentRangeColor,
      wasRemotelyDeleted: stateSlice.wasRemotelyDeleted,
      wasSheetDeleted: stateSlice.wasSheetDeleted,
      snapshot,

      // All actions come from useEditorActions() for stable references
      ...actions,

      // Picker state (Issue 2: Cell Dropdowns / In-Cell Pickers)
      // Using state slice instead of calling selectors on raw state
      editorType: stateSlice.editorType,
      cellSchema: stateSlice.cellSchema,
      enumItems: stateSlice.enumItems,
      isPickerOpen: stateSlice.isPickerOpen,
      isDropdownCell: stateSlice.editorType === 'dropdown',
      isDateCell: stateSlice.editorType === 'date',
      isSliderCell: stateSlice.editorType === 'slider',
    }),
    [stateSlice, editingCell, snapshot, actions],
  );
}
