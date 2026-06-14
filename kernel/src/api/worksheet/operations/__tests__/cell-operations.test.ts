import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import * as CellOps from '../cell-operations';

const SHEET_ID = sheetId('sheet-1');

function createBridgeTable() {
  return {
    id: 'table-1',
    name: 'Sales',
    sheetId: SHEET_ID,
    range: { startRow: 0, startCol: 0, endRow: 2, endCol: 1 },
    hasHeaderRow: true,
    hasTotalsRow: false,
    columns: [
      { id: 'col-1', name: 'Region', index: 0 },
      { id: 'col-2', name: 'Revenue', index: 1 },
    ],
  };
}

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
      getTableAtCell: jest.fn().mockResolvedValue(null),
      getAllTablesInSheet: jest.fn().mockResolvedValue([]),
      getSheetProtectionOptions: jest.fn().mockResolvedValue(null),
      renameTableColumn: jest.fn().mockImplementation(async () => {
        order.push('renameTableColumn');
      }),
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
      'await:allSheets',
      'setCellsByPosition',
      'getActiveFilters',
      'applyFilter',
    ]);
  });

  it('renames a table column when setCell targets a visible table header', async () => {
    const ctx = createMockCtx();
    ctx.computeBridge.getTableAtCell.mockResolvedValue(createBridgeTable());

    await CellOps.setCell(ctx, SHEET_ID, 0, 1, 'Area');

    expect(ctx.computeBridge.renameTableColumn).toHaveBeenCalledWith('Sales', 1, 'Area');
    expect(ctx.computeBridge.setCellsByPosition).not.toHaveBeenCalled();
    expect(ctx.computeBridge.getMutationHandler).not.toHaveBeenCalled();
    expect(ctx.order).toEqual([
      'await:allSheets',
      'renameTableColumn',
      'getActiveFilters',
      'applyFilter',
    ]);
  });

  it('treats same-name table header writes as no-ops', async () => {
    const ctx = createMockCtx();
    ctx.computeBridge.getTableAtCell.mockResolvedValue(createBridgeTable());

    await CellOps.setCell(ctx, SHEET_ID, 0, 0, 'Region');

    expect(ctx.computeBridge.renameTableColumn).not.toHaveBeenCalled();
    expect(ctx.computeBridge.setCellsByPosition).not.toHaveBeenCalled();
    expect(ctx.computeBridge.getActiveFilters).not.toHaveBeenCalled();
    expect(ctx.awaitMaterialized).not.toHaveBeenCalled();
  });

  it('splits table header renames from normal cells in batch writes', async () => {
    const ctx = createMockCtx();
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValue([createBridgeTable()]);

    const result = await CellOps.setCells(ctx, SHEET_ID, [
      { row: 0, col: 1, value: 'Area' },
      { row: 1, col: 0, value: 'West' },
    ]);

    expect(result).toEqual({ cellsWritten: 2, errors: null });
    expect(ctx.computeBridge.getAllTablesInSheet).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.getTableAtCell).not.toHaveBeenCalled();
    expect(ctx.computeBridge.renameTableColumn).toHaveBeenCalledWith('Sales', 1, 'Area');
    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(SHEET_ID, [
      { row: 1, col: 0, input: { kind: 'parse', text: 'West' } },
    ]);
    expect(ctx.computeBridge.getMutationHandler).toHaveBeenCalledTimes(1);
    expect(ctx.order).toEqual([
      'await:allSheets',
      'renameTableColumn',
      'setCellsByPosition',
      'getActiveFilters',
      'applyFilter',
    ]);
  });
});
