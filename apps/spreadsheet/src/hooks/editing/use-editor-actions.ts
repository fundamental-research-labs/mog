/**
 * Editor Actions Hook - Stable Function References Only
 *
 * This hook provides ONLY stable action functions for editor operations.
 * It does NOT subscribe to any state, so it will NEVER cause re-renders.
 *
 * Problem: useEditor() subscribes to full editor state via identity selector,
 * causing 620+ React re-renders during normal operation. Components that only
 * need to call editor actions (startEditing, commit, cancel) are forced to
 * re-render on every state transition.
 *
 * Solution: Split useEditor() into granular hooks following the established pattern
 * used for scroll (useScrollActions) and selection hooks.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 14: Render Isolation
 */

import { useMemo } from 'react';

import { clipboardSelectors } from '../../selectors';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { Direction } from '@mog-sdk/contracts/machines';
import type { MutationResult } from '@mog-sdk/contracts/protection';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { protectionError, successResult } from '@mog/spreadsheet-utils/protection';

import { useReadOnly, useWorkbook } from '../../infra/context';
import type { EditorEntryMode } from '../../systems/grid-editing/machines/editor/types';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// TYPES
// =============================================================================

export interface UseEditorActionsReturn {
  // ===========================================================================
  // EDITING ACTIONS
  // ===========================================================================

  /**
   * Start editing a cell.
   * Returns MutationResult - check success before proceeding.
   * If the cell is protected, returns { success: false, reason: '...' }
   *
   * @param cell - The cell to edit
   * @param sheetId - The sheet ID
   * @param initialValue - Initial value to show in editor
   * @param entryMode - How editing was initiated (determines Enter Mode vs Edit Mode)
   * - 'F2', 'doubleClick', 'formulaBar' -> Edit Mode (arrows move cursor)
   * - 'typing' (default) -> Enter Mode (arrows commit and move)
   * @param cursorPosition - Initial cursor position (for double-click at specific position)
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

  /**
   * Update the editor value.
   *
   * The cursor position MUST be the DOM caret (`selectionStart`). The
   * editor machine mirrors it instead of inventing one — passing
   * `value.length` from a mid-typing surface re-introduces the
   * mid-string-edit corruption fixed in
   */
  input: (value: string, cursorPosition: number) => void;

  /** Set cursor position */
  setCursor: (position: number) => void;

  /** Commit the edit with optional direction to move selection */
  commit: (direction: Direction | 'none') => void;

  /**
   * Commit the edit using a semantic key.
   * Issue 8: Settings Panel - Enter key direction is configurable.
   *
   * @param commitKey - The key that triggered the commit
   */
  commitWithKey: (commitKey: 'enter' | 'shift-enter' | 'tab' | 'shift-tab') => void;

  /** Cancel the edit */
  cancel: () => void;

  /** Retry after validation error */
  retry: () => void;

  // ===========================================================================
  // IME ACTIONS
  // ===========================================================================

  /** Signal IME composition start */
  imeStart: () => void;

  /** Update IME composition text */
  imeUpdate: (compositionText: string) => void;

  /** End IME composition */
  imeEnd: (finalText: string) => void;

  /** Cancel IME composition without committing */
  imeCancelComposition: () => void;

  // ===========================================================================
  // TEXT SELECTION ACTIONS
  // ===========================================================================

  /** Select all text in the editor (Ctrl+A) */
  selectAllText: () => void;

  /** Extend selection one character to the right (Shift+Right) */
  selectRight: () => void;

  // ===========================================================================
  // FORMULA ACTIONS
  // ===========================================================================

  /** Insert a formula range reference */
  insertFormulaRange: (range: CellRange, color: string) => void;

  /** Update a formula range reference after drag-resize */
  updateFormulaRange: (rangeIndex: number, newRange: CellRange) => void;

  // ===========================================================================
  // PICKER ACTIONS
  // ===========================================================================

  /** Open the picker (dropdown, date picker, etc.) */
  openPicker: () => void;

  /** Close the picker */
  closePicker: () => void;

  /** Select an item from the picker */
  selectPickerItem: (value: unknown) => void;
}

// =============================================================================
// CUT RANGE CHECK HELPER
// =============================================================================

/**
 * Check if a cell is within any of the cut source ranges.
 * Returns true if the cell is in a cut range (should block editing).
 */
function isCellInCutRange(clipboardActor: any, sheetId: SheetId, cell: CellCoord): boolean {
  if (!clipboardActor) return false;

  const snapshot = clipboardActor.getSnapshot();
  if (!snapshot) return false;

  if (!clipboardSelectors.hasCut(snapshot)) {
    return false;
  }

  const clipboardData = clipboardSelectors.data(snapshot);
  if (!clipboardData || clipboardData.sourceSheetId !== sheetId) {
    return false;
  }

  const sourceRanges = clipboardSelectors.sourceRanges(snapshot);
  if (!sourceRanges) {
    return false;
  }

  for (const range of sourceRanges) {
    if (
      cell.row >= range.startRow &&
      cell.row <= range.endRow &&
      cell.col >= range.startCol &&
      cell.col <= range.endCol
    ) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for editor actions with stable function references.
 *
 * This is a performance-optimized alternative to useEditor() for components
 * that only need to trigger editor actions but don't need to read state.
 *
 * Key optimization: Returns only stable memoized functions. No subscriptions,
 * no state, no re-renders.
 *
 * @example
 * ```tsx
 * function EditButton() {
 * const { startEditing } = useEditorActions;
 *
 * // This component NEVER re-renders due to editor state changes
 * return <button onClick={ => startEditing({ row: 0, col: 0 }, 'sheet1')}>Edit</button>;
 * }
 * ```
 */
export function useEditorActions(): UseEditorActionsReturn {
  const coordinator = useCoordinator();
  const wb = useWorkbook();
  const readOnly = useReadOnly();

  // Get pre-created commands from the grid system (stable references)
  const commands = coordinator.grid.access.commands.editor;

  // ===========================================================================
  // EDITING ACTIONS
  // ===========================================================================

  const canEditCell = useMemo(
    () =>
      async (cell: CellCoord, sheetId: SheetId): Promise<MutationResult> => {
        // Block editing cells in cut range
        const clipboardActor = coordinator.grid.access.actors.clipboard;
        if (isCellInCutRange(clipboardActor, sheetId, cell)) {
          return { success: false, error: 'PROTECTED', reason: 'Cannot edit cells in cut range' };
        }

        const ws = wb.getSheetById(sheetId);

        // CSE partial-array rejection now lives in Rust (`compute-core`
        // returns `ComputeError::PartialArrayWrite` from `set_cell` for
        // any cell covered by a CSE anchor's projection). The TS guard
        // that previously duplicated that logic here was deleted along
        // with the `arrayFormulaCells` Zustand registry; the editor
        // commit path surfaces the Rust error via the standard error
        // path. Dynamic-array spills are NOT covered — the spill member
        // edit places a blocker literal and raises `#SPILL!` at the
        // anchor (existing scheduler/spill behavior, unchanged).

        const fastEditability = ws.protection.canEditCellFast(cell.row, cell.col);
        if (fastEditability === 'unknown') {
          const editable = await ws.protection.canEditCell(cell.row, cell.col);
          if (!editable) {
            return protectionError('Cannot edit locked cell on protected sheet');
          }
        }
        return successResult();
      },
    [coordinator, wb],
  );

  const startEditing = useMemo(
    () =>
      async (
        cell: CellCoord,
        sheetId: SheetId,
        initialValue?: string,
        entryMode?: EditorEntryMode,
        cursorPosition?: number,
        openDropdown?: boolean,
      ): Promise<MutationResult> => {
        // Read-only mode: block all human UI editing
        if (readOnly) {
          return protectionError('Document is in read-only mode');
        }

        const geometry = coordinator.renderer.getGeometry();
        const mergedRegion = geometry?.getMergeAnchor(cell.row, cell.col) ?? undefined;
        return coordinator.grid.beginEditSession({
          sheetId,
          cell,
          entryMode: entryMode ?? 'typing',
          initialTextHint: initialValue,
          cursorPositionHint: cursorPosition,
          mergedRegion,
          openDropdown,
        });
      },
    [coordinator, readOnly],
  );

  const input = useMemo(
    () => (value: string, cursorPosition: number) => {
      commands.input(value, cursorPosition);
    },
    [commands],
  );

  const setCursor = useMemo(
    () => (position: number) => {
      commands.setCursor(position);
    },
    [commands],
  );

  const commit = useMemo(
    () => (direction: Direction | 'none') => {
      commands.commit(direction);
    },
    [commands],
  );

  const commitWithKey = useMemo(
    () => (commitKey: 'enter' | 'shift-enter' | 'tab' | 'shift-tab') => {
      coordinator.grid.commitWithKey(commitKey);
    },
    [coordinator],
  );

  const cancel = useMemo(
    () => () => {
      commands.cancel();
    },
    [commands],
  );

  const retry = useMemo(
    () => () => {
      commands.retry();
    },
    [commands],
  );

  // ===========================================================================
  // IME ACTIONS
  // ===========================================================================

  const imeStart = useMemo(
    () => () => {
      commands.imeStart();
    },
    [commands],
  );

  const imeUpdate = useMemo(
    () => (compositionText: string) => {
      commands.imeUpdate(compositionText);
    },
    [commands],
  );

  const imeEnd = useMemo(
    () => (finalText: string) => {
      commands.imeEnd(finalText);
    },
    [commands],
  );

  const imeCancelComposition = useMemo(
    () => () => {
      commands.imeCancelComposition();
    },
    [commands],
  );

  // ===========================================================================
  // TEXT SELECTION ACTIONS
  // ===========================================================================

  const selectAllText = useMemo(
    () => () => {
      commands.selectAll();
    },
    [commands],
  );

  const selectRight = useMemo(
    () => () => {
      commands.selectRight();
    },
    [commands],
  );

  // ===========================================================================
  // FORMULA ACTIONS
  // ===========================================================================

  const insertFormulaRange = useMemo(
    () => (range: CellRange, color: string) => {
      commands.formulaRangeSelected(range, color);
    },
    [commands],
  );

  const updateFormulaRange = useMemo(
    () => (rangeIndex: number, newRange: CellRange) => {
      commands.updateFormulaRange(rangeIndex, newRange);
    },
    [commands],
  );

  // ===========================================================================
  // PICKER ACTIONS
  // ===========================================================================

  const openPicker = useMemo(
    () => () => {
      commands.openPicker();
    },
    [commands],
  );

  const closePicker = useMemo(
    () => () => {
      commands.closePicker();
    },
    [commands],
  );

  const selectPickerItem = useMemo(
    () => (value: unknown) => {
      commands.pickerSelect(value);
    },
    [commands],
  );

  // Return stable object - all functions are memoized
  return useMemo(
    () => ({
      startEditing,
      canEditCell,
      input,
      setCursor,
      commit,
      commitWithKey,
      cancel,
      retry,
      imeStart,
      imeUpdate,
      imeEnd,
      imeCancelComposition,
      selectAllText,
      selectRight,
      insertFormulaRange,
      updateFormulaRange,
      openPicker,
      closePicker,
      selectPickerItem,
    }),
    [
      startEditing,
      canEditCell,
      input,
      setCursor,
      commit,
      commitWithKey,
      cancel,
      retry,
      imeStart,
      imeUpdate,
      imeEnd,
      imeCancelComposition,
      selectAllText,
      selectRight,
      insertFormulaRange,
      updateFormulaRange,
      openPicker,
      closePicker,
      selectPickerItem,
    ],
  );
}
