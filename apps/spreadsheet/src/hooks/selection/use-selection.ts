/**
 * Selection Hook
 *
 * React hook that wraps the selection state machine actor.
 * Provides type-safe access to selection state and actions.
 *
 * ARCHITECTURE: Uses selectors from contracts for reactive reads and commands for writes.
 * @see ARCHITECTURE.md - State Machine 2: Selection
 */

import { useSelector } from '@xstate/react';
import { useMemo } from 'react';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { Direction, SelectionSnapshot } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { TableConfig } from '@mog-sdk/contracts/tables';
import type { SelectionSnapshotResult } from '../../systems/grid-editing/machines/selection/derived-state';
import { getSelectionSnapshot } from '../../systems/grid-editing/machines/selection/derived-state';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// EQUALITY FUNCTIONS
// =============================================================================

/**
 * Compare two CellCoord values for equality.
 * Returns true if both are null, or if both have the same row and col.
 */
function cellCoordEqual(a: CellCoord | null, b: CellCoord | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.row === b.row && a.col === b.col;
}

/**
 * Compare two CellRange values for equality.
 * Returns true if both are null, or if both have the same bounds and flags.
 */
function cellRangeEqual(a: CellRange | null, b: CellRange | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.startRow === b.startRow &&
    a.startCol === b.startCol &&
    a.endRow === b.endRow &&
    a.endCol === b.endCol &&
    a.isFullRow === b.isFullRow &&
    a.isFullColumn === b.isFullColumn
  );
}

/**
 * Compare two arrays of CellRange for equality.
 * Uses deep comparison of each range.
 */
function rangesEqual(a: CellRange[], b: CellRange[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!cellRangeEqual(a[i], b[i])) return false;
  }
  return true;
}

/**
 * Compare two ReadonlySet<number> for equality.
 * Returns true if both sets have the same size and elements.
 */
function setsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  // Use forEach to avoid downlevelIteration requirement
  let equal = true;
  a.forEach((item) => {
    if (!b.has(item)) equal = false;
  });
  return equal;
}

/**
 * Custom equality function for SelectionSnapshotResult comparison.
 * Only returns true (preventing re-render) if all tracked fields are identical.
 *
 * This is critical for performance - we only want to re-render when
 * selection state actually changes, not on every XState state machine transition.
 */
function selectionSnapshotEqual(a: SelectionSnapshotResult, b: SelectionSnapshotResult): boolean {
  // Quick reference check
  if (a === b) return true;

  // Compare boolean/primitive fields first (fast comparisons)
  if (
    a.isSelecting !== b.isSelecting ||
    a.isFormulaMode !== b.isFormulaMode ||
    a.isDraggingFillHandle !== b.isDraggingFillHandle ||
    a.isRightDraggingFillHandle !== b.isRightDraggingFillHandle ||
    a.direction !== b.direction ||
    a.isSelectingColumn !== b.isSelectingColumn ||
    a.isSelectingRow !== b.isSelectingRow ||
    a.isDraggingCells !== b.isDraggingCells ||
    a.isResizingHeader !== b.isResizingHeader ||
    a.isResizingTable !== b.isResizingTable ||
    a.hasFullRowSelection !== b.hasFullRowSelection ||
    a.hasFullColumnSelection !== b.hasFullColumnSelection ||
    a.dragMode !== b.dragMode ||
    a.resizeType !== b.resizeType ||
    a.resizeIndex !== b.resizeIndex ||
    a.resizeCurrentSize !== b.resizeCurrentSize ||
    a.anchorCol !== b.anchorCol ||
    a.anchorRow !== b.anchorRow ||
    a.tableResizeId !== b.tableResizeId ||
    a.tableResizeTargetRow !== b.tableResizeTargetRow ||
    a.tableResizeTargetCol !== b.tableResizeTargetCol
  ) {
    return false;
  }

  // Compare CellCoord fields
  if (
    !cellCoordEqual(a.activeCell, b.activeCell) ||
    !cellCoordEqual(a.anchor, b.anchor) ||
    !cellCoordEqual(a.fillHandleStart, b.fillHandleStart) ||
    !cellCoordEqual(a.fillHandleEnd, b.fillHandleEnd) ||
    !cellCoordEqual(a.dragTargetCell, b.dragTargetCell)
  ) {
    return false;
  }

  // Compare CellRange fields
  if (
    !cellRangeEqual(a.dragSourceRange, b.dragSourceRange) ||
    !cellRangeEqual(a.tableResizeStartBounds, b.tableResizeStartBounds)
  ) {
    return false;
  }

  // Compare ranges array (most expensive for large selections)
  if (!rangesEqual(a.ranges, b.ranges)) {
    return false;
  }

  // Compare Set fields (derived state)
  if (
    !setsEqual(a.selectedRows, b.selectedRows) ||
    !setsEqual(a.selectedCols, b.selectedCols) ||
    !setsEqual(a.fullySelectedRows, b.fullySelectedRows) ||
    !setsEqual(a.fullySelectedCols, b.fullySelectedCols)
  ) {
    return false;
  }

  return true;
}

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseSelectionReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** All selected ranges (supports multi-selection) */
  ranges: CellRange[];

  /** The active cell (where typing goes, shown with dark border) */
  activeCell: CellCoord;

  /** Anchor cell for range selection (where drag started) */
  anchor: CellCoord | null;

  /** Whether currently dragging to select */
  isSelecting: boolean;

  /** Whether in formula range selection mode */
  isFormulaMode: boolean;

  /** Whether dragging the fill handle */
  isDraggingFillHandle: boolean;

  /** Fill handle drag start cell */
  fillHandleStart: CellCoord | null;

  /** Fill handle drag current end cell */
  fillHandleEnd: CellCoord | null;

  /** Whether currently selecting columns via header drag */
  isSelectingColumn: boolean;

  /** Whether currently selecting rows via header drag */
  isSelectingRow: boolean;

  /** Full snapshot for advanced usage */
  snapshot: SelectionSnapshot & {
    anchor: CellCoord | null;
    fillHandleStart: CellCoord | null;
    fillHandleEnd: CellCoord | null;
    isSelectingColumn: boolean;
    isSelectingRow: boolean;
    anchorCol: number | null;
    anchorRow: number | null;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // MOUSE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Handle mouse down on a cell */
  onMouseDown: (cell: CellCoord, shiftKey: boolean, ctrlKey: boolean) => void;

  /** Handle mouse move while selecting */
  onMouseMove: (cell: CellCoord) => void;

  /** Handle mouse up */
  onMouseUp: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // KEYBOARD ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Handle arrow key navigation */
  onKeyArrow: (direction: Direction, shiftKey: boolean) => void;

  /** Handle Ctrl+Arrow for jump navigation */
  onKeyCtrlArrow: (direction: Direction) => void;

  /** Handle Home key */
  onKeyHome: (ctrlKey: boolean) => void;

  /** Handle End key */
  onKeyEnd: (ctrlKey: boolean) => void;

  /** Handle Tab key (Tables) */
  onKeyTab: (shiftKey: boolean) => void;

  /**
   * Handle Tab key with table-awareness (Tables)
   * If active cell is in a table, Tab navigates within table bounds:
   * - Tab: Move right within row, wrap to next row at end
   * - Shift+Tab: Move left within row, wrap to previous row at start
   * @param shiftKey - Whether Shift is held
   * @param getTableAtCell - Function to check if a cell is in a table
   */
  onKeyTabTableAware: (
    shiftKey: boolean,
    getTableAtCell: (row: number, col: number) => TableConfig | undefined,
  ) => void;

  /** Handle Enter key navigation (Tables) */
  onKeyEnter: (shiftKey: boolean) => void;

  /** Navigate to specific cell (used for table-aware Tab) */
  tabNavigate: (targetCell: CellCoord) => void;

  /** Select all cells (Ctrl+A) */
  selectAll: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // FILL HANDLE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Start dragging the fill handle (left-click) */
  startFillHandleDrag: () => void;

  /** Update fill handle drag position */
  onFillHandleDrag: (cell: CellCoord) => void;

  /** End fill handle drag */
  endFillHandleDrag: () => void;

  // Right-click fill handle drag (shows context menu on release)
  /** Start right-click dragging the fill handle */
  startRightFillHandleDrag: () => void;

  /** Update right-click fill handle drag position */
  onRightFillHandleDrag: (cell: CellCoord) => void;

  /** End right-click fill handle drag */
  endRightFillHandleDrag: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // PROGRAMMATIC ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set selection programmatically */
  setSelection: (ranges: CellRange[], activeCell: CellCoord) => void;

  /** Reset selection to A1 */
  reset: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER SELECTION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Select entire column by clicking column header or keyboard shortcut */
  selectColumn: (col: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard?: boolean) => void;

  /** Select entire row by clicking row header or keyboard shortcut */
  selectRow: (row: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard?: boolean) => void;

  /** Handle mouse move during column header selection drag */
  onColumnMouseMove: (col: number) => void;

  /** Handle mouse move during row header selection drag */
  onRowMouseMove: (row: number) => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER RESIZE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Whether currently resizing a column or row header */
  isResizingHeader: boolean;

  /** Type of resize: 'column' | 'row' | null */
  resizeType: 'column' | 'row' | null;

  /** Index of the column or row being resized */
  resizeIndex: number | null;

  /** Current size during resize (for visual feedback) */
  resizeCurrentSize: number | null;

  /** Start resizing a column header */
  startColumnResize: (
    col: number,
    startPosition: number,
    startSize: number,
    /** C.2: Optional array of columns for multi-select resize */
    cols?: number[],
    /** C.2: Optional map of starting sizes for multi-select resize */
    startSizes?: Map<number, number>,
  ) => void;

  /** Start resizing a row header */
  startRowResize: (
    row: number,
    startPosition: number,
    startSize: number,
    /** C.2: Optional array of rows for multi-select resize */
    rows?: number[],
    /** C.2: Optional map of starting sizes for multi-select resize */
    startSizes?: Map<number, number>,
  ) => void;

  /** Update resize position during drag */
  onResizeMove: (position: number) => void;

  /** End resize operation */
  endResize: () => void;

  /** Cancel resize operation (e.g., Escape key) */
  cancelResize: () => void;

  // ===========================================================================
  // Table Resize State (Tables - 10.4)
  // ===========================================================================

  /** True if a table is being resized */
  isResizingTable: boolean;

  /** ID of table being resized */
  tableResizeId: string | null;

  /** Start resizing a table */
  startTableResize: (tableId: string, tableBounds: CellRange) => void;

  /** Update table resize target during drag */
  onTableResizeMove: (targetRow: number, targetCol: number) => void;

  /** End table resize operation */
  endTableResize: () => void;

  /** Cancel table resize operation */
  cancelTableResize: () => void;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing and controlling the selection state machine.
 *
 * @example
 * ```tsx
 * function CellGrid() {
 * const {
 * ranges,
 * activeCell,
 * isSelecting,
 * onMouseDown,
 * onMouseMove,
 * onMouseUp,
 * } = useSelection;
 *
 * return (
 * <canvas
 * onMouseDown={(e) => {
 * const cell = getCellFromPoint(e);
 * onMouseDown(cell, e.shiftKey, e.ctrlKey || e.metaKey);
 * }}
 * onMouseMove={(e) => {
 * if (isSelecting) {
 * const cell = getCellFromPoint(e);
 * onMouseMove(cell);
 * }
 * }}
 * onMouseUp={onMouseUp}
 * />
 * );
 * }
 * ```
 */
export function useSelection(): UseSelectionReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;

  // Subscribe to the full snapshot using getSelectionSnapshot with custom equality
  // to prevent unnecessary re-renders when state transitions don't change the snapshot values
  const snapshot = useSelector(actor, getSelectionSnapshot, selectionSnapshotEqual);

  // Get pre-created commands from the grid system (stable references)
  const commands = coordinator.grid.access.commands.selection;

  // ═══════════════════════════════════════════════════════════════════════════
  // MOUSE ACTIONS (use commands instead of actor.send)
  // ═══════════════════════════════════════════════════════════════════════════

  const onMouseDown = useMemo(
    () => (cell: CellCoord, shiftKey: boolean, ctrlKey: boolean) => {
      // The machine resolves merges itself via ctx.getMergedRegionAt; this
      // signature stops passing the pre-resolved region.
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

  // ═══════════════════════════════════════════════════════════════════════════
  // KEYBOARD ACTIONS (use commands instead of actor.send)
  // ═══════════════════════════════════════════════════════════════════════════

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

  /**
   * Table-aware Tab navigation (Tables)
   * Navigates within table bounds, wrapping at row ends.
   */
  const onKeyTabTableAware = useMemo(
    () =>
      (
        shiftKey: boolean,
        getTableAtCell: (row: number, col: number) => TableConfig | undefined,
      ) => {
        const { activeCell } = snapshot;
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
    [commands, snapshot],
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

  const selectAll = useMemo(
    () => () => {
      commands.selectAll();
    },
    [commands],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // FILL HANDLE ACTIONS (use commands instead of actor.send)
  // ═══════════════════════════════════════════════════════════════════════════

  const startFillHandleDrag = useMemo(
    () => () => {
      commands.startFillHandleDrag();
    },
    [commands],
  );

  const onFillHandleDrag = useMemo(
    () => (cell: CellCoord) => {
      commands.fillHandleDrag(cell);
    },
    [commands],
  );

  const endFillHandleDrag = useMemo(
    () => () => {
      commands.endFillHandleDrag();
    },
    [commands],
  );

  // Right-click fill handle drag (shows context menu on release)
  const startRightFillHandleDrag = useMemo(
    () => () => {
      commands.startRightFillHandleDrag();
    },
    [commands],
  );

  const onRightFillHandleDrag = useMemo(
    () => (cell: CellCoord) => {
      commands.rightFillHandleDrag(cell);
    },
    [commands],
  );

  const endRightFillHandleDrag = useMemo(
    () => () => {
      commands.endRightFillHandleDrag();
    },
    [commands],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PROGRAMMATIC ACTIONS (use commands instead of actor.send)
  // ═══════════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER SELECTION ACTIONS - use commands instead of actor.send
  // ═══════════════════════════════════════════════════════════════════════════

  const selectColumn = useMemo(
    () =>
      (col: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard = false) => {
        commands.selectColumn(col, shiftKey, ctrlKey, fromKeyboard);
      },
    [commands],
  );

  const selectRow = useMemo(
    () =>
      (row: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard = false) => {
        commands.selectRow(row, shiftKey, ctrlKey, fromKeyboard);
      },
    [commands],
  );

  const onColumnMouseMove = useMemo(
    () => (col: number) => {
      commands.columnMouseMove(col);
    },
    [commands],
  );

  const onRowMouseMove = useMemo(
    () => (row: number) => {
      commands.rowMouseMove(row);
    },
    [commands],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER RESIZE ACTIONS - use commands instead of actor.send
  // ═══════════════════════════════════════════════════════════════════════════

  const startColumnResize = useMemo(
    () =>
      (
        col: number,
        startPosition: number,
        startSize: number,
        cols?: number[],
        startSizes?: Map<number, number>,
      ) => {
        commands.startColumnResize(col, startPosition, startSize, cols, startSizes);
      },
    [commands],
  );

  const startRowResize = useMemo(
    () =>
      (
        row: number,
        startPosition: number,
        startSize: number,
        rows?: number[],
        startSizes?: Map<number, number>,
      ) => {
        commands.startRowResize(row, startPosition, startSize, rows, startSizes);
      },
    [commands],
  );

  const onResizeMove = useMemo(
    () => (position: number) => {
      commands.resizeMove(position);
    },
    [commands],
  );

  const endResize = useMemo(
    () => () => {
      commands.endResize();
    },
    [commands],
  );

  const cancelResize = useMemo(
    () => () => {
      commands.cancelResize();
    },
    [commands],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLE RESIZE ACTIONS (Tables - 10.4) - use commands instead of actor.send
  // ═══════════════════════════════════════════════════════════════════════════

  const startTableResize = useMemo(
    () => (tableId: string, tableBounds: CellRange) => {
      commands.startTableResize(tableId, tableBounds);
    },
    [commands],
  );

  const onTableResizeMove = useMemo(
    () => (targetRow: number, targetCol: number) => {
      commands.tableResizeMove(targetRow, targetCol);
    },
    [commands],
  );

  const endTableResize = useMemo(
    () => () => {
      commands.endTableResize();
    },
    [commands],
  );

  const cancelTableResize = useMemo(
    () => () => {
      commands.cancelTableResize();
    },
    [commands],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // State
      ranges: snapshot.ranges,
      activeCell: snapshot.activeCell,
      anchor: snapshot.anchor,
      isSelecting: snapshot.isSelecting,
      isFormulaMode: snapshot.isFormulaMode,
      isDraggingFillHandle: snapshot.isDraggingFillHandle,
      fillHandleStart: snapshot.fillHandleStart,
      fillHandleEnd: snapshot.fillHandleEnd,
      isSelectingColumn: snapshot.isSelectingColumn,
      isSelectingRow: snapshot.isSelectingRow,
      snapshot,

      // Mouse actions
      onMouseDown,
      onMouseMove,
      onMouseUp,

      // Keyboard actions
      onKeyArrow,
      onKeyCtrlArrow,
      onKeyHome,
      onKeyEnd,
      onKeyTab,
      onKeyTabTableAware,
      onKeyEnter,
      tabNavigate,
      selectAll,

      // Fill handle actions
      startFillHandleDrag,
      onFillHandleDrag,
      endFillHandleDrag,
      // Right-click fill handle drag
      startRightFillHandleDrag,
      onRightFillHandleDrag,
      endRightFillHandleDrag,

      // Programmatic actions
      setSelection,
      reset,

      // Header selection actions
      selectColumn,
      selectRow,
      onColumnMouseMove,
      onRowMouseMove,

      // Header resize state
      isResizingHeader: snapshot.isResizingHeader,
      resizeType: snapshot.resizeType,
      resizeIndex: snapshot.resizeIndex,
      resizeCurrentSize: snapshot.resizeCurrentSize,

      // Header resize actions
      startColumnResize,
      startRowResize,
      onResizeMove,
      endResize,
      cancelResize,

      // Table resize state (Tables - 10.4)
      isResizingTable: snapshot.isResizingTable,
      tableResizeId: snapshot.tableResizeId,

      // Table resize actions (Tables - 10.4)
      startTableResize,
      onTableResizeMove,
      endTableResize,
      cancelTableResize,
    }),
    [
      snapshot,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onKeyArrow,
      onKeyCtrlArrow,
      onKeyHome,
      onKeyEnd,
      onKeyTab,
      onKeyTabTableAware,
      onKeyEnter,
      tabNavigate,
      selectAll,
      startFillHandleDrag,
      onFillHandleDrag,
      endFillHandleDrag,
      startRightFillHandleDrag,
      onRightFillHandleDrag,
      endRightFillHandleDrag,
      setSelection,
      reset,
      selectColumn,
      selectRow,
      onColumnMouseMove,
      onRowMouseMove,
      startColumnResize,
      startRowResize,
      onResizeMove,
      endResize,
      cancelResize,
      startTableResize,
      onTableResizeMove,
      endTableResize,
      cancelTableResize,
    ],
  );
}
