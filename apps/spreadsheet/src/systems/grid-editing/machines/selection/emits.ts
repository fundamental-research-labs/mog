/**
 * Selection Machine - Emitted Events
 *
 * Emit actions for the selection machine. These run AFTER the assign() actions
 * for the same transition, so they read the newly-assigned `activeCell` from
 * the post-assign context.
 *
 * The single emit today is `userSelectionChanged`, consumed by the
 * viewport-follow coordinator to bring the active cell into view after any
 * user-initiated selection change.
 *
 * Classification of which selection events emit and which don't lives in
 * selection event, classify it there — the union in `./types.ts` is the
 * audit surface, this file is the wiring surface, and the table in §3.2 is
 * the contract surface.
 *
 * Guard rules (enforced by `isUserSelection` in `./guards.ts` for SET_SELECTION;
 * REMOTE_SELECTION_CHANGED simply never lists this emit on its transition):
 * - SET_SELECTION emits only when `source === 'user'` (default). `'remote'`,
 * `'agent'`, and `'restore'` do NOT emit, so collaborator/AI cursors and
 * per-sheet scroll restore do not yank the local viewport.
 * - REMOTE_SELECTION_CHANGED never emits.
 *
 * @see ./types.ts - SelectionEmitted definition + SET_SELECTION.source field
 * @see ../../../renderer/coordination/viewport-follow-coordination.ts -
 * The single subscriber.
 */

import { emit } from 'xstate';
import { getSelectionViewportFollowCell } from '../../../shared/types';
import type { SelectionContext, SelectionEvent, SelectionScrollIntent } from './types';

function getSelectionScrollIntent(event: SelectionEvent): SelectionScrollIntent | undefined {
  switch (event.type) {
    case 'KEY_HOME':
      return { type: 'origin', axis: event.ctrlKey ? 'both' : 'horizontal' };
    case 'PAGE_LEFT':
      return { type: 'page', axis: 'horizontal', direction: 'previous' };
    case 'PAGE_RIGHT':
      return { type: 'page', axis: 'horizontal', direction: 'next' };
    case 'PAGE_UP':
      return { type: 'page', axis: 'vertical', direction: 'previous' };
    case 'PAGE_DOWN':
      return { type: 'page', axis: 'vertical', direction: 'next' };
    default:
      return undefined;
  }
}

/**
 * Emit `userSelectionChanged` carrying the post-transition active cell and
 * explicit viewport-follow target.
 *
 * Wired on every event in §3.2's emit set. The SET_SELECTION transition uses
 * the `isUserSelection` guard to gate the emit on `source === 'user'` (default).
 */
export const emitUserSelectionChanged = emit(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    const followCell =
      event.type === 'SET_SELECTION' && event.anchor === undefined
        ? context.activeCell
        : getSelectionViewportFollowCell(context.pendingRange, context.activeCell, context.anchor);
    const scrollIntent = getSelectionScrollIntent(event);

    return {
      type: 'userSelectionChanged' as const,
      activeCell: context.activeCell,
      followCell,
      ...(scrollIntent ? { scrollIntent } : {}),
    };
  },
);
