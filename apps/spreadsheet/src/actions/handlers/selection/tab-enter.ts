/**
 * Selection Handlers - Tab/Enter Navigation
 *
 * Tab/Enter cycling lives in the selection machine (see
 * `machines/selection/cycle.ts` and the KEY_TAB / KEY_ENTER actions in
 * `keyboard-actions.ts`). The cycle implementation is hidden-row-aware
 * AND merge-aware via `ctx.isRowHidden` / `ctx.isColHidden` /
 * `ctx.getMergedRegionAt` (wired by the coordinator).
 *
 * These handlers are thin shims:
 * - TAB_FORWARD / TAB_BACKWARD → `commands.selection.keyTab(shift)`
 * - ENTER_NAVIGATE / SHIFT_ENTER_NAVIGATE → `commands.selection.keyEnter(shift)`
 *
 * The one piece of handler-side logic is Excel's Enter-paste behavior:
 * pressing Enter while the clipboard has a copy pastes once into the active
 * cell and clears the marching ants. That stays here because clipboard ops
 * are not a selection-machine concern.
 *
 * @see machines/selection/cycle.ts — getNextCellInSelection, hasCyclableStops
 */

import type { AsyncActionHandler } from '@mog-sdk/contracts/actions';
import { unifiedPaste } from '../../../domain/clipboard';
import { waitForPendingClipboardPaste } from '../../../systems/grid-editing/coordination/pending-clipboard-paste';
import { handled, type ActionHandler } from './helpers';

// =============================================================================
// Tab Navigation Handlers
// =============================================================================

export const TAB_FORWARD: ActionHandler = (deps) => {
  deps.commands.selection.keyTab(false);
  return handled();
};

export const TAB_BACKWARD: ActionHandler = (deps) => {
  deps.commands.selection.keyTab(true);
  return handled();
};

// =============================================================================
// Enter Navigation Handlers
// =============================================================================

/**
 * Enter Navigate.
 *
 * Excel clipboard behavior: when clipboard has a copy (hasCopy state),
 * pressing Enter pastes once into the active cell and clears the marching
 * ants (one-time paste). This is distinct from Ctrl+V which allows repeated
 * pasting. The clipboard branch is async (paste is async); the navigation
 * branch is sync via the selection command.
 */
export const ENTER_NAVIGATE: AsyncActionHandler = async (deps) => {
  if (deps.accessors.clipboard.hasCopy()) {
    const activeCell = deps.accessors.selection.getActiveCell();
    await unifiedPaste(activeCell, {
      getClipboardSnapshot: () => deps.accessors.clipboard.getSnapshot(),
      commands: deps.commands.clipboard,
      waitForPasteCommit: waitForPendingClipboardPaste,
    });
    // Clear marching ants after the one-time Enter-paste (Excel behavior)
    deps.commands.clipboard.clear();
    return handled();
  }

  deps.commands.selection.keyEnter(false);
  return handled();
};

export const SHIFT_ENTER_NAVIGATE: ActionHandler = (deps) => {
  deps.commands.selection.keyEnter(true);
  return handled();
};
