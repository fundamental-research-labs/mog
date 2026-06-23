import {
  expectDiffContains,
  expectIndexedDbDurableCheckout,
  expectedCellDiff,
  expectedRowOrderDiff,
} from './version-indexeddb-public-vc06-persistence-checkout-test-utils';

export function registerRowsColumnsPersistenceCheckoutScenario(): void {
  it('persists rows-columns insertRows through durable provider reload and checkout materialization', async () => {
    await expectIndexedDbDurableCheckout({
      documentId: 'vc06-indexeddb-rows-columns-persistence-checkout',
      graphId: 'graph-vc06-rows-columns-persistence-checkout',
      rootLabel: 'rows-columns-root',
      mutate: async (wb) => {
        await wb.activeSheet.setCell('A1', 'header');
        await wb.activeSheet.setCell('A2', 'shifted-row');
        await wb.activeSheet.structure.insertRows(1, 1);
      },
      expectDurableGraph: async ({ wb, rootHead, committed }) => {
        await expectDiffContains(wb, rootHead, committed, [
          expectedCellDiff('A1', 'header'),
          expectedCellDiff('A2', 'shifted-row'),
          expectedRowOrderDiff('2:2'),
        ]);
      },
      expectVisibleState: async (wb) => {
        await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'header' });
        await expect(wb.activeSheet.getCell('A2')).resolves.toMatchObject({ value: null });
        await expect(wb.activeSheet.getCell('A3')).resolves.toMatchObject({
          value: 'shifted-row',
        });
      },
    });
  });
}
