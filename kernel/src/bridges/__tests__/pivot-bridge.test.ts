import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import { PivotBridge } from '../pivot-bridge';

const SHEET_ID = sheetId('sheet-1');

function makePivotResult(overrides?: Record<string, unknown>): any {
  return {
    rows: [],
    columnHeaders: [],
    grandTotals: {},
    sourceRowCount: 0,
    renderedBounds: {
      totalRows: 1,
      totalCols: 1,
      firstDataRow: 0,
      firstDataCol: 0,
      numDataRows: 0,
      numDataCols: 0,
    },
    ...overrides,
  };
}

function makePublicPivotResult(overrides?: Record<string, unknown>): any {
  return makePivotResult({
    records: undefined,
    measureDescriptors: [],
    valueRecords: [],
    errors: undefined,
    ...overrides,
  });
}

function makePivotConfig(overrides?: Record<string, unknown>): any {
  return {
    schemaVersion: 2,
    id: 'pivot-1',
    name: 'SalesPivot',
    sourceSheetId: SHEET_ID,
    sourceSheetName: 'Sheet1',
    sourceRange: { startRow: 0, startCol: 0, endRow: 99, endCol: 4 },
    outputSheetName: 'Sheet1',
    outputLocation: { row: 4, col: 0 },
    fields: [
      { id: 'Month', name: 'Month', sourceColumn: 0, dataType: 'string' },
      { id: 'Vendor', name: 'Vendor', sourceColumn: 1, dataType: 'string' },
      { id: 'Region', name: 'Region', sourceColumn: 2, dataType: 'string' },
      { id: 'Quarter', name: 'Quarter', sourceColumn: 3, dataType: 'string' },
      { id: 'Amount', name: 'Amount', sourceColumn: 4, dataType: 'number' },
    ],
    placements: [],
    filters: [],
    layout: { showRowGrandTotals: true, showColumnGrandTotals: true, layoutForm: 'compact' },
    ...overrides,
  };
}

function createMockCtx(): any {
  const handlers = new Map<string, Array<(event: any) => void>>();
  return {
    computeBridge: {
      getMutationHandler: jest.fn(() => null),
      pivotCreate: jest.fn(async (config: unknown) => ({ data: config })),
      pivotCreateWithSheet: jest.fn(async (_sheetName: string, config: unknown) => ({
        sheetId: SHEET_ID,
        config,
      })),
      pivotGet: jest.fn().mockResolvedValue(null),
      pivotGetAll: jest.fn().mockResolvedValue([]),
      pivotGetImportedViewRecords: jest.fn().mockResolvedValue([]),
      pivotUpdate: jest.fn(async (_sheetId: string, _pivotId: string, config: unknown) => ({
        data: config,
      })),
      getSheetName: jest.fn().mockResolvedValue('Sheet1'),
      getAllSheetIds: jest.fn().mockResolvedValue([SHEET_ID]),
      pivotComputeFromSource: jest.fn().mockResolvedValue(makePivotResult()),
      pivotMaterialize: jest.fn().mockResolvedValue(makePivotResult()),
      forceRefreshAllViewports: jest.fn().mockResolvedValue(undefined),
    },
    eventBus: {
      handlers,
      on: jest.fn((type: string, handler: (event: any) => void) => {
        const list = handlers.get(type) ?? [];
        list.push(handler);
        handlers.set(type, list);
        return () => {
          const next = (handlers.get(type) ?? []).filter((entry) => entry !== handler);
          handlers.set(type, next);
        };
      }),
      emit: jest.fn((event: any) => {
        for (const handler of handlers.get(event.type) ?? []) {
          handler(event);
        }
      }),
    },
    pivotExpansionProvider: {
      getExpansionState: jest.fn(() => ({
        expandedRows: {},
        expandedColumns: {},
      })),
    },
  };
}

function createMutationBridge(config: any): {
  bridge: PivotBridge;
  ctx: any;
  getConfig: () => any;
} {
  const ctx = createMockCtx();
  let currentConfig = config;
  ctx.computeBridge.pivotGet.mockImplementation(async (_sheetId: string, pivotId: string) =>
    pivotId === currentConfig.id ? currentConfig : null,
  );
  ctx.computeBridge.pivotUpdate.mockImplementation(
    async (_sheetId: string, _pivotId: string, nextConfig: any) => {
      currentConfig = nextConfig;
      return { data: nextConfig };
    },
  );
  return { bridge: new PivotBridge(ctx), ctx, getConfig: () => currentConfig };
}

function sortedPlacements(placements: any[], area: string): any[] {
  return placements
    .filter((placement) => placement.area === area)
    .sort((left, right) => left.position - right.position);
}

function placementOrder(placements: any[], area: string): string[] {
  return sortedPlacements(placements, area).map((placement) => placement.placementId);
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('PivotBridge read vs refresh paths', () => {
  it('createPivot emits dirty-only config updates because callers own initial materialization', async () => {
    const ctx = createMockCtx();
    const withPivotUpdateOptions = jest.fn(async (_options: unknown, fn: () => Promise<unknown>) =>
      fn(),
    );
    ctx.computeBridge.getMutationHandler.mockReturnValue({ withPivotUpdateOptions });
    const bridge = new PivotBridge(ctx);

    await bridge.createPivot(makePivotConfig());

    expect(withPivotUpdateOptions).toHaveBeenCalledWith(
      { reason: 'uiConfigChanged', refreshPolicy: 'dirtyOnly' },
      expect.any(Function),
    );
  });

  it('createPivotWithSheet emits dirty-only config updates because callers own initial materialization', async () => {
    const ctx = createMockCtx();
    const withPivotUpdateOptions = jest.fn(async (_options: unknown, fn: () => Promise<unknown>) =>
      fn(),
    );
    ctx.computeBridge.getMutationHandler.mockReturnValue({ withPivotUpdateOptions });
    const bridge = new PivotBridge(ctx);

    await bridge.createPivotWithSheet('PivotSheet', makePivotConfig());

    expect(withPivotUpdateOptions).toHaveBeenCalledWith(
      { reason: 'uiConfigChanged', refreshPolicy: 'dirtyOnly' },
      expect.any(Function),
    );
  });

  it('compute uses the pure source path and does not materialize or notify subscribers', async () => {
    const ctx = createMockCtx();
    const bridge = new PivotBridge(ctx);
    const subscriber = jest.fn();
    bridge.subscribe('pivot-1', subscriber);

    const result = await bridge.compute(SHEET_ID, 'pivot-1', true);

    expect(result).toEqual(makePublicPivotResult());
    expect(result).not.toHaveProperty('source');
    expect(ctx.computeBridge.pivotComputeFromSource).toHaveBeenCalledWith(SHEET_ID, 'pivot-1', {
      expandedRows: {},
      expandedColumns: {},
    });
    expect(ctx.computeBridge.pivotMaterialize).not.toHaveBeenCalled();
    expect(ctx.computeBridge.forceRefreshAllViewports).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
  });

  it('refresh is the explicit materialization path and notifies subscribers', async () => {
    const ctx = createMockCtx();
    const bridge = new PivotBridge(ctx);
    const subscriber = jest.fn();
    bridge.subscribe('pivot-1', subscriber);

    const result = await bridge.refresh(SHEET_ID, 'pivot-1');

    expect(result).toEqual(makePublicPivotResult());
    expect(result).not.toHaveProperty('source');
    expect(ctx.computeBridge.pivotMaterialize).toHaveBeenCalledWith(SHEET_ID, 'pivot-1', {
      expandedRows: {},
      expandedColumns: {},
    });
    expect(ctx.computeBridge.forceRefreshAllViewports).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.pivotComputeFromSource).not.toHaveBeenCalled();
    expect(subscriber).toHaveBeenCalledWith('pivot-1', result, undefined);
  });

  it('refreshAndMaterialize pivot events use the materialization path even without subscribers', async () => {
    const ctx = createMockCtx();
    new PivotBridge(ctx);

    ctx.eventBus.emit({
      type: 'pivot:updated',
      sheetId: SHEET_ID,
      outputSheetId: SHEET_ID,
      sourceSheetId: SHEET_ID,
      pivotId: 'pivot-1',
      update: { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
      source: 'user',
      timestamp: Date.now(),
    });

    await Promise.resolve();

    expect(ctx.computeBridge.pivotMaterialize).toHaveBeenCalledWith(SHEET_ID, 'pivot-1', {
      expandedRows: {},
      expandedColumns: {},
    });
    expect(ctx.computeBridge.forceRefreshAllViewports).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.pivotComputeFromSource).not.toHaveBeenCalled();
  });

  it('dirtyOnly pivot events invalidate without materializing', async () => {
    const ctx = createMockCtx();
    new PivotBridge(ctx);

    ctx.eventBus.emit({
      type: 'pivot:updated',
      sheetId: SHEET_ID,
      outputSheetId: SHEET_ID,
      sourceSheetId: SHEET_ID,
      pivotId: 'pivot-1',
      update: { reason: 'sourceRangeChanged', refreshPolicy: 'dirtyOnly' },
      source: 'user',
      timestamp: Date.now(),
    });

    await Promise.resolve();

    expect(ctx.computeBridge.pivotMaterialize).not.toHaveBeenCalled();
    expect(ctx.computeBridge.forceRefreshAllViewports).not.toHaveBeenCalled();
    expect(ctx.computeBridge.pivotComputeFromSource).not.toHaveBeenCalled();
  });

  it('source cell changes refresh dependent pivots through the materialization path', async () => {
    const ctx = createMockCtx();
    ctx.computeBridge.pivotGetAll.mockResolvedValue([makePivotConfig()]);
    new PivotBridge(ctx);

    ctx.eventBus.emit({
      type: 'cell:changed',
      sheetId: SHEET_ID,
      row: 2,
      col: 1,
      oldValue: undefined,
      newValue: 150,
      source: 'user',
      timestamp: Date.now(),
    });

    await flushPromises();

    expect(ctx.computeBridge.pivotMaterialize).toHaveBeenCalledWith(SHEET_ID, 'pivot-1', {
      expandedRows: {},
      expandedColumns: {},
    });
    expect(ctx.computeBridge.forceRefreshAllViewports).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.pivotComputeFromSource).not.toHaveBeenCalled();
  });

  it('source cell changes outside the pivot source range do not refresh', async () => {
    const ctx = createMockCtx();
    ctx.computeBridge.pivotGetAll.mockResolvedValue([makePivotConfig()]);
    new PivotBridge(ctx);

    ctx.eventBus.emit({
      type: 'cell:changed',
      sheetId: SHEET_ID,
      row: 200,
      col: 1,
      oldValue: undefined,
      newValue: 150,
      source: 'user',
      timestamp: Date.now(),
    });

    await flushPromises();

    expect(ctx.computeBridge.pivotMaterialize).not.toHaveBeenCalled();
    expect(ctx.computeBridge.forceRefreshAllViewports).not.toHaveBeenCalled();
    expect(ctx.computeBridge.pivotComputeFromSource).not.toHaveBeenCalled();
  });
});

describe('PivotBridge placement mutations', () => {
  it('moves a placement before an occupied same-area target and preserves placement settings', async () => {
    const { bridge, getConfig } = createMutationBridge(
      makePivotConfig({
        placements: [
          { placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 },
          {
            placementId: 'row:Vendor:1',
            fieldId: 'Vendor',
            area: 'row',
            position: 1,
            sortOrder: 'desc',
            customSortList: ['Contoso', 'Fabrikam'],
            showSubtotals: false,
            displayName: 'Vendor label',
            numberFormat: '@',
          },
          { placementId: 'row:Region:2', fieldId: 'Region', area: 'row', position: 2 },
        ],
      }),
    );

    await bridge.movePlacement('pivot-1', 'row:Vendor:1' as any, 'row', 0);

    const rows = sortedPlacements(getConfig().placements, 'row');
    expect(rows.map((placement) => placement.placementId)).toEqual([
      'row:Vendor:1',
      'row:Month:0',
      'row:Region:2',
    ]);
    expect(rows.map((placement) => placement.position)).toEqual([0, 1, 2]);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        placementId: 'row:Vendor:1',
        fieldId: 'Vendor',
        sortOrder: 'desc',
        customSortList: ['Contoso', 'Fabrikam'],
        showSubtotals: false,
        displayName: 'Vendor label',
        numberFormat: '@',
      }),
    );
  });

  it('moves a same-area placement after the requested target index', async () => {
    const { bridge, getConfig } = createMutationBridge(
      makePivotConfig({
        placements: [
          { placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 },
          { placementId: 'row:Vendor:1', fieldId: 'Vendor', area: 'row', position: 1 },
          { placementId: 'row:Region:2', fieldId: 'Region', area: 'row', position: 2 },
        ],
      }),
    );

    await bridge.movePlacement('pivot-1', 'row:Month:0' as any, 'row', 2);

    expect(placementOrder(getConfig().placements, 'row')).toEqual([
      'row:Vendor:1',
      'row:Region:2',
      'row:Month:0',
    ]);
    expect(
      sortedPlacements(getConfig().placements, 'row').map((placement) => placement.position),
    ).toEqual([0, 1, 2]);
  });

  it('moves a placement across areas at the requested index and renumbers both areas', async () => {
    const { bridge, getConfig } = createMutationBridge(
      makePivotConfig({
        placements: [
          { placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 },
          { placementId: 'row:Vendor:1', fieldId: 'Vendor', area: 'row', position: 1 },
          { placementId: 'column:Quarter:0', fieldId: 'Quarter', area: 'column', position: 0 },
          { placementId: 'column:Region:1', fieldId: 'Region', area: 'column', position: 1 },
        ],
      }),
    );

    await bridge.movePlacement('pivot-1', 'row:Vendor:1' as any, 'column', 1);

    expect(placementOrder(getConfig().placements, 'row')).toEqual(['row:Month:0']);
    expect(
      sortedPlacements(getConfig().placements, 'row').map((placement) => placement.position),
    ).toEqual([0]);
    expect(placementOrder(getConfig().placements, 'column')).toEqual([
      'column:Quarter:0',
      'row:Vendor:1',
      'column:Region:1',
    ]);
    expect(
      sortedPlacements(getConfig().placements, 'column').map((placement) => placement.position),
    ).toEqual([0, 1, 2]);
  });

  it('moves duplicate value placements by placement id without colliding', async () => {
    const { bridge, getConfig } = createMutationBridge(
      makePivotConfig({
        placements: [
          {
            placementId: 'value:Amount:sum',
            fieldId: 'Amount',
            area: 'value',
            position: 0,
            aggregateFunction: 'sum',
            displayName: 'Sum of Amount',
          },
          {
            placementId: 'value:Amount:count',
            fieldId: 'Amount',
            area: 'value',
            position: 1,
            aggregateFunction: 'count',
            displayName: 'Count of Amount',
          },
        ],
      }),
    );

    await bridge.movePlacement('pivot-1', 'value:Amount:count' as any, 'value', 0);

    const values = sortedPlacements(getConfig().placements, 'value');
    expect(values.map((placement) => placement.placementId)).toEqual([
      'value:Amount:count',
      'value:Amount:sum',
    ]);
    expect(values.map((placement) => placement.aggregateFunction)).toEqual(['count', 'sum']);
    expect(values.map((placement) => placement.displayName)).toEqual([
      'Count of Amount',
      'Sum of Amount',
    ]);
  });

  it('sets and clears sort order only on the requested placement', async () => {
    const { bridge, getConfig } = createMutationBridge(
      makePivotConfig({
        placements: [
          { placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 },
          {
            placementId: 'row:Vendor:1',
            fieldId: 'Vendor',
            area: 'row',
            position: 1,
            sortOrder: 'asc',
          },
        ],
      }),
    );

    await bridge.setSortOrder('pivot-1', 'row:Month:0' as any, 'desc');

    expect(sortedPlacements(getConfig().placements, 'row')).toEqual([
      expect.objectContaining({ placementId: 'row:Month:0', sortOrder: 'desc' }),
      expect.objectContaining({ placementId: 'row:Vendor:1', sortOrder: 'asc' }),
    ]);

    await bridge.setSortOrder('pivot-1', 'row:Month:0' as any, null);

    expect(sortedPlacements(getConfig().placements, 'row')).toEqual([
      expect.not.objectContaining({ sortOrder: expect.anything() }),
      expect.objectContaining({ placementId: 'row:Vendor:1', sortOrder: 'asc' }),
    ]);
  });

  it('sets and clears value sorting on the axis placement while preserving duplicate value identity', async () => {
    const { bridge, getConfig } = createMutationBridge(
      makePivotConfig({
        placements: [
          {
            placementId: 'row:Region:0',
            fieldId: 'Region',
            area: 'row',
            position: 0,
            sortByValue: {
              valueFieldId: 'Amount',
              valuePlacementId: 'value:Amount:sum',
              order: 'asc',
            },
          },
          { placementId: 'row:Vendor:1', fieldId: 'Vendor', area: 'row', position: 1 },
          {
            placementId: 'value:Amount:sum',
            fieldId: 'Amount',
            area: 'value',
            position: 0,
            aggregateFunction: 'sum',
          },
          {
            placementId: 'value:Amount:count',
            fieldId: 'Amount',
            area: 'value',
            position: 1,
            aggregateFunction: 'count',
          },
        ],
      }),
    );

    await bridge.setSortByValue('pivot-1', 'row:Vendor:1' as any, 'value:Amount:count' as any, {
      order: 'desc',
      columnKey: 'FY2026',
    });

    expect(sortedPlacements(getConfig().placements, 'row')).toEqual([
      expect.objectContaining({
        placementId: 'row:Region:0',
        sortByValue: expect.objectContaining({
          valueFieldId: 'Amount',
          valuePlacementId: 'value:Amount:sum',
          order: 'asc',
        }),
      }),
      expect.objectContaining({
        placementId: 'row:Vendor:1',
        sortByValue: {
          valueFieldId: 'Amount',
          valuePlacementId: 'value:Amount:count',
          order: 'desc',
          columnKey: 'FY2026',
        },
      }),
    ]);

    await bridge.setSortByValue(
      'pivot-1',
      'row:Vendor:1' as any,
      'value:Amount:count' as any,
      null,
    );

    expect(sortedPlacements(getConfig().placements, 'row')).toEqual([
      expect.objectContaining({
        placementId: 'row:Region:0',
        sortByValue: expect.objectContaining({ valuePlacementId: 'value:Amount:sum' }),
      }),
      expect.not.objectContaining({ sortByValue: expect.anything() }),
    ]);
  });
});

describe('PivotBridge Rust DTO boundary', () => {
  it('normalizes optional OOXML item vectors to arrays before pivotCreate', async () => {
    const ctx = createMockCtx();
    const bridge = new PivotBridge(ctx);

    await bridge.createPivot({
      schemaVersion: 2,
      id: 'PivotSales',
      name: 'PivotSales',
      sourceSheetId: SHEET_ID,
      sourceSheetName: 'Sheet1',
      sourceRange: { startRow: 0, startCol: 0, endRow: 2, endCol: 1 },
      outputSheetName: 'Sheet1',
      outputLocation: { row: 4, col: 0 },
      fields: [
        { id: 'col0', name: 'Region', sourceColumn: 0, dataType: 'string' },
        { id: 'col1', name: 'Sales', sourceColumn: 1, dataType: 'number' },
      ],
      placements: [],
      filters: [],
      layout: { showRowGrandTotals: true, showColumnGrandTotals: true, layoutForm: 'compact' },
    });

    expect(ctx.computeBridge.pivotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        rowItems: [],
        colItems: [],
      }),
    );
  });

  it('strips calculated-field formulas for Rust and restores display formulas for public configs', async () => {
    const ctx = createMockCtx();
    const bridge = new PivotBridge(ctx);
    const config = makePivotConfig({
      calculatedFields: [
        {
          fieldId: 'CalcMargin',
          calculatedFieldId: 'CalcMargin',
          name: 'Margin',
          formula: '=Amount / 2',
        },
      ],
    });

    await bridge.createPivot(config);

    expect(ctx.computeBridge.pivotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        calculatedFields: [
          expect.objectContaining({
            fieldId: 'CalcMargin',
            formula: 'Amount / 2',
          }),
        ],
      }),
    );

    ctx.computeBridge.pivotGet.mockResolvedValue({
      ...config,
      calculatedFields: [
        {
          fieldId: 'CalcMargin',
          calculatedFieldId: 'CalcMargin',
          name: 'Margin',
          formula: 'Amount / 2',
        },
      ],
    });

    await expect(bridge.getPivot(SHEET_ID, 'pivot-1')).resolves.toEqual(
      expect.objectContaining({
        calculatedFields: [
          expect.objectContaining({
            fieldId: 'CalcMargin',
            formula: '=Amount / 2',
          }),
        ],
      }),
    );
  });
});
