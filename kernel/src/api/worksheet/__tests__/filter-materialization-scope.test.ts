import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetFiltersImpl } from '../filters';

const SHEET_ID = sheetId('sheet-1');

function createMockCtx(): any {
  return {
    writeGate: {
      assertWritable: jest.fn(),
    },
    awaitMaterialized: jest.fn().mockResolvedValue(undefined),
    computeBridge: {
      getFiltersInSheet: jest.fn().mockResolvedValue([
        {
          id: 'filter-1',
          type: 'tableFilter',
          tableId: 'table-1',
          columnFilters: {},
        },
      ]),
      getAllTablesInSheet: jest.fn().mockResolvedValue([
        {
          id: 'table-1',
          range: { startRow: 0, startCol: 0, endRow: 4, endCol: 1 },
        },
      ]),
      getFilterHeaderInfo: jest.fn().mockResolvedValue([]),
      reapplyFilter: jest.fn().mockResolvedValue({ recalc: { changedCells: [] } }),
    },
  };
}

describe('WorksheetFiltersImpl materialization scopes', () => {
  let ctx: any;
  let filters: WorksheetFiltersImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
  });

  it('defaults detailed list reads to complete materialization', async () => {
    await filters.list();

    expect(ctx.awaitMaterialized).toHaveBeenCalledWith('allSheets');
  });

  it('allows detailed list reads to stay sheet-local when requested', async () => {
    await filters.list({ scope: 'sheetLocal' });

    expect(ctx.awaitMaterialized).toHaveBeenCalledWith(SHEET_ID);
  });

  it('defaults getInfo reads to complete materialization', async () => {
    await filters.getInfo('missing');

    expect(ctx.awaitMaterialized).toHaveBeenCalledWith('allSheets');
  });

  it('allows getInfo reads to stay sheet-local when requested', async () => {
    await filters.getInfo('missing', { scope: 'sheetLocal' });

    expect(ctx.awaitMaterialized).toHaveBeenCalledWith(SHEET_ID);
  });

  it('defaults compact summaries and headers to sheet-local materialization', async () => {
    await filters.listSummaries();
    await filters.listHeaderInfo();

    expect(ctx.awaitMaterialized).toHaveBeenNthCalledWith(1, SHEET_ID);
    expect(ctx.awaitMaterialized).toHaveBeenNthCalledWith(2, SHEET_ID);
  });

  it('allows compact summaries and headers to read currently available metadata', async () => {
    await filters.listSummaries({ scope: 'available' });
    await filters.listHeaderInfo({ scope: 'available' });

    expect(ctx.awaitMaterialized).not.toHaveBeenCalled();
    expect(ctx.computeBridge.getFiltersInSheet).toHaveBeenCalledWith(SHEET_ID);
    expect(ctx.computeBridge.getFilterHeaderInfo).toHaveBeenCalledWith(SHEET_ID);
  });

  it('can force compact header reads through complete materialization', async () => {
    await filters.listHeaderInfo({ scope: 'complete' });

    expect(ctx.awaitMaterialized).toHaveBeenCalledWith('allSheets');
  });

  it('waits for complete materialization before reapplying a filter', async () => {
    await filters.reapply('filter-1');

    expect(ctx.awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(ctx.computeBridge.reapplyFilter).toHaveBeenCalledWith(SHEET_ID, 'filter-1');
  });
});
