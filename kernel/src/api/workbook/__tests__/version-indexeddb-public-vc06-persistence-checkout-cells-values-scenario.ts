import {
  expectDiffContains,
  expectIndexedDbDurableCheckout,
  expectedCellDiff,
} from './version-indexeddb-public-vc06-persistence-checkout-test-utils';

export function registerCellsValuesPersistenceCheckoutScenario(): void {
  it('persists cells.values through durable provider reload and checkout materialization', async () => {
    await expectIndexedDbDurableCheckout({
      documentId: 'vc06-indexeddb-cells-values-persistence-checkout',
      graphId: 'graph-vc06-cells-values-persistence-checkout',
      rootLabel: 'cells-values-root',
      mutate: async (wb) => {
        await wb.activeSheet.setCell('B2', 'durable-value');
      },
      expectDurableGraph: async ({ wb, rootHead, committed }) => {
        await expectDiffContains(wb, rootHead, committed, [
          expectedCellDiff('B2', 'durable-value'),
        ]);
      },
      expectVisibleState: async (wb) => {
        await expect(wb.activeSheet.getCell('B2')).resolves.toMatchObject({
          value: 'durable-value',
        });
        await expect(wb.activeSheet.getFormula('B2')).resolves.toBeNull();
      },
    });
  });
}
