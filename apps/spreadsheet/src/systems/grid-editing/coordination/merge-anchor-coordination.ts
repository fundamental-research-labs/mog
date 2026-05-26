/**
 * Merge Anchor Coordination
 *
 * Snaps `activeCell` to the merge top-left after a merge whose region contains
 * the current activeCell. Matches Excel:
 *
 * - Shift-click leaves activeCell at the moving edge of the selection
 * (e.g. selecting A1:B2 by clicking A1 then shift-clicking B2 leaves
 * activeCell at B2). That's correct for the extend operation itself.
 * - But once the user merges that range, the merged region's anchor is its
 * top-left, and Excel re-anchors activeCell there so subsequent navigation,
 * context-menus, and editing all start from the merge anchor.
 *
 * Subscribes to `merges:changed` and reads the per-region detail from
 * `event.regions` (carried directly from the bridge's MergeChange records).
 * `ws.viewport.getMerges()` is NOT used here — the viewport's merge cache is
 * populated by the render pipeline and may be stale immediately after a
 * `structure.merge()` call.
 *
 * Every merge entry point (action handlers, dev-tools, future keyboard / menu
 * paths) flows through `mutation-result-handler.ts` and emits the same
 * `merges:changed`, so this listener produces uniform selection semantics
 * without duplicating logic into each merge call site.
 *
 * Selection ranges are preserved verbatim — only `activeCell` moves, and only
 * when it was inside a newly-created merge (`kind === 'Set'`).
 *
 * @see ../../../renderer/subscriptions/event-subscriptions.ts - sibling listener that invalidates the renderer
 * @see ../machines/selection/mouse-actions.ts - shift-click sets activeCell to the moving edge
 * @see ../../../actions/handlers/formatting/merge-operations.ts - merge action handlers
 * @see kernel/src/bridges/mutation-result-handler.ts - emits merges:changed with regions
 */

import { selectionSelectors } from '../../../selectors';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import type { SelectionActor } from './cross-coordination';

// =============================================================================
// Types
// =============================================================================

export interface MergeAnchorCoordinationConfig {
  /** Workbook to subscribe to merge events. */
  workbook: Workbook;
  /** Selection machine actor. */
  selectionActor: SelectionActor;
  /** Active sheet id getter — listener no-ops on background-sheet events. */
  getActiveSheetId: () => SheetId;
}

export interface MergeAnchorCoordinationResult {
  /** Unsubscribe from `merges:changed`. */
  cleanup: () => void;
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Set up merge-anchor coordination.
 *
 * On every `merges:changed` for the active sheet, scan the per-region detail
 * for a newly-created merge (`kind === 'Set'`) that contains the current
 * activeCell. If found and activeCell is not already at the region's
 * top-left, dispatch `SET_SELECTION` snapping activeCell to the top-left
 * while preserving the existing range list.
 *
 * Edge cases:
 * - Cross-sheet event (sheetId !== active): no-op.
 * - activeCell already at merge top-left: no-op (avoids spurious dispatches).
 * - Unmerge (`kind === 'Removed'`): not handled here. activeCell stays where
 * it was (Excel parity).
 * - No regions in payload (e.g. coalesced remote batch): no-op.
 */
export function setupMergeAnchorCoordination(
  config: MergeAnchorCoordinationConfig,
): MergeAnchorCoordinationResult {
  const { workbook, selectionActor, getActiveSheetId } = config;

  const unsubscribe = workbook.on('merges:changed', (event) => {
    if (event.sheetId !== getActiveSheetId()) return;

    const regions = event.regions;
    if (!regions || regions.length === 0) return;

    const snapshot = selectionActor.getSnapshot();
    const activeCell = snapshot.context.activeCell as CellCoord | null;
    if (!activeCell) return;

    const containing = regions.find(
      (r) =>
        r.kind === 'Set' &&
        activeCell.row >= r.startRow &&
        activeCell.row <= r.endRow &&
        activeCell.col >= r.startCol &&
        activeCell.col <= r.endCol,
    );
    if (!containing) return;

    if (activeCell.row === containing.startRow && activeCell.col === containing.startCol) {
      return;
    }

    const ranges = selectionSelectors.ranges(snapshot);
    selectionActor.send({
      type: 'SET_SELECTION',
      ranges,
      activeCell: { row: containing.startRow, col: containing.startCol },
    });
  });

  return {
    cleanup: () => {
      unsubscribe();
    },
  };
}
