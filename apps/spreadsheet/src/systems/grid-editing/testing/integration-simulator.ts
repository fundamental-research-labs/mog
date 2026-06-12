/**
 * Integration Simulator
 *
 * A headless test harness that dispatches through real action handlers
 * with a real test context, wires real coordination modules, and tests
 * the actual behavior users experience — without DOM, Canvas, or React.
 *
 * Unlike GridSimulator which calls raw state machine commands (e.g.
 * commands.selection.keyArrow), IntegrationSimulator routes through
 * real action handlers that implement Excel-parity behaviors:
 * - Multi-cell collapse on arrow (movement.ts)
 * - Data-edge jumping with Ctrl+Arrow (data-edge.ts)
 * - Hidden row skipping (via visibility callbacks)
 * - Merge-aware movement through selection-machine layout callbacks
 * - EditorCommitCoordination auto-complete lifecycle
 *
 * Usage:
 * const sim = createIntegrationSimulator({
 * cells: { '0,0': 'hello', '1,0': 'world' },
 * activeCell: { row: 0, col: 0 },
 * });
 * sim.pressKey('ArrowDown');
 * expect(sim.activeCell).toEqual({ row: 1, col: 0 });
 * sim.destroy;
 *
 * @module systems/grid-editing/testing
 */

import type { ActionHandler, AnyActionHandler } from '@mog-sdk/contracts/actions';
import { sheetId as toSheetId, type CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import { setupEditorCommitCoordination } from '../coordination/editor-commit-coordination';
import { GridEditingSystem } from '../grid-editing-system';

// DAG-EXCEPTION: test harness — intentionally imports action handlers for integration testing
// Action handlers — imported from individual modules to avoid heavy transitive
// dependencies (e.g. differences.ts → @mog-sdk/kernel/api → xlsx-parser)
import {
  EXTEND_TO_EDGE_DOWN,
  EXTEND_TO_EDGE_LEFT,
  EXTEND_TO_EDGE_RIGHT,
  EXTEND_TO_EDGE_UP,
  MOVE_TO_EDGE_DOWN,
  MOVE_TO_EDGE_LEFT,
  MOVE_TO_EDGE_RIGHT,
  MOVE_TO_EDGE_UP,
} from '../../../actions/handlers/selection/data-edge';
import {
  EXTEND_SELECTION_DOWN,
  EXTEND_SELECTION_LEFT,
  EXTEND_SELECTION_RIGHT,
  EXTEND_SELECTION_UP,
} from '../../../actions/handlers/selection/extension';
import {
  MOVE_DOWN,
  MOVE_LEFT,
  MOVE_RIGHT,
  MOVE_UP,
} from '../../../actions/handlers/selection/movement';
import {
  EXTEND_SELECTION_PAGE_DOWN,
  EXTEND_SELECTION_PAGE_UP,
  PAGE_DOWN,
  PAGE_UP,
} from '../../../actions/handlers/selection/page-navigation';
import { COMMIT_ENTER, COMMIT_SHIFT_ENTER } from '../../../actions/handlers/editor';
import {
  ENTER_NAVIGATE,
  SHIFT_ENTER_NAVIGATE,
  TAB_BACKWARD,
  TAB_FORWARD,
} from '../../../actions/handlers/selection/tab-enter';
// home-end.ts imports from @mog-sdk/kernel/api which has heavy transitive deps
// (xlsx-parser), so we implement lightweight stubs for the handlers we need.
// These match the real handler behavior for the subset we test.
const handled = (): { handled: boolean } => ({ handled: true });
const MOVE_TO_ROW_START: ActionHandler = (deps) => {
  deps.commands.selection.keyHome(false, false);
  return handled();
};
const MOVE_TO_ROW_END: ActionHandler = (deps) => {
  deps.commands.selection.keyEnd(false, false);
  return handled();
};
const MOVE_TO_A1: ActionHandler = (deps) => {
  deps.commands.selection.keyHome(true, false);
  return handled();
};
const MOVE_TO_LAST_USED_CELL: ActionHandler = (deps) => {
  deps.commands.selection.keyEnd(true, false);
  return handled();
};
const EXTEND_TO_ROW_START: ActionHandler = (deps) => {
  deps.commands.selection.keyHome(false, true);
  return handled();
};
const EXTEND_TO_A1: ActionHandler = (deps) => {
  deps.commands.selection.keyHome(true, true);
  return handled();
};
const EXTEND_TO_LAST_USED_CELL: ActionHandler = (deps) => {
  deps.commands.selection.keyEnd(true, true);
  return handled();
};

import type { TestSheetConfig } from '../../testing-foundation/test-sheet-context';
import { createTestSheetContext } from '../../testing-foundation/test-sheet-context';
import type { KeyModifiers, SelectionActionType } from './key-action-map';
import { lookupAction } from './key-action-map';
import { createEditableTestWorkbook } from './mock-workbook';

// =============================================================================
// Handler Map
// =============================================================================

/**
 * Map from action type string to handler function.
 * These are all the handlers we can dispatch through.
 */
const HANDLER_MAP: Record<SelectionActionType, AnyActionHandler> = {
  // Movement
  MOVE_UP,
  MOVE_DOWN,
  MOVE_LEFT,
  MOVE_RIGHT,

  // Extension
  EXTEND_SELECTION_UP,
  EXTEND_SELECTION_DOWN,
  EXTEND_SELECTION_LEFT,
  EXTEND_SELECTION_RIGHT,

  // Data-edge
  MOVE_TO_EDGE_UP,
  MOVE_TO_EDGE_DOWN,
  MOVE_TO_EDGE_LEFT,
  MOVE_TO_EDGE_RIGHT,

  // Data-edge extension
  EXTEND_TO_EDGE_UP,
  EXTEND_TO_EDGE_DOWN,
  EXTEND_TO_EDGE_LEFT,
  EXTEND_TO_EDGE_RIGHT,

  // Home/End
  MOVE_TO_ROW_START,
  MOVE_TO_ROW_END,
  MOVE_TO_A1,
  MOVE_TO_LAST_USED_CELL,
  EXTEND_TO_ROW_START,
  EXTEND_TO_A1,
  EXTEND_TO_LAST_USED_CELL,

  // Tab/Enter
  TAB_FORWARD,
  TAB_BACKWARD,
  ENTER_NAVIGATE,
  SHIFT_ENTER_NAVIGATE,
  COMMIT_ENTER,
  COMMIT_SHIFT_ENTER,

  // Page navigation
  PAGE_UP,
  PAGE_DOWN,
  EXTEND_SELECTION_PAGE_UP,
  EXTEND_SELECTION_PAGE_DOWN,
};

// =============================================================================
// Types
// =============================================================================

/**
 * Integration simulator API - same query interface as GridSimulator,
 * but dispatches through real action handlers.
 */
export interface IntegrationSimulator {
  // ===========================================================================
  // Key Dispatch (the primary API)
  // ===========================================================================

  /**
   * Press a key, dispatching through the real action handler.
   * @param key - Key name (e.g. 'ArrowDown', 'Tab', 'Home')
   * @param modifiers - Optional { shift, ctrl } modifiers
   */
  pressKey(key: string, modifiers?: KeyModifiers): void | Promise<void>;

  /**
   * Dispatch a specific action type directly.
   * @param actionType - The action handler to call
   */
  dispatch(actionType: SelectionActionType): void | Promise<void>;

  // ===========================================================================
  // Editing
  // ===========================================================================

  /** Start editing the active cell. */
  startEditing(initialValue?: string): void;

  /** Type a value into the editor. */
  typeValue(value: string): void;

  /**
   * Commit the current edit.
   * With auto-commit coordination wired, this completes automatically
   * (no manual completeCommit needed).
   */
  commitEdit(direction?: 'up' | 'down' | 'left' | 'right' | 'none'): void;

  /** Cancel the current edit. */
  cancelEdit(): void;

  // ===========================================================================
  // Cell Interaction
  // ===========================================================================

  /** Click a cell (with editing interception). */
  clickCell(row: number, col: number, opts?: { shift?: boolean; ctrl?: boolean }): void;

  // ===========================================================================
  // State Queries
  // ===========================================================================

  /** Get the active cell. */
  activeCell(): CellCoord;

  /** Get all selection ranges. */
  selectionRanges(): CellRange[];

  /** Get the selection anchor. */
  anchor(): CellCoord | null;

  /** Check if the editor is active. */
  isEditing(): boolean;

  /** Check if formula editing is active. */
  isFormulaEditing(): boolean;

  /** Check if selecting a range for a formula. */
  isSelectingRangeForFormula(): boolean;

  /** Get the current editor value. */
  editorValue(): string;

  /** Check if selection is in idle state. */
  isIdle(): boolean;

  // ===========================================================================
  // Raw Access
  // ===========================================================================

  /** The underlying GridEditingSystem instance. */
  system: GridEditingSystem;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Flush XState microtask queue. */
  flush(): Promise<void>;

  /** Dispose the system and clean up. */
  destroy(): void;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an integration simulator that dispatches through real action handlers
 * with a real test context.
 *
 * @param config - Test sheet configuration (cells, merges, hiddenRows, etc.)
 * @returns An IntegrationSimulator instance
 */
export function createIntegrationSimulator(config: TestSheetConfig = {}): IntegrationSimulator {
  const sheetId = config.sheetId ?? 'sheet-1';

  // -------------------------------------------------------------------------
  // 1. Create test context
  // -------------------------------------------------------------------------

  const { ctx } = createTestSheetContext(config);
  const viewportBuffer = (ctx as any).viewportBuffer;

  // -------------------------------------------------------------------------
  // 2. Build mock Worksheet API / Workbook API
  // -------------------------------------------------------------------------

  const hiddenRowSet = new Set(config.hiddenRows ?? []);
  const hiddenColSet = new Set(config.hiddenCols ?? []);
  const getMergedRegionAt =
    config.merges && config.merges.length > 0
      ? (row: number, col: number): CellRange | null =>
          config.merges?.find(
            (range) =>
              row >= range.startRow &&
              row <= range.endRow &&
              col >= range.startCol &&
              col <= range.endCol,
          ) ?? null
      : undefined;
  const mockWorkbook = createEditableTestWorkbook({
    ...config,
    sheetId,
    viewportBuffer,
  });

  // -------------------------------------------------------------------------
  // 3. Create and start GridEditingSystem
  // -------------------------------------------------------------------------

  const system = new GridEditingSystem({ initialSheetId: sheetId });
  system.start();

  // -------------------------------------------------------------------------
  // 4. Set initial selection
  // -------------------------------------------------------------------------

  const initialCell = config.activeCell ?? { row: 0, col: 0 };
  system.access.commands.selection.setSelection(
    [
      {
        startRow: initialCell.row,
        startCol: initialCell.col,
        endRow: initialCell.row,
        endCol: initialCell.col,
      },
    ],
    initialCell,
  );

  // -------------------------------------------------------------------------
  // 5. Wire visibility callbacks
  // -------------------------------------------------------------------------

  system.access.commands.selection.setLayoutCallbacks(
    (row: number) => hiddenRowSet.has(row),
    (col: number) => hiddenColSet.has(col),
    getMergedRegionAt,
  );

  // -------------------------------------------------------------------------
  // 6. Merge-aware navigation is wired through SET_LAYOUT_CALLBACKS above.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 7. Wire EditorCommitCoordination (auto-complete lifecycle)
  // -------------------------------------------------------------------------

  const cleanupCommitCoordination = setupEditorCommitCoordination({
    editorActor: (system as any).editorActor,
    selectionActor: (system as any).selectionActor,
    // No validateCellValue — all values auto-succeed
    // No validateFormulaSyntax — all formulas accepted
  });

  // -------------------------------------------------------------------------
  // 8. Build ActionDependencies
  // -------------------------------------------------------------------------

  const deps = {
    ctx: ctx as any,
    workbook: mockWorkbook as any,
    accessors: system.access.accessors,
    commands: system.access.commands,
    getActiveSheetId: () => sheetId,
    uiStore: { getState: () => ({}) },
  };

  // -------------------------------------------------------------------------
  // 8. Build simulator API
  // -------------------------------------------------------------------------

  const cleanupFns: (() => void)[] = [cleanupCommitCoordination];

  const simulator: IntegrationSimulator = {
    // =========================================================================
    // Key Dispatch
    // =========================================================================

    pressKey(key: string, modifiers?: KeyModifiers) {
      const actionType = lookupAction(key, modifiers);
      if (!actionType) {
        throw new Error(
          `No action mapped for key combo: ${key}${modifiers?.ctrl ? ' +Ctrl' : ''}${modifiers?.shift ? ' +Shift' : ''}`,
        );
      }
      return simulator.dispatch(actionType);
    },

    dispatch(actionType: SelectionActionType) {
      const handler = HANDLER_MAP[actionType];
      if (!handler) {
        throw new Error(`No handler found for action: ${actionType}`);
      }
      const result = handler(deps as any);
      // If the handler is async, return the promise so callers can await it
      if (result && typeof (result as any).then === 'function') {
        return (result as any).then(() => {});
      }
    },

    // =========================================================================
    // Editing
    // =========================================================================

    startEditing(initialValue?: string) {
      const cell = system.access.accessors.selection.getActiveCell();
      system.startEditing(cell, toSheetId(sheetId), initialValue);
    },

    typeValue(value: string, cursorPosition?: number) {
      // Default to end-of-value; tests covering mid-string insertion
      // should pass an explicit cursor position.
      system.access.commands.editor.input(value, cursorPosition ?? value.length);
    },

    commitEdit(direction?: 'up' | 'down' | 'left' | 'right' | 'none') {
      system.commitEdit(direction ?? 'none');
    },

    cancelEdit() {
      system.cancelEdit();
    },

    // =========================================================================
    // Cell Interaction
    // =========================================================================

    clickCell(row: number, col: number, opts?: { shift?: boolean; ctrl?: boolean }) {
      const cell: CellCoord = { row, col };
      const shift = opts?.shift ?? false;
      const ctrl = opts?.ctrl ?? false;

      const intercepted = system.handleCellClick(cell, shift, ctrl);
      if (!intercepted) {
        system.access.commands.selection.mouseDown(cell, shift, ctrl);
        system.access.commands.selection.mouseUp();
      }
    },

    // =========================================================================
    // State Queries
    // =========================================================================

    activeCell() {
      return system.access.accessors.selection.getActiveCell()!;
    },

    selectionRanges() {
      return system.access.accessors.selection.getRanges();
    },

    anchor() {
      return system.access.accessors.selection.getAnchor();
    },

    isEditing() {
      return system.access.accessors.editor.isEditing();
    },

    isFormulaEditing() {
      return system.access.accessors.editor.isFormulaEditing();
    },

    isSelectingRangeForFormula() {
      return system.access.accessors.selection.isSelectingRangeForFormula();
    },

    editorValue() {
      return system.access.accessors.editor.getValue();
    },

    isIdle() {
      return system.access.accessors.selection.isIdle();
    },

    // =========================================================================
    // Raw Access
    // =========================================================================

    system,

    // =========================================================================
    // Lifecycle
    // =========================================================================

    async flush() {
      await new Promise<void>((r) => setTimeout(r, 0));
    },

    destroy() {
      for (const fn of cleanupFns) {
        fn();
      }
      system.dispose();
    },
  };

  return simulator;
}
