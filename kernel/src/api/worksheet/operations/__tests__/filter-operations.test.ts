import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import * as FilterOps from '../filter-operations';

const SHEET_ID = sheetId('sheet-1');
const MUTATION_RESULT = { filterChanges: [], diagnostics: [] };

function createMockCtx() {
  return {
    awaitMaterialized: jest.fn().mockResolvedValue(undefined),
    clock: {
      now: jest.fn(() => 1_700_000_000_000),
    },
    computeBridge: {
      createFilter: jest.fn().mockResolvedValue(MUTATION_RESULT),
      deleteFilter: jest.fn().mockResolvedValue(MUTATION_RESULT),
      getFiltersInSheet: jest.fn().mockResolvedValue([]),
      getAllTablesInSheet: jest.fn().mockResolvedValue([]),
      getCellPosition: jest.fn().mockResolvedValue(null),
      getCellIdAt: jest.fn().mockResolvedValue(null),
      setColumnFilter: jest.fn().mockResolvedValue(MUTATION_RESULT),
      clearColumnFilter: jest.fn().mockResolvedValue(MUTATION_RESULT),
      clearAllColumnFilters: jest.fn().mockResolvedValue(MUTATION_RESULT),
      applyFilter: jest.fn().mockResolvedValue(MUTATION_RESULT),
      reapplyFilter: jest.fn().mockResolvedValue(MUTATION_RESULT),
      setFilterSortState: jest.fn().mockResolvedValue(MUTATION_RESULT),
    },
    workbookLinkScope: jest.fn(() => ({
      actor: 'user-1',
      requestingDocumentId: 'workbook-1',
      requestingSessionId: 'session-1',
    })),
    writeGate: {
      assertWritable: jest.fn(),
    },
  } as any;
}

function expectFilterAdmissionOptions(operationIdPrefix: string) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(
        new RegExp(`^${operationIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`),
      ),
      sheetIds: [SHEET_ID],
      domainIds: ['filters.auto-filter'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    }),
  });
}

function tableBackedFilter(columnFilters: Record<string, unknown> = {}) {
  return {
    id: 'filter-1',
    type: 'autoFilter',
    tableId: 'table-1',
    headerStartCellId: 'header-a',
    headerEndCellId: 'header-b',
    dataEndCellId: 'data-end',
    columnFilters,
  };
}

describe('FilterOps resolved ranges', () => {
  it('returns canonical table ranges from filter detail APIs', async () => {
    const ctx = createMockCtx();
    ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
      {
        id: 'filter-1',
        type: 'autoFilter',
        tableId: 'table-1',
        headerStartCellId: 'header-a',
        headerEndCellId: 'header-b',
        dataEndCellId: 'moved-data-end',
        columnFilters: {},
      },
    ]);
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValue([
      {
        id: 'table-1',
        range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
      },
    ]);
    ctx.computeBridge.getCellPosition
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 0 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 1 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 2, col: 1 });

    const info = await FilterOps.getFilterInfo(ctx, SHEET_ID, 'filter-1');
    const details = await FilterOps.listFilterDetails(ctx, SHEET_ID);

    expect(info?.range).toEqual({ startRow: 0, startCol: 0, endRow: 3, endCol: 1 });
    expect(details).toEqual([
      {
        id: 'filter-1',
        range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
        columnFilters: {},
      },
    ]);
    expect(ctx.computeBridge.getCellPosition).not.toHaveBeenCalled();
  });

  it('uses canonical table ranges for overlap checks', async () => {
    const ctx = createMockCtx();
    ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
      {
        id: 'filter-1',
        type: 'autoFilter',
        tableId: 'table-1',
        headerStartCellId: 'header-a',
        headerEndCellId: 'header-b',
        dataEndCellId: 'moved-data-end',
        columnFilters: {},
      },
    ]);
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValue([
      {
        id: 'table-1',
        range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
      },
    ]);
    ctx.computeBridge.getCellPosition
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 0 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 1 })
      .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 2, col: 1 });

    const result = await FilterOps.getFilterForRange(ctx, SHEET_ID, {
      startRow: 3,
      startCol: 0,
      endRow: 3,
      endCol: 0,
    });

    expect(result).toEqual({ id: 'filter-1' });
    expect(ctx.computeBridge.getCellPosition).not.toHaveBeenCalled();
  });

  it('waits for all sheets before mutating filter sort state', async () => {
    const ctx = createMockCtx();

    const result = await FilterOps.setFilterSortState(ctx, SHEET_ID, 'filter-1', {
      columnCellId: 'header-a',
      order: 'asc',
      sortBy: 'value',
    });

    expect(result.success).toBe(true);
    expect(ctx.awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(ctx.computeBridge.setFilterSortState).toHaveBeenCalledWith(
      SHEET_ID,
      'filter-1',
      {
        columnCellId: 'header-a',
        order: 'asc',
        sortBy: 'value',
      },
      expectFilterAdmissionOptions('filters.setSortState'),
    );
  });

  it('passes version admission options to filter bridge mutations', async () => {
    const ctx = createMockCtx();
    const filter = tableBackedFilter({
      'header-a': { criteria: { type: 'value', values: ['East'] } },
    });
    ctx.computeBridge.getFiltersInSheet.mockResolvedValue([filter]);
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValue([
      {
        id: 'table-1',
        range: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
      },
    ]);
    ctx.computeBridge.getCellIdAt.mockResolvedValue('header-a');

    await FilterOps.createFilter(ctx, SHEET_ID, 0, 0, 10, 2);
    await FilterOps.deleteFilter(ctx, SHEET_ID, 'filter-1');
    await FilterOps.setColumnFilter(ctx, SHEET_ID, 'filter-1', 0, {
      type: 'value',
      values: ['West'],
    });
    await FilterOps.clearColumnFilter(ctx, SHEET_ID, 'filter-1', 0);
    await FilterOps.clearAllColumnFilters(ctx, SHEET_ID, 'filter-1');
    await FilterOps.applyFilter(ctx, SHEET_ID, 'filter-1');
    await FilterOps.reapplyFilter(ctx, SHEET_ID, 'filter-1');
    await FilterOps.setFilterSortState(ctx, SHEET_ID, 'filter-1', {
      columnCellId: 'header-a',
      order: 'desc',
      sortBy: 'value',
    });

    expect(ctx.computeBridge.createFilter.mock.calls[0][2]).toEqual(
      expectFilterAdmissionOptions('filters.add'),
    );
    expect(ctx.computeBridge.deleteFilter.mock.calls[0][2]).toEqual(
      expectFilterAdmissionOptions('filters.remove'),
    );
    expect(ctx.computeBridge.setColumnFilter.mock.calls[0][4]).toEqual(
      expectFilterAdmissionOptions('filters.setColumnFilter'),
    );
    expect(ctx.computeBridge.clearColumnFilter.mock.calls[0][3]).toEqual(
      expectFilterAdmissionOptions('filters.clearColumnFilter'),
    );
    expect(ctx.computeBridge.clearAllColumnFilters.mock.calls[0][2]).toEqual(
      expectFilterAdmissionOptions('filters.clearAllColumnFilters'),
    );
    expect(ctx.computeBridge.applyFilter.mock.calls[0][2]).toEqual(
      expectFilterAdmissionOptions('filters.apply'),
    );
    expect(ctx.computeBridge.reapplyFilter.mock.calls[0][2]).toEqual(
      expectFilterAdmissionOptions('filters.reapply'),
    );
    expect(ctx.computeBridge.setFilterSortState.mock.calls[0][3]).toEqual(
      expectFilterAdmissionOptions('filters.setSortState'),
    );
  });

  it('does not call filter bridge mutations for no-op missing filters', async () => {
    const ctx = createMockCtx();

    const result = await FilterOps.setColumnFilter(ctx, SHEET_ID, 'missing-filter', 0, {
      type: 'value',
      values: ['East'],
    });

    expect(result.success).toBe(true);
    expect(ctx.computeBridge.setColumnFilter).not.toHaveBeenCalled();
  });
});
