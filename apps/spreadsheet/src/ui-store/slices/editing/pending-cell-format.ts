/**
 * Pending Cell Format Slice
 *
 * Stores a "pending format" that was applied via keyboard shortcut (e.g., Cmd+B)
 * on an empty cell before typing. Because the Rust compute layer does not retain
 * format-only records for cells that have no value, toggling bold on an empty cell
 * before typing loses the format when the cell value is committed.
 *
 * The fix: when a format toggle fires on an empty cell (outside of editing mode),
 * record the intended format here. After the edit commits, re-apply the format
 * to the cell to ensure it persists alongside the newly written value.
 *
 * Lifecycle:
 * 1. TOGGLE_BOLD (etc.) on empty cell → setPendingCellFormat()
 * 2. User types + commits → applyPendingCellFormat() in sheet-coordinator
 * 3. Format re-applied via ws.formats.setRanges()
 * 4. clearPendingCellFormat()
 *
 * The pending format is cleared:
 * - After successful application (post-commit)
 * - When cell selection changes away from the pending cell
 * - When editing is cancelled (ESC)
 */

import type { CellFormat } from '@mog-sdk/contracts/core';
import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * A pending format waiting to be re-applied after a value is committed.
 */
export interface PendingCellFormatEntry {
  /** The accumulated format to apply after commit */
  format: Partial<CellFormat>;
  /** Row of the cell that received the format toggle */
  row: number;
  /** Column of the cell that received the format toggle */
  col: number;
  /** Sheet ID where the format was toggled */
  sheetId: string;
}

export interface PendingCellFormatSlice {
  /**
   * A pending cell format to re-apply after editing commits.
   * Set when format toggles fire on empty cells outside of editing mode.
   * null when no pending format is queued.
   */
  pendingCellFormat: PendingCellFormatEntry | null;

  /**
   * Set or merge a pending cell format.
   * If there is already a pending format for the same cell, merges the format.
   * If the cell differs, replaces the existing pending format.
   */
  setPendingCellFormat: (entry: PendingCellFormatEntry) => void;

  /** Clear the pending cell format (called after application or cancellation). */
  clearPendingCellFormat: () => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createPendingCellFormatSlice: StateCreator<
  PendingCellFormatSlice,
  [],
  [],
  PendingCellFormatSlice
> = (set) => ({
  pendingCellFormat: null,

  setPendingCellFormat: (entry) => {
    set((state) => {
      const existing = state.pendingCellFormat;
      // Merge format if same cell, replace otherwise
      if (
        existing &&
        existing.row === entry.row &&
        existing.col === entry.col &&
        existing.sheetId === entry.sheetId
      ) {
        return {
          pendingCellFormat: {
            ...entry,
            format: { ...existing.format, ...entry.format },
          },
        };
      }
      return { pendingCellFormat: entry };
    });
  },

  clearPendingCellFormat: () => {
    set({ pendingCellFormat: null });
  },
});
