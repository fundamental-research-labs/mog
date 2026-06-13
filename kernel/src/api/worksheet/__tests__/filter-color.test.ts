/**
 * WorksheetFilters.byColor — kernel-only routing test.
 *
 * Exercises the new `byColor` method: resolve-active-filter, compose color
 * criteria, route through `setColumnFilter` and on into the compute bridge.
 *
 * The Rust side of the color predicate (per-row format match) lives in
 * compute-table/filter.rs; that's covered by `cargo test -p compute-table`.
 * This test verifies kernel-level wiring only — that the public method
 * shape lines up with the bridge call shape, and the active-filter resolve
 * path is taken when `filterId` is omitted.
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetFiltersImpl } from '../filters';

const SHEET_ID = sheetId('sheet-1');
const FILTER_ID = 'filter-1';

function createMockCtx(opts: { existingFilters?: Array<{ id: string }> } = {}): any {
  const filters = opts.existingFilters ?? [{ id: FILTER_ID }];
  return {
    writeGate: {
      assertWritable: jest.fn(),
    },
    computeBridge: {
      getFiltersInSheet: jest.fn().mockResolvedValue(filters),
      applyAdvancedFilter: jest.fn().mockResolvedValue({
        data: {
          mode: 'inPlace',
          listRange: 'A1:B6',
          criteriaRange: 'D1:D2',
          filterId: 'advanced-filter-1',
          rowsMatched: 1,
          rowsHidden: 4,
        },
      }),
      setColumnFilter: jest.fn().mockResolvedValue(undefined),
      applyFilter: jest.fn().mockResolvedValue(undefined),
      createFilter: jest.fn().mockResolvedValue(undefined),
      deleteFilter: jest.fn().mockResolvedValue(undefined),
      clearColumnFilter: jest.fn().mockResolvedValue(undefined),
      clearAllColumnFilters: jest.fn().mockResolvedValue(undefined),
      getCellPosition: jest.fn().mockResolvedValue(null),
      getUniqueColumnValues: jest.fn().mockResolvedValue([]),
      getFilterSortState: jest.fn().mockResolvedValue(null),
      setFilterSortState: jest.fn().mockResolvedValue(undefined),
      getSheetProtectionOptions: jest.fn().mockResolvedValue(null),
    },
  };
}

describe('WorksheetFiltersImpl.byColor', () => {
  let ctx: any;
  let filters: WorksheetFiltersImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
  });

  it('resolves active filter and forwards a fill-color criterion', async () => {
    await filters.byColor(0, { colorType: 'fill', color: '#FFFF00' });

    // Resolved the first filter on the sheet (no filterId passed).
    expect(ctx.computeBridge.getFiltersInSheet).toHaveBeenCalledWith(SHEET_ID);

    // Sent the color predicate to the bridge with byFont=false (fill).
    expect(ctx.computeBridge.setColumnFilter).toHaveBeenCalledWith(
      SHEET_ID,
      FILTER_ID,
      0,
      expect.objectContaining({
        type: 'color',
        color: '#FFFF00',
        byFont: false,
      }),
    );

    // Applied the filter so hidden-row state updates.
    expect(ctx.computeBridge.applyFilter).toHaveBeenCalledWith(SHEET_ID, FILTER_ID);
  });

  it('forwards a font-color criterion with byFont=true', async () => {
    await filters.byColor(2, { colorType: 'font', color: '#FF0000' });

    expect(ctx.computeBridge.setColumnFilter).toHaveBeenCalledWith(
      SHEET_ID,
      FILTER_ID,
      2,
      expect.objectContaining({
        type: 'color',
        color: '#FF0000',
        byFont: true,
      }),
    );
    expect(ctx.computeBridge.applyFilter).toHaveBeenCalledWith(SHEET_ID, FILTER_ID);
  });

  it('honors an explicit filterId without resolving the active filter', async () => {
    await filters.byColor(1, {
      colorType: 'fill',
      color: '#00FF00',
      filterId: 'explicit-filter',
    });

    // Explicit ID avoids active-filter resolution when sheet protection is inactive.
    expect(ctx.computeBridge.getFiltersInSheet).not.toHaveBeenCalled();
    expect(ctx.computeBridge.setColumnFilter).toHaveBeenCalledWith(
      SHEET_ID,
      'explicit-filter',
      1,
      expect.objectContaining({ type: 'color', color: '#00FF00', byFont: false }),
    );
    expect(ctx.computeBridge.applyFilter).toHaveBeenCalledWith(SHEET_ID, 'explicit-filter');
  });

  it('throws when no auto-filter exists and no filterId is provided', async () => {
    ctx = createMockCtx({ existingFilters: [] });
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);

    await expect(filters.byColor(0, { colorType: 'fill', color: '#FFFF00' })).rejects.toThrow(
      /No auto-filter/,
    );

    expect(ctx.computeBridge.setColumnFilter).not.toHaveBeenCalled();
  });
});

describe('WorksheetFiltersImpl.applyAdvanced', () => {
  let ctx: any;
  let filters: WorksheetFiltersImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
  });

  it('forwards in-place advanced filters to the Rust bridge and returns the receipt', async () => {
    const receipt = await filters.applyAdvanced({
      listRange: '$A$1:$B$6',
      criteriaRange: '$D$1:$D$2',
      mode: 'inPlace',
      uniqueRecordsOnly: true,
      filterId: 'existing-advanced-filter',
    });

    expect(ctx.computeBridge.applyAdvancedFilter).toHaveBeenCalledWith(SHEET_ID, {
      listRange: '$A$1:$B$6',
      criteriaRange: '$D$1:$D$2',
      mode: 'inPlace',
      copyToRange: undefined,
      uniqueRecordsOnly: true,
      filterId: 'existing-advanced-filter',
    });
    expect(receipt).toEqual({
      mode: 'inPlace',
      listRange: 'A1:B6',
      criteriaRange: 'D1:D2',
      filterId: 'advanced-filter-1',
      rowsMatched: 1,
      rowsHidden: 4,
    });
  });

  it('forwards copy-to advanced filters without a filterId', async () => {
    ctx.computeBridge.applyAdvancedFilter.mockResolvedValueOnce({
      data: {
        mode: 'copyTo',
        listRange: 'A1:B7',
        rowsMatched: 4,
        rowsCopied: 4,
        columnsCopied: 2,
        destinationRange: 'D1:E5',
      },
    });

    const receipt = await filters.applyAdvanced({
      listRange: '$A$1:$B$7',
      criteriaRange: null,
      mode: 'copyTo',
      copyToRange: '$D$1',
    });

    expect(ctx.computeBridge.applyAdvancedFilter).toHaveBeenCalledWith(SHEET_ID, {
      listRange: '$A$1:$B$7',
      criteriaRange: undefined,
      mode: 'copyTo',
      copyToRange: '$D$1',
      uniqueRecordsOnly: false,
      filterId: undefined,
    });
    expect(receipt.destinationRange).toBe('D1:E5');
  });

  it('throws when the Rust bridge does not return an advanced-filter receipt', async () => {
    ctx.computeBridge.applyAdvancedFilter.mockResolvedValueOnce({ data: null });

    await expect(filters.applyAdvanced({ listRange: 'A1:B6', mode: 'inPlace' })).rejects.toThrow(
      /Advanced Filter returned no receipt/,
    );
  });

  it('maps Rust filter type and advanced metadata through list()', async () => {
    ctx.computeBridge.getFiltersInSheet.mockResolvedValueOnce([
      {
        id: 'advanced-filter-1',
        type: 'advancedFilter',
        headerStartCellId: 'header-start',
        headerEndCellId: 'header-end',
        dataEndCellId: 'data-end',
        columnFilters: {},
        advancedFilter: { uniqueRecordsOnly: true },
      },
    ]);

    const details = await filters.list();

    expect(details[0]).toEqual(
      expect.objectContaining({
        id: 'advanced-filter-1',
        filterKind: 'advancedFilter',
        advancedFilter: expect.objectContaining({
          uniqueRecordsOnly: true,
          active: true,
        }),
      }),
    );
  });
});
