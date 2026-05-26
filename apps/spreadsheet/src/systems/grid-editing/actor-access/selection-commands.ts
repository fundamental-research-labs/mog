/**
 * Selection Command Factory
 *
 * Type-safe wrappers around actor.send() for selection state machine events.
 * Includes Layer 3 deduplication for high-frequency mouse events.
 *
 * Extracted from coordinator/actor-access/commands.ts
 *
 * @module systems/grid-editing/actor-access/selection-commands
 */

import type { SelectionCommands } from '@mog-sdk/contracts/actors';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { Direction } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

// =============================================================================
// TYPES
// =============================================================================

/** Minimal actor interface for sending events */
interface MinimalActor {
  send(event: any): void;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Helper to compare CellCoord objects for equality.
 * Used for deduplicating high-frequency mouse events.
 */
function cellEquals(a: CellCoord | null, b: CellCoord): boolean {
  if (!a) return false;
  return a.row === b.row && a.col === b.col;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create selection commands from a selection actor.
 * Wraps actor.send() with type-safe methods for selection events.
 *
 * Includes Layer 3 deduplication for high-frequency events:
 * - mouseMove: Skips if same cell as last call
 * - columnMouseMove: Skips if same column as last call
 * - rowMouseMove: Skips if same row as last call
 * - mouseUp: Resets all tracking variables
 *
 * @param actor - The selection state machine actor
 * @returns SelectionCommands interface implementation
 *
 * @see state-machines/src/selection-machine.ts for event definitions
 */
export function createSelectionCommands(actor: MinimalActor): SelectionCommands {
  // ---------------------------------------------------------------------------
  // Layer 3: Command-level deduplication tracking
  // These variables track the last sent values to skip redundant events.
  // Reset on mouseUp to allow fresh tracking for next drag operation.
  // ---------------------------------------------------------------------------
  let lastMouseCell: CellCoord | null = null;
  let lastColumnSent: number | null = null;
  let lastRowSent: number | null = null;

  return {
    // -------------------------------------------------------------------------
    // Mouse Events
    // -------------------------------------------------------------------------
    mouseDown: (cell: CellCoord, shiftKey: boolean, ctrlKey: boolean) =>
      actor.send({
        type: 'MOUSE_DOWN',
        cell,
        shiftKey,
        ctrlKey,
      }),

    mouseMove: (cell: CellCoord) => {
      // Layer 3: Skip if cell hasn't changed (reduces 60+/sec to ~0-5/sec)
      if (cellEquals(lastMouseCell, cell)) return;
      lastMouseCell = cell;
      actor.send({ type: 'MOUSE_MOVE', cell });
    },

    mouseUp: () => {
      // Reset deduplication tracking for next drag operation
      lastMouseCell = null;
      lastColumnSent = null;
      lastRowSent = null;
      actor.send({ type: 'MOUSE_UP' });
    },

    // -------------------------------------------------------------------------
    // Keyboard Navigation
    // -------------------------------------------------------------------------
    keyArrow: (direction: Direction, shiftKey: boolean) =>
      actor.send({ type: 'KEY_ARROW', direction, shiftKey }),

    keyCtrlArrow: (direction: Direction, shiftKey?: boolean) =>
      actor.send({ type: 'KEY_CTRL_ARROW', direction, shiftKey }),

    keyHome: (ctrlKey: boolean, shiftKey?: boolean) =>
      actor.send({ type: 'KEY_HOME', ctrlKey, shiftKey }),

    keyEnd: (ctrlKey: boolean, shiftKey?: boolean) =>
      actor.send({ type: 'KEY_END', ctrlKey, shiftKey }),

    keyTab: (shiftKey: boolean) => actor.send({ type: 'KEY_TAB', shiftKey }),

    keyEnter: (shiftKey: boolean) => actor.send({ type: 'KEY_ENTER', shiftKey }),

    selectAll: () => actor.send({ type: 'SELECT_ALL' }),

    // -------------------------------------------------------------------------
    // Page Navigation
    // -------------------------------------------------------------------------
    pageUp: (visibleRows: number, shiftKey?: boolean) =>
      actor.send({ type: 'PAGE_UP', visibleRows, shiftKey }),

    pageDown: (visibleRows: number, shiftKey?: boolean) =>
      actor.send({ type: 'PAGE_DOWN', visibleRows, shiftKey }),

    pageLeft: (visibleCols: number, shiftKey?: boolean) =>
      actor.send({ type: 'PAGE_LEFT', visibleCols, shiftKey }),

    pageRight: (visibleCols: number, shiftKey?: boolean) =>
      actor.send({ type: 'PAGE_RIGHT', visibleCols, shiftKey }),

    goTo: (cell: CellCoord) => actor.send({ type: 'GO_TO', cell }),

    // -------------------------------------------------------------------------
    // Formula Range Mode
    // -------------------------------------------------------------------------
    enterFormulaRangeMode: (color: string) =>
      actor.send({ type: 'ENTER_FORMULA_RANGE_MODE', color }),

    exitFormulaRangeMode: () => actor.send({ type: 'EXIT_FORMULA_RANGE_MODE' }),

    enterRangeSelectionMode: () => actor.send({ type: 'ENTER_RANGE_SELECTION_MODE' }),

    exitRangeSelectionMode: () => actor.send({ type: 'EXIT_RANGE_SELECTION_MODE' }),

    // -------------------------------------------------------------------------
    // Fill Handle
    // -------------------------------------------------------------------------
    startFillHandleDrag: () => actor.send({ type: 'START_FILL_HANDLE_DRAG' }),

    fillHandleDrag: (cell: CellCoord) => actor.send({ type: 'FILL_HANDLE_DRAG', cell }),

    endFillHandleDrag: () => actor.send({ type: 'END_FILL_HANDLE_DRAG' }),

    startRightFillHandleDrag: () => actor.send({ type: 'START_RIGHT_FILL_HANDLE_DRAG' }),

    rightFillHandleDrag: (cell: CellCoord) => actor.send({ type: 'RIGHT_FILL_HANDLE_DRAG', cell }),

    endRightFillHandleDrag: () => actor.send({ type: 'END_RIGHT_FILL_HANDLE_DRAG' }),

    clearFillContext: () => actor.send({ type: 'CLEAR_FILL_CONTEXT' }),

    // -------------------------------------------------------------------------
    // Header Selection
    // fromKeyboard: true for keyboard shortcuts (Ctrl+Space/Shift+Space) - stays in idle
    // fromKeyboard: false/undefined for mouse clicks on headers - enters drag state
    // -------------------------------------------------------------------------
    selectColumn: (col: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard = false) =>
      actor.send({ type: 'SELECT_COLUMN', col, shiftKey, ctrlKey, fromKeyboard }),

    selectRow: (row: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard = false) =>
      actor.send({ type: 'SELECT_ROW', row, shiftKey, ctrlKey, fromKeyboard }),

    columnMouseMove: (col: number) => {
      // Layer 3: Skip if column hasn't changed (reduces 60+/sec to ~0-5/sec)
      if (col === lastColumnSent) return;
      lastColumnSent = col;
      actor.send({ type: 'COLUMN_MOUSE_MOVE', col });
    },

    rowMouseMove: (row: number) => {
      // Layer 3: Skip if row hasn't changed (reduces 60+/sec to ~0-5/sec)
      if (row === lastRowSent) return;
      lastRowSent = row;
      actor.send({ type: 'ROW_MOUSE_MOVE', row });
    },

    // -------------------------------------------------------------------------
    // Cell Drag-Drop
    // -------------------------------------------------------------------------
    startDragCells: (cell: CellCoord, ctrlKey: boolean) =>
      actor.send({ type: 'START_DRAG_CELLS', cell, ctrlKey }),

    dragCellsMove: (cell: CellCoord, ctrlKey: boolean) =>
      actor.send({ type: 'DRAG_CELLS_MOVE', cell, ctrlKey }),

    endDragCells: () => actor.send({ type: 'END_DRAG_CELLS' }),

    cancelDragCells: () => actor.send({ type: 'CANCEL_DRAG_CELLS' }),

    // -------------------------------------------------------------------------
    // Header Resize
    // -------------------------------------------------------------------------
    startColumnResize: (
      col: number,
      startPosition: number,
      startSize: number,
      cols?: number[],
      startSizes?: Map<number, number>,
    ) =>
      actor.send({
        type: 'START_COLUMN_RESIZE',
        col,
        startPosition,
        startSize,
        cols,
        startSizes,
      }),

    startRowResize: (
      row: number,
      startPosition: number,
      startSize: number,
      rows?: number[],
      startSizes?: Map<number, number>,
    ) =>
      actor.send({
        type: 'START_ROW_RESIZE',
        row,
        startPosition,
        startSize,
        rows,
        startSizes,
      }),

    resizeMove: (position: number) => actor.send({ type: 'RESIZE_MOVE', position }),

    endResize: () => actor.send({ type: 'END_RESIZE' }),

    cancelResize: () => actor.send({ type: 'CANCEL_RESIZE' }),

    clearResize: () => actor.send({ type: 'CLEAR_RESIZE' }),

    // -------------------------------------------------------------------------
    // Table Resize
    // -------------------------------------------------------------------------
    startTableResize: (tableId: string, tableBounds: CellRange) =>
      actor.send({ type: 'START_TABLE_RESIZE', tableId, tableBounds }),

    tableResizeMove: (targetRow: number, targetCol: number) =>
      actor.send({ type: 'TABLE_RESIZE_MOVE', targetRow, targetCol }),

    endTableResize: () => actor.send({ type: 'END_TABLE_RESIZE' }),

    cancelTableResize: () => actor.send({ type: 'CANCEL_TABLE_RESIZE' }),

    clearTableResize: () => actor.send({ type: 'CLEAR_TABLE_RESIZE' }),

    // -------------------------------------------------------------------------
    // External Events
    // -------------------------------------------------------------------------
    remoteSelectionChanged: (ranges: CellRange[]) =>
      actor.send({ type: 'REMOTE_SELECTION_CHANGED', ranges }),

    setSelection: (
      ranges: CellRange[],
      activeCell: CellCoord,
      anchor?: CellCoord | null,
      anchorCol?: number | null,
      anchorRow?: number | null,
      source: 'user' | 'remote' | 'agent' | 'restore' = 'user',
    ) =>
      actor.send({
        type: 'SET_SELECTION',
        ranges,
        activeCell,
        anchor,
        anchorCol,
        anchorRow,
        source,
      }),

    reset: () => actor.send({ type: 'RESET' }),

    tabNavigate: (targetCell: CellCoord) => actor.send({ type: 'TAB_NAVIGATE', targetCell }),

    updateSettings: (allowDragFill?: boolean) =>
      actor.send({ type: 'UPDATE_SETTINGS', allowDragFill }),

    structureChange: (
      sheetId: string,
      change: {
        type: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns';
        index: number;
        count: number;
      },
    ) => actor.send({ type: 'STRUCTURE_CHANGE', sheetId, change }),

    setLayoutCallbacks: (
      isRowHidden?: (row: number) => boolean,
      isColHidden?: (col: number) => boolean,
      getMergedRegionAt?: (row: number, col: number) => CellRange | null,
    ) =>
      actor.send({
        type: 'SET_LAYOUT_CALLBACKS',
        isRowHidden,
        isColHidden,
        getMergedRegionAt,
      }),

    externalSelectionActive: (context: 'cells' | 'objects' | 'chart') =>
      actor.send({ type: 'EXTERNAL_SELECTION_ACTIVE', context }),

    // ===========================================================================
    // Selection-mode lifecycle
    // ===========================================================================

    setMode: (mode: 'end' | 'extend' | 'additive', value: boolean) =>
      actor.send({ type: 'SET_MODE', mode, value }),

    exitAllModes: () => actor.send({ type: 'EXIT_ALL_MODES' }),

    commitPending: () => actor.send({ type: 'COMMIT_PENDING' }),
  };
}
