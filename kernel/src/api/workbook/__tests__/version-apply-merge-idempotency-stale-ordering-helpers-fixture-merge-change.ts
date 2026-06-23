import type { VersionMergeChange } from '@mog-sdk/contracts/api';

export function mergeChange(changeId: string): VersionMergeChange {
  return {
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'cells.values',
      entityId: 'sheet-1!C1',
      propertyPath: ['value'],
    },
    base: { kind: 'value', value: null },
    ours: { kind: 'value', value: null },
    theirs: { kind: 'value', value: 'theirs' },
    merged: { kind: 'value', value: 'theirs' },
  };
}
