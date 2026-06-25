import type { VersionSemanticValue } from '@mog-sdk/contracts/api';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import type { CellChange } from '../../bridges/compute/compute-types.gen';

type SyncSemanticChangeRecord = {
  readonly structural: {
    readonly kind: 'metadata';
    readonly changeId: string;
    readonly domain: string;
    readonly entityId: string;
    readonly propertyPath: readonly string[];
  };
  readonly before: {
    readonly kind: 'value';
    readonly value: VersionSemanticValue;
  };
  readonly after: {
    readonly kind: 'value';
    readonly value: VersionSemanticValue;
  };
  readonly display?: {
    readonly address?: { readonly kind: 'value'; readonly value: string };
    readonly entityLabel?: { readonly kind: 'value'; readonly value: string };
  };
};

export function mapSyncAuthoredCellChanges(
  authoredCellChanges: readonly CellChange[],
  sequence: number,
): readonly SyncSemanticChangeRecord[] {
  const changes: SyncSemanticChangeRecord[] = [];
  for (const cell of authoredCellChanges) {
    if (!cell.position) continue;
    const address = toA1(cell.position.row, cell.position.col);
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sync-cell:${changes.length}`,
        domain: 'cell',
        entityId: `${cell.sheetId}!${address}`,
        propertyPath: ['value'],
      },
      before: { kind: 'value', value: semanticCellEditValue(cell.oldFormula, cell.oldValue) },
      after: { kind: 'value', value: semanticCellEditValue(cell.newFormula, cell.value) },
      display: {
        address: { kind: 'value', value: address },
        entityLabel: { kind: 'value', value: `${cell.sheetId}!${address}` },
      },
    });
  }
  return changes;
}

function semanticCellEditValue(
  formula: string | undefined,
  value: CellChange['value'] | CellChange['oldValue'] | undefined,
): VersionSemanticValue {
  const result = semanticCellValue(value);
  return formula ? { kind: 'formula', formula, result } : result;
}

function semanticCellValue(
  value: CellChange['value'] | CellChange['oldValue'] | undefined,
): VersionSemanticValue {
  if (value === undefined) return { kind: 'blank' };
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : { kind: 'blank' };
  if (isCellError(value)) {
    return {
      kind: 'error',
      code: value.value,
      ...(typeof value.message === 'string' ? { message: value.message } : {}),
    };
  }
  return { kind: 'blank' };
}

function isCellError(
  value: unknown,
): value is { readonly value: string; readonly message?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'error' &&
    'value' in value &&
    typeof value.value === 'string'
  );
}
