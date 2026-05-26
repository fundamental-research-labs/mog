/**
 * Clipboard Actions
 *
 * High-level clipboard action functions: copy, cut, paste.
 *
 */

import type { SelectionSnapshot } from '@mog-sdk/contracts/machines';
import type { ActorManager } from '../shared/actor-manager';
import type { ClipboardData } from '../shared/types';

// =============================================================================
// CLIPBOARD ACTIONS
// =============================================================================

/**
 * Copy current selection to clipboard.
 */
export function copyAction(
  actors: ActorManager,
  selectionSnapshot: SelectionSnapshot,
  data: ClipboardData,
): void {
  const { ranges } = selectionSnapshot;
  actors.clipboard.send({ type: 'COPY', ranges, data });
}

/**
 * Cut current selection to clipboard.
 */
export function cutAction(
  actors: ActorManager,
  selectionSnapshot: SelectionSnapshot,
  data: ClipboardData,
): void {
  const { ranges } = selectionSnapshot;
  actors.clipboard.send({ type: 'CUT', ranges, data });
}

/**
 * Paste from clipboard to active cell.
 */
export function pasteAction(actors: ActorManager, selectionSnapshot: SelectionSnapshot): void {
  const { activeCell } = selectionSnapshot;
  actors.clipboard.send({ type: 'PASTE', targetCell: activeCell });
}

/**
 * Signal paste complete.
 */
export function pasteCompleteAction(actors: ActorManager): void {
  actors.clipboard.send({ type: 'PASTE_COMPLETE' });
}
