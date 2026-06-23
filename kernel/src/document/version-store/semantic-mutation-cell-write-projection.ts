import { toA1 } from '@mog/spreadsheet-utils/a1';

import type { CellChange } from '../../bridges/compute/compute-types.gen';
import type { DirectEditPosition, DirectEditRange } from '../../bridges/compute/mutation-admission';
import {
  directEditKey,
  isInDirectEditRange,
  semanticCellEditValue,
} from './semantic-mutation-capture-projection-helpers';
import type { VersionSemanticChangeRecord } from './semantic-mutation-capture-projection-types';

export function isDirectCellValueOperation(operation: string): boolean {
  return (
    operation === 'compute_batch_set_cells_by_position' ||
    operation === 'compute_set_date_value' ||
    operation === 'compute_set_time_value' ||
    operation === 'compute_clear_range_by_position' ||
    operation === 'compute_clear_range' ||
    operation === 'compute_clear_range_and_return_ids' ||
    operation === 'compute_clear_range_with_mode' ||
    operation === 'compute_replace_all_in_range'
  );
}

export function mapCellWriteChanges(
  changedCells: readonly CellChange[],
  directEdits: readonly DirectEditPosition[],
  directEditRanges: readonly DirectEditRange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const directEditKeys = new Set(directEdits.map((edit) => directEditKey(edit)));
  if (directEditKeys.size === 0 && directEditRanges.length === 0) return [];

  const changes: VersionSemanticChangeRecord[] = [];
  for (const cell of changedCells) {
    if (!cell.position) continue;
    const key = directEditKey({
      sheetId: cell.sheetId,
      row: cell.position.row,
      col: cell.position.col,
    });
    if (
      directEditKeys.size > 0
        ? !directEditKeys.has(key)
        : !isInDirectEditRange(cell, directEditRanges)
    )
      continue;

    const address = toA1(cell.position.row, cell.position.col);
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:cell:${changes.length}`,
        domain: 'cell',
        entityId: `${cell.sheetId}!${address}`,
        propertyPath: ['value'],
      },
      before: {
        kind: 'value',
        value: semanticCellEditValue(cell.oldFormula, cell.oldValue),
      },
      after: {
        kind: 'value',
        value: semanticCellEditValue(cell.newFormula, cell.value),
      },
      display: {
        address: { kind: 'value', value: address },
      },
    });
  }
  return changes;
}
