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

function createMockCtx(): any {
  const handlers = new Map<string, Array<(event: any) => void>>();
  return {
    computeBridge: {
      getMutationHandler: jest.fn(() => null),
      pivotCreate: jest.fn(async (config: unknown) => ({ data: config })),
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

describe('PivotBridge read vs refresh paths', () => {
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
});
