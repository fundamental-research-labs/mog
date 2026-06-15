/**
 * Selection Machine Types
 *
 * Type definitions for the selection state machine context and events.
 * These types define the contract for selection state management including:
 * - Selection ranges and active cell tracking (committed + pending)
 * - Selection-mode bundle (end / extend / additive)
 * - Layout-predicate callbacks (hidden rows/cols + merged regions)
 * - Fill handle drag operations
 * - Cell drag-drop operations
 * - Header resize operations
 * - Table resize operations
 * - Formula range mode
 *
 * @module selection/types
 * @see ../selection-machine.ts - The state machine implementation
 * @see ARCHITECTURE.md - State Machine 2: Selection
 */

import type { CellRange } from '@mog-sdk/contracts/core';

import type { CellCoord, Direction, SelectionDirection } from '../../../shared/types';
import type { StructureChange } from '../../../shared/utils';

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * Selection-mode bundle. Each flag is read at exactly one place (the input
 * translation layer plus the machine's own KEY_ARROW / MOUSE_DOWN guards).
 * Action handlers downstream are mode-naive.
 *
 * Invariants (enforced by the SET_MODE handler + setSelection assign):
 * - `committedRanges` is empty whenever `additive === false`.
 * - `extend` and `additive` are mutually exclusive — turning one on forces
 * the other off. (`end` is independent of both.)
 * - `end` auto-deactivates after one navigation event consumes it.
 *
 */
export interface SelectionModes {
  /** End-mode: next navigation jumps to the data edge, then auto-deactivates. */
  end: boolean;
  /** Extend-mode (F8): arrows behave as if Shift were held. Sticky until Esc. */
  extend: boolean;
  /** Additive-mode (Shift+F8): arrows mutate `pendingRange` only. Sticky until Esc. */
  additive: boolean;
}

export interface SelectionContext {
  /** Anchor cell for range selection (where drag started) */
  anchor: CellCoord | null;
  /**
   * Committed (non-contiguous) ranges. Always empty when `modes.additive` is
   * false. Each entry is a previously-completed range in an additive
   * selection — the trailing range is held in `pendingRange` while the user
   * is still mutating it.
   */
  committedRanges: CellRange[];
  /**
   * The range currently being edited. Always populated. In default and
   * Extend mode this is the only range; in Additive mode it's the trailing
   * range alongside `committedRanges`.
   */
  pendingRange: CellRange;
  /**
   * The active cell: where typing, paste, and F2 edit target.
   *
   * Excel parity: physical Shift-extension keeps this at the selection anchor.
   * The moving edge is represented by `pendingRange` geometry and emitted as
   * `followCell` for viewport-follow; it is not automatically the active cell.
   */
  activeCell: CellCoord;
  /**
   * Direction the selection was created in (from anchor to active cell).
   * Used for Tab/Enter cycling to determine starting position.
   *
   */
  direction: SelectionDirection;
  /** Selection-mode bundle. See {@link SelectionModes} for invariants. */
  modes: SelectionModes;
  /** Color for formula range mode highlighting */
  formulaRangeColor: string | null;
  /**
   * Whether in range selection mode.
   * When true, user is selecting a range for a dialog input.
   */
  inRangeSelectionMode: boolean;
  /** Fill handle drag start cell */
  fillHandleStart: CellCoord | null;
  /** Fill handle drag current end cell */
  fillHandleEnd: CellCoord | null;
  /**
   * Source range captured at fill handle drag START.
   * This is immutable during the drag and is used by the coordinator to know
   * what to fill from. Persists until CLEAR_FILL_CONTEXT is sent.
   */
  fillSourceRange: CellRange | null;
  /** Anchor column for column range selection (where column drag started) */
  anchorCol: number | null;
  /** Anchor row for row range selection (where row drag started) */
  anchorRow: number | null;
  // ===========================================================================
  // Workbook Settings (Issue 8: Settings Panel)
  // Synced from Yjs via coordinator on init and UPDATE_SETTINGS event
  // ===========================================================================
  /** Whether fill handle dragging is enabled (from WorkbookSettings). Default: true */
  allowDragFill: boolean;

  // ===========================================================================
  // Layout-Predicate Callbacks
  //
  // Injected by coordinator at machine bootstrap and on sheet switch via the
  // SET_LAYOUT_CALLBACKS event. CONSTRAINT: these are *layout/structure*
  // predicates only — never read cell values through SelectionContext.
  // Adding `getCellValue` here would blur the architecture; cell-value-dependent
  // decisions belong in handlers.
  //
  // ===========================================================================
  /**
   * Callback to check if a row is hidden.
   * Used to skip hidden rows during keyboard navigation.
   */
  isRowHidden?: (row: number) => boolean;
  /**
   * Callback to check if a column is hidden.
   * Used to skip hidden columns during keyboard navigation.
   */
  isColHidden?: (col: number) => boolean;
  /**
   * Callback to resolve a (row, col) position to its containing merged region,
   * if any. Used by the machine's merge-escape logic for KEY_ARROW / MOUSE_DOWN
   * (the per-event `MOUSE_DOWN.mergedRegion` field is gone — the machine
   * resolves merges itself).
   *
   * Production wiring lives in the related wiring; the field shape lives here.
   */
  getMergedRegionAt?: (row: number, col: number) => CellRange | null;

  // ===========================================================================
  // Cell Drag-Drop
  // ===========================================================================
  /**
   * Source range being dragged (captured at drag start).
   * Null when not dragging cells.
   */
  dragSourceRange: CellRange | null;
  /**
   * Current target cell for the drag (top-left of drop location).
   * Updated during DRAG_CELLS_MOVE.
   */
  dragTargetCell: CellCoord | null;
  /**
   * Drag mode: 'move' (default) or 'copy' (Ctrl held).
   * Determined by ctrlKey at drag start, can change during drag.
   */
  dragMode: 'move' | 'copy';

  // ===========================================================================
  // Header Resize
  // ===========================================================================
  /**
   * Type of header resize: 'column' or 'row'.
   * Null when not resizing.
   */
  resizeType: 'column' | 'row' | null;
  /**
   * Index of the column or row being resized (single resize mode).
   * Deprecated in favor of resizeIndexes for multi-select resize.
   */
  resizeIndex: number | null;
  /**
   * Array of column or row indexes being resized (multi-select mode).
   * C.2: When multiple headers are selected, all are resized together.
   */
  resizeIndexes: number[];
  /**
   * Starting mouse position when resize began (screen coordinates).
   */
  resizeStartPosition: number | null;
  /**
   * Starting size of the column/row when resize began (pixels).
   * Deprecated in favor of resizeStartSizes for multi-select resize.
   */
  resizeStartSize: number | null;
  /**
   * Map of starting sizes for each resized index (multi-select mode).
   * C.2: Keyed by column/row index. During drag, delta is applied to all.
   */
  resizeStartSizes: Map<number, number>;
  /**
   * Current size during resize (pixels).
   * For multi-select, this represents the unified delta applied to all.
   */
  resizeCurrentSize: number | null;

  // ===========================================================================
  // Table Resize (Tables - 10.4)
  // ===========================================================================
  /**
   * Table ID being resized (null when not resizing).
   */
  tableResizeId: string | null;
  /**
   * Starting table bounds when resize began.
   */
  tableResizeStartBounds: CellRange | null;
  /**
   * Current target row for table resize (bottom-right corner).
   */
  tableResizeTargetRow: number | null;
  /**
   * Current target column for table resize (bottom-right corner).
   */
  tableResizeTargetCol: number | null;

  // ===========================================================================
  // Tab-Enter Data Entry Pattern
  // ===========================================================================
  /**
   * Column where Tab navigation started.
   * When Enter is pressed while tabOriginCol is set, the cursor returns to
   * this column and moves down one row (Excel data entry pattern).
   * Cleared by any non-Tab/Enter navigation (arrow keys, mouse click, etc.).
   */
  tabOriginCol: number | null;
}

// =============================================================================
// EMITTED EVENTS
// =============================================================================

/**
 * Events broadcast by the selection machine to subscribers via `actor.on()`.
 *
 * `userSelectionChanged` is emitted for user-initiated selection changes.
 * `activeCell` is the true active cell. `followCell` is the cell the viewport
 * should bring into view; for extended selections it may be the moving edge,
 * while select-all keeps it at the active cell.
 *
 * The complete classification of selection events into "emits"
 * When adding a new selection event to this state, classify it there; failing to do so
 * means either the viewport silently stops following (false-no-emit) or a
 * non-user event yanks the viewport (false-emit).
 */
export type SelectionScrollIntent =
  | {
      type: 'page';
      axis: 'horizontal' | 'vertical';
      direction: 'previous' | 'next';
    }
  | {
      type: 'origin';
      axis: 'horizontal' | 'both';
    };

export type SelectionEmitted = {
  type: 'userSelectionChanged';
  activeCell: CellCoord;
  followCell: CellCoord;
  range: CellRange;
  scrollIntent?: SelectionScrollIntent;
  suppressViewportFollow?: boolean;
};

// =============================================================================
// EVENTS
// =============================================================================

export type SelectionEvent =
  | {
      type: 'MOUSE_DOWN';
      cell: CellCoord;
      shiftKey: boolean;
      ctrlKey: boolean;
      // NOTE: `mergedRegion` is intentionally absent. The machine resolves
      // merges via `ctx.getMergedRegionAt`; the mouse hook stops pre-resolving.
    }
  | { type: 'MOUSE_MOVE'; cell: CellCoord }
  | { type: 'MOUSE_UP' }
  | { type: 'KEY_ARROW'; direction: Direction; shiftKey: boolean }
  | { type: 'KEY_CTRL_ARROW'; direction: Direction; shiftKey?: boolean }
  | { type: 'KEY_HOME'; ctrlKey: boolean; shiftKey?: boolean }
  | { type: 'KEY_END'; ctrlKey: boolean; shiftKey?: boolean }
  | { type: 'KEY_TAB'; shiftKey: boolean }
  | { type: 'KEY_ENTER'; shiftKey: boolean }
  | { type: 'BEGIN_CELL_EDIT'; cell: CellCoord }
  | { type: 'SELECT_ALL' }
  | { type: 'ENTER_FORMULA_RANGE_MODE'; color: string }
  | { type: 'EXIT_FORMULA_RANGE_MODE' }
  // Range selection mode for dialogs
  | { type: 'ENTER_RANGE_SELECTION_MODE' }
  | { type: 'EXIT_RANGE_SELECTION_MODE' }
  | { type: 'START_FILL_HANDLE_DRAG' }
  | { type: 'FILL_HANDLE_DRAG'; cell: CellCoord }
  | { type: 'END_FILL_HANDLE_DRAG' }
  // Right-click fill handle drag events
  | { type: 'START_RIGHT_FILL_HANDLE_DRAG' }
  | { type: 'RIGHT_FILL_HANDLE_DRAG'; cell: CellCoord }
  | { type: 'END_RIGHT_FILL_HANDLE_DRAG' }
  /**
   * Clear fill context after coordinator has executed the fill operation.
   * This is sent by the coordinator AFTER reading fillSourceRange/fillHandleEnd.
   */
  | { type: 'CLEAR_FILL_CONTEXT' }
  | { type: 'REMOTE_SELECTION_CHANGED'; ranges: CellRange[] }
  | {
      type: 'SET_SELECTION';
      ranges: CellRange[];
      activeCell: CellCoord;
      /** Optional anchor for shift-click extension. Defaults to activeCell if not provided. */
      anchor?: CellCoord | null;
      /** Optional anchor column for column selection restoration. @see PER-SHEET-SELECTION.md */
      anchorCol?: number | null;
      /** Optional anchor row for row selection restoration. @see PER-SHEET-SELECTION.md */
      anchorRow?: number | null;
      /**
       * Provenance of this selection change. Drives both the viewport-follow
       * emit (only `'user'` triggers `userSelectionChanged`) and the
       * source-aware mode-reset (only `'user'` preserves modes /
       * `committedRanges`; all other sources clear modes and drop
       * `committedRanges` before applying the new range).
       *
       * - `'user'`: keystroke, click, dialog, GoTo, Find, Name Box, programmatic
       * action initiated by the local user. The viewport should follow,
       * modes are preserved.
       * - `'remote'`: a collaborator's cursor mirrored locally. Must NOT scroll
       * the local viewport and must clear modes.
       * - `'agent'`: an AI agent moving the cursor. Must NOT scroll the local
       * viewport and must clear modes.
       * - `'restore'`: per-sheet view-state restoration on sheet switch. Must
       * NOT scroll (renderer-execution restores scroll in parallel) and
       * must clear modes, preventing stale selection-mode indicators after
       * sheet switches.
       */
      source?: 'user' | 'remote' | 'agent' | 'restore';
    }
  | { type: 'RESET' }
  // Header selection events
  // fromKeyboard: true means triggered via keyboard shortcut (Ctrl+Space/Shift+Space),
  // should stay in idle state. false/undefined means mouse click on header, should
  // enter selectingColumn/selectingRow state for drag extension.
  | {
      type: 'SELECT_COLUMN';
      col: number;
      shiftKey: boolean;
      ctrlKey: boolean;
      fromKeyboard?: boolean;
    }
  | { type: 'SELECT_ROW'; row: number; shiftKey: boolean; ctrlKey: boolean; fromKeyboard?: boolean }
  | { type: 'COLUMN_MOUSE_MOVE'; col: number }
  | { type: 'ROW_MOUSE_MOVE'; row: number }
  // Table navigation events
  | { type: 'TAB_NAVIGATE'; targetCell: CellCoord }
  // Issue 8: Settings Panel - Settings sync from coordinator
  | { type: 'UPDATE_SETTINGS'; allowDragFill?: boolean }
  // Issue 1: Structure Change Coordination - Adjust positions after row/column insert/delete
  | { type: 'STRUCTURE_CHANGE'; sheetId: string; change: StructureChange }
  // Page navigation events (Issue 8 Wave 2B - real user input)
  | { type: 'PAGE_UP'; visibleRows: number; shiftKey?: boolean }
  | { type: 'PAGE_DOWN'; visibleRows: number; shiftKey?: boolean }
  | { type: 'PAGE_LEFT'; visibleCols: number; shiftKey?: boolean }
  | { type: 'PAGE_RIGHT'; visibleCols: number; shiftKey?: boolean }
  // Direct cell navigation (Issue 8 Wave 2B - Ctrl+G / Name Box)
  | { type: 'GO_TO'; cell: CellCoord }
  // Layout-predicate callbacks (renamed from SET_VISIBILITY_CALLBACKS).
  // Carries the merge-region accessor in addition to the existing visibility
  // predicates so navigation events can resolve merges through the same path.
  | {
      type: 'SET_LAYOUT_CALLBACKS';
      isRowHidden?: (row: number) => boolean;
      isColHidden?: (col: number) => boolean;
      getMergedRegionAt?: (row: number, col: number) => CellRange | null;
    }
  // ===========================================================================
  // Selection-mode lifecycle
  // ===========================================================================
  /**
   * Set a single mode flag. The handler enforces the
   * `extend ⊕ additive` mutual-exclusion invariant — turning one on forces
   * the other off. Toggling `additive` from `true → false` commits the
   * pending range and flattens to a single range.
   */
  | { type: 'SET_MODE'; mode: 'end' | 'extend' | 'additive'; value: boolean }
  /**
   * Commit the current `pendingRange` into `committedRanges` and open a new
   * single-cell `pendingRange` at the active cell. Triggered by the second
   * Shift+F8 (Excel commit-and-continue), click outside the pending range
   * during ADD mode, and other "stop editing this range, start a new one"
   * gestures. Leaves `modes.additive` true.
   */
  | { type: 'COMMIT_PENDING' }
  /**
   * Clear all three mode flags and flatten to a single range at the active
   * cell. Triggered by Esc.
   */
  | { type: 'EXIT_ALL_MODES' }
  // Cell drag-drop events
  | { type: 'START_DRAG_CELLS'; cell: CellCoord; ctrlKey: boolean }
  | { type: 'DRAG_CELLS_MOVE'; cell: CellCoord; ctrlKey: boolean }
  | { type: 'END_DRAG_CELLS' }
  | { type: 'CANCEL_DRAG_CELLS' }
  // Header resize events
  | {
      type: 'START_COLUMN_RESIZE';
      col: number;
      /** C.2: Array of column indexes to resize together (for multi-select) */
      cols?: number[];
      startPosition: number;
      startSize: number;
      /** C.2: Map of starting sizes for multi-select resize */
      startSizes?: Map<number, number>;
    }
  | {
      type: 'START_ROW_RESIZE';
      row: number;
      /** C.2: Array of row indexes to resize together (for multi-select) */
      rows?: number[];
      startPosition: number;
      startSize: number;
      /** C.2: Map of starting sizes for multi-select resize */
      startSizes?: Map<number, number>;
    }
  | { type: 'RESIZE_MOVE'; position: number }
  | { type: 'END_RESIZE' }
  | { type: 'CANCEL_RESIZE' }
  | { type: 'CLEAR_RESIZE' }
  // Cross-Machine Communication - External selection event
  // Sent by coordinator when another selection context (objects, chart) takes focus
  | { type: 'EXTERNAL_SELECTION_ACTIVE'; context: 'cells' | 'objects' | 'chart' }
  // Table resize events (Tables - 10.4)
  | {
      type: 'START_TABLE_RESIZE';
      tableId: string;
      tableBounds: CellRange;
    }
  | { type: 'TABLE_RESIZE_MOVE'; targetRow: number; targetCol: number }
  | { type: 'END_TABLE_RESIZE' }
  | { type: 'CANCEL_TABLE_RESIZE' }
  | { type: 'CLEAR_TABLE_RESIZE' };
