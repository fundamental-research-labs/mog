import type { VersionHead, Workbook, WorkbookCommitSummary } from '@mog-sdk/contracts/api';

export async function expectDiffContains(
  wb: Workbook,
  rootHead: VersionHead,
  committed: WorkbookCommitSummary,
  items: readonly unknown[],
): Promise<void> {
  const diffResult = await wb.version.diff(rootHead.id, committed.id);
  if (!diffResult.ok) {
    throw new Error(`expected indexeddb diff success: ${JSON.stringify(diffResult.error)}`);
  }
  expect(diffResult.value.items).toEqual(expect.arrayContaining(items));
}

export function expectedCellDiff(address: string, value: unknown) {
  return expect.objectContaining({
    structural: expect.objectContaining({
      domain: 'cell',
      entityId: expect.stringMatching(new RegExp(`!${address}$`)),
      propertyPath: ['value'],
    }),
    after: { kind: 'value', value },
    display: { address: { kind: 'value', value: address } },
  });
}

export function expectedRowOrderDiff(address: string) {
  return expect.objectContaining({
    structural: expect.objectContaining({
      domain: 'rows-columns',
      propertyPath: ['order'],
    }),
    after: {
      kind: 'value',
      value: expect.objectContaining({
        fields: expect.arrayContaining([
          { key: 'axis', value: 'row' },
          { key: 'displayRef', value: address },
        ]),
      }),
    },
    display: { address: { kind: 'value', value: address } },
  });
}
