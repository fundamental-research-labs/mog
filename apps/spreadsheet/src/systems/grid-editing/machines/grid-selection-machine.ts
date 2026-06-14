/**
 * Selection State Machine
 *
 * Manages all selection interactions including mouse, keyboard,
 * formula range picking, and fill handle operations.
 *
 * This file contains only the state machine definition itself.
 * All types, events, guards, actions, and derived state are imported
 * from the ./selection/ modules.
 *
 * @see ARCHITECTURE.md - State Machine 2: Selection
 */

import { setup, type ActorRefFrom } from 'xstate';

// Import types from modules
import type { SelectionContext, SelectionEmitted, SelectionEvent } from './selection/types';

// Import guards
import { selectionGuards } from './selection/guards';

// Import actions
import { initialSelectionContext, selectionCoreActions } from './selection/core-actions';

// =============================================================================
// STATE MACHINE
// =============================================================================

export const selectionMachine = setup({
  types: {
    context: {} as SelectionContext,
    events: {} as SelectionEvent,
    emitted: {} as SelectionEmitted,
  },
  guards: selectionGuards,
  // @ts-expect-error - Actions are properly typed but XState v5 cannot infer types across module boundaries
  actions: selectionCoreActions,
}).createMachine({
  id: 'selection',
  initial: 'idle',
  context: initialSelectionContext,
  // ===========================================================================
  // Root-level event handlers (can be received in any state)
  // Issue 8: Settings Panel - UPDATE_SETTINGS can be received at any time
  // Issue 1: Structure Change - STRUCTURE_CHANGE can be received at any time
  // L0.5: Visibility callbacks - SET_VISIBILITY_CALLBACKS can be received at any time
  // Cross-Machine Communication - EXTERNAL_SELECTION_ACTIVE can be received
  // in most states (but protected states override to ignore)
  // ===========================================================================
  on: {
    UPDATE_SETTINGS: {
      actions: 'updateSettings',
    },
    // Issue 1: Structure Change Coordination
    // Adjust all positions when rows/columns are inserted or deleted.
    // This can happen at any time (local or remote structure changes).
    STRUCTURE_CHANGE: {
      actions: 'adjustForStructureChange',
    },
    // layout-predicate callbacks (renamed from SET_VISIBILITY_CALLBACKS).
    // Sent by coordinator when ViewportPositionIndex / merge index become
    // available or sheet switches. Carries `getMergedRegionAt` so navigation
    // events resolve merges through one machine-internal path.
    SET_LAYOUT_CALLBACKS: {
      actions: 'setLayoutCallbacks',
    },
    // selection-mode lifecycle. SET_MODE handler enforces the
    // extend ⊕ additive mutual-exclusion invariant; COMMIT_PENDING moves the
    // pending range into committedRanges (Excel's commit-and-continue);
    // EXIT_ALL_MODES clears all three flags and flattens to a single range.
    SET_MODE: {
      actions: 'setMode',
    },
    COMMIT_PENDING: {
      actions: 'commitPending',
    },
    EXIT_ALL_MODES: {
      actions: 'exitAllModes',
    },
    // Programmatic replacements from structural commands, dialogs, or API
    // callers must break out of transient pointer states such as row-header
    // drag selection. Otherwise a follow-up plain cell click can be processed
    // while the machine still believes a header drag is active.
    SET_SELECTION: [
      {
        target: '.idle',
        guard: 'isUserSelection',
        actions: ['setSelection', 'emitUserSelectionChanged'],
      },
      {
        target: '.idle',
        actions: 'setSelection',
      },
    ],
    // Cross-Machine Communication
    // When another selection context (objects, chart) takes focus, reset cell selection.
    // Protected states (draggingFillHandle, draggingCells, selectingRangeForFormula)
    // override this handler to ignore the event and let their operation complete.
    EXTERNAL_SELECTION_ACTIVE: {
      target: '.idle',
      actions: 'resetSelection',
    },
  },
  states: {
    // =========================================================================
    // IDLE - Static selection, waiting for input
    //
    // Viewport-follow contract: every event listed below that ends with
    // `emitUserSelectionChanged` belongs to §3.2's emit set in
    // on `source === 'user'` via the `isUserSelection` guard. When you add a
    // new selection event to this state, classify it in §3.2 — emit if the
    // user moved the active cell intentionally, no-emit otherwise (drag
    // continuation, resize, fill-handle, structure adjustment, remote/agent).
    // =========================================================================
    idle: {
      on: {
        // MOUSE_DOWN priority matrix. Modes compose with
        // raw modifiers: effective shift = raw shift ∨ extend; effective
        // ctrl = raw ctrl ∨ additive. shift+ctrl-click semantics (rows 4/6/8)
        // commit current pending into committed AND extend a new range from
        // the prior anchor.
        MOUSE_DOWN: [
          {
            guard: 'isAdditiveShiftOnlyClick',
            target: 'multiSelecting',
            actions: ['addSingleCellToSelectionAndExitAdditive', 'emitUserSelectionChanged'],
          },
          {
            guard: 'isShiftAndCtrlClick',
            target: 'multiSelecting',
            actions: ['startMultiSelectAndExtend', 'emitUserSelectionChanged'],
          },
          {
            guard: 'isShiftOnlyClick',
            target: 'extending',
            actions: ['extendToCell', 'emitUserSelectionChanged'],
          },
          {
            guard: 'isCtrlOnlyClick',
            target: 'multiSelecting',
            actions: ['startMultiSelect', 'emitUserSelectionChanged'],
          },
          {
            target: 'selecting',
            actions: ['setAnchorAndSelect', 'emitUserSelectionChanged'],
          },
        ],
        // KEY_ARROW interpretation follows the selection-mode priority
        // matrix. Order matters — End wins over Additive over Extend over
        // default. The mode-aware machine guards read `ctx.modes.*`; raw
        // shift on the event is composed via guard helpers.
        KEY_ARROW: [
          // Priority 1a: end ∧ (extend ∨ shift) → extend-to-edge, deactivate end.
          {
            guard: 'endModeWithShiftIntent',
            actions: ['endModeExtendToEdge', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          // Priority 1b: end ∧ ¬extend ∧ ¬shift → move-to-edge, deactivate end.
          {
            guard: 'endModeWithoutShiftIntent',
            actions: ['endModeMoveToEdge', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          // Priority 2: additive ∧ shift → extend pendingRange only.
          // (extendSelection writes to pendingRange; committedRanges untouched.)
          {
            guard: 'additiveModeWithShift',
            actions: ['extendSelection', 'emitUserSelectionChanged'],
          },
          // Priority 3: additive ∧ ¬shift → move active cell, collapse pending.
          // (moveActiveCell branches on modes.additive to call moveToPending,
          // preserving committedRanges.)
          {
            guard: 'additiveModeWithoutShift',
            actions: ['moveActiveCell', 'emitUserSelectionChanged'],
          },
          // Priority 4: extend ∨ shift (no end, no additive) → extend single range.
          {
            guard: 'extendIntent',
            actions: ['extendSelection', 'emitUserSelectionChanged'],
          },
          // Priority 5: default → move + collapse.
          {
            actions: ['moveActiveCell', 'emitUserSelectionChanged'],
          },
        ],
        // NOTE: Ctrl+Arrow is normally handled by KeyboardCoordinator with findDataEdge().
        // This fallback handler allows direct tests and provides basic jump behavior
        // when the coordinator doesn't intercept (e.g., unit tests).
        KEY_CTRL_ARROW: [
          {
            guard: 'isShiftCtrlArrow',
            actions: ['jumpToEdgeExtend', 'emitUserSelectionChanged'],
          },
          {
            actions: ['jumpToEdge', 'emitUserSelectionChanged'],
          },
        ],
        // Home/End/Page navigation follows the same priority
        // matrix as KEY_ARROW. The "extend" actions write to
        // pendingRange; the "move" actions branch on modes.additive so
        // committedRanges stay intact when additive mode is on.
        KEY_HOME: [
          // 1a end + shift-intent → extend
          {
            guard: 'endModeWithShiftIntent',
            actions: ['extendToHome', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          // 1b end + no shift → move
          {
            guard: 'endModeWithoutShiftIntent',
            actions: ['moveToHome', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          // 2 additive + shift → extend pending
          {
            guard: 'additiveModeWithShift',
            actions: ['extendToHome', 'emitUserSelectionChanged'],
          },
          // 3 additive + no shift → move (collapses pending)
          {
            guard: 'additiveModeWithoutShift',
            actions: ['moveToHome', 'emitUserSelectionChanged'],
          },
          // 4 extend or shift → extend
          {
            guard: 'extendIntent',
            actions: ['extendToHome', 'emitUserSelectionChanged'],
          },
          // 5 default → move
          {
            actions: ['moveToHome', 'emitUserSelectionChanged'],
          },
        ],
        KEY_END: [
          {
            guard: 'endModeWithShiftIntent',
            actions: ['extendToEnd', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          {
            guard: 'endModeWithoutShiftIntent',
            actions: ['moveToEnd', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          {
            guard: 'additiveModeWithShift',
            actions: ['extendToEnd', 'emitUserSelectionChanged'],
          },
          {
            guard: 'additiveModeWithoutShift',
            actions: ['moveToEnd', 'emitUserSelectionChanged'],
          },
          {
            guard: 'extendIntent',
            actions: ['extendToEnd', 'emitUserSelectionChanged'],
          },
          {
            actions: ['moveToEnd', 'emitUserSelectionChanged'],
          },
        ],
        PAGE_UP: [
          {
            guard: 'endModeWithShiftIntent',
            actions: ['pageUpExtend', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          {
            guard: 'endModeWithoutShiftIntent',
            actions: ['pageUp', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          {
            guard: 'additiveModeWithShift',
            actions: ['pageUpExtend', 'emitUserSelectionChanged'],
          },
          {
            guard: 'additiveModeWithoutShift',
            actions: ['pageUp', 'emitUserSelectionChanged'],
          },
          {
            guard: 'extendIntent',
            actions: ['pageUpExtend', 'emitUserSelectionChanged'],
          },
          {
            actions: ['pageUp', 'emitUserSelectionChanged'],
          },
        ],
        PAGE_DOWN: [
          {
            guard: 'endModeWithShiftIntent',
            actions: ['pageDownExtend', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          {
            guard: 'endModeWithoutShiftIntent',
            actions: ['pageDown', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          {
            guard: 'additiveModeWithShift',
            actions: ['pageDownExtend', 'emitUserSelectionChanged'],
          },
          {
            guard: 'additiveModeWithoutShift',
            actions: ['pageDown', 'emitUserSelectionChanged'],
          },
          {
            guard: 'extendIntent',
            actions: ['pageDownExtend', 'emitUserSelectionChanged'],
          },
          {
            actions: ['pageDown', 'emitUserSelectionChanged'],
          },
        ],
        PAGE_LEFT: [
          {
            guard: 'endModeWithShiftIntent',
            actions: ['pageLeftExtend', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          {
            guard: 'endModeWithoutShiftIntent',
            actions: ['pageLeft', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          {
            guard: 'additiveModeWithShift',
            actions: ['pageLeftExtend', 'emitUserSelectionChanged'],
          },
          {
            guard: 'additiveModeWithoutShift',
            actions: ['pageLeft', 'emitUserSelectionChanged'],
          },
          {
            guard: 'extendIntent',
            actions: ['pageLeftExtend', 'emitUserSelectionChanged'],
          },
          {
            actions: ['pageLeft', 'emitUserSelectionChanged'],
          },
        ],
        PAGE_RIGHT: [
          {
            guard: 'endModeWithShiftIntent',
            actions: ['pageRightExtend', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          {
            guard: 'endModeWithoutShiftIntent',
            actions: ['pageRight', 'deactivateEndMode', 'emitUserSelectionChanged'],
          },
          {
            guard: 'additiveModeWithShift',
            actions: ['pageRightExtend', 'emitUserSelectionChanged'],
          },
          {
            guard: 'additiveModeWithoutShift',
            actions: ['pageRight', 'emitUserSelectionChanged'],
          },
          {
            guard: 'extendIntent',
            actions: ['pageRightExtend', 'emitUserSelectionChanged'],
          },
          {
            actions: ['pageRight', 'emitUserSelectionChanged'],
          },
        ],
        // Issue 8 Wave 2B: Direct navigation (Ctrl+G / Name Box)
        GO_TO: {
          actions: ['goToCell', 'emitUserSelectionChanged'],
        },
        KEY_TAB: {
          actions: ['moveTab', 'emitUserSelectionChanged'],
        },
        KEY_ENTER: {
          actions: ['moveEnter', 'emitUserSelectionChanged'],
        },
        BEGIN_CELL_EDIT: {
          actions: 'beginCellEdit',
        },
        TAB_NAVIGATE: {
          actions: ['tabNavigate', 'emitUserSelectionChanged'],
        },
        SELECT_ALL: {
          actions: ['selectAll', 'emitUserSelectionChanged'],
        },
        ENTER_FORMULA_RANGE_MODE: {
          target: 'selectingRangeForFormula',
          actions: 'enterFormulaMode',
        },
        // Range selection mode for dialogs
        ENTER_RANGE_SELECTION_MODE: {
          actions: 'enterRangeSelectionMode',
        },
        EXIT_RANGE_SELECTION_MODE: {
          actions: 'exitRangeSelectionMode',
        },
        START_FILL_HANDLE_DRAG: {
          // Issue 8: Only allow fill handle drag if setting is enabled
          guard: 'isFillHandleAllowed',
          target: 'draggingFillHandle',
          actions: 'startFillHandle',
        },
        // Right-click fill handle drag shows context menu on release
        START_RIGHT_FILL_HANDLE_DRAG: {
          guard: 'isFillHandleAllowed',
          target: 'rightDraggingFillHandle',
          actions: 'startFillHandle',
        },
        // Cell drag-drop
        START_DRAG_CELLS: {
          target: 'draggingCells',
          actions: 'startDragCells',
        },
        CANCEL_DRAG_CELLS: {
          actions: 'clearDragCells',
        },
        /**
         * Clear fill context after coordinator has executed the fill operation.
         * This is called by the coordinator AFTER reading fillSourceRange/fillHandleEnd.
         */
        CLEAR_FILL_CONTEXT: {
          actions: 'clearFillHandle',
        },
        SET_SELECTION: [
          {
            // Local-user selection: always emit so the viewport follows.
            guard: 'isUserSelection',
            actions: ['setSelection', 'emitUserSelectionChanged'],
          },
          {
            // 'remote' / 'agent' / 'restore' — apply state, do not emit.
            actions: 'setSelection',
          },
        ],
        REMOTE_SELECTION_CHANGED: {
          // Intentional no-op: remote cursors rendered by coordinator, not selection machine.
          // Also no emit — remote selections must not yank the local viewport.
          actions: [],
        },
        RESET: {
          actions: 'resetSelection',
        },
        // Column/row header selection events
        // Order matters: check keyboard first, then shift, then ctrl, then default mouse
        SELECT_COLUMN: [
          {
            guard: 'isShiftColumnClick',
            actions: ['extendToColumn', 'emitUserSelectionChanged'],
            // Stay in idle for single shift+click (no drag needed)
          },
          {
            guard: 'isKeyboardColumnSelect',
            actions: ['selectSingleColumn', 'emitUserSelectionChanged'],
            // Stay in idle for keyboard selection (Ctrl+Space) - no drag needed
          },
          {
            guard: 'isCtrlColumnClick',
            target: 'selectingColumn',
            actions: ['addColumnToSelection', 'emitUserSelectionChanged'],
          },
          {
            target: 'selectingColumn',
            actions: ['selectSingleColumn', 'emitUserSelectionChanged'],
          },
        ],
        SELECT_ROW: [
          {
            guard: 'isShiftRowClick',
            actions: ['extendToRow', 'emitUserSelectionChanged'],
            // Stay in idle for single shift+click (no drag needed)
          },
          {
            guard: 'isKeyboardRowSelect',
            actions: ['selectSingleRow', 'emitUserSelectionChanged'],
            // Stay in idle for keyboard selection (Shift+Space) - no drag needed
          },
          {
            guard: 'isCtrlRowClick',
            target: 'selectingRow',
            actions: ['addRowToSelection', 'emitUserSelectionChanged'],
          },
          {
            target: 'selectingRow',
            actions: ['selectSingleRow', 'emitUserSelectionChanged'],
          },
        ],
        // Header resize events
        START_COLUMN_RESIZE: {
          target: 'resizingHeader',
          actions: 'startColumnResize',
        },
        START_ROW_RESIZE: {
          target: 'resizingHeader',
          actions: 'startRowResize',
        },
        // Table resize event (Tables - 10.4)
        START_TABLE_RESIZE: {
          target: 'resizingTable',
          actions: 'startTableResize',
        },
        /**
         * Clear resize context after coordinator has applied the dimension change.
         * Can be received in any state (root-level would be cleaner but keeping pattern).
         */
        CLEAR_RESIZE: {
          actions: 'clearResize',
        },
        /**
         * Clear table resize context after coordinator has applied the resize.
         * Can be received in any state.
         */
        CLEAR_TABLE_RESIZE: {
          actions: 'clearTableResize',
        },
      },
    },

    // =========================================================================
    // SELECTING - Mouse down, dragging to select range
    // =========================================================================
    selecting: {
      on: {
        MOUSE_MOVE: {
          actions: 'updateDragSelection',
        },
        MOUSE_UP: {
          target: 'idle',
          actions: 'finalizeDrag',
        },
        // Feature C (Issue 4): Allow escape to cancel drag selection
        RESET: {
          target: 'idle',
          actions: 'resetSelection',
        },
        // Allow keyboard events even while dragging (edge case but possible)
        KEY_ARROW: [
          {
            guard: 'isShiftArrow',
            actions: ['extendSelection', 'emitUserSelectionChanged'],
          },
          {
            actions: ['moveActiveCell', 'emitUserSelectionChanged'],
          },
        ],
      },
    },

    // =========================================================================
    // EXTENDING - Shift+click extending existing selection
    // =========================================================================
    extending: {
      on: {
        MOUSE_MOVE: {
          actions: 'updateDragSelection',
        },
        MOUSE_UP: {
          target: 'idle',
          actions: 'finalizeDrag',
        },
        // Feature C (Issue 4): Allow escape to cancel shift+click extension
        RESET: {
          target: 'idle',
          actions: 'resetSelection',
        },
      },
    },

    // =========================================================================
    // MULTI-SELECTING - Ctrl+click adding new ranges
    // =========================================================================
    multiSelecting: {
      on: {
        MOUSE_MOVE: {
          actions: 'updateDragSelection',
        },
        MOUSE_UP: {
          target: 'idle',
          actions: 'finalizeDrag',
        },
        // Feature C (Issue 4): Allow escape to cancel multi-select drag
        RESET: {
          target: 'idle',
          actions: 'resetSelection',
        },
      },
    },

    // =========================================================================
    // SELECTING RANGE FOR FORMULA - Picking range while editing formula
    // =========================================================================
    selectingRangeForFormula: {
      on: {
        MOUSE_DOWN: [
          {
            guard: 'isShiftClick',
            target: 'selectingRangeForFormula.dragging',
            actions: ['extendToCell', 'emitUserSelectionChanged'],
          },
          {
            target: 'selectingRangeForFormula.dragging',
            actions: 'setFormulaRange',
          },
        ],
        KEY_ARROW: [
          {
            guard: 'isShiftArrow',
            actions: ['extendFormulaRange', 'emitUserSelectionChanged'],
          },
          {
            actions: ['moveFormulaRange', 'emitUserSelectionChanged'],
          },
        ],
        EXIT_FORMULA_RANGE_MODE: {
          target: 'idle',
          actions: 'exitFormulaMode',
        },
        SET_SELECTION: [
          {
            guard: 'isUserSelection',
            actions: ['setSelection', 'emitUserSelectionChanged'],
          },
          {
            actions: 'setSelection',
          },
        ],
        BEGIN_CELL_EDIT: {
          actions: 'beginCellEdit',
        },
        // Protected state - ignore external selection during formula range picking
        // Editor coordination handles this separately
        EXTERNAL_SELECTION_ACTIVE: {},
      },
      initial: 'idle',
      states: {
        idle: {
          on: {
            MOUSE_DOWN: [
              {
                guard: 'isShiftClick',
                target: 'dragging',
                actions: ['extendToCell', 'emitUserSelectionChanged'],
              },
              {
                target: 'dragging',
                actions: 'setFormulaRange',
              },
            ],
          },
        },
        dragging: {
          on: {
            MOUSE_MOVE: {
              actions: 'updateFormulaRange',
            },
            MOUSE_UP: {
              target: 'idle',
            },
          },
        },
      },
    },

    // =========================================================================
    // DRAGGING FILL HANDLE - Autofill operation in progress
    // =========================================================================
    /**
     * Fill handle drag state.
     *
     * IMPORTANT: END_FILL_HANDLE_DRAG does NOT clear the fill context!
     * This allows the coordinator to read fillSourceRange/fillHandleEnd
     * AFTER the state transition, then call CLEAR_FILL_CONTEXT.
     *
     */
    draggingFillHandle: {
      on: {
        FILL_HANDLE_DRAG: {
          actions: 'updateFillHandle',
        },
        END_FILL_HANDLE_DRAG: {
          // DO NOT clear fill context here - coordinator needs to read it first!
          // Coordinator will send CLEAR_FILL_CONTEXT after executing fill.
          target: 'idle',
        },
        // DEFENSIVE: Accept MOUSE_UP as fallback termination (stale state recovery)
        MOUSE_UP: {
          target: 'idle',
        },
        // Escape to cancel - this DOES clear fill context (user is aborting)
        RESET: {
          target: 'idle',
          actions: ['clearFillHandle', 'resetSelection'],
        },
        // Protected state - ignore external selection to let fill complete
        EXTERNAL_SELECTION_ACTIVE: {},
      },
    },

    // =========================================================================
    // RIGHT-DRAGGING FILL HANDLE - Shows context menu on release
    // =========================================================================
    /**
     * Right-click fill handle drag state.
     *
     * Similar to draggingFillHandle, but on release (END_RIGHT_FILL_HANDLE_DRAG):
     * - Shows fill context menu with fill options
     * - Does NOT execute fill immediately
     *
     * The coordinator will show the fill context menu with options like:
     * - Copy Cells
     * - Fill Series
     * - Fill Formatting Only
     * - Fill Without Formatting
     * - Fill Days/Weekdays/Months/Years (if date detected)
     *
     * IMPORTANT: END_RIGHT_FILL_HANDLE_DRAG does NOT clear the fill context!
     * The coordinator reads fillSourceRange/fillHandleEnd and shows the menu.
     * When user selects an option, that action executes fill and clears context.
     *
     */
    rightDraggingFillHandle: {
      on: {
        // Accept both right-specific and generic drag events for compatibility
        RIGHT_FILL_HANDLE_DRAG: {
          actions: 'updateFillHandle',
        },
        FILL_HANDLE_DRAG: {
          // Also accept generic drag event (use-grid-mouse sends this)
          actions: 'updateFillHandle',
        },
        END_RIGHT_FILL_HANDLE_DRAG: {
          // DO NOT clear fill context - coordinator shows menu first!
          // User action from menu will execute fill and clear context.
          target: 'idle',
        },
        END_FILL_HANDLE_DRAG: {
          // Also accept generic end event - coordinator detects right-drag from state
          target: 'idle',
        },
        // DEFENSIVE: Accept MOUSE_UP as fallback termination (stale state recovery)
        MOUSE_UP: {
          target: 'idle',
        },
        // Escape to cancel - this DOES clear fill context (user is aborting)
        RESET: {
          target: 'idle',
          actions: ['clearFillHandle', 'resetSelection'],
        },
        // Protected state - ignore external selection to let fill complete
        EXTERNAL_SELECTION_ACTIVE: {},
      },
    },

    // =========================================================================
    // DRAGGING CELLS - Moving/copying cells via drag-drop
    // =========================================================================
    /**
     * Dragging cells state.
     * User initiated a drag from the cell border (not fill handle).
     * - dragSourceRange: the source selection (immutable)
     * - dragTargetCell: current target cell (updates on move)
     * - dragMode: 'move' or 'copy' (based on Ctrl key)
     *
     * On END_DRAG_CELLS, we DON'T clear context - coordinator reads it first.
     * Coordinator sends a follow-up event to clear after executing the move/copy.
     */
    draggingCells: {
      on: {
        DRAG_CELLS_MOVE: {
          actions: 'updateDragCells',
        },
        END_DRAG_CELLS: {
          // DON'T clear drag context - coordinator reads dragSourceRange/dragTargetCell first
          // Coordinator will execute the move/copy, then clear context itself
          target: 'idle',
        },
        // DEFENSIVE: Accept MOUSE_UP as fallback termination (stale state recovery)
        // Note: Do NOT clear drag context - coordinator needs to read it first
        MOUSE_UP: {
          target: 'idle',
        },
        CANCEL_DRAG_CELLS: {
          // Escape or drag cancel - clear context immediately
          target: 'idle',
          actions: 'clearDragCells',
        },
        // Escape via RESET also cancels
        RESET: {
          target: 'idle',
          actions: ['clearDragCells', 'resetSelection'],
        },
        // Protected state - ignore external selection to let drag complete
        EXTERNAL_SELECTION_ACTIVE: {},
      },
    },

    // =========================================================================
    // SELECTING COLUMN - Dragging across column headers
    // =========================================================================
    selectingColumn: {
      on: {
        COLUMN_MOUSE_MOVE: {
          actions: 'extendColumnSelection',
        },
        MOUSE_UP: {
          target: 'idle',
          actions: 'finalizeHeaderSelection',
        },
        // Allow escape to cancel and reset
        RESET: {
          target: 'idle',
          actions: 'resetSelection',
        },
      },
    },

    // =========================================================================
    // SELECTING ROW - Dragging across row headers
    // =========================================================================
    selectingRow: {
      on: {
        ROW_MOUSE_MOVE: {
          actions: 'extendRowSelection',
        },
        MOUSE_UP: {
          target: 'idle',
          actions: 'finalizeHeaderSelection',
        },
        // Allow escape to cancel and reset
        RESET: {
          target: 'idle',
          actions: 'resetSelection',
        },
      },
    },

    // =========================================================================
    // RESIZING HEADER - Dragging column/row resize handle
    // =========================================================================
    /**
     * Header resize state.
     * User is dragging a column or row resize handle.
     * - resizeType: 'column' or 'row'
     * - resizeIndex: the column/row being resized
     * - resizeCurrentSize: current size during drag (for visual feedback)
     *
     * On END_RESIZE, we DON'T clear context - coordinator reads it first.
     * Coordinator sends CLEAR_RESIZE after applying the dimension change.
     */
    resizingHeader: {
      on: {
        RESIZE_MOVE: {
          actions: 'updateResize',
        },
        END_RESIZE: {
          // DON'T clear resize context - coordinator reads resizeType/resizeIndex/resizeCurrentSize first
          // Coordinator will apply the dimension change, then send CLEAR_RESIZE
          target: 'idle',
          actions: 'finalizeResize',
        },
        // DEFENSIVE: Accept MOUSE_UP as fallback termination (stale state recovery)
        MOUSE_UP: {
          target: 'idle',
          actions: 'finalizeResize',
        },
        CANCEL_RESIZE: {
          // Escape or cancel - clear context immediately (no dimension change)
          target: 'idle',
          actions: 'clearResize',
        },
        // Escape via RESET also cancels
        RESET: {
          target: 'idle',
          actions: ['clearResize', 'resetSelection'],
        },
      },
    },

    // =========================================================================
    // RESIZING TABLE - Dragging table resize handle (Tables - 10.4)
    // =========================================================================
    /**
     * Table resize state.
     * User is dragging the table resize handle (blue triangle at bottom-right).
     * - tableResizeId: ID of the table being resized
     * - tableResizeStartBounds: original table bounds when resize started
     * - tableResizeTargetRow/Col: current target for bottom-right corner
     *
     * On END_TABLE_RESIZE, we DON'T clear context - coordinator reads it first.
     * Coordinator sends CLEAR_TABLE_RESIZE after applying the resize.
     */
    resizingTable: {
      on: {
        TABLE_RESIZE_MOVE: {
          actions: 'updateTableResize',
        },
        END_TABLE_RESIZE: {
          // DON'T clear context - coordinator reads tableResizeId/target first
          target: 'idle',
          actions: 'finalizeTableResize',
        },
        // DEFENSIVE: Accept MOUSE_UP as fallback termination (stale state recovery)
        MOUSE_UP: {
          target: 'idle',
          actions: 'finalizeTableResize',
        },
        CANCEL_TABLE_RESIZE: {
          // Escape or cancel - clear context immediately (no resize applied)
          target: 'idle',
          actions: 'clearTableResize',
        },
        // Escape via RESET also cancels
        RESET: {
          target: 'idle',
          actions: ['clearTableResize', 'resetSelection'],
        },
      },
    },
  },
});

// =============================================================================
// TYPE EXPORTS & UTILITIES
// =============================================================================

export type SelectionMachine = typeof selectionMachine;
export type SelectionActor = ActorRefFrom<SelectionMachine>;
export type SelectionState = ReturnType<SelectionActor['getSnapshot']>;
