/**
 * GridInteractionSimulator
 *
 * A headless test harness that wraps GridEditingSystem for multi-step
 * interaction testing. No DOM, no Canvas, no React — pure state machine
 * testing through the system's public API.
 *
 * Usage:
 * const sim = createGridSimulator({ activeCell: { row: 0, col: 0 } });
 * sim.clickCell(2, 3);
 * expect(sim.activeCell).toEqual({ row: 2, col: 3 });
 * sim.startEditing('hello');
 * sim.commitEdit('down');
 * sim.destroy;
 *
 * @module systems/grid-editing/testing
 */

import { sheetId as toSheetId, type CellRange } from '@mog-sdk/contracts/core';
import type { Direction } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import { GridEditingSystem } from '../grid-editing-system';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a grid simulator.
 */
export interface SimulatorOptions {
  /** Sheet ID to use (defaults to 'sheet-1') */
  sheetId?: string;

  /** Initial active cell position */
  activeCell?: CellCoord;
}

/**
 * The simulator API surface for headless interaction testing.
 */
export interface GridSimulator {
  // ===========================================================================
  // Cell Interaction
  // ===========================================================================

  /**
   * Simulate a cell click.
   * Calls handleCellClick for editing interception first.
   * If not intercepted, performs selection mouseDown + mouseUp.
   */
  clickCell(row: number, col: number, opts?: { shift?: boolean; ctrl?: boolean }): void;

  /**
   * Simulate a cell double-click (mouseDown + mouseUp + startEditing).
   */
  doubleClickCell(row: number, col: number): void;

  // ===========================================================================
  // Editing
  // ===========================================================================

  /**
   * Start editing the active cell.
   * @param initialValue - Optional initial value (typing entry mode)
   */
  startEditing(initialValue?: string): void;

  /**
   * Type a value into the editor (replaces current content).
   */
  typeValue(value: string): void;

  /**
   * Commit the current edit with an explicit direction.
   * @param direction - Direction to move after commit (defaults to 'none')
   */
  commitEdit(direction?: Direction | 'none'): void;

  /**
   * Commit the current edit using a logical key.
   *
   * Note: commitWithKey reads enter direction from ComputeBridge.
   * Since we have no ComputeBridge in testing, use commitEdit() with explicit
   * directions instead: 'enter' -> 'down', 'shift-enter' -> 'up',
   * 'tab' -> 'right', 'shift-tab' -> 'left'.
   */
  commitWithKey(key: 'enter' | 'shift-enter' | 'tab' | 'shift-tab'): Promise<void>;

  /**
   * Cancel the current edit.
   */
  cancelEdit(): void;

  // ===========================================================================
  // Keyboard Navigation
  // ===========================================================================

  /**
   * Simulate an arrow key press.
   * @param direction - Arrow direction
   * @param opts - Optional shift/ctrl modifiers
   */
  arrow(direction: Direction, opts?: { shift?: boolean; ctrl?: boolean }): void;

  /**
   * Simulate Home key press.
   */
  home(opts?: { ctrl?: boolean; shift?: boolean }): void;

  /**
   * Simulate End key press.
   */
  end(opts?: { ctrl?: boolean; shift?: boolean }): void;

  /**
   * Simulate Page Down key press.
   * @param visibleRows - Number of visible rows for page size (defaults to 20)
   */
  pageDown(visibleRows?: number, opts?: { shift?: boolean }): void;

  /**
   * Simulate Page Up key press.
   * @param visibleRows - Number of visible rows for page size (defaults to 20)
   */
  pageUp(visibleRows?: number, opts?: { shift?: boolean }): void;

  /**
   * Simulate Tab key press.
   */
  tab(opts?: { shift?: boolean }): void;

  /**
   * Simulate Enter key press.
   */
  enter(opts?: { shift?: boolean }): void;

  /**
   * Select all cells (Ctrl+A).
   */
  selectAll(): void;

  /**
   * Simulate Escape key press.
   * If editing, cancels the edit. Otherwise, resets selection.
   */
  escape(): void;

  // ===========================================================================
  // Fill Handle
  // ===========================================================================

  /** Start a fill handle drag */
  startFillDrag(): void;

  /** Drag the fill handle to a cell */
  fillDragTo(row: number, col: number): void;

  /** End the fill handle drag */
  endFillDrag(): void;

  // ===========================================================================
  // Column/Row Selection
  // ===========================================================================

  /** Select an entire column */
  selectColumn(col: number, opts?: { shift?: boolean; ctrl?: boolean }): void;

  /** Select an entire row */
  selectRow(row: number, opts?: { shift?: boolean; ctrl?: boolean }): void;

  // ===========================================================================
  // State Queries
  // ===========================================================================

  /** Get the active cell */
  activeCell(): CellCoord;

  /** Get all selection ranges */
  selectionRanges(): CellRange[];

  /** Get the selection anchor (where drag started) */
  anchor(): CellCoord | null;

  /** Check if the editor is active */
  isEditing(): boolean;

  /** Check if formula editing is active */
  isFormulaEditing(): boolean;

  /** Check if selecting a range for a formula */
  isSelectingRangeForFormula(): boolean;

  /** Get the current editor value */
  editorValue(): string;

  /** Check if selection is in idle state */
  isIdle(): boolean;

  /** Check if fill handle is being dragged */
  isDraggingFillHandle(): boolean;

  // ===========================================================================
  // Raw Access
  // ===========================================================================

  /** The underlying GridEditingSystem instance for advanced tests */
  system: GridEditingSystem;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Flush XState microtask queue */
  flush(): Promise<void>;

  /** Dispose the system and clean up */
  destroy(): void;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a headless grid interaction simulator.
 *
 * Wraps a GridEditingSystem with user-level actions and state queries
 * for ergonomic multi-step interaction testing.
 *
 * @param options - Optional configuration (sheetId, initial activeCell)
 * @returns A GridSimulator instance
 */
export function createGridSimulator(options?: SimulatorOptions): GridSimulator {
  const system = new GridEditingSystem({
    initialSheetId: options?.sheetId ?? 'sheet-1',
  });

  system.start();

  // Set initial selection if activeCell is provided
  if (options?.activeCell) {
    const cell = options.activeCell;
    system.access.commands.selection.setSelection(
      [{ startRow: cell.row, startCol: cell.col, endRow: cell.row, endCol: cell.col }],
      cell,
    );
  }

  // Shorthand references
  const commands = system.access.commands;
  const accessors = system.access.accessors;

  const sheetId = options?.sheetId ?? 'sheet-1';

  // ===========================================================================
  // Build the simulator API
  // ===========================================================================

  const simulator: GridSimulator = {
    // =========================================================================
    // Cell Interaction
    // =========================================================================

    clickCell(row: number, col: number, opts?: { shift?: boolean; ctrl?: boolean }) {
      const cell: CellCoord = { row, col };
      const shift = opts?.shift ?? false;
      const ctrl = opts?.ctrl ?? false;

      // Try editing interception first (commit-then-move pattern)
      const intercepted = system.handleCellClick(cell, shift, ctrl);
      if (!intercepted) {
        commands.selection.mouseDown(cell, shift, ctrl);
        commands.selection.mouseUp();
      }
    },

    doubleClickCell(row: number, col: number) {
      const cell: CellCoord = { row, col };
      commands.selection.mouseDown(cell, false, false);
      commands.selection.mouseUp();
      system.startEditing(cell, toSheetId(sheetId));
    },

    // =========================================================================
    // Editing
    // =========================================================================

    startEditing(initialValue?: string) {
      const cell = accessors.selection.getActiveCell();
      system.startEditing(cell, toSheetId(sheetId), initialValue);
    },

    typeValue(value: string, cursorPosition?: number) {
      // Default to end-of-value when the test doesn't model a mid-string
      // caret. Tests that exercise mid-string insertion should pass an
      // explicit cursor position.
      commands.editor.input(value, cursorPosition ?? value.length);
    },

    commitEdit(direction?: Direction | 'none') {
      system.commitEdit(direction ?? 'none');
    },

    async commitWithKey(key: 'enter' | 'shift-enter' | 'tab' | 'shift-tab') {
      await system.commitWithKey(key);
    },

    cancelEdit() {
      system.cancelEdit();
    },

    // =========================================================================
    // Keyboard Navigation
    // =========================================================================

    arrow(direction: Direction, opts?: { shift?: boolean; ctrl?: boolean }) {
      if (opts?.ctrl) {
        commands.selection.keyCtrlArrow(direction, opts?.shift);
      } else {
        commands.selection.keyArrow(direction, opts?.shift ?? false);
      }
    },

    home(opts?: { ctrl?: boolean; shift?: boolean }) {
      commands.selection.keyHome(opts?.ctrl ?? false, opts?.shift);
    },

    end(opts?: { ctrl?: boolean; shift?: boolean }) {
      commands.selection.keyEnd(opts?.ctrl ?? false, opts?.shift);
    },

    pageDown(visibleRows?: number, opts?: { shift?: boolean }) {
      commands.selection.pageDown(visibleRows ?? 20, opts?.shift);
    },

    pageUp(visibleRows?: number, opts?: { shift?: boolean }) {
      commands.selection.pageUp(visibleRows ?? 20, opts?.shift);
    },

    tab(opts?: { shift?: boolean }) {
      commands.selection.keyTab(opts?.shift ?? false);
    },

    enter(opts?: { shift?: boolean }) {
      commands.selection.keyEnter(opts?.shift ?? false);
    },

    selectAll() {
      commands.selection.selectAll();
    },

    escape() {
      if (accessors.editor.isEditing()) {
        system.cancelEdit();
      } else {
        commands.selection.reset();
      }
    },

    // =========================================================================
    // Fill Handle
    // =========================================================================

    startFillDrag() {
      commands.selection.startFillHandleDrag();
    },

    fillDragTo(row: number, col: number) {
      commands.selection.fillHandleDrag({ row, col });
    },

    endFillDrag() {
      commands.selection.endFillHandleDrag();
    },

    // =========================================================================
    // Column/Row Selection
    // =========================================================================

    selectColumn(col: number, opts?: { shift?: boolean; ctrl?: boolean }) {
      commands.selection.selectColumn(col, opts?.shift ?? false, opts?.ctrl ?? false);
    },

    selectRow(row: number, opts?: { shift?: boolean; ctrl?: boolean }) {
      commands.selection.selectRow(row, opts?.shift ?? false, opts?.ctrl ?? false);
    },

    // =========================================================================
    // State Queries
    // =========================================================================

    activeCell() {
      return accessors.selection.getActiveCell()!;
    },

    selectionRanges() {
      return accessors.selection.getRanges();
    },

    anchor() {
      return accessors.selection.getAnchor();
    },

    isEditing() {
      return accessors.editor.isEditing();
    },

    isFormulaEditing() {
      return accessors.editor.isFormulaEditing();
    },

    isSelectingRangeForFormula() {
      return accessors.selection.isSelectingRangeForFormula();
    },

    editorValue() {
      return accessors.editor.getValue();
    },

    isIdle() {
      return accessors.selection.isIdle();
    },

    isDraggingFillHandle() {
      return accessors.selection.isDraggingFillHandle();
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
      system.dispose();
    },
  };

  return simulator;
}
