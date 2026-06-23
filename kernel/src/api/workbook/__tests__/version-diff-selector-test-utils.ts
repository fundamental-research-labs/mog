import { WorkbookVersionImpl } from '../version';

export const ROOT_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
export const READ_REVISION = { kind: 'counter', value: '1' } as const;

type DiffServiceFn = (...args: any[]) => unknown;

export function createVersion(diff: DiffServiceFn) {
  return new WorkbookVersionImpl({
    versioning: {
      diffService: { diff },
    },
  } as any);
}

export function createVersionWithoutDiffProvider() {
  return new WorkbookVersionImpl({} as any);
}

export function orderedCellChange(changeId: string, domainOrder: number) {
  return {
    pageCursorOrderKey: {
      domainOrder,
      hashPropertyPath: `/cells/${changeId}/value`,
      hashIdentity: `sheet-1!${changeId}`,
      valueClass: 'authored',
    },
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'cell',
      entityId: `sheet-1!${changeId}`,
      propertyPath: ['value'],
    },
    before: { kind: 'value', value: null },
    after: { kind: 'value', value: changeId },
    display: { address: { kind: 'value', value: changeId } },
  };
}
