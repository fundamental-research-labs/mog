/**
 * Editor State Hook - Granular Editor Subscription
 *
 * This hook provides a granular subscription to ONLY the editor state flags
 * needed for rendering, NOT the full editor state. This is a critical
 * performance optimization.
 *
 * Problem: useEditor() uses an identity selector `(s) => s` causing SpreadsheetGrid
 * to re-render on EVERY XState state transition (620 times in profiling data),
 * even when it only needs `editor.isEditing`.
 *
 * Solution: Use XState's useSelector with a custom equality function that
 * only triggers re-renders when the specific state flags actually change.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 14: Render Isolation
 */

import { useSelector } from '@xstate/react';
import { useMemo } from 'react';

import { editorSelectors } from '../../selectors';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellEditorType } from '@mog-sdk/contracts/editor';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// TYPES
// =============================================================================

export interface UseEditorStateReturn {
  /** Whether any editing is in progress */
  isEditing: boolean;

  /** Whether currently editing a formula (value starts with =) */
  isFormulaEditing: boolean;

  /** The cell currently being edited (derived from coordinator) */
  editingCell: CellCoord | null;

  /** The sheet ID where editing is occurring */
  sheetId: string | null;

  /** Current editor value */
  value: string;

  /** Whether the picker (dropdown, date picker, etc.) is currently open */
  isPickerOpen: boolean;

  /** The resolved editor type for the current cell */
  editorType: CellEditorType;

  /**
   * Whether in Edit Mode (true) or Enter Mode (false).
   * Edit Mode: Arrow keys move cursor within text.
   * Enter Mode: Arrow keys commit and move selection (or insert formula refs).
   */
  isEditMode: boolean;

  /** Cursor position within the value */
  cursorPosition: number;

  /** Selection anchor within the value */
  selectionAnchor: number;

  /** Whether the editor currently has a text selection */
  hasSelection: boolean;

  /**
   * Merge bounds if the editing cell is part of a merged region.
   * Used for positioning overlays (date picker, dropdown) at merged cell bounds.
   */
  mergeBounds: CellRange | null;
}

// =============================================================================
// INTERNAL STATE TYPE FOR SELECTOR
// =============================================================================

interface EditorStateSlice {
  isEditing: boolean;
  isFormulaEditing: boolean;
  sheetId: string | null;
  value: string;
  isPickerOpen: boolean;
  editorType: CellEditorType;
  isEditMode: boolean;
  cursorPosition: number;
  selectionAnchor: number;
  hasSelection: boolean;
  mergeBounds: CellRange | null;
}

// =============================================================================
// EQUALITY FUNCTION
// =============================================================================

/**
 * Custom equality function for editor state comparison.
 * Only returns true (preventing re-render) if all tracked fields are identical.
 */
function editorStateEqual(a: EditorStateSlice, b: EditorStateSlice): boolean {
  // Compare mergeBounds by value (same coords = same merge region)
  const mergeBoundsEqual =
    a.mergeBounds === b.mergeBounds ||
    (a.mergeBounds !== null &&
      b.mergeBounds !== null &&
      a.mergeBounds.startRow === b.mergeBounds.startRow &&
      a.mergeBounds.startCol === b.mergeBounds.startCol &&
      a.mergeBounds.endRow === b.mergeBounds.endRow &&
      a.mergeBounds.endCol === b.mergeBounds.endCol);

  return (
    a.isEditing === b.isEditing &&
    a.isFormulaEditing === b.isFormulaEditing &&
    a.sheetId === b.sheetId &&
    a.value === b.value &&
    a.isPickerOpen === b.isPickerOpen &&
    a.editorType === b.editorType &&
    a.isEditMode === b.isEditMode &&
    a.cursorPosition === b.cursorPosition &&
    a.selectionAnchor === b.selectionAnchor &&
    a.hasSelection === b.hasSelection &&
    mergeBoundsEqual
  );
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing ONLY the editor state flags needed for rendering.
 *
 * This is a performance-optimized alternative to useEditor() for components
 * that only need to read editor state (not trigger actions).
 *
 * Key optimization: Uses useSelector with custom equality function to prevent
 * re-renders when unrelated editor state changes (like IME composing, validation, etc.).
 *
 * @example
 * ```tsx
 * function EditorDisplay() {
 * const { isEditing, editingCell, value } = useEditorState;
 *
 * if (!isEditing || !editingCell) return null;
 *
 * // Only re-renders when the tracked state fields change,
 * // NOT on every XState transition
 * return <div>Editing {value}</div>;
 * }
 * ```
 */
export function useEditorState(): UseEditorStateReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.editor;

  // Subscribe to ONLY the fields we need with custom equality
  // This prevents re-renders when unrelated editor state changes
  const stateSlice = useSelector(
    actor,
    (state) => ({
      isEditing: editorSelectors.isEditing(state),
      isFormulaEditing: editorSelectors.isFormulaEditing(state),
      sheetId: editorSelectors.sheetId(state),
      value: editorSelectors.value(state),
      isPickerOpen: editorSelectors.isPickerOpen(state),
      editorType: editorSelectors.editorType(state),
      isEditMode: editorSelectors.editModeFlag(state),
      cursorPosition: editorSelectors.cursorPosition(state),
      selectionAnchor: state.context.selectionAnchor,
      hasSelection: state.context.hasSelection,
      mergeBounds: editorSelectors.mergeBounds(state),
    }),
    editorStateEqual,
  );

  // Derive editingCell from coordinator (single source of truth)
  // @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
  const editingCell = useMemo(
    () => (stateSlice.isEditing ? coordinator.grid.getEditorSnapshot().editingCell : null),
    [stateSlice.isEditing, coordinator],
  );

  return useMemo(
    () => ({
      isEditing: stateSlice.isEditing,
      isFormulaEditing: stateSlice.isFormulaEditing,
      editingCell,
      sheetId: stateSlice.sheetId,
      value: stateSlice.value,
      isPickerOpen: stateSlice.isPickerOpen,
      editorType: stateSlice.editorType,
      isEditMode: stateSlice.isEditMode,
      cursorPosition: stateSlice.cursorPosition,
      selectionAnchor: stateSlice.selectionAnchor,
      hasSelection: stateSlice.hasSelection,
      mergeBounds: stateSlice.mergeBounds,
    }),
    [stateSlice, editingCell],
  );
}
