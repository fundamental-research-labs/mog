/**
 * Viewport-Follow Coordination
 *
 * Single architectural rule: after any user-initiated selection change, the
 * leading edge of the new selection (its `activeCell`) is rendered inside
 * the visible viewport. No call site has to "remember to scroll" — this
 * coordinator owns the invariant at the renderer seam.
 *
 * Flow:
 *
 * selection actor
 * └── emits 'userSelectionChanged' { activeCell, followCell }
 *
 * viewport-follow-coordination (this module)
 * ├── reads live scroll state via viewport.getScrollToCell(followCell)
 * └── if not visible: rendererActor.send({ type: 'SCROLL_TO_ACTIVE_CELL', cell })
 *
 * grid-renderer-machine
 * └── emits 'scrollToActiveCellRequested' { cell }
 *
 * RenderSystem.applyScrollToActiveCell
 * └── coords.getScrollToCell → setScrollPosition (existing pipe)
 *
 * Why a dedicated coordinator (event-emit subscription) and not
 * `actor.subscribe(state => ...)`? See viewport-follow.md §3.2: XState
 * subscriptions don't carry the *event* that caused the transition, so the
 * subscriber can't distinguish user-initiated from remote/agent. The selection
 * machine already classifies events — only those firing the emit are
 * user-initiated, and the SET_SELECTION discriminant gates AI/remote/restore.
 *
 * Pattern: parallels render-system.ts:599 (`scrollToActiveCellSubscription`),
 * which uses the same `actor.on()` shape on the renderer machine.
 *
 * @see ../../grid-editing/machines/selection/emits.ts - the emit
 * @see ../render-system.ts - applyScrollToActiveCell side effect
 */

import type { ActorRefFrom } from 'xstate';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { ISheetViewViewport } from '@mog-sdk/sheet-view';

import type { selectionMachine } from '../../grid-editing/machines/grid-selection-machine';
import type { rendererMachine } from '../machines/grid-renderer-machine';

// =============================================================================
// TYPES
// =============================================================================

export type SelectionActor = ActorRefFrom<typeof selectionMachine>;
export type RendererActor = ActorRefFrom<typeof rendererMachine>;

/**
 * Configuration for viewport-follow coordination.
 */
export interface ViewportFollowCoordinationConfig {
  /** The selection actor (source of `userSelectionChanged` emits). */
  selectionActor: SelectionActor;
  /** The renderer actor (target of `SCROLL_TO_ACTIVE_CELL` events). */
  rendererActor: RendererActor;
  /** Resolve the live viewport capability; null until renderer hydrates. */
  getViewport: () => ISheetViewViewport | null;
}

/**
 * Result of viewport-follow coordination setup.
 */
export interface ViewportFollowCoordinationResult {
  /** Cleanup function to unsubscribe from the selection actor. */
  cleanup: () => void;
}

function sameCell(left: CellCoord, right: CellCoord): boolean {
  return left.row === right.row && left.col === right.col;
}

function normalizeRange(range: CellRange): CellRange {
  return {
    ...range,
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

function rangeFitsVisibleCellSpan(range: CellRange, viewport: ISheetViewViewport): boolean {
  const visibleRange = viewport.getSnapshot?.().visibleRange;
  if (!visibleRange) return false;

  const normalized = normalizeRange(range);
  const rangeRows = normalized.endRow - normalized.startRow + 1;
  const rangeCols = normalized.endCol - normalized.startCol + 1;
  const visibleRows = visibleRange.endRow - visibleRange.startRow + 1;
  const visibleCols = visibleRange.endCol - visibleRange.startCol + 1;

  return rangeRows <= visibleRows && rangeCols <= visibleCols;
}

// =============================================================================
// COORDINATION SETUP
// =============================================================================

/**
 * Set up viewport-follow coordination.
 *
 * Subscribes to the selection actor's `userSelectionChanged` emit; for each,
 * checks visibility via `viewport.getScrollToCell()` — which returns null when
 * the cell is already visible (meaning no scroll needed). If the cell is not
 * visible, dispatches `SCROLL_TO_ACTIVE_CELL` to the renderer actor; the
 * renderer machine emits, RenderSystem applies the scroll via the existing pipe.
 *
 * No-op if the viewport capability is not yet hydrated — defensive guard for
 * boot/teardown windows.
 *
 * The caller owns the returned cleanup function and is responsible for
 * invoking it on teardown (typically registered with the parent system's
 * CleanupManager or cleanup array).
 *
 * @param config - Actors, viewport resolver
 * @returns Result with explicit cleanup function
 */
export function setupViewportFollowCoordination(
  config: ViewportFollowCoordinationConfig,
): ViewportFollowCoordinationResult {
  const { selectionActor, rendererActor, getViewport } = config;

  const subscription = selectionActor.on('userSelectionChanged', (event) => {
    const viewport = getViewport();
    if (!viewport) return;

    const followCell = event.followCell ?? event.activeCell;
    const scrollIntent = event.scrollIntent;

    if (scrollIntent?.type === 'page') {
      rendererActor.send({
        type: 'SCROLL_PAGE',
        axis: scrollIntent.axis,
        direction: scrollIntent.direction,
        cell: followCell,
      });
      return;
    }

    if (scrollIntent?.type === 'origin') {
      rendererActor.send({
        type: 'SCROLL_TO_ORIGIN',
        axis: scrollIntent.axis,
        cell: followCell,
      });
      return;
    }

    if (event.suppressViewportFollow) return;

    // getScrollToCell returns null when the cell is already visible
    const scrollTarget = viewport.getScrollToCell(followCell);
    if (
      event.range &&
      !sameCell(event.activeCell, followCell) &&
      rangeFitsVisibleCellSpan(event.range, viewport)
    ) {
      const activeScrollTarget = viewport.getScrollToCell(event.activeCell);
      if (activeScrollTarget) {
        rendererActor.send({ type: 'SCROLL_TO_ACTIVE_CELL', cell: event.activeCell });
        return;
      }
    }

    if (!scrollTarget) return;

    rendererActor.send({ type: 'SCROLL_TO_ACTIVE_CELL', cell: followCell });
  });

  const cleanup = () => {
    subscription.unsubscribe();
  };

  return { cleanup };
}
