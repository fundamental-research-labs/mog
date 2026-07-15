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

function mutationResult(overrides: Record<string, unknown> = {}): any {
  return {
    recalc: { changedCells: [] },
    ...overrides,
  };
}

function tableFilter(overrides: Record<string, unknown> = {}): any {
  return {
    id: FILTER_ID,
    type: 'tableFilter',
    tableId: 'table-1',
    columnFilters: {},
    ...overrides,
  };
}

function autoFilter(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'auto-filter-1',
    type: 'autoFilter',
    headerStartCellId: 'auto-start',
    headerEndCellId: 'auto-end',
    dataEndCellId: 'auto-data-end',
    columnFilters: {},
    ...overrides,
  };
}

function advancedFilter(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'advanced-filter-1',
    type: 'advancedFilter',
    headerStartCellId: 'advanced-header-start',
    headerEndCellId: 'advanced-header-end',
    dataEndCellId: 'advanced-data-end',
    columnFilters: {},
    advancedFilter: {
      criteriaRange: {
        sheetId: SHEET_ID,
        startCellId: 'advanced-criteria-start',
        endCellId: 'advanced-criteria-end',
      },
      uniqueRecordsOnly: false,
    },
    ...overrides,
  };
}

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
      reapplyFilter: jest.fn().mockResolvedValue(undefined),
      createFilter: jest.fn().mockResolvedValue(undefined),
      deleteFilter: jest.fn().mockResolvedValue(undefined),
      clearColumnFilter: jest.fn().mockResolvedValue(undefined),
      clearAllColumnFilters: jest.fn().mockResolvedValue(undefined),
      computeDynamicFilterSerialRange: jest.fn().mockResolvedValue(null),
      getAllTablesInSheet: jest.fn().mockResolvedValue([
        {
          id: 'table-1',
          range: { startRow: 0, startCol: 0, endRow: 4, endCol: 1 },
        },
      ]),
      getCellIdAt: jest.fn().mockResolvedValue(null),
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

  it('honors an explicit filterId target', async () => {
    ctx = createMockCtx({ existingFilters: [{ id: 'explicit-filter' }] });
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);

    await filters.byColor(1, {
      colorType: 'fill',
      color: '#00FF00',
      filterId: 'explicit-filter',
    });

    expect(ctx.computeBridge.setColumnFilter).toHaveBeenCalledWith(
      SHEET_ID,
      'explicit-filter',
      1,
      expect.objectContaining({ type: 'color', color: '#00FF00', byFont: false }),
    );
    expect(ctx.computeBridge.applyFilter).toHaveBeenCalledWith(SHEET_ID, 'explicit-filter');
  });

  it('returns a base operation receipt when setting an auto-filter', async () => {
    const receipt = await filters.add('A1:B10');

    expect(ctx.computeBridge.createFilter).toHaveBeenCalledWith(SHEET_ID, {
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 1,
    });
    expect(receipt).toEqual({
      kind: 'autoFilterSet',
      status: 'applied',
      effects: [
        {
          type: 'createdObject',
          sheetId: SHEET_ID,
          range: 'A1:B10',
          details: { objectType: 'filter' },
        },
        {
          type: 'changedFilterProjection',
          sheetId: SHEET_ID,
          range: 'A1:B10',
        },
      ],
      diagnostics: [],
      range: 'A1:B10',
    });
  });

  it('does not create a duplicate filter when the requested range already has a filter', async () => {
    ctx = createMockCtx({
      existingFilters: [
        autoFilter({
          headerStartCellId: 'existing-start',
          headerEndCellId: 'existing-end',
          dataEndCellId: 'existing-data-end',
        }),
      ],
    });
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
    ctx.computeBridge.getCellPosition.mockImplementation(
      async (_sheetId: string, cellId: string) => {
        const positions: Record<string, { row: number; col: number }> = {
          'existing-start': { row: 0, col: 0 },
          'existing-end': { row: 0, col: 1 },
          'existing-data-end': { row: 9, col: 1 },
        };
        return positions[cellId] ?? null;
      },
    );

    const receipt = await filters.add('A1:B10');

    expect(ctx.computeBridge.createFilter).not.toHaveBeenCalled();
    expect(receipt).toEqual({
      kind: 'autoFilterSet',
      status: 'noOp',
      effects: [],
      diagnostics: [],
      range: 'A1:B10',
    });
  });

  it('uses an existing sheet auto-filter as the default target before table filters', async () => {
    ctx = createMockCtx({
      existingFilters: [
        tableFilter({ id: 'table-filter-1' }),
        autoFilter({ id: 'sheet-auto-filter-1' }),
      ],
    });
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
    ctx.computeBridge.setColumnFilter.mockResolvedValueOnce(mutationResult());

    await filters.setColumnFilter(1, { type: 'value', values: ['May 2026'] });

    expect(ctx.computeBridge.setColumnFilter).toHaveBeenCalledWith(
      SHEET_ID,
      'sheet-auto-filter-1',
      1,
      expect.objectContaining({
        type: 'values',
        values: ['May 2026'],
      }),
    );
  });

  it('keeps omitted-filter mutations on the active filter instead of raw storage order', async () => {
    ctx = createMockCtx({
      existingFilters: [
        autoFilter({ id: 'inactive-auto-filter' }),
        tableFilter({
          id: 'active-table-filter',
          columnFilters: {
            usageBandHeader: { type: 'values', values: ['High'], includeBlanks: false },
          },
        }),
      ],
    });
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
    ctx.computeBridge.setColumnFilter.mockResolvedValueOnce(mutationResult());

    await filters.setColumnFilter(3, { type: 'value', values: ['May 2026'] });

    expect(ctx.computeBridge.setColumnFilter).toHaveBeenCalledWith(
      SHEET_ID,
      'active-table-filter',
      3,
      expect.objectContaining({
        type: 'values',
        values: ['May 2026'],
      }),
    );
  });

  it('returns applied and no-op receipts when clearing auto-filters', async () => {
    const applied = await filters.clear();

    expect(ctx.computeBridge.deleteFilter).toHaveBeenCalledWith(SHEET_ID, FILTER_ID);
    expect(applied).toEqual({
      kind: 'autoFilterClear',
      status: 'applied',
      effects: [
        {
          type: 'removedObject',
          sheetId: SHEET_ID,
          count: 1,
          details: { objectType: 'filter' },
        },
        {
          type: 'changedFilterProjection',
          sheetId: SHEET_ID,
          count: 1,
        },
      ],
      diagnostics: [],
      clearedCount: 1,
    });

    ctx.computeBridge.getFiltersInSheet.mockResolvedValue([]);
    ctx.computeBridge.deleteFilter.mockClear();

    const noOp = await filters.clear();

    expect(ctx.computeBridge.deleteFilter).not.toHaveBeenCalled();
    expect(noOp).toEqual({
      kind: 'autoFilterClear',
      status: 'noOp',
      effects: [],
      diagnostics: [],
      clearedCount: 0,
    });
  });

  it('returns an applied receipt for setColumnFilter projection changes', async () => {
    ctx = createMockCtx({ existingFilters: [tableFilter()] });
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
    ctx.computeBridge.setColumnFilter.mockResolvedValueOnce(
      mutationResult({
        filterChanges: [
          {
            sheetId: SHEET_ID,
            filterId: FILTER_ID,
            filterKind: 'tableFilter',
            tableId: 'table-1',
            action: 'applied',
            hiddenRowCount: 2,
            visibleRowCount: 3,
            kind: 'Set',
          },
        ],
      }),
    );

    const receipt = await filters.setColumnFilter(0, { type: 'value', values: ['East'] });

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'filter.columnFilter.set',
        status: 'applied',
        sheetId: SHEET_ID,
        filterId: FILTER_ID,
        filterKind: 'tableFilter',
        tableId: 'table-1',
        range: 'A1:B5',
        column: 0,
        hiddenRowCount: 2,
        visibleRowCount: 3,
        diagnostics: [],
      }),
    );
    expect(receipt.effects).toEqual([
      expect.objectContaining({
        type: 'changedFilterProjection',
        sheetId: SHEET_ID,
        range: 'A1:B5',
        details: expect.objectContaining({
          filterId: FILTER_ID,
          hiddenRowCount: 2,
          visibleRowCount: 3,
        }),
      }),
    ]);
  });

  it('returns a no-op receipt when clearing an already-clear column', async () => {
    ctx = createMockCtx({ existingFilters: [tableFilter()] });
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);

    const receipt = await filters.clearColumnFilter(0);

    expect(ctx.computeBridge.clearColumnFilter).not.toHaveBeenCalled();
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'filter.columnFilter.clear',
        status: 'noOp',
        sheetId: SHEET_ID,
        filterId: FILTER_ID,
        filterKind: 'tableFilter',
        range: 'A1:B5',
        column: 0,
        effects: [],
        diagnostics: [],
      }),
    );
  });

  it('clears active advanced-filter criteria even when no column filters are set', async () => {
    ctx = createMockCtx({ existingFilters: [advancedFilter()] });
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
    ctx.computeBridge.getCellPosition.mockImplementation(
      async (_sheetId: string, cellId: string) => {
        const positions: Record<string, { row: number; col: number }> = {
          'advanced-header-start': { row: 0, col: 0 },
          'advanced-header-end': { row: 0, col: 1 },
          'advanced-data-end': { row: 5, col: 1 },
        };
        return positions[cellId] ?? null;
      },
    );
    ctx.computeBridge.clearAllColumnFilters.mockResolvedValueOnce(
      mutationResult({
        filterChanges: [
          {
            sheetId: SHEET_ID,
            filterId: 'advanced-filter-1',
            filterKind: 'advancedFilter',
            action: 'cleared',
            hiddenRowCount: 0,
            visibleRowCount: 5,
            kind: 'Set',
          },
        ],
      }),
    );

    const receipt = await filters.clearAllCriteria('advanced-filter-1');

    expect(ctx.computeBridge.clearAllColumnFilters).toHaveBeenCalledWith(
      SHEET_ID,
      'advanced-filter-1',
    );
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'filter.criteria.clearAll',
        status: 'applied',
        sheetId: SHEET_ID,
        filterId: 'advanced-filter-1',
        filterKind: 'advancedFilter',
        range: 'A1:B6',
        hiddenRowCount: 0,
        visibleRowCount: 5,
      }),
    );
    expect(receipt.effects).toEqual([
      expect.objectContaining({
        type: 'changedFilterProjection',
        sheetId: SHEET_ID,
        range: 'A1:B6',
        details: expect.objectContaining({
          action: 'cleared',
          filterKind: 'advancedFilter',
        }),
      }),
    ]);
  });

  it('returns an unsupported receipt with diagnostics for preserved filter shells', async () => {
    const diagnostic = {
      id: 'runtime-diagnostic-1',
      sequence: '1',
      code: 'unsupported_filter_reapply',
      severity: 'warning',
      recoverability: 'unsupported_preserved',
      operation: 'applyFilter',
      sheetId: SHEET_ID,
      filterId: FILTER_ID,
      filterKind: 'tableFilter',
      tableId: 'table-1',
      reason: 'iconFilterUnsupported',
      reasons: ['iconFilterUnsupported'],
    };
    ctx = createMockCtx({ existingFilters: [tableFilter()] });
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
    ctx.computeBridge.applyFilter.mockResolvedValueOnce(
      mutationResult({
        diagnostics: [diagnostic],
        filterChanges: [
          {
            sheetId: SHEET_ID,
            filterId: FILTER_ID,
            filterKind: 'tableFilter',
            tableId: 'table-1',
            capability: 'unsupported',
            unsupportedReasons: ['iconFilterUnsupported'],
            diagnostics: [diagnostic],
            action: 'applied',
            hiddenRowCount: 0,
            visibleRowCount: 5,
            kind: 'Set',
          },
        ],
      }),
    );

    const receipt = await filters.apply(FILTER_ID);

    expect(receipt.status).toBe('unsupported');
    expect(receipt.unsupportedReasons).toEqual(['iconFilterUnsupported']);
    expect(receipt.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'unsupported_filter_reapply',
        target: expect.objectContaining({ sheetId: SHEET_ID, objectId: FILTER_ID }),
      }),
    ]);
    expect(receipt.effects).toEqual([expect.objectContaining({ type: 'changedFilterProjection' })]);
  });

  it('returns failed status when compute reports failure diagnostics', async () => {
    ctx = createMockCtx({ existingFilters: [tableFilter()] });
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
    ctx.computeBridge.reapplyFilter.mockResolvedValueOnce(
      mutationResult({
        diagnostics: [
          {
            id: 'runtime-diagnostic-2',
            sequence: '2',
            code: 'filter_runtime_failure',
            severity: 'error',
            recoverability: 'fatal',
            operation: 'reapplyFilter',
            sheetId: SHEET_ID,
            filterId: FILTER_ID,
            filterKind: 'tableFilter',
            tableId: 'table-1',
          },
        ],
      }),
    );

    const receipt = await filters.reapply(FILTER_ID);

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'filter.reapply',
        status: 'failed',
        sheetId: SHEET_ID,
        filterId: FILTER_ID,
        range: 'A1:B5',
      }),
    );
    expect(receipt.diagnostics[0]).toEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'filter_runtime_failure',
        recoverable: false,
      }),
    );
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
    ctx.computeBridge.getFiltersInSheet.mockResolvedValueOnce([
      advancedFilter({ id: 'existing-advanced-filter' }),
    ]);
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

describe('WorksheetFiltersImpl invalid mutation targets', () => {
  let ctx: any;
  let filters: WorksheetFiltersImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx({ existingFilters: [] });
    filters = new WorksheetFiltersImpl(ctx, SHEET_ID);
  });

  const missingTargetCases: Array<[string, (filters: WorksheetFiltersImpl) => Promise<unknown>]> = [
    ['remove', (api) => api.remove('missing-filter')],
    [
      'setColumnFilter',
      (api) => api.setColumnFilter(0, { type: 'value', values: ['East'] }, 'missing-filter'),
    ],
    ['applyDynamicFilter', (api) => api.applyDynamicFilter(0, 'aboveAverage', 'missing-filter')],
    ['clearColumnFilter', (api) => api.clearColumnFilter(0, 'missing-filter')],
    [
      'setCriteria',
      (api) => api.setCriteria('missing-filter', 0, { type: 'value', values: ['East'] }),
    ],
    ['clearCriteria', (api) => api.clearCriteria('missing-filter', 0)],
    ['clearAllCriteria', (api) => api.clearAllCriteria('missing-filter')],
    ['apply', (api) => api.apply('missing-filter')],
    ['reapply', (api) => api.reapply('missing-filter')],
    [
      'setSortState',
      (api) =>
        api.setSortState('missing-filter', {
          column: 'missing-column' as any,
          direction: 'ascending',
        }),
    ],
    [
      'byColor',
      (api) =>
        api.byColor(0, {
          colorType: 'fill',
          color: '#FFFF00',
          filterId: 'missing-filter',
        }),
    ],
    [
      'applyAdvanced',
      (api) =>
        api.applyAdvanced({
          listRange: 'A1:B6',
          mode: 'inPlace',
          filterId: 'missing-filter',
        }),
    ],
  ];

  it.each(missingTargetCases)('%s rejects a missing explicit filter ID', async (_name, action) => {
    await expect(action(filters)).rejects.toMatchObject({ code: 'FILTER_NOT_FOUND' });
  });

  it('retains no-op semantics when an optional default target is omitted', async () => {
    await expect(
      filters.setColumnFilter(0, { type: 'value', values: ['East'] }),
    ).resolves.toMatchObject({ status: 'noOp' });
    await expect(filters.clearColumnFilter(0)).resolves.toMatchObject({ status: 'noOp' });
  });
});
