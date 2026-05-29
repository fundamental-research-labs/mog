/**
 * Editor Action Handlers
 *
 * Pure handler functions for editor-related actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps) => ActionResult
 * - They access actor state through deps.accessors (reads) and deps.commands (writes)
 * - They access data through deps.workbook (unified Workbook/Worksheet API)
 * - They do NOT store references to deps
 *
 * This file handles:
 * - Cell editing lifecycle (start, commit, cancel)
 * - Content modification (clear, delete)
 * - Fill operations (fill down, fill right, fill selection)
 * - Special insertions (date, time, copy from above)
 * - Formula-specific operations (cycle reference, auto sum)
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import type { Direction } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { Worksheet, WorksheetWithInternals } from '@mog-sdk/contracts/api';
// Fill operations - use executeFillViaWorksheet for proper formula adjustment
import type { FillDirection } from '../../domain/fill/types';
import { executeFillViaWorksheet } from './fill/types';
import { extractFormulaRanges } from '../../domain/editor/formula-range-parser';
// helpers used by the formula point-mode jump-to-edge handlers (Ctrl+Arrow
// and Ctrl+Shift+Arrow during formula edit).
import {
  getMovingEdge,
  normalizeRange,
  rangeFromAnchorAndCell,
  singleCellRange,
} from '../../systems/shared/types';

import { letterToCol, parseA1Range as parseA1RangeNotation } from '@mog/spreadsheet-utils/a1';

import { getRelativeCommandColumn, resolveDataCommandTarget } from '../data-command-target';
import { guardBridgeMutation } from './bridge-error-guard';
import { beginEditSessionFromAction } from './edit-entry';
import { requestFormulaBarRefresh } from '../../infra/events/formula-bar-refresh';
import { getUIStore, handled, notHandled } from './handler-utils';
import { hasMultiCellSelection } from './selection/helpers';

/**
 * Maps a commit direction to its corresponding action type.
 * Used by components that receive direction as a callback parameter
 * (slider, rich text) to route through the unified action system.
 */
export const COMMIT_ACTION_FOR: Record<Direction | 'none', string> = {
  down: 'COMMIT_AND_MOVE_DOWN',
  up: 'COMMIT_AND_MOVE_UP',
  left: 'COMMIT_AND_MOVE_LEFT',
  right: 'COMMIT_AND_MOVE_RIGHT',
  none: 'COMMIT_IN_PLACE',
};

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Get target sheet IDs for multi-sheet operations.
 * Returns selected sheets if available, otherwise falls back to [activeSheetId].
 *
 * Multi-Sheet Selection
 */
// getSelectedSheetIds is async — sync wrapper returns active sheet as safe default
function getTargetSheetIds(deps: ActionDependencies): SheetId[] {
  // Fallback to active sheet only — getSelectedSheetIds is async (Promise<string[]>)
  // Sync callers cannot await. Return active sheet as safe default.
  return [deps.getActiveSheetId()];
}

/**
 * Get selection context (activeCell and ranges) from selection accessor.
 */
function getSelectionContext(deps: ActionDependencies): {
  activeCell: CellCoord;
  ranges: CellRange[];
} {
  return {
    activeCell: deps.accessors.selection.getActiveCell(),
    ranges: deps.accessors.selection.getRanges(),
  };
}

/**
 * Check if a cell is within any of the cut source ranges.
 * Returns true if the cell is in a cut range (should block editing).
 *
 */
function isCellInCutRange(deps: ActionDependencies, sheetId: SheetId, cell: CellCoord): boolean {
  const clipboardAccessor = deps.accessors.clipboard;

  // Only block if we're in the hasCut state (not hasCopy or empty)
  if (!clipboardAccessor.hasCut()) {
    return false;
  }

  // Check if the clipboard source is from the same sheet
  const data = clipboardAccessor.getData();
  if (!data || data.sourceSheetId !== sheetId) {
    return false;
  }

  // Check if cell is within any of the source ranges
  const sourceRanges = clipboardAccessor.getSourceRanges();
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

/**
 * Helper to get a Worksheet for a given sheetId from the workbook API.
 */
function getWorksheet(deps: ActionDependencies, sheetId: SheetId) {
  return deps.workbook.getSheetById(sheetId);
}

// `ARRAY_PART_ERROR` and the `guardBridgeMutation` helper now live in
// `./bridge-error-guard.ts` so non-editor handlers can share the same
// `PartialArrayWrite` recovery path without duplicating the message or
// the catch shape.

// =============================================================================
// Editing Lifecycle Handlers
// =============================================================================

/**
 * Start editing the active cell (F2 or typing).
 *
 * Blocks editing if the cell is in the cut range.
 * Uses deps.workbook for cell data reads.
 */
export const EDIT_CELL: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);

  // Block editing cells in cut range
  if (isCellInCutRange(deps, sheetId, activeCell)) {
    // Silently block the edit - Excel doesn't show a toast, just prevents editing
    return handled();
  }

  // CSE partial-write rejection lives in Rust compute-core
  // (`ComputeError::PartialArrayWrite`). Editing a CSE member surfaces
  // the error from `ws.setCell` at commit time; the TS-side pre-check
  // that previously duplicated the projection lookup was deleted.
  // Dynamic-array spill members continue to accept blocker writes
  // (Excel 365 `#SPILL!` behavior, unchanged).

  // Auto-deactivate selection modes on edit start (Excel behavior)
  // End Mode, Extend Selection (F8), and Add to Selection (Shift+F8) all deactivate
  // when the user starts editing a cell.
  // routed through the selection actor; the UIStore
  // mode slice fields were retired.
  deps.commands.selection.exitAllModes();

  await beginEditSessionFromAction(deps, {
    sheetId,
    cell: activeCell,
    entryMode: 'F2',
  });

  return handled();
};

/**
 * Commit edit and move down (Enter or ArrowDown in Enter Mode).
 */
export const COMMIT_AND_MOVE_DOWN: ActionHandler = (deps) => {
  deps.commands.editor.commit('down');
  return handled();
};

/**
 * COMMIT_EDIT - Alias for COMMIT_AND_MOVE_DOWN.
 * Commits the current edit without specifying direction (defaults to down).
 */
export const COMMIT_EDIT: ActionHandler = COMMIT_AND_MOVE_DOWN;

/**
 * Commit edit and move up (Shift+Enter or ArrowUp in Enter Mode).
 */
export const COMMIT_AND_MOVE_UP: ActionHandler = (deps) => {
  deps.commands.editor.commit('up');
  return handled();
};

/**
 * Commit edit and move left (ArrowLeft in Enter Mode or Shift+Tab).
 *
 * Selection-aware: When a multi-cell selection exists, commits with 'none'
 * direction (preserves selection) and delegates Tab-cycling to the selection
 * machine via `commands.selection.keyTab(true)`. Single-cell fallback uses
 * commit('left').
 *
 * Previously, this handler ran its own `getNextCellInSelection`
 * cycle via tab-enter helpers. The cycle algorithm now lives in
 * `machines/selection/cycle.ts` and is driven by KEY_TAB inside the
 * selection machine — handlers no longer need to know about merge/hidden
 * geometry.
 */
export const COMMIT_AND_MOVE_LEFT: ActionHandler = (deps) => {
  const ranges = deps.accessors.selection.getRanges();

  if (hasMultiCellSelection(ranges)) {
    // Commit without moving — 'none' prevents cross-coordination from collapsing selection.
    deps.commands.editor.commit('none');
    // Selection cycle is the machine's job (KEY_TAB → moveTab in keyboard-actions.ts).
    deps.commands.selection.keyTab(true);
    return handled();
  }

  // Single cell: original behavior — commit drives the active-cell motion.
  deps.commands.editor.commit('left');
  return handled();
};

/**
 * Commit edit and move right (Tab while editing or ArrowRight in Enter Mode).
 *
 * Selection-aware: When a multi-cell selection exists, commits with 'none'
 * direction (preserves selection) and delegates Tab-cycling to the selection
 * machine via `commands.selection.keyTab(false)`. Single-cell fallback uses
 * commit('right'). See `COMMIT_AND_MOVE_LEFT` for the history.
 */
export const COMMIT_AND_MOVE_RIGHT: ActionHandler = (deps) => {
  const ranges = deps.accessors.selection.getRanges();

  if (hasMultiCellSelection(ranges)) {
    deps.commands.editor.commit('none');
    deps.commands.selection.keyTab(false);
    return handled();
  }

  deps.commands.editor.commit('right');
  return handled();
};

/**
 * Commit edit via Tab key — routes through selection machine's KEY_TAB handler
 * so tabOriginCol is tracked for the Tab-Enter data entry pattern.
 */
export const COMMIT_TAB: ActionHandler = (deps) => {
  deps.commands.editor.commit('right', 'tab');
  return handled();
};

/**
 * Commit edit via Shift+Tab — routes through selection machine's KEY_TAB handler
 * with shiftKey=true for backward Tab navigation.
 */
export const COMMIT_SHIFT_TAB: ActionHandler = (deps) => {
  deps.commands.editor.commit('left', 'shift-tab');
  return handled();
};

/**
 * Commit edit via Enter key — routes through selection machine's KEY_ENTER handler
 * so tabOriginCol is respected (returns to Tab-start column on Enter).
 */
export const COMMIT_ENTER: ActionHandler = (deps) => {
  deps.commands.editor.commit('down', 'enter');
  return handled();
};

/**
 * Commit edit via Shift+Enter — routes through selection machine's KEY_ENTER handler
 * with shiftKey=true for upward movement.
 */
export const COMMIT_SHIFT_ENTER: ActionHandler = (deps) => {
  deps.commands.editor.commit('up', 'shift-enter');
  return handled();
};

/**
 * Cancel editing (Escape).
 */
export const CANCEL_EDIT: ActionHandler = (deps) => {
  deps.commands.editor.cancel();
  return handled();
};

/**
 * Commit editor in place — no selection movement.
 * Used by formula bar Enter, etc.
 */
export const COMMIT_IN_PLACE: ActionHandler = (deps) => {
  deps.commands.editor.commit('none');
  return handled();
};

/**
 * Picker selected a value — single compound event to the machine.
 * Atomically sets value + commits with no intermediate state.
 */
export const PICKER_COMMIT: ActionHandler = (
  deps,
  payload?: { value: unknown; direction: Direction | 'none' },
) => {
  if (payload) {
    deps.commands.editor.pickerCommit(payload.value, payload.direction ?? 'down');
  }
  return handled();
};

export const DATE_PICKER_COMMIT: ActionHandler = (
  deps,
  payload?: { isoDate: string; kind?: 'date' | 'datetime'; direction?: Direction | 'none' },
) => {
  if (payload) {
    deps.commands.editor.datePickerCommit(
      payload.isoDate,
      payload.kind ?? 'date',
      payload.direction ?? 'down',
    );
  }
  return handled();
};

/**
 * Insert newline in cell (Alt+Enter).
 */
export const INSERT_NEWLINE: ActionHandler = (deps) => {
  deps.commands.editor.insertNewline();
  return handled();
};

/**
 * Insert a printable character into the editor at the current cursor position.
 *
 * Used for cross-sheet formula editing when the inline cell editor is not
 * visible (it's on another sheet). Operators (+, -, *, /) and other printable
 * characters are forwarded through this action instead of being lost.
 *
 * H2 fix: replaces raw e.key reads and string splicing in keyboard-coordinator.
 *
 * @param payload - { char: string } The single character to insert
 */
export const INSERT_CHAR: ActionHandler = (deps, payload?: { char: string }) => {
  if (!payload?.char || payload.char.length !== 1) {
    return notHandled('not_implemented');
  }

  const value = deps.accessors.editor.getValue();
  const cursorPosition = deps.accessors.editor.getCursorPosition();
  const newValue = value.slice(0, cursorPosition) + payload.char + value.slice(cursorPosition);
  // Programmatic char insert — caret advances past the inserted character.
  deps.commands.editor.input(newValue, cursorPosition + 1);
  return handled();
};

/**
 * Start formula editing with '=' character.
 *
 * Blocks editing if the cell is in the cut range.
 */
export const START_FORMULA: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);

  // Block editing cells in cut range
  if (isCellInCutRange(deps, sheetId, activeCell)) {
    // Silently block the edit - Excel doesn't show a toast, just prevents editing
    return handled();
  }

  // Auto-deactivate selection modes on edit start (Excel behavior)
  // End Mode, Extend Selection (F8), and Add to Selection (Shift+F8) all deactivate
  // when the user starts editing a cell.
  // routed through the selection actor; the UIStore
  // mode slice fields were retired.
  deps.commands.selection.exitAllModes();

  await beginEditSessionFromAction(deps, {
    sheetId,
    cell: activeCell,
    entryMode: 'typing',
    initialTextHint: '=',
  });

  return handled();
};

// =============================================================================
// Content Modification Handlers
// =============================================================================

/**
 * Clear contents of selected cells (Delete key).
 *
 * Uses the worksheet range-clear API so large selections remain sparse.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 *
 * CSE handling: a Clear on the CSE anchor tears down the array
 * formula (Rust `set_cell` allows that case explicitly). A Clear on
 * a non-anchor member of a CSE array is rejected by Rust as
 * `ComputeError::PartialArrayWrite`; the editor surfaces that via
 * the standard error path. Selecting the entire CSE extent (anchor +
 * members) succeeds because the anchor Clear runs first and tears
 * down the projection — subsequent member Clears land on plain cells.
 */
export const CLEAR_CONTENTS: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  await deps.workbook.undoGroup(async () => {
    for (const sheetId of targetSheetIds) {
      const ws = getWorksheet(deps, sheetId);
      for (const range of ranges) {
        const ok = await guardBridgeMutation(() => ws.clear(range, 'contents'));
        if (!ok) {
          return;
        }
      }
    }
  });

  requestFormulaBarRefresh({ sheetIds: targetSheetIds, ranges });

  return handled();
};

/**
 * Clear all cell-attached payloads from selected cells.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const CLEAR_ALL: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  await deps.workbook.undoGroup(async () => {
    for (const sheetId of targetSheetIds) {
      const ws = getWorksheet(deps, sheetId);
      for (const range of ranges) {
        const ok = await guardBridgeMutation(() => ws.clear(range, 'all'));
        if (!ok) return;
        await clearRangeMetadata(ws, range);
      }
    }
  });

  return handled();
};

async function clearRangeMetadata(ws: WorksheetWithInternals, range: CellRange): Promise<void> {
  await Promise.all([
    clearCommentsInRange(ws, range),
    ws.validations.clearInRange(range),
    ws.conditionalFormats.clearInRanges([range]),
  ]);
}

async function clearCommentsInRange(ws: WorksheetWithInternals, range: CellRange): Promise<void> {
  const comments = await ws.comments.list();
  if (comments.length === 0) return;

  const positions = await ws._internal.batchGetCellPositions(
    comments.map((comment) => comment.cellRef),
  );
  const removals: Promise<void>[] = [];
  const seenCells = new Set<string>();
  for (const comment of comments) {
    const position = positions.get(comment.cellRef);
    if (!position) continue;
    if (
      position.row < range.startRow ||
      position.row > range.endRow ||
      position.col < range.startCol ||
      position.col > range.endCol
    ) {
      continue;
    }
    const key = `${position.row},${position.col}`;
    if (seenCells.has(key)) continue;
    seenCells.add(key);
    removals.push(ws.comments.removeForCell(position.row, position.col).then(() => undefined));
  }
  await Promise.all(removals);
}

function normalizedRange(range: CellRange): CellRange {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

function rangesEqual(a: CellRange, b: CellRange): boolean {
  const left = normalizedRange(a);
  const right = normalizedRange(b);
  return (
    left.startRow === right.startRow &&
    left.startCol === right.startCol &&
    left.endRow === right.endRow &&
    left.endCol === right.endCol
  );
}

function rangeContainsRange(container: CellRange, candidate: CellRange): boolean {
  const outer = normalizedRange(container);
  const inner = normalizedRange(candidate);
  return (
    inner.startRow >= outer.startRow &&
    inner.endRow <= outer.endRow &&
    inner.startCol >= outer.startCol &&
    inner.endCol <= outer.endCol
  );
}

function parseTableRange(range: string): CellRange | null {
  const localRange = range.includes('!') ? range.slice(range.lastIndexOf('!') + 1) : range;
  try {
    return parseA1RangeNotation(localRange.replace(/\$/g, ''));
  } catch {
    return null;
  }
}

async function removeTablesContainedByRange(ws: Worksheet, range: CellRange): Promise<void> {
  const tables = await ws.tables.list();
  for (const table of tables) {
    const tableRange = parseTableRange(table.range);
    if (tableRange && (rangesEqual(tableRange, range) || rangeContainsRange(range, tableRange))) {
      await ws.tables.remove(table.name);
    }
  }
}

/**
 * Clear formats only from selected cells.
 *
 * Uses ws.clearFormat(row, col).
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 *
 * - Also clears data validation from selected cells (Excel parity)
 */
export const CLEAR_FORMATS: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  await deps.workbook.undoGroup(async () => {
    for (const sheetId of targetSheetIds) {
      const ws = getWorksheet(deps, sheetId);
      for (const range of ranges) {
        // Clear formats: use clearFormatForRanges (removes all explicit formatting).
        // NOTE: setRange(range, {}) is a no-op — merge_formats({bold:true}, {}) keeps bold.
        await ws.formats.clearRange({
          startRow: range.startRow,
          startCol: range.startCol,
          endRow: range.endRow,
          endCol: range.endCol,
        });

        // Clear data validation (Excel parity)
        const rangeStr = `${deps.workbook.indexToAddress(range.startRow, range.startCol)}:${deps.workbook.indexToAddress(range.endRow, range.endCol)}`;
        await ws.validations.clear(rangeStr);
      }
    }
  });

  return handled();
};

/**
 * Clear comments from selected cells.
 *
 * Uses ws.comments.removeNote(row, col) via unified Worksheet API.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const CLEAR_COMMENTS: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  await deps.workbook.undoGroup(async () => {
    for (const sheetId of targetSheetIds) {
      const ws = getWorksheet(deps, sheetId);
      const removals: Promise<void>[] = [];
      for (const range of ranges) {
        for (let row = range.startRow; row <= range.endRow; row++) {
          for (let col = range.startCol; col <= range.endCol; col++) {
            removals.push(ws.comments.removeNote(row, col));
          }
        }
      }
      await Promise.all(removals);
    }
  });

  return handled();
};

// =============================================================================
// Sort Handlers (Cell Identity Model)
// =============================================================================

/**
 * Shared body for SORT_ASCENDING / SORT_DESCENDING. The two handlers are
 * identical except for the sort direction, so the loop, current-region
 * expansion, merged-cell guard, and active-column logic live here.
 *
 * Cell Identity Model: Sort updates cell POSITIONS, not DATA.
 * - CellIds stay with their values (formulas preserved)
 * - External references follow the cell (no #REF! errors from sorting)
 *
 * Excel refuses to sort ranges containing merged cells; we return
 * `{ handled: false, reason: 'blocked' }` if any merge overlaps the range.
 *
 */
async function sortInDirection(
  deps: ActionDependencies,
  direction: 'asc' | 'desc',
): Promise<ActionResult> {
  const sheetId = deps.getActiveSheetId();
  const { activeCell, ranges } = getSelectionContext(deps);
  const ws = getWorksheet(deps, sheetId);

  let sorted = false;
  for (const range of ranges) {
    const target = await resolveDataCommandTarget(ws, range);
    if (!target) continue;

    // E4: Excel refuses to sort ranges containing merged cells.
    const allMerges = await ws.structure.getMergedRegions();
    const hasMergesInRange = allMerges.some(
      (m) =>
        !(
          m.endRow < target.range.startRow ||
          m.startRow > target.range.endRow ||
          m.endCol < target.range.startCol ||
          m.startCol > target.range.endCol
        ),
    );
    if (hasMergesInRange) {
      return {
        handled: false,
        reason: 'blocked' as const,
        error: 'This operation requires the merged cells to be identically sized.',
      };
    }

    await ws.sortRange(target.range, {
      columns: [{ column: getRelativeCommandColumn(activeCell, target.range), direction }],
      hasHeaders: target.hasHeaders,
    });
    sorted = true;
  }

  return sorted ? handled() : notHandled('disabled');
}

/**
 * Sort selection ascending. See `sortInDirection` for behavior details.
 */
export const SORT_ASCENDING: AsyncActionHandler = (deps) => sortInDirection(deps, 'asc');

/**
 * Sort selection descending. See `sortInDirection` for behavior details.
 */
export const SORT_DESCENDING: AsyncActionHandler = (deps) => sortInDirection(deps, 'desc');

/**
 * Sort selection by cell background color.
 *
 * Sort by Color options
 * - Opens sort dialog with color sort pre-selected
 * - Or sorts by the currently selected cell's color
 *
 */
export const SORT_BY_CELL_COLOR: AsyncActionHandler = async (deps) => {
  const { activeCell, ranges } = getSelectionContext(deps);
  if (ranges.length === 0) {
    return notHandled('disabled');
  }
  const ws = getWorksheet(deps, deps.getActiveSheetId());
  const target = await resolveDataCommandTarget(ws, ranges[0]);
  if (!target) {
    return notHandled('disabled');
  }
  const format = await ws.formats.get(activeCell.row, activeCell.col);
  const targetColor = format?.backgroundColor;
  if (!targetColor) {
    return notHandled('disabled');
  }
  getUIStore(deps)
    .getState()
    .openSortDialog(target.range, target.hasHeaders, {
      type: 'cellColor',
      criterion: {
        sortBy: 'cellColor',
        columnIndex: getRelativeCommandColumn(activeCell, target.range),
        direction: 'asc',
        targetColor,
        colorPosition: 'top',
      },
    });
  return handled();
};

/**
 * Sort selection by font color.
 *
 * Sort by Color options
 * - Opens sort dialog with font color sort pre-selected
 * - Or sorts by the currently selected cell's font color
 *
 */
export const SORT_BY_FONT_COLOR: AsyncActionHandler = async (deps) => {
  const { activeCell, ranges } = getSelectionContext(deps);
  if (ranges.length === 0) {
    return notHandled('disabled');
  }
  const ws = getWorksheet(deps, deps.getActiveSheetId());
  const target = await resolveDataCommandTarget(ws, ranges[0]);
  if (!target) {
    return notHandled('disabled');
  }
  const format = await ws.formats.get(activeCell.row, activeCell.col);
  const targetColor = format?.fontColor;
  if (!targetColor) {
    return notHandled('disabled');
  }
  getUIStore(deps)
    .getState()
    .openSortDialog(target.range, target.hasHeaders, {
      type: 'fontColor',
      criterion: {
        sortBy: 'fontColor',
        columnIndex: getRelativeCommandColumn(activeCell, target.range),
        direction: 'asc',
        targetColor,
        colorPosition: 'top',
      },
    });
  return handled();
};

/**
 * Clear cell and start editing (Backspace or typing).
 *
 * Blocks editing if the cell is in the cut range.
 *
 * Excel parity: the backend clear is *tentative* for a
 * single-cell selection — Escape must restore the original formula. We
 * achieve that by skipping the backend mutation entirely on single-cell
 * selections and letting the editor commit pipeline handle the empty
 * value at Enter time. For multi-cell selections (range or multiple
 * non-contiguous cells) Excel commits the clear immediately; we keep
 * that behavior and guard the bridge call against `PartialArrayWrite`
 * so a CSE member rejection short-circuits the edit cleanly.
 */
export const CLEAR_AND_EDIT: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { activeCell, ranges } = getSelectionContext(deps);

  // Block editing cells in cut range
  if (isCellInCutRange(deps, sheetId, activeCell)) {
    // Silently block the edit - Excel doesn't show a toast, just prevents editing
    return handled();
  }

  // Auto-deactivate selection modes on edit start (Excel behavior)
  // End Mode, Extend Selection (F8), and Add to Selection (Shift+F8) all deactivate
  // when the user starts editing a cell.
  // routed through the selection actor; the UIStore
  // mode slice fields were retired.
  deps.commands.selection.exitAllModes();

  // Multi-cell when either the selection contains more than one range
  // (Cmd-click non-contiguous selection) or any range covers more than
  // one cell. Single active-cell only ⇒ tentative-edit path.
  const isMultiCell =
    ranges.length > 1 || ranges.some((r) => r.startRow !== r.endRow || r.startCol !== r.endCol);

  if (isMultiCell) {
    const ws = getWorksheet(deps, sheetId);
    let cleared = true;
    await deps.workbook.undoGroup(async () => {
      for (const range of ranges) {
        await removeTablesContainedByRange(ws, range);
        const ok = await guardBridgeMutation(() => ws.clear(range, 'contents'));
        if (!ok) {
          cleared = false;
          return;
        }
      }
    });
    if (!cleared) {
      // PartialArrayWrite — abort the edit; the user pressed Backspace
      // on a selection that overlaps a CSE block and Rust rejected it.
      return handled();
    }
  }

  // Then enter edit mode on the active cell. For single-cell, the active
  // cell's backend value is *unchanged* — Escape leaves it intact, Enter
  // commits whatever the user types (or empty → clear) through the
  // editor's normal commit pipeline.
  await beginEditSessionFromAction(deps, {
    sheetId,
    cell: activeCell,
    entryMode: 'typing',
    initialTextHint: '',
  });

  return handled();
};

/**
 * Delete to end of line in editor.
 * Note: This action is for text editing within a cell, not clearing cells.
 */
export const DELETE_TO_END_OF_LINE: ActionHandler = (deps) => {
  deps.commands.editor.deleteToEndOfLine();
  return handled();
};

// =============================================================================
// Cursor Navigation Handlers (Multi-line cells in Edit Mode)
// =============================================================================

/**
 * Move cursor up in multi-line cell (ArrowUp in Edit Mode).
 * Allows native text cursor movement within multi-line cells.
 *
 * Note: In Edit Mode, arrow keys move the cursor within the text.
 * This handler signals that we want cursor navigation, not cell navigation.
 * The actual cursor movement is handled by the browser's native behavior.
 */
export const CURSOR_UP: ActionHandler = (deps) => {
  deps.commands.editor.cursorUp();
  return handled();
};

/**
 * Move cursor down in multi-line cell (ArrowDown in Edit Mode).
 * Allows native text cursor movement within multi-line cells.
 *
 * Note: In Edit Mode, arrow keys move the cursor within the text.
 * This handler signals that we want cursor navigation, not cell navigation.
 * The actual cursor movement is handled by the browser's native behavior.
 */
export const CURSOR_DOWN: ActionHandler = (deps) => {
  deps.commands.editor.cursorDown();
  return handled();
};

// =============================================================================
// Word Deletion Handlers (Edit Mode)
// =============================================================================

/**
 * Delete word forward (Ctrl+Delete in Edit Mode).
 * Deletes from cursor to end of current word or next word boundary.
 *
 * Note: The actual deletion is handled by the browser's native behavior
 * when we allow the event to propagate.
 */
export const DELETE_WORD_FORWARD: ActionHandler = (deps) => {
  deps.commands.editor.deleteWordForward();
  return handled();
};

/**
 * Delete word backward (Ctrl+Backspace in Edit Mode).
 * Deletes from cursor to beginning of current word or previous word boundary.
 *
 * Note: The actual deletion is handled by the browser's native behavior
 * when we allow the event to propagate.
 */
export const DELETE_WORD_BACKWARD: ActionHandler = (deps) => {
  deps.commands.editor.deleteWordBackward();
  return handled();
};

// =============================================================================
// Fill Operations Handlers
// =============================================================================
//
// ARCHITECTURE: All fill handlers delegate to executeFillViaWorksheet() from
// fill/types.ts. This ensures a single source of truth for fill behavior,
// whether triggered via menu (Home→Fill→Down) or drag handle (autofill).
//
// executeFillViaWorksheet() properly:
// - Adjusts formula references (e.g., =A1 becomes =A2 when filled down)
// - Uses the Cell Identity Model (IdentityFormula refs, no A1 round-tripping)
// - Handles patterns, formats, validation copying
// - Applies via Worksheet API batch methods
// =============================================================================

/**
 * Helper to execute a fill operation in a given direction.
 * Computes source and target ranges based on selection and direction.
 *
 * @param ws - Worksheet instance
 * @param sheetId - Active sheet ID
 * @param range - Selection range
 * @param direction - Fill direction
 */
async function executeFillForRange(
  ws: import('@mog-sdk/contracts/api').Worksheet,
  sheetId: SheetId,
  range: CellRange,
  direction: FillDirection,
): Promise<void> {
  // Compute source and target ranges based on direction
  // Source is the edge row/column, target is the rest of the selection
  let sourceRange: { startRow: number; startCol: number; endRow: number; endCol: number };
  let targetRange: { startRow: number; startCol: number; endRow: number; endCol: number };

  switch (direction) {
    case 'down':
      // Source: first row, Target: remaining rows
      if (range.endRow <= range.startRow) return; // Nothing to fill
      sourceRange = {
        startRow: range.startRow,
        startCol: range.startCol,
        endRow: range.startRow,
        endCol: range.endCol,
      };
      targetRange = {
        startRow: range.startRow + 1,
        startCol: range.startCol,
        endRow: range.endRow,
        endCol: range.endCol,
      };
      break;

    case 'right':
      // Source: first column, Target: remaining columns
      if (range.endCol <= range.startCol) return; // Nothing to fill
      sourceRange = {
        startRow: range.startRow,
        startCol: range.startCol,
        endRow: range.endRow,
        endCol: range.startCol,
      };
      targetRange = {
        startRow: range.startRow,
        startCol: range.startCol + 1,
        endRow: range.endRow,
        endCol: range.endCol,
      };
      break;

    case 'up':
      // Source: last row, Target: rows above
      if (range.endRow <= range.startRow) return; // Nothing to fill
      sourceRange = {
        startRow: range.endRow,
        startCol: range.startCol,
        endRow: range.endRow,
        endCol: range.endCol,
      };
      targetRange = {
        startRow: range.startRow,
        startCol: range.startCol,
        endRow: range.endRow - 1,
        endCol: range.endCol,
      };
      break;

    case 'left':
      // Source: last column, Target: columns to the left
      if (range.endCol <= range.startCol) return; // Nothing to fill
      sourceRange = {
        startRow: range.startRow,
        startCol: range.endCol,
        endRow: range.endRow,
        endCol: range.endCol,
      };
      targetRange = {
        startRow: range.startRow,
        startCol: range.startCol,
        endRow: range.endRow,
        endCol: range.endCol - 1,
      };
      break;
  }

  // Execute fill using the unified fill system
  // This properly adjusts formula references and handles all fill semantics
  await executeFillViaWorksheet(ws, sourceRange, targetRange, sheetId, {
    direction,
    fillType: 'all',
    seriesType: 'copy', // Menu fill commands use 'copy' mode (no pattern detection)
    includeFormulas: true,
    includeValues: true,
    includeFormats: true,
    smartFill: false, // Menu fill commands don't do smart pattern detection
  });
}

/**
 * Fill down - copy from first row of selection to all rows below (Ctrl+D).
 * Formulas are properly adjusted (e.g., =A1 becomes =A2, =A3, etc.)
 */
export const FILL_DOWN: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const { ranges } = getSelectionContext(deps);

  await deps.workbook.undoGroup(async () => {
    for (const range of ranges) {
      await executeFillForRange(ws, sheetId, range, 'down');
    }
  });

  return handled();
};

/**
 * Fill right - copy from first column of selection to all columns right (Ctrl+R).
 * Formulas are properly adjusted (e.g., =A1 becomes =B1, =C1, etc.)
 */
export const FILL_RIGHT: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const { ranges } = getSelectionContext(deps);

  await deps.workbook.undoGroup(async () => {
    for (const range of ranges) {
      await executeFillForRange(ws, sheetId, range, 'right');
    }
  });

  return handled();
};

/**
 * Fill up - copy from last row of selection to all rows above.
 * Formulas are properly adjusted (e.g., =A4 becomes =A3, =A2, etc.)
 */
export const FILL_UP: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const { ranges } = getSelectionContext(deps);

  await deps.workbook.undoGroup(async () => {
    for (const range of ranges) {
      await executeFillForRange(ws, sheetId, range, 'up');
    }
  });

  return handled();
};

/**
 * Fill left - copy from last column of selection to all columns left.
 * Formulas are properly adjusted (e.g., =D1 becomes =C1, =B1, etc.)
 */
export const FILL_LEFT: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const { ranges } = getSelectionContext(deps);

  await deps.workbook.undoGroup(async () => {
    for (const range of ranges) {
      await executeFillForRange(ws, sheetId, range, 'left');
    }
  });

  return handled();
};

/**
 * Fill selection with current editor value (Ctrl+Enter while editing).
 *
 * Uses ws.setCell() to write values.
 */
export const FILL_SELECTION: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { ranges: visibleRanges } = getSelectionContext(deps);
  const editStartRanges = deps.accessors.editor.getEditStartSelectionRanges();
  const ranges = editStartRanges && editStartRanges.length > 0 ? editStartRanges : visibleRanges;
  const ws = getWorksheet(deps, sheetId);

  const editingValue = deps.accessors.editor.getValue() || '';

  // Batch: collect all updates and send in one IPC call
  const updates: Array<{ row: number; col: number; value: any }> = [];
  for (const range of ranges) {
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        updates.push({ row, col, value: editingValue });
      }
    }
  }
  if (updates.length > 0) {
    let ok = true;
    await deps.workbook.undoGroup(async () => {
      ok = await guardBridgeMutation(async () => {
        await ws.setCells(updates);
      });
    });
    if (!ok) return handled();
  }

  deps.commands.editor.cancel();

  return handled();
};

// =============================================================================
// Date/Time Insertion Handlers
// =============================================================================

/**
 * Insert current date (Ctrl+;).
 *
 * Passes the now-instant to `setDateValue(Date)` which resolves the calendar
 * parts in the session's `userTimezone`. The result is "today in the user's
 * calendar frame" — correct on a browser host (where session TZ = browser
 * Intl) and on a cloud worker (where session TZ is supplied by the
 * orchestrator from the user's session metadata). Never depends on the host
 * process's local time.
 */
export const INSERT_CURRENT_DATE: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);
  const ws = deps.workbook.getSheetById(sheetId);

  const ok = await guardBridgeMutation(() =>
    ws.setDateValue(activeCell.row, activeCell.col, new Date()),
  );
  if (!ok) return handled();

  return handled();
};

/**
 * Insert current time (Ctrl+Shift+;). Same session-TZ semantics as
 * INSERT_CURRENT_DATE — extracts the time-of-day components in the user's
 * calendar frame.
 */
export const INSERT_CURRENT_TIME: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);
  const ws = deps.workbook.getSheetById(sheetId);

  const ok = await guardBridgeMutation(() =>
    ws.setTimeValue(activeCell.row, activeCell.col, new Date()),
  );
  if (!ok) return handled();

  return handled();
};

// =============================================================================
// Copy From Above Handlers
// =============================================================================

/**
 * Copy the displayed value from the cell above (Ctrl+Shift+").
 *
 * Uses ws.getCell() for display value read, ws.setCell() for write.
 */
export const COPY_VALUE_FROM_ABOVE: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);
  const ws = getWorksheet(deps, sheetId);

  if (activeCell.row > 0) {
    const cellData = await ws.getCell(activeCell.row - 1, activeCell.col);
    const displayValue = cellData.value != null ? String(cellData.value) : '';
    // Set as literal value (not formula)
    const ok = await guardBridgeMutation(() =>
      ws.setCell(activeCell.row, activeCell.col, displayValue),
    );
    if (!ok) return handled();
  }

  return handled();
};

/**
 * Copy the formula/raw value from the cell above (Ctrl+').
 *
 * Uses ws.getCell() and ws.getFormula() to read formula or raw value,
 * ws.setCell() for write.
 */
export const COPY_FORMULA_FROM_ABOVE: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);
  const ws = getWorksheet(deps, sheetId);

  if (activeCell.row > 0) {
    // If cell has a formula, copy the formula; otherwise copy the raw value
    const formula = await ws.getFormula(activeCell.row - 1, activeCell.col);
    if (formula) {
      // Copy the formula text (e.g., "=SUM(A1:A5)")
      const ok = await guardBridgeMutation(() =>
        ws.setCell(activeCell.row, activeCell.col, formula),
      );
      if (!ok) return handled();
    } else {
      const cellData = await ws.getCell(activeCell.row - 1, activeCell.col);
      const rawValue = cellData.value != null ? String(cellData.value) : '';
      const ok = await guardBridgeMutation(() =>
        ws.setCell(activeCell.row, activeCell.col, rawValue),
      );
      if (!ok) return handled();
    }
  }

  return handled();
};

// =============================================================================
// Formula-Specific Handlers
// =============================================================================

/**
 * Cycle reference style (F4 in formula editing).
 * Cycles: A1 -> $A$1 -> A$1 -> $A1 -> A1
 */
export const CYCLE_REFERENCE: ActionHandler = (deps) => {
  deps.commands.editor.cycleReference();
  return handled();
};

/**
 * Enter array formula (Ctrl+Shift+Enter).
 */
export const ENTER_ARRAY_FORMULA: ActionHandler = (deps) => {
  deps.commands.editor.enterArrayFormula();
  return handled();
};

/**
 * Insert function arguments placeholder.
 */
export const INSERT_FUNCTION_ARGS: ActionHandler = (deps) => {
  deps.commands.editor.insertFunctionArgs();
  return handled();
};

/**
 * Paste name in formula (F3 in formula editing).
 *
 * SCOPE: deferred to there is no dedicated name-picker
 * dialog in `apps/spreadsheet/src/dialogs/`; the existing
 * `named-ranges-dialog` slice is a Define/Manager surface that creates
 * names, not a picker for inserting them into a formula. Adding a
 * "paste mode" flag to that slice without a paste-mode UI subscriber
 * would leave the handler wired to a UI state path with no consumer. Until a
 * real picker dialog ships, this handler stays on the legacy
 * stringly-typed UI escape hatch — keeps that field on the
 * deps type specifically to keep this handler functional.
 */
export const PASTE_NAME_IN_FORMULA: ActionHandler = (deps) => {
  // This typically opens a name picker dialog
  deps.onUIAction?.('PASTE_NAME_IN_FORMULA');
  return handled();
};

/**
 * Insert an aggregate function (AVERAGE/COUNT/MAX/MIN) at the active cell.
 *
 * Mirrors the viewport-scan behavior previously implemented in
 * `chrome/toolbar/hooks/use-editing-actions.ts:insertAutoFunction`. Scans
 * the column above the active cell for a contiguous numeric range and
 * writes `=<FN>(<range>)`; falls back to `=<FN>()` if no numeric data
 * is found.
 *
 * AUTO_SUM (separate action below) uses smarter range detection that
 * also looks left when no data is above. INSERT_AUTO_FUNCTION keeps the
 * simpler scan to preserve parity with the prior Editing-group hook.
 *
 */
export const INSERT_AUTO_FUNCTION: AsyncActionHandler = async (
  deps,
  payload?: { functionName: 'AVERAGE' | 'COUNT' | 'MAX' | 'MIN' },
) => {
  if (!payload?.functionName) {
    return notHandled('not_implemented');
  }
  const fn = payload.functionName;
  const sheetId = deps.getActiveSheetId();
  const { activeCell } = getSelectionContext(deps);
  const ws = getWorksheet(deps, sheetId);
  const row = activeCell.row;
  const col = activeCell.col;

  const cellRef = (r: number, c: number): string => deps.workbook.indexToAddress(r, c);

  // Find contiguous numeric range above using the viewport buffer for
  // sync reads. Mirrors the prior hook's behavior.
  let endRow = row - 1;
  while (endRow >= 0) {
    const cell = ws.viewport.getCellData(endRow, col);
    if (cell?.value != null && cell.value !== '') {
      break;
    }
    endRow--;
  }

  if (endRow < 0) {
    const ok = await guardBridgeMutation(() => ws.setCell(row, col, `=${fn}()`));
    if (!ok) return handled();
    return handled();
  }

  // Check if numeric — mirrors the prior hook's `typeof === 'number'`
  // check verbatim (use-editing-actions.ts lines 162-164 in the
  // previous source). The viewport's CellData.value at this layer
  // is the raw primitive, not a discriminated union, so the simple
  // typeof check is the right fidelity.
  const firstCell = ws.viewport.getCellData(endRow, col);
  const isNumeric = typeof firstCell?.value === 'number';

  if (!isNumeric) {
    const ok = await guardBridgeMutation(() => ws.setCell(row, col, `=${fn}()`));
    if (!ok) return handled();
    return handled();
  }

  // Find start of contiguous numeric range
  let startRow = endRow;
  while (startRow > 0) {
    const cell = ws.viewport.getCellData(startRow - 1, col);
    if (typeof cell?.value !== 'number') break;
    startRow--;
  }

  const startRef = cellRef(startRow, col);
  const endRef = cellRef(endRow, col);
  const formula = startRow === endRow ? `=${fn}(${startRef})` : `=${fn}(${startRef}:${endRef})`;

  const ok = await guardBridgeMutation(() => ws.setCell(row, col, formula));
  if (!ok) return handled();
  return handled();
};

/**
 * AutoSum - insert an aggregate formula for adjacent data (Alt+=).
 *
 * Uses ws.getRange() and ws.getCell() for scanning adjacent cells (above
 * first, then left) to determine the range. The function name defaults to
 * SUM but can be overridden via payload to support the Formulas-ribbon
 * AutoSum dropdown's Average/Count/Max/Min variants. The smart range
 * detection (above + left fallback) is shared across all variants —
 * matching what Excel does for its AutoSum dropdown entries.
 *
 * INSERT_AUTO_FUNCTION (separate handler) is the simpler viewport-scan
 * variant used by the Editing-group ribbon dropdown; it ships in parallel
 * with AUTO_SUM by design.
 */
export const AUTO_SUM: AsyncActionHandler = async (
  deps,
  payload?: { functionName?: 'SUM' | 'AVERAGE' | 'COUNT' | 'MAX' | 'MIN' },
) => {
  const fn = payload?.functionName ?? 'SUM';
  const sheetId = deps.getActiveSheetId();
  const { activeCell, ranges } = getSelectionContext(deps);
  const ws = getWorksheet(deps, sheetId);

  const selectedPlacement = getAutoSumPlacementFromSelection(ranges, deps.workbook);
  const targetCell = selectedPlacement?.targetCell ?? activeCell;
  const sumRange =
    selectedPlacement?.sumRange ??
    (await findAutoSumRange(ws, activeCell.row, activeCell.col, deps.workbook));

  // Auto-deactivate selection modes on edit start (Excel behavior)
  // routed through the selection actor; the UIStore
  // mode slice fields were retired.
  deps.commands.selection.exitAllModes();

  // Start editing with the formula
  await beginEditSessionFromAction(deps, {
    sheetId,
    cell: targetCell,
    entryMode: 'typing',
    initialTextHint: `=${fn}(${sumRange})`,
  });

  return handled();
};

// =============================================================================
// Helper Functions
// =============================================================================

function getAutoSumPlacementFromSelection(
  ranges: CellRange[],
  wb: ActionDependencies['workbook'],
): { targetCell: CellCoord; sumRange: string } | null {
  if (ranges.length !== 1) {
    return null;
  }

  const range = normalizeRange(ranges[0]);
  const isSingleCell = range.startRow === range.endRow && range.startCol === range.endCol;
  if (isSingleCell) {
    return null;
  }

  const isSingleColumn = range.startCol === range.endCol;
  const isSingleRow = range.startRow === range.endRow;
  let targetCell: CellCoord;

  if (isSingleColumn && range.endRow + 1 < MAX_ROWS) {
    targetCell = { row: range.endRow + 1, col: range.startCol };
  } else if (isSingleRow && range.endCol + 1 < MAX_COLS) {
    targetCell = { row: range.startRow, col: range.endCol + 1 };
  } else if (range.endRow + 1 < MAX_ROWS) {
    targetCell = { row: range.endRow + 1, col: range.startCol };
  } else if (range.endCol + 1 < MAX_COLS) {
    targetCell = { row: range.startRow, col: range.endCol + 1 };
  } else {
    return null;
  }

  const startRef = wb.indexToAddress(range.startRow, range.startCol);
  const endRef = wb.indexToAddress(range.endRow, range.endCol);
  const sumRange = startRef === endRef ? startRef : `${startRef}:${endRef}`;

  return { targetCell, sumRange };
}

/**
 * Find the range for AutoSum based on adjacent data.
 * Looks above the cell first, then left if no data above.
 * Returns a range string like "A1:A5" or "A1:E1".
 *
 * Uses ws.getRange() to scan for numeric data above and to the left.
 */
async function findAutoSumRange(
  ws: Worksheet,
  row: number,
  col: number,
  wb: ActionDependencies['workbook'],
): Promise<string> {
  // Helper to create cell reference string using workbook utility
  const cellRef = (r: number, c: number): string => wb.indexToAddress(r, c);

  // Batch-query the column above using ws.getRange()
  if (row > 0) {
    const rangeData = await ws.getRange(0, col, row - 1, col);

    // rangeData is CellData[][] — one column, so rangeData[r][0]
    // Scan from bottom (closest to active cell) upward
    let foundData = false;
    let startRow = row - 1;

    for (let r = row - 1; r >= 0; r--) {
      const cellData = rangeData[r]?.[0];
      const value = cellData?.value;
      const display = value != null ? String(value) : '';
      const isNumeric = display !== '' && !isNaN(Number(display));

      if (isNumeric) {
        foundData = true;
        startRow = r;
      } else if (foundData) {
        break;
      }
    }

    if (foundData) {
      const rangeEndRow = row - 1;
      if (startRow <= rangeEndRow) {
        return `${cellRef(startRow, col)}:${cellRef(rangeEndRow, col)}`;
      }
    }
  }

  // If no data above, look left
  if (col > 0) {
    const rangeData = await ws.getRange(row, 0, row, col - 1);

    // rangeData is CellData[][] — one row, so rangeData[0][c]
    let foundData = false;
    let startCol = col - 1;

    for (let c = col - 1; c >= 0; c--) {
      const cellData = rangeData[0]?.[c];
      const value = cellData?.value;
      const display = value != null ? String(value) : '';
      const isNumeric = display !== '' && !isNaN(Number(display));

      if (isNumeric) {
        foundData = true;
        startCol = c;
      } else if (foundData) {
        break;
      }
    }

    if (foundData) {
      const rangeEndCol = col - 1;
      if (startCol <= rangeEndCol) {
        return `${cellRef(row, startCol)}:${cellRef(row, rangeEndCol)}`;
      }
    }
  }

  // Default: just reference the cell above if nothing found
  if (row > 0) {
    return cellRef(row - 1, col);
  }
  // Or the cell to the left
  if (col > 0) {
    return cellRef(row, col - 1);
  }
  // Fallback to A1
  return 'A1';
}

// =============================================================================
// Enter Mode / Edit Mode Handlers
// =============================================================================

/**
 * Toggle between Enter Mode and Edit Mode (F2 while editing).
 *
 * Enter Mode: Arrow keys commit edit and move selection (or insert formula refs)
 * Edit Mode: Arrow keys move cursor within text
 */
export const TOGGLE_EDIT_MODE: ActionHandler = (deps) => {
  deps.commands.editor.toggleEditMode();
  return handled();
};

/**
 * Insert/extend cell reference up in formula Enter Mode.
 * Triggers formula range selection mode if not already active.
 */
export const FORMULA_SELECT_UP: ActionHandler = (deps) => {
  // Enter range selection mode if not already in it
  if (!deps.accessors.selection.isSelectingRangeForFormula()) {
    const currentRangeColor = deps.accessors.editor.getCurrentRangeColor();
    deps.commands.selection.enterFormulaRangeMode(currentRangeColor);
  }

  // Move selection up
  deps.commands.selection.keyArrow('up', false);
  return handled();
};

/**
 * Insert/extend cell reference down in formula Enter Mode.
 */
export const FORMULA_SELECT_DOWN: ActionHandler = (deps) => {
  if (!deps.accessors.selection.isSelectingRangeForFormula()) {
    const currentRangeColor = deps.accessors.editor.getCurrentRangeColor();
    deps.commands.selection.enterFormulaRangeMode(currentRangeColor);
  }

  deps.commands.selection.keyArrow('down', false);
  return handled();
};

/**
 * Insert/extend cell reference left in formula Enter Mode.
 */
export const FORMULA_SELECT_LEFT: ActionHandler = (deps) => {
  if (!deps.accessors.selection.isSelectingRangeForFormula()) {
    const currentRangeColor = deps.accessors.editor.getCurrentRangeColor();
    deps.commands.selection.enterFormulaRangeMode(currentRangeColor);
  }

  deps.commands.selection.keyArrow('left', false);
  return handled();
};

/**
 * Insert/extend cell reference right in formula Enter Mode.
 */
export const FORMULA_SELECT_RIGHT: ActionHandler = (deps) => {
  if (!deps.accessors.selection.isSelectingRangeForFormula()) {
    const currentRangeColor = deps.accessors.editor.getCurrentRangeColor();
    deps.commands.selection.enterFormulaRangeMode(currentRangeColor);
  }

  deps.commands.selection.keyArrow('right', false);
  return handled();
};

/**
 * Extend formula range selection up (Shift+Arrow in formula Enter Mode).
 * Passes shift=true so extendSelection fires instead of moveActiveCell.
 */
export const FORMULA_EXTEND_UP: ActionHandler = (deps) => {
  if (!deps.accessors.selection.isSelectingRangeForFormula()) {
    const currentRangeColor = deps.accessors.editor.getCurrentRangeColor();
    deps.commands.selection.enterFormulaRangeMode(currentRangeColor);
  }

  deps.commands.selection.keyArrow('up', true);
  return handled();
};

/**
 * Extend formula range selection down (Shift+Arrow in formula Enter Mode).
 */
export const FORMULA_EXTEND_DOWN: ActionHandler = (deps) => {
  if (!deps.accessors.selection.isSelectingRangeForFormula()) {
    const currentRangeColor = deps.accessors.editor.getCurrentRangeColor();
    deps.commands.selection.enterFormulaRangeMode(currentRangeColor);
  }

  deps.commands.selection.keyArrow('down', true);
  return handled();
};

/**
 * Extend formula range selection left (Shift+Arrow in formula Enter Mode).
 */
export const FORMULA_EXTEND_LEFT: ActionHandler = (deps) => {
  if (!deps.accessors.selection.isSelectingRangeForFormula()) {
    const currentRangeColor = deps.accessors.editor.getCurrentRangeColor();
    deps.commands.selection.enterFormulaRangeMode(currentRangeColor);
  }

  deps.commands.selection.keyArrow('left', true);
  return handled();
};

/**
 * Extend formula range selection right (Shift+Arrow in formula Enter Mode).
 */
export const FORMULA_EXTEND_RIGHT: ActionHandler = (deps) => {
  if (!deps.accessors.selection.isSelectingRangeForFormula()) {
    const currentRangeColor = deps.accessors.editor.getCurrentRangeColor();
    deps.commands.selection.enterFormulaRangeMode(currentRangeColor);
  }

  deps.commands.selection.keyArrow('right', true);
  return handled();
};

/**
 * Move to data edge during formula range selection (Ctrl+Arrow in formula
 * Enter Mode). Excel parity: jumps the picked single-cell reference to the
 * contiguous data edge. The cross-coordination subscription detects the
 * anchor move and fires FORMULA_RANGE_SELECTED so the formula text
 * inserts/replaces the reference.
 */
async function formulaMoveToEdge(
  deps: ActionDependencies,
  direction: Direction,
): Promise<ActionResult> {
  if (!deps.accessors.selection.isSelectingRangeForFormula()) {
    const currentRangeColor = deps.accessors.editor.getCurrentRangeColor();
    deps.commands.selection.enterFormulaRangeMode(currentRangeColor);
  }
  const activeCell = deps.accessors.selection.getActiveCell();
  const ws = deps.workbook.activeSheet;
  const targetCell = await ws.findDataEdge(activeCell.row, activeCell.col, direction);
  // The selectingRangeForFormula state does not handle GO_TO; route via
  // SET_SELECTION which IS handled. The cross-coordination subscriber
  // detects the anchor change and fires FORMULA_RANGE_SELECTED.
  deps.commands.selection.setSelection([singleCellRange(targetCell)], targetCell);
  return handled();
}

export const FORMULA_MOVE_TO_EDGE_UP: AsyncActionHandler = (deps) => formulaMoveToEdge(deps, 'up');
export const FORMULA_MOVE_TO_EDGE_DOWN: AsyncActionHandler = (deps) =>
  formulaMoveToEdge(deps, 'down');
export const FORMULA_MOVE_TO_EDGE_LEFT: AsyncActionHandler = (deps) =>
  formulaMoveToEdge(deps, 'left');
export const FORMULA_MOVE_TO_EDGE_RIGHT: AsyncActionHandler = (deps) =>
  formulaMoveToEdge(deps, 'right');

/**
 * Extend formula range selection to data edge (Ctrl+Shift+Arrow in formula
 * Enter Mode). Excel parity: extends the picked range to the contiguous
 * data edge. The cross-coordination subscription detects the range
 * extension and fires FORMULA_RANGE_SELECTED so the formula text inserts
 * or replaces the reference (e.g. "=B1:B5").
 */
async function formulaExtendToEdge(
  deps: ActionDependencies,
  direction: Direction,
): Promise<ActionResult> {
  if (!deps.accessors.selection.isSelectingRangeForFormula()) {
    const currentRangeColor = deps.accessors.editor.getCurrentRangeColor();
    deps.commands.selection.enterFormulaRangeMode(currentRangeColor);
  }
  const activeCell = deps.accessors.selection.getActiveCell();
  const ranges = deps.accessors.selection.getRanges();
  const anchor = deps.accessors.selection.getAnchor() ?? activeCell;
  const ws = deps.workbook.activeSheet;

  const lastRange = ranges[ranges.length - 1] as CellRange | undefined;
  const extendFrom = lastRange ? getMovingEdge(lastRange, anchor) : activeCell;
  const targetCell = await ws.findDataEdge(extendFrom.row, extendFrom.col, direction);
  const newRange = rangeFromAnchorAndCell(anchor, targetCell);
  deps.commands.selection.setSelection([newRange], anchor);
  return handled();
}

export const FORMULA_EXTEND_TO_EDGE_UP: AsyncActionHandler = (deps) =>
  formulaExtendToEdge(deps, 'up');
export const FORMULA_EXTEND_TO_EDGE_DOWN: AsyncActionHandler = (deps) =>
  formulaExtendToEdge(deps, 'down');
export const FORMULA_EXTEND_TO_EDGE_LEFT: AsyncActionHandler = (deps) =>
  formulaExtendToEdge(deps, 'left');
export const FORMULA_EXTEND_TO_EDGE_RIGHT: AsyncActionHandler = (deps) =>
  formulaExtendToEdge(deps, 'right');

// Edit Mode arrow keys: NO handlers needed
// The absence of shortcuts in editMode/formulaEditMode contexts allows
// native browser cursor movement without calling preventDefault().

// =============================================================================
// F9 Partial Formula Evaluation
// =============================================================================

/**
 * Resolve all A1-style cell references in a formula expression by substituting
 * their current values from the worksheet. This prevents #REF! errors when the
 * compute engine evaluates a bare expression (without a cell context).
 *
 * Examples:
 * "A1+B1" (A1=5, B1=10) → "5+10"
 * "SUM(A1:A3)" → left as-is (range refs not substituted)
 *
 * Only simple single-cell references are substituted (e.g. A1, $A$1, $A1, A$1).
 * Range references (A1:B2) are left unchanged so the engine handles them.
 */
async function resolveCellRefs(expression: string, ws: Worksheet): Promise<string> {
  // Match isolated cell references (not part of a range ref "A1:B2")
  // Negative lookbehind for ':' avoids replacing the end of a range (e.g. A3 in A1:A3).
  // Negative lookahead for ':' avoids replacing the start of a range (e.g. A1 in A1:A3).
  const cellRefPattern = /(?<!:)\$?([A-Za-z]+)\$?(\d+)(?!:[A-Za-z0-9])/g;

  const matches: Array<{ match: string; row: number; col: number; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = cellRefPattern.exec(expression)) !== null) {
    const row = parseInt(m[2], 10) - 1;
    const col = letterToCol(m[1]);
    matches.push({ match: m[0], row, col, index: m.index });
  }

  if (matches.length === 0) return expression;

  // Resolve all cell values in parallel
  const values = await Promise.all(
    matches.map(({ row, col }) => ws.getValue(row, col).catch(() => null)),
  );

  // Substitute back-to-front to preserve indices
  let result = expression;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { match, index } = matches[i];
    const val = values[i];
    const replacement =
      val === null || val === undefined
        ? '0'
        : typeof val === 'string'
          ? `"${val.replace(/"/g, '""')}"`
          : String(val);
    result = result.substring(0, index) + replacement + result.substring(index + match.length);
  }

  return result;
}

/**
 * Extract a displayable string from the raw result of ws.evaluate().
 *
 * The Rust bridge may return:
 * - A plain primitive (number, string, boolean, null) — use as-is
 * - An object like { Number: 15 }, { Text: "hi" }, { Boolean: true } — unwrap
 * - A Map (e.g. for array formula results) — take the first value
 * - A CellError { type: 'error', value: 'Ref' } — show error string
 */
function extractCellValueResult(raw: unknown): string {
  if (raw === null || raw === undefined) return '0';
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE';
  if (typeof raw === 'string') return raw;

  // Handle Map (array formula result — take first scalar value)
  if (raw instanceof Map) {
    const first = raw.values().next().value;
    return extractCellValueResult(first);
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    // Rust bridge tagged variants
    if ('Number' in obj) return String(obj.Number);
    if ('Text' in obj) return String(obj.Text ?? '');
    if ('Boolean' in obj) return (obj.Boolean as boolean) ? 'TRUE' : 'FALSE';
    if ('Null' in obj) return '0';
    // CellError contract shape
    if (obj.type === 'error') return `#${String(obj.value).toUpperCase()}!`;
  }

  return String(raw);
}

/**
 * Evaluate selected portion of formula and replace with result.
 *
 * When editing a formula and F9 is pressed with text selected:
 * - Extract the selected text
 * - Resolve any cell references to their current values
 * - Evaluate the resolved expression via the compute engine
 * - Replace selection with the computed result
 *
 * Example: "=SUM(1,2)+A1" with "SUM(1,2)" selected -> F9 -> "=3+A1"
 *
 * If not in formula editing mode, falls back to normal CALCULATE_ALL behavior.
 *
 */
export const EVALUATE_FORMULA_SELECTION: AsyncActionHandler = async (deps) => {
  const editorAccessor = deps.accessors.editor;

  // Only works when editing a formula
  const isFormulaEditing = editorAccessor.isFormulaEditing();

  if (!isFormulaEditing) {
    // Not in formula mode - fall back to normal recalculation
    // This is handled by returning not_handled, keyboard coordinator will
    // then try the regular CALCULATE_ALL shortcut
    return { handled: false, reason: 'disabled' as const };
  }

  const value = editorAccessor.getValue();
  const cursorPosition = editorAccessor.getCursorPosition();
  const hasSelection = editorAccessor.hasSelection();
  const selectionAnchor = editorAccessor.getSelectionAnchor();

  // Get the selected text (or fall through to empty check below)
  const start = hasSelection ? Math.min(cursorPosition, selectionAnchor) : 0;
  const end = hasSelection ? Math.max(cursorPosition, selectionAnchor) : value.length;
  const selectedText = value.substring(start, end).trim();

  if (!selectedText) {
    return { handled: false, reason: 'disabled' as const };
  }

  // Evaluate the selected subexpression via the compute engine
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  if (!ws) {
    return notHandled('wrong_context');
  }

  // Strip leading '=' — ws.evaluate() expects a bare expression
  const bareExpression = selectedText.startsWith('=') ? selectedText.slice(1) : selectedText;

  try {
    // Resolve cell references to their current values before evaluating,
    // preventing #REF! errors when the engine lacks cell context for bare exprs.
    const resolvedExpression = await resolveCellRefs(bareExpression, ws);
    const raw = await ws.evaluate(resolvedExpression);
    const resultStr = extractCellValueResult(raw);

    // Replace the selected portion with the evaluated result.
    // Pass the cursor explicitly so the machine doesn't have to be
    // corrected by the setCursor call below (which still runs to keep the
    // selection collapsed at the result tail).
    const newValue = value.substring(0, start) + resultStr + value.substring(end);
    const newCursor = start + resultStr.length;
    deps.commands.editor.input(newValue, newCursor);

    // Place cursor right after the inserted result
    deps.commands.editor.setCursor(newCursor);

    return handled();
  } catch {
    // If evaluation fails (invalid expression), leave editor unchanged
    return notHandled('disabled');
  }
};

// =============================================================================
// Formula Error Dialog Actions
// =============================================================================

/**
 * Edit formula with error - return to editing the formula.
 * Called from FormulaErrorDialog "Edit" button.
 *
 * This keeps the editor open and focuses back on the formula input,
 * allowing the user to correct the error.
 */
export const EDIT_FORMULA_WITH_ERROR: ActionHandler = (_deps) => {
  // The editor is already in editing state when the dialog shows.
  // We just need to close the dialog (handled by the dialog component).
  // The editor will remain in its current state (formula editing).
  // No action needed here - the dialog close handler maintains editor state.
  return handled();
};

/**
 * Commit formula as text - accept the invalid formula as literal text.
 * Called from FormulaErrorDialog "OK" button.
 *
 * This commits the formula as text by prefixing it with an apostrophe,
 * which tells Excel/Shortcut to treat it as a string literal.
 */
export const COMMIT_FORMULA_AS_TEXT: ActionHandler = (deps) => {
  // Get the current formula value
  const formula = deps.accessors.editor.getValue();

  // Prefix with apostrophe to make it literal text
  const textValue = `'${formula}`;

  // Programmatic mutation, no live caret to preserve — end-of-value is
  // the correct cursor.
  deps.commands.editor.input(textValue, textValue.length);

  // Commit the change (move down by default, like Enter)
  deps.commands.editor.commit('down');

  return handled();
};

/**
 * Open formula help documentation.
 * Called from FormulaErrorDialog "Help" button.
 *
 * Opens external documentation about formula syntax and errors.
 */
export const OPEN_FORMULA_HELP: ActionHandler = (_deps) => {
  // Open help documentation in a new tab
  // This could be wired to an internal help system or external docs
  window.open('https://support.microsoft.com/en-us/office/formula-errors', '_blank');

  // Dialog remains open so user can refer back to the error
  return handled();
};

// =============================================================================
// Data Validation Dropdown
// =============================================================================

/**
 * Open cell picker (dropdown) for data validation.
 * Called when user clicks the dropdown arrow on a cell with list validation,
 * or presses Alt+Down on such a cell.
 *
 * This sends OPEN_PICKER to the editor machine, which opens the picker UI.
 */
export const OPEN_CELL_PICKER: ActionHandler = (deps) => {
  deps.commands.editor.openPicker();
  return handled();
};

// =============================================================================
// Range Box Dragging for Formula Editing
// =============================================================================

/**
 * Update formula range after dragging a range box.
 * Called when user drags a formula range box handle to resize/move the range.
 *
 * Cell Identity Model: Uses CellIds for stable references during drag.
 * The payload contains startCellId and endCellId, not row/col positions.
 *
 * @param deps Action dependencies
 * @param payload { rangeIndex: number, startCellId: string, endCellId: string }
 */
export const UPDATE_FORMULA_RANGE: AsyncActionHandler = async (deps, payload: any) => {
  const { rangeIndex, startCellId, endCellId } = payload as {
    rangeIndex: number;
    startCellId: string;
    endCellId: string;
  };

  const sheetId = deps.getActiveSheetId();
  const ws = getWorksheet(deps, sheetId);

  // Get current formula value
  const formula = deps.accessors.editor.getValue();

  // Parse formula to extract ranges
  const ranges = extractFormulaRanges(formula);
  if (rangeIndex < 0 || rangeIndex >= ranges.length) {
    // Invalid range index
    return handled();
  }

  const targetRange = ranges[rangeIndex];

  // Convert CellIds to positions for A1 notation via Worksheet API
  const positionMap = await ws._internal.batchGetCellPositions([startCellId, endCellId]);
  const startPos = positionMap.get(startCellId);
  const endPos = positionMap.get(endCellId);

  if (!startPos || !endPos) {
    // CellIds not found - corner cells may have been deleted
    return handled();
  }

  // Generate new A1 reference from positions using workbook utility
  const startA1 = deps.workbook.indexToAddress(startPos.row, startPos.col);
  const endA1 = deps.workbook.indexToAddress(endPos.row, endPos.col);
  const newRangeRef = startA1 === endA1 ? startA1 : `${startA1}:${endA1}`;

  // Replace the old range reference with the new one in the formula
  const beforeRange = formula.substring(0, targetRange.startPos);
  const afterRange = formula.substring(targetRange.endPos);
  const newFormula = beforeRange + newRangeRef + afterRange;

  // Drag-resize finishes with the caret at the end of the just-rewritten
  // range reference (between `beforeRange` and `afterRange`).
  deps.commands.editor.input(newFormula, beforeRange.length + newRangeRef.length);

  return handled();
};
