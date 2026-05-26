/**
 * Selection Machine Event Factory
 *
 * Type-safe event factories for the selection machine.
 * Use these instead of inline object literals to prevent magic string drift.
 *
 * @example
 * // Instead of: actor.send({ type: 'KEY_ARROW', direction: 'down', shiftKey: false })
 * // Use: actor.send(SelectionEvents.keyArrow('down'))
 *
 * @see ARCHITECTURE.md - State Machine 2: Selection
 * @see selection-machine.ts - Main selection state machine
 */

import type { CellCoord, CellRange, Direction } from '../../../shared/types';
import type { StructureChange } from '../../../shared/utils';
import type { SelectionEvent } from './types';

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the selection machine.
 * Use these instead of inline object literals to prevent magic string drift.
 *
 * @example
 * // Instead of: actor.send({ type: 'KEY_ARROW', direction: 'down', shiftKey: false })
 * // Use: actor.send(SelectionEvents.keyArrow('down'))
 */
export const SelectionEvents = {
  // Mouse events. NOTE: `mergedRegion` is gone — the machine resolves merges
  // itself via `ctx.getMergedRegionAt` (layout). Hooks stop pre-resolving.
  mouseDown: (cell: CellCoord, shiftKey = false, ctrlKey = false): SelectionEvent => ({
    type: 'MOUSE_DOWN',
    cell,
    shiftKey,
    ctrlKey,
  }),

  mouseMove: (cell: CellCoord): SelectionEvent => ({
    type: 'MOUSE_MOVE',
    cell,
  }),

  mouseUp: (): SelectionEvent => ({
    type: 'MOUSE_UP',
  }),

  // Keyboard navigation events
  keyArrow: (direction: Direction, shiftKey = false): SelectionEvent => ({
    type: 'KEY_ARROW',
    direction,
    shiftKey,
  }),

  keyCtrlArrow: (direction: Direction, shiftKey = false): SelectionEvent => ({
    type: 'KEY_CTRL_ARROW',
    direction,
    shiftKey,
  }),

  keyHome: (ctrlKey = false, shiftKey = false): SelectionEvent => ({
    type: 'KEY_HOME',
    ctrlKey,
    shiftKey,
  }),

  keyEnd: (ctrlKey = false, shiftKey = false): SelectionEvent => ({
    type: 'KEY_END',
    ctrlKey,
    shiftKey,
  }),

  keyTab: (shiftKey = false): SelectionEvent => ({
    type: 'KEY_TAB',
    shiftKey,
  }),

  keyEnter: (shiftKey = false): SelectionEvent => ({
    type: 'KEY_ENTER',
    shiftKey,
  }),

  beginCellEdit: (cell: CellCoord): SelectionEvent => ({
    type: 'BEGIN_CELL_EDIT',
    cell,
  }),

  // Page navigation events
  pageUp: (visibleRows: number, shiftKey = false): SelectionEvent => ({
    type: 'PAGE_UP',
    visibleRows,
    shiftKey,
  }),

  pageDown: (visibleRows: number, shiftKey = false): SelectionEvent => ({
    type: 'PAGE_DOWN',
    visibleRows,
    shiftKey,
  }),

  pageLeft: (visibleCols: number, shiftKey = false): SelectionEvent => ({
    type: 'PAGE_LEFT',
    visibleCols,
    shiftKey,
  }),

  pageRight: (visibleCols: number, shiftKey = false): SelectionEvent => ({
    type: 'PAGE_RIGHT',
    visibleCols,
    shiftKey,
  }),

  goTo: (cell: CellCoord): SelectionEvent => ({
    type: 'GO_TO',
    cell,
  }),

  // Selection commands
  selectAll: (): SelectionEvent => ({
    type: 'SELECT_ALL',
  }),

  setSelection: (
    ranges: CellRange[],
    activeCell: CellCoord,
    options?: {
      anchor?: CellCoord | null;
      anchorCol?: number | null;
      anchorRow?: number | null;
      source?: 'user' | 'remote' | 'agent' | 'restore';
    },
  ): SelectionEvent => ({
    type: 'SET_SELECTION',
    ranges,
    activeCell,
    anchor: options?.anchor,
    anchorCol: options?.anchorCol,
    anchorRow: options?.anchorRow,
    source: options?.source,
  }),

  reset: (): SelectionEvent => ({
    type: 'RESET',
  }),

  // Formula range mode
  enterFormulaRangeMode: (color: string): SelectionEvent => ({
    type: 'ENTER_FORMULA_RANGE_MODE',
    color,
  }),

  exitFormulaRangeMode: (): SelectionEvent => ({
    type: 'EXIT_FORMULA_RANGE_MODE',
  }),

  // Fill handle events
  startFillHandleDrag: (): SelectionEvent => ({
    type: 'START_FILL_HANDLE_DRAG',
  }),

  fillHandleDrag: (cell: CellCoord): SelectionEvent => ({
    type: 'FILL_HANDLE_DRAG',
    cell,
  }),

  endFillHandleDrag: (): SelectionEvent => ({
    type: 'END_FILL_HANDLE_DRAG',
  }),

  // Right-click fill handle drag events
  startRightFillHandleDrag: (): SelectionEvent => ({
    type: 'START_RIGHT_FILL_HANDLE_DRAG',
  }),

  rightFillHandleDrag: (cell: CellCoord): SelectionEvent => ({
    type: 'RIGHT_FILL_HANDLE_DRAG',
    cell,
  }),

  endRightFillHandleDrag: (): SelectionEvent => ({
    type: 'END_RIGHT_FILL_HANDLE_DRAG',
  }),

  /**
   * Clear fill context after coordinator has executed the fill operation.
   * Call this AFTER reading fillSourceRange/fillHandleEnd.
   */
  clearFillContext: (): SelectionEvent => ({
    type: 'CLEAR_FILL_CONTEXT',
  }),

  // Header selection events
  // fromKeyboard: true for keyboard shortcuts (Ctrl+Space/Shift+Space) - stays in idle
  // fromKeyboard: false/undefined for mouse clicks on headers - enters drag state
  selectColumn: (
    col: number,
    shiftKey = false,
    ctrlKey = false,
    fromKeyboard = false,
  ): SelectionEvent => ({
    type: 'SELECT_COLUMN',
    col,
    shiftKey,
    ctrlKey,
    fromKeyboard,
  }),

  selectRow: (
    row: number,
    shiftKey = false,
    ctrlKey = false,
    fromKeyboard = false,
  ): SelectionEvent => ({
    type: 'SELECT_ROW',
    row,
    shiftKey,
    ctrlKey,
    fromKeyboard,
  }),

  columnMouseMove: (col: number): SelectionEvent => ({
    type: 'COLUMN_MOUSE_MOVE',
    col,
  }),

  rowMouseMove: (row: number): SelectionEvent => ({
    type: 'ROW_MOUSE_MOVE',
    row,
  }),

  // Table navigation
  tabNavigate: (targetCell: CellCoord): SelectionEvent => ({
    type: 'TAB_NAVIGATE',
    targetCell,
  }),

  // Remote collaboration
  remoteSelectionChanged: (ranges: CellRange[]): SelectionEvent => ({
    type: 'REMOTE_SELECTION_CHANGED',
    ranges,
  }),

  // Settings sync
  updateSettings: (allowDragFill?: boolean): SelectionEvent => ({
    type: 'UPDATE_SETTINGS',
    allowDragFill,
  }),

  // Structure change coordination
  structureChange: (sheetId: string, change: StructureChange): SelectionEvent => ({
    type: 'STRUCTURE_CHANGE',
    sheetId,
    change,
  }),

  // Layout-predicate callbacks (renamed from setVisibilityCallbacks).
  // Carries `getMergedRegionAt` alongside the visibility predicates so
  // navigation events resolve merges through one path.
  setLayoutCallbacks: (
    isRowHidden?: (row: number) => boolean,
    isColHidden?: (col: number) => boolean,
    getMergedRegionAt?: (row: number, col: number) => CellRange | null,
  ): SelectionEvent => ({
    type: 'SET_LAYOUT_CALLBACKS',
    isRowHidden,
    isColHidden,
    getMergedRegionAt,
  }),

  // Selection-mode lifecycle
  setMode: (mode: 'end' | 'extend' | 'additive', value: boolean): SelectionEvent => ({
    type: 'SET_MODE',
    mode,
    value,
  }),

  commitPending: (): SelectionEvent => ({
    type: 'COMMIT_PENDING',
  }),

  exitAllModes: (): SelectionEvent => ({
    type: 'EXIT_ALL_MODES',
  }),

  // Cell drag-drop events
  startDragCells: (cell: CellCoord, ctrlKey = false): SelectionEvent => ({
    type: 'START_DRAG_CELLS',
    cell,
    ctrlKey,
  }),

  dragCellsMove: (cell: CellCoord, ctrlKey = false): SelectionEvent => ({
    type: 'DRAG_CELLS_MOVE',
    cell,
    ctrlKey,
  }),

  endDragCells: (): SelectionEvent => ({
    type: 'END_DRAG_CELLS',
  }),

  cancelDragCells: (): SelectionEvent => ({
    type: 'CANCEL_DRAG_CELLS',
  }),

  // Header resize events
  startColumnResize: (col: number, startPosition: number, startSize: number): SelectionEvent => ({
    type: 'START_COLUMN_RESIZE',
    col,
    startPosition,
    startSize,
  }),

  startRowResize: (row: number, startPosition: number, startSize: number): SelectionEvent => ({
    type: 'START_ROW_RESIZE',
    row,
    startPosition,
    startSize,
  }),

  resizeMove: (position: number): SelectionEvent => ({
    type: 'RESIZE_MOVE',
    position,
  }),

  endResize: (): SelectionEvent => ({
    type: 'END_RESIZE',
  }),

  cancelResize: (): SelectionEvent => ({
    type: 'CANCEL_RESIZE',
  }),

  clearResize: (): SelectionEvent => ({
    type: 'CLEAR_RESIZE',
  }),

  // Cross-Machine Communication
  /**
   * Signal that another selection context has taken focus.
   * Called by coordinator when objects or charts are selected.
   * This causes cell selection to reset to A1.
   */
  externalSelectionActive: (context: 'cells' | 'objects' | 'chart'): SelectionEvent => ({
    type: 'EXTERNAL_SELECTION_ACTIVE',
    context,
  }),

  // Range selection mode for dialogs
  enterRangeSelectionMode: (): SelectionEvent => ({
    type: 'ENTER_RANGE_SELECTION_MODE',
  }),

  exitRangeSelectionMode: (): SelectionEvent => ({
    type: 'EXIT_RANGE_SELECTION_MODE',
  }),

  // Table resize events (Tables - 10.4)
  startTableResize: (tableId: string, tableBounds: CellRange): SelectionEvent => ({
    type: 'START_TABLE_RESIZE',
    tableId,
    tableBounds,
  }),

  tableResizeMove: (targetRow: number, targetCol: number): SelectionEvent => ({
    type: 'TABLE_RESIZE_MOVE',
    targetRow,
    targetCol,
  }),

  endTableResize: (): SelectionEvent => ({
    type: 'END_TABLE_RESIZE',
  }),

  cancelTableResize: (): SelectionEvent => ({
    type: 'CANCEL_TABLE_RESIZE',
  }),

  clearTableResize: (): SelectionEvent => ({
    type: 'CLEAR_TABLE_RESIZE',
  }),
} as const;
