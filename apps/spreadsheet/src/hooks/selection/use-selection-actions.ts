/**
 * Selection Actions Hook - Stable Function References Only
 *
 * This hook provides ONLY stable action functions for selection operations.
 * It does NOT subscribe to any state, so it will NEVER cause re-renders.
 *
 * Problem: useSelection() subscribes to full selection state, causing components
 * that only need to call selection actions to re-render on every state change.
 *
 * Solution: Split useSelection() into granular hooks following the Actor Access
 * Layer pattern. This hook provides actions only, no state subscription.
 *
 * @see engine/src/state/hooks/use-editor-actions.ts - Reference pattern
 */

import { useMemo } from 'react';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { Direction } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { TableConfig } from '@mog-sdk/contracts/tables';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// TYPES
// =============================================================================

export interface UseSelectionActionsReturn {
  // ===========================================================================
  // PROGRAMMATIC ACTIONS
  // ===========================================================================

  /**
   * Set selection programmatically.
   * @param ranges - Array of cell ranges to select
   * @param activeCell - The active cell (where typing goes)
   */
  setSelection: (ranges: CellRange[], activeCell: CellCoord) => void;

  /**
   * Reset selection to A1.
   */
  reset: () => void;

  /**
   * Select all cells (Ctrl+A).
   */
  selectAll: () => void;

  // ===========================================================================
  // HEADER SELECTION ACTIONS
  // ===========================================================================

  /**
   * Select entire row by clicking row header or keyboard shortcut.
   * @param row - Row index
   * @param shiftKey - Whether Shift is held (extends selection)
   * @param ctrlKey - Whether Ctrl/Cmd is held (multi-select)
   * @param fromKeyboard - Whether triggered by keyboard (stays in idle, no drag state)
   */
  selectRow: (row: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard?: boolean) => void;

  /**
   * Select entire column by clicking column header or keyboard shortcut.
   * @param col - Column index
   * @param shiftKey - Whether Shift is held (extends selection)
   * @param ctrlKey - Whether Ctrl/Cmd is held (multi-select)
   * @param fromKeyboard - Whether triggered by keyboard (stays in idle, no drag state)
   */
  selectColumn: (col: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard?: boolean) => void;

  // ===========================================================================
  // MOUSE ACTIONS
  // ===========================================================================

  /**
   * Handle mouse down on a cell. the optional `mergedRegion`
   * was dropped — the machine resolves merges itself via
   * `ctx.getMergedRegionAt`.
   *
   * @param cell - Cell coordinates
   * @param shiftKey - Whether Shift is held (extends selection)
   * @param ctrlKey - Whether Ctrl/Cmd is held (multi-select)
   */
  onMouseDown: (cell: CellCoord, shiftKey: boolean, ctrlKey: boolean) => void;

  /**
   * Handle mouse move while selecting.
   * @param cell - Current cell coordinates
   */
  onMouseMove: (cell: CellCoord) => void;

  /**
   * Handle mouse up (end selection).
   */
  onMouseUp: () => void;

  // ===========================================================================
  // KEYBOARD NAVIGATION
  // ===========================================================================

  /**
   * Handle arrow key navigation.
   * @param direction - Arrow direction ('up' | 'down' | 'left' | 'right')
   * @param shiftKey - Whether Shift is held (extends selection)
   */
  onKeyArrow: (direction: Direction, shiftKey: boolean) => void;

  /**
   * Handle Ctrl+Arrow for jump navigation.
   * @param direction - Arrow direction ('up' | 'down' | 'left' | 'right')
   */
  onKeyCtrlArrow: (direction: Direction) => void;

  /**
   * Handle Home key.
   * @param ctrlKey - Whether Ctrl is held (jump to A1 vs start of row)
   */
  onKeyHome: (ctrlKey: boolean) => void;

  /**
   * Handle End key.
   * @param ctrlKey - Whether Ctrl is held (jump to last cell vs end of row)
   */
  onKeyEnd: (ctrlKey: boolean) => void;

  /**
   * Handle Tab key.
   * @param shiftKey - Whether Shift is held (reverse direction)
   */
  onKeyTab: (shiftKey: boolean) => void;

  /**
   * Handle Enter key navigation.
   * @param shiftKey - Whether Shift is held (reverse direction)
   */
  onKeyEnter: (shiftKey: boolean) => void;

  /**
   * Navigate to specific cell (used for table-aware Tab).
   * @param targetCell - Target cell coordinates
   */
  tabNavigate: (targetCell: CellCoord) => void;

  /**
   * Handle Tab key with table-awareness.
   * If active cell is in a table, Tab navigates within table bounds:
   * - Tab: Move right within row, wrap to next row at end
   * - Shift+Tab: Move left within row, wrap to previous row at start
   *
   * @param activeCell - Current active cell (caller must provide via useActiveCell)
   * @param shiftKey - Whether Shift is held
   * @param getTableAtCell - Function to check if a cell is in a table
   */
  onKeyTabTableAware: (
    activeCell: CellCoord,
    shiftKey: boolean,
    getTableAtCell: (row: number, col: number) => TableConfig | undefined,
  ) => void;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for selection actions with stable function references.
 *
 * This is a performance-optimized alternative to useSelection() for components
 * that only need to trigger selection actions but don't need to read state.
 *
 * Key optimization: Returns only stable memoized functions. No subscriptions,
 * no state, no re-renders.
 *
 * @example
 * ```tsx
 * function SelectionButton() {
 * const { selectAll } = useSelectionActions;
 *
 * // This component NEVER re-renders due to selection state changes
 * return <button onClick={selectAll}>Select All</button>;
 * }
 * ```
 */
export function useSelectionActions(): UseSelectionActionsReturn {
  const coordinator = useCoordinator();

  // Get pre-created commands from the grid system (stable references)
  const commands = coordinator.grid.access.commands.selection;

  // ===========================================================================
  // PROGRAMMATIC ACTIONS
  // ===========================================================================

  const setSelection = useMemo(
    () => (ranges: CellRange[], activeCell: CellCoord) => {
      commands.setSelection(ranges, activeCell);
    },
    [commands],
  );

  const reset = useMemo(
    () => () => {
      commands.reset();
    },
    [commands],
  );

  const selectAll = useMemo(
    () => () => {
      commands.selectAll();
    },
    [commands],
  );

  // ===========================================================================
  // HEADER SELECTION ACTIONS
  // ===========================================================================

  const selectRow = useMemo(
    () =>
      (row: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard = false) => {
        commands.selectRow(row, shiftKey, ctrlKey, fromKeyboard);
      },
    [commands],
  );

  const selectColumn = useMemo(
    () =>
      (col: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard = false) => {
        commands.selectColumn(col, shiftKey, ctrlKey, fromKeyboard);
      },
    [commands],
  );

  // ===========================================================================
  // MOUSE ACTIONS
  // ===========================================================================

  const onMouseDown = useMemo(
    () => (cell: CellCoord, shiftKey: boolean, ctrlKey: boolean) => {
      commands.mouseDown(cell, shiftKey, ctrlKey);
    },
    [commands],
  );

  const onMouseMove = useMemo(
    () => (cell: CellCoord) => {
      commands.mouseMove(cell);
    },
    [commands],
  );

  const onMouseUp = useMemo(
    () => () => {
      commands.mouseUp();
    },
    [commands],
  );

  // ===========================================================================
  // KEYBOARD NAVIGATION
  // ===========================================================================

  const onKeyArrow = useMemo(
    () => (direction: Direction, shiftKey: boolean) => {
      commands.keyArrow(direction, shiftKey);
    },
    [commands],
  );

  const onKeyCtrlArrow = useMemo(
    () => (direction: Direction) => {
      commands.keyCtrlArrow(direction);
    },
    [commands],
  );

  const onKeyHome = useMemo(
    () => (ctrlKey: boolean) => {
      commands.keyHome(ctrlKey);
    },
    [commands],
  );

  const onKeyEnd = useMemo(
    () => (ctrlKey: boolean) => {
      commands.keyEnd(ctrlKey);
    },
    [commands],
  );

  const onKeyTab = useMemo(
    () => (shiftKey: boolean) => {
      commands.keyTab(shiftKey);
    },
    [commands],
  );

  const onKeyEnter = useMemo(
    () => (shiftKey: boolean) => {
      commands.keyEnter(shiftKey);
    },
    [commands],
  );

  const tabNavigate = useMemo(
    () => (targetCell: CellCoord) => {
      commands.tabNavigate(targetCell);
    },
    [commands],
  );

  /**
   * Table-aware Tab navigation.
   * Navigates within table bounds, wrapping at row ends.
   * Caller must provide activeCell via useActiveCell() to keep this hook pure.
   */
  const onKeyTabTableAware = useMemo(
    () =>
      (
        activeCell: CellCoord,
        shiftKey: boolean,
        getTableAtCell: (row: number, col: number) => TableConfig | undefined,
      ) => {
        const table = getTableAtCell(activeCell.row, activeCell.col);

        if (!table) {
          // Not in a table, use default Tab behavior
          commands.keyTab(shiftKey);
          return;
        }

        // In a table - compute next cell within table bounds
        const { range, hasHeaderRow, hasTotalRow } = table;

        // Calculate data area (exclude header and total rows from navigation)
        const dataStartRow = hasHeaderRow ? range.startRow + 1 : range.startRow;
        const dataEndRow = hasTotalRow ? range.endRow - 1 : range.endRow;

        let newRow = activeCell.row;
        let newCol = activeCell.col;

        if (shiftKey) {
          // Shift+Tab: Move left, wrap to previous row at start
          newCol--;
          if (newCol < range.startCol) {
            // Wrap to end of previous row
            newCol = range.endCol;
            newRow--;
            if (newRow < dataStartRow) {
              // At start of table data, wrap to end
              newRow = dataEndRow;
            }
          }
        } else {
          // Tab: Move right, wrap to next row at end
          newCol++;
          if (newCol > range.endCol) {
            // Wrap to start of next row
            newCol = range.startCol;
            newRow++;
            if (newRow > dataEndRow) {
              // At end of table data, wrap to start
              newRow = dataStartRow;
            }
          }
        }

        // Use tabNavigate command for precise navigation
        commands.tabNavigate({ row: newRow, col: newCol });
      },
    [commands],
  );

  // Return stable object - all functions are memoized
  return useMemo(
    () => ({
      setSelection,
      reset,
      selectAll,
      selectRow,
      selectColumn,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onKeyArrow,
      onKeyCtrlArrow,
      onKeyHome,
      onKeyEnd,
      onKeyTab,
      onKeyEnter,
      tabNavigate,
      onKeyTabTableAware,
    }),
    [
      setSelection,
      reset,
      selectAll,
      selectRow,
      selectColumn,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onKeyArrow,
      onKeyCtrlArrow,
      onKeyHome,
      onKeyEnd,
      onKeyTab,
      onKeyEnter,
      tabNavigate,
      onKeyTabTableAware,
    ],
  );
}
