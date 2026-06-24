import type { IEventBus } from '@mog-sdk/contracts/events';

import type { ViewSelectionChange } from './compute/compute-types.gen';
import type { MutationSource } from './mutation-source';

export function emitViewSelectionChanges(
  eventBus: IEventBus,
  changes: ViewSelectionChange[],
  source: MutationSource,
): void {
  const timestamp = Date.now();
  const eventSource = source === 'user' ? 'user' : 'remote';

  for (const change of changes) {
    const changedRanges = change.ranges ?? [];
    const ranges =
      changedRanges.length > 0
        ? changedRanges.map((range) => ({ ...range }))
        : [
            {
              startRow: change.activeCell.row,
              startCol: change.activeCell.col,
              endRow: change.activeCell.row,
              endCol: change.activeCell.col,
            },
          ];

    eventBus.emit({
      type: 'view:selection-changed',
      timestamp,
      sheetId: change.sheetId,
      activeCell: { row: change.activeCell.row, col: change.activeCell.col },
      ranges,
      source: eventSource,
    });
  }
}
