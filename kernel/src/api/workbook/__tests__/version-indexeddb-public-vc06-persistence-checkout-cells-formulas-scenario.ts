import {
  expectDiffContains,
  expectIndexedDbDurableCheckout,
  expectedCellDiff,
} from './version-indexeddb-public-vc06-persistence-checkout-test-utils';

export function registerCellsFormulasPersistenceCheckoutScenario(): void {
  it('persists cells.formulas through durable provider reload and checkout materialization', async () => {
    await expectIndexedDbDurableCheckout({
      documentId: 'vc06-indexeddb-cells-formulas-persistence-checkout',
      graphId: 'graph-vc06-cells-formulas-persistence-checkout',
      rootLabel: 'cells-formulas-root',
      mutate: async (wb) => {
        await wb.activeSheet.setCell('C1', 7);
        await wb.activeSheet.setFormula('C2', '=C1*6');
      },
      expectDurableGraph: async ({ wb, rootHead, committed }) => {
        await expectDiffContains(wb, rootHead, committed, [
          expectedCellDiff('C1', 7),
          expectedCellDiff('C2', { kind: 'formula', formula: '=C1*6', result: 42 }),
        ]);
      },
      expectVisibleState: async (wb) => {
        await expect(wb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: 7 });
        await expect(wb.activeSheet.getFormula('C2')).resolves.toBe('=C1*6');
        await expect(wb.activeSheet.getCell('C2')).resolves.toMatchObject({ value: 42 });
      },
    });
  });
}
