/**
 * Editor Transition Handlers
 *
 * Named, testable functions extracted from SheetCoordinator's cross-system
 * wiring. Each function subscribes to the editor actor's state transitions
 * and performs a single, well-scoped side effect.
 *
 */

import type { StoreApi } from 'zustand';

import { sheetId as toSheetId, type CellFormat } from '@mog-sdk/contracts/core';
import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import type { FlashFillCoordinator } from '../systems/grid-editing/features/flash-fill';
import type { UIState } from '../ui-store';
import type { EditorActor, SelectionActor } from './types';

// =============================================================================
// Transition detection helpers
// =============================================================================

/**
 * Returns true when the editor transitions from an active editing state to inactive.
 */
function wasEditingNowInactive(
  prevState: ReturnType<EditorActor['getSnapshot']>,
  currentState: ReturnType<EditorActor['getSnapshot']>,
): boolean {
  const wasEditing =
    prevState.matches('formulaEditing') ||
    prevState.matches('editing') ||
    prevState.matches('error') ||
    prevState.matches('committing');
  return wasEditing && currentState.matches('inactive');
}

function moveCell(cell: CellCoord, direction: string | null): CellCoord {
  switch (direction) {
    case 'right':
      return { row: cell.row, col: cell.col + 1 };
    case 'left':
      return { row: cell.row, col: Math.max(0, cell.col - 1) };
    case 'down':
      return { row: cell.row + 1, col: cell.col };
    case 'up':
      return { row: Math.max(0, cell.row - 1), col: cell.col };
    default:
      return cell;
  }
}

function saveOriginSelectionAfterCommit(
  prevState: ReturnType<EditorActor['getSnapshot']>,
  uiStoreApi: StoreApi<UIState>,
  originSheetId: string,
): void {
  if (!prevState.matches('committing')) {
    return;
  }

  const originCell = prevState.context.editingCell ?? prevState.context.commitActiveCell;
  if (!originCell) {
    return;
  }

  const commitKey = prevState.context.commitKey;
  // Cross-sheet Enter commits return to the edited formula cell; Tab preserves tab navigation.
  const shouldAdvanceSelection = commitKey === 'tab' || commitKey === 'shift-tab';
  const targetCell = shouldAdvanceSelection
    ? moveCell(originCell, prevState.context.commitDirection)
    : originCell;
  const targetRange = {
    startRow: targetCell.row,
    startCol: targetCell.col,
    endRow: targetCell.row,
    endCol: targetCell.col,
  };
  const sheet = toSheetId(originSheetId);
  const existing = uiStoreApi.getState().getSheetViewState(sheet);

  uiStoreApi.getState().saveSheetViewState(sheet, {
    ranges: [targetRange],
    activeCell: targetCell,
    anchor: null,
    anchorCol: null,
    anchorRow: null,
    scrollTop: existing?.scrollTop ?? 0,
    scrollLeft: existing?.scrollLeft ?? 0,
  });
}

// =============================================================================
// Return to origin sheet
// =============================================================================

/**
 * Wire: return to origin sheet when cross-sheet formula editing ends.
 *
 * When the user navigates to another sheet while building a cross-sheet
 * formula, this handler switches back to the origin sheet when the editor
 * goes inactive (Enter commit, Tab commit, or Escape cancel).
 *
 * IMPORTANT: Only triggers for formula editing (formulaEditing state), not
 * regular editing (editing state). If the user explicitly clicks a sheet tab
 * during regular editing, the sheet switch itself causes the commit; reverting
 * to the origin sheet would undo the intentional navigation.
 *
 * @returns cleanup function that unsubscribes from the editor actor
 */
export function wireReturnToOriginSheet(
  editorActor: EditorActor,
  uiStoreApi: StoreApi<UIState>,
): () => void {
  let prevState = editorActor.getSnapshot();
  // Track whether we passed through formulaEditing before reaching committing/inactive.
  // This distinguishes cross-sheet formula commits (should return) from regular
  // editing commits triggered by a sheet switch (should NOT return).
  let sawFormulaEditing = prevState.matches('formulaEditing');

  const sub = editorActor.subscribe((state) => {
    // Track entry into formulaEditing so we can distinguish it from regular editing
    if (state.matches('formulaEditing')) {
      sawFormulaEditing = true;
    }

    if (wasEditingNowInactive(prevState, state)) {
      // Only return to origin sheet for cross-sheet formula editing.
      // For regular editing, a sheet-switch commits the editor while simultaneously
      // setting activeSheetId to the target sheet — reverting would undo the user's
      // explicit navigation. Formula editing is the only case where the user can be
      // on a different sheet than the origin without intending to switch permanently.
      if (sawFormulaEditing) {
        // Read origin sheet from the PREVIOUS state's context (cancel resets context)
        const originSheetId = prevState.context.sheetId;
        const activeSheetId = uiStoreApi.getState().activeSheetId;
        if (originSheetId && originSheetId !== activeSheetId) {
          saveOriginSelectionAfterCommit(prevState, uiStoreApi, originSheetId);
          uiStoreApi.getState().setActiveSheet(toSheetId(originSheetId));
        }
      }
      sawFormulaEditing = false;
    }
    prevState = state;
  });

  return () => sub.unsubscribe();
}

// =============================================================================
// Flash Fill auto-preview on commit
// =============================================================================

/**
 * Wire: detect Flash Fill patterns when an editor commit produces a new
 * value in a column that may have prior examples.
 *
 * Excel-style behavior: as soon as the user commits a 2nd or later example
 * in a column adjacent to data, a ghosted preview should appear showing the
 * inferred fill values for the remaining rows. The user can accept it
 * (Enter) or dismiss it (Escape, or by continuing to type something
 * different).
 *
 * Triggers on: previous state was `committing`, current state is `inactive`.
 * (Cancel paths — Escape from `editing`/`formulaEditing` — do NOT trigger.)
 *
 * Cell coordinates are read from `prevState.context.editingCell` (preferred)
 * or `prevState.context.commitActiveCell` (fallback) — these are populated
 * by the editor machine before the transition.
 *
 * The `FlashFillCoordinator` itself owns the async pattern-detection work:
 * we only kick it off here.
 */
export function wireFlashFillOnCommit(
  editorActor: EditorActor,
  flashFillCoordinator: FlashFillCoordinator,
): () => void {
  let prevState = editorActor.getSnapshot();

  const sub = editorActor.subscribe((state) => {
    const becameInactive = prevState.matches('committing') && state.matches('inactive');
    if (becameInactive) {
      const cell = prevState.context.editingCell ?? prevState.context.commitActiveCell;
      if (cell) {
        flashFillCoordinator.checkForPatternOnCellCommit(cell.row, cell.col);
      }
    } else if (prevState.matches('editing') && state.matches('inactive')) {
      // Cancel path — hide any existing preview so it doesn't linger.
      flashFillCoordinator.rejectPreview();
    }
    prevState = state;
  });

  return () => sub.unsubscribe();
}

/**
 * Wire: dismiss the Flash Fill preview when the active cell moves.
 *
 * Excel parity: a flash-fill suggestion is anchored to the cell the user
 * just committed. The moment the user navigates or clicks elsewhere, the
 * suggestion is no longer relevant — it should disappear, not linger and
 * interfere with subsequent input. This also closes a race where the
 * preview popup remains visible during a follow-up `typeInCell` (its
 * presence flips the keyboard context to `'flashFillPreview'`, and a fast
 * type+Enter sequence could fire ACCEPT_FLASH_FILL before the editor
 * machine has finished transitioning to `editing`, silently dropping the
 * user's edit).
 *
 * The first emission from `subscribe` is the current snapshot — we capture
 * `prev` once at wire time and only act on subsequent active-cell deltas.
 *
 * @returns cleanup function that unsubscribes from the selection actor
 */
export function wireFlashFillDismissOnSelectionMove(
  selectionActor: SelectionActor,
  flashFillCoordinator: FlashFillCoordinator,
): () => void {
  let prev = selectionActor.getSnapshot().context.activeCell;

  const sub = selectionActor.subscribe((state) => {
    const next = state.context.activeCell;
    if (next.row !== prev.row || next.col !== prev.col) {
      flashFillCoordinator.rejectPreview();
    }
    prev = next;
  });

  return () => sub.unsubscribe();
}

// =============================================================================
// Pending cell format on commit
// =============================================================================

/**
 * Wire: re-apply pending cell format after editor commit.
 *
 * When a user presses Cmd+B on an empty cell and then types, the Rust
 * compute layer may discard the format-only entry when no value exists.
 * After the value is committed we re-apply the pending format so that it
 * persists alongside the newly written cell value.
 *
 * Commit path: previous state was 'committing' -> inactive.
 * Cancel path: previous state was 'editing'/'formulaEditing' -> inactive.
 * Only applies pending format on commit, not cancel. Always clears the
 * pending format when editing ends.
 *
 * @returns cleanup function that unsubscribes from the editor actor
 */
export function wirePendingCellFormatOnCommit(
  editorActor: EditorActor,
  uiStoreApi: StoreApi<UIState>,
  workbook: WorkbookInternal,
): () => void {
  let prevState = editorActor.getSnapshot();

  const sub = editorActor.subscribe((state) => {
    if (wasEditingNowInactive(prevState, state)) {
      if (uiStoreApi.getState().pendingCellFormat) {
        const wasCommitting = prevState.matches('committing');
        if (wasCommitting) {
          const pendingFmt = uiStoreApi.getState().pendingCellFormat!;
          const committedCell = prevState.context.editingCell ?? prevState.context.commitActiveCell;
          const committedSheetId = prevState.context.sheetId;
          if (
            committedCell &&
            committedSheetId &&
            committedCell.row === pendingFmt.row &&
            committedCell.col === pendingFmt.col &&
            committedSheetId === pendingFmt.sheetId
          ) {
            // Apply format async — fire-and-forget (same pattern as setCell)
            const ws = workbook.getSheetById(toSheetId(committedSheetId));
            void ws.formats.setRanges(
              [
                {
                  startRow: pendingFmt.row,
                  startCol: pendingFmt.col,
                  endRow: pendingFmt.row,
                  endCol: pendingFmt.col,
                },
              ],
              pendingFmt.format as CellFormat,
            );
          }
        }
        // Always clear after editing ends (commit or cancel)
        uiStoreApi.getState().clearPendingCellFormat();
      }
    }
    prevState = state;
  });

  return () => sub.unsubscribe();
}
