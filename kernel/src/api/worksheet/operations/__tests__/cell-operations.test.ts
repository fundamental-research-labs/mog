import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import * as CellOps from '../cell-operations';

const SHEET_ID = sheetId('sheet-1');

function createMockCtx() {
  const order: string[] = [];
  return {
    order,
    userTimezone: 'UTC',
    awaitMaterialized: jest.fn().mockImplementation(async (scope: string) => {
      order.push(`await:${scope}`);
    }),
    computeBridge: {
      getMutationHandler: jest.fn(() => ({
        changeAccumulator: {
          setDirectEdits: jest.fn(),
        },
      })),
      setCellsByPosition: jest.fn().mockImplementation(async () => {
        order.push('setCellsByPosition');
      }),
      getActiveFilters: jest.fn().mockImplementation(async () => {
        order.push('getActiveFilters');
        return [{ id: 'filter-1' }];
      }),
      applyFilter: jest.fn().mockImplementation(async () => {
        order.push('applyFilter');
      }),
    },
  } as any;
}

describe('CellOps filter reapply materialization', () => {
  it('waits for all sheets before reapplying active filters after a cell write', async () => {
    const ctx = createMockCtx();

    await CellOps.setCell(ctx, SHEET_ID, 2, 3, 'Acme');

    expect(ctx.awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(ctx.computeBridge.getActiveFilters).toHaveBeenCalledWith(SHEET_ID);
    expect(ctx.computeBridge.applyFilter).toHaveBeenCalledWith(SHEET_ID, 'filter-1');
    expect(ctx.order).toEqual([
      'setCellsByPosition',
      'await:allSheets',
      'getActiveFilters',
      'applyFilter',
    ]);
  });
});
