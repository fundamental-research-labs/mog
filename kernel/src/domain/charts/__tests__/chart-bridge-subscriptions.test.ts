import { jest } from '@jest/globals';

import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type { IEventBus } from '@mog-sdk/contracts/events';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../../context/types';
import type {
  ChartBridgeSubscriptionContext,
  ChartBridgeSubscriptionRenderCache,
} from '../bridge/chart-bridge-subscriptions';
import {
  getChartsAffectedByRange,
  handleColumnsDeleted,
  handleRowsDeleted,
  handleRowsInserted,
  setupChartBridgeSubscriptions,
} from '../bridge/chart-bridge-subscriptions';

const SHEET_A: SheetId = toSheetId('sheet-a');
const SHEET_B: SheetId = toSheetId('sheet-b');
const CHART_1 = 'chart-1';
const CHART_2 = 'chart-2';

type TestEvent = { type: string; [key: string]: unknown };
type Handler = (event: TestEvent) => void;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createTestEventBus(): IEventBus & {
  handlers: Map<string, Set<Handler>>;
  emitAny(event: TestEvent): void;
} {
  const handlers = new Map<string, Set<Handler>>();
  const emitAny = (event: TestEvent) => {
    handlers.get(event.type)?.forEach((handler) => handler(event));
  };
  return {
    handlers,
    on: ((type: string, handler: Handler) => {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => set!.delete(handler);
    }) as IEventBus['on'],
    onMany: () => () => {},
    onAll: () => () => {},
    emit: emitAny as IEventBus['emit'],
    emitBatch: () => {},
    clear: () => handlers.clear(),
    emitAny,
  } as unknown as IEventBus & {
    handlers: Map<string, Set<Handler>>;
    emitAny(event: TestEvent): void;
  };
}

function chart(overrides: Partial<ChartFloatingObject> = {}): ChartFloatingObject {
  return {
    id: CHART_1,
    type: 'chart',
    chartType: 'bar',
    sheetId: SHEET_A as unknown as string,
    dataRange: 'A1:B2',
    ...overrides,
  } as unknown as ChartFloatingObject;
}

function createMockRenderCache(): jest.Mocked<ChartBridgeSubscriptionRenderCache> {
  return {
    getSheetId: jest.fn(),
    setSheetId: jest.fn(),
    deleteSheetId: jest.fn(),
    deleteSheet: jest.fn(() => []),
    deleteChartCaches: jest.fn(),
    syncImportRenderStatus: jest.fn(() => false),
  };
}

function createDeps(
  overrides: {
    ctx?: Partial<DocumentContext>;
    renderCache?: jest.Mocked<ChartBridgeSubscriptionRenderCache>;
    isLive?: jest.Mock<() => boolean>;
    invalidateChart?: jest.Mock<(chartId: string, sheetId?: SheetId) => void>;
    clearAllCaches?: jest.Mock<() => void>;
  } = {},
): ChartBridgeSubscriptionContext & {
  ctx: DocumentContext;
  renderCache: jest.Mocked<ChartBridgeSubscriptionRenderCache>;
  invalidateChart: jest.Mock<(chartId: string, sheetId?: SheetId) => void>;
  clearAllCaches: jest.Mock<() => void>;
} {
  const eventBus = createTestEventBus();
  const baseComputeBridge = {
    getSheetOrder: jest.fn(async () => [SHEET_A]),
    getAllCharts: jest.fn(async () => []),
    updateChart: jest.fn(async () => undefined),
    getSheetName: jest.fn(async (sheetId: SheetId) =>
      sheetId === SHEET_A ? 'Sheet A' : sheetId === SHEET_B ? 'Sheet B' : undefined,
    ),
  };
  const overrideComputeBridge =
    (overrides.ctx?.computeBridge as Partial<typeof baseComputeBridge> | undefined) ?? {};
  const ctx = {
    eventBus,
    ...overrides.ctx,
    computeBridge: {
      ...baseComputeBridge,
      ...overrideComputeBridge,
    },
  } as unknown as DocumentContext;

  return {
    ctx,
    renderCache: overrides.renderCache ?? createMockRenderCache(),
    isLive: overrides.isLive ?? jest.fn(() => true),
    invalidateChart: overrides.invalidateChart ?? jest.fn(),
    clearAllCaches: overrides.clearAllCaches ?? jest.fn(),
  };
}

async function flushAsyncHandlers(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function computeBridgeMock(ctx: DocumentContext): {
  getSheetOrder: jest.Mock;
  getAllCharts: jest.Mock;
  updateChart: jest.Mock;
  getSheetName: jest.Mock;
} {
  return ctx.computeBridge as unknown as {
    getSheetOrder: jest.Mock;
    getAllCharts: jest.Mock;
    updateChart: jest.Mock;
    getSheetName: jest.Mock;
  };
}

function expectChartMutationOptions(operationIdPrefix: string) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(new RegExp(`^${escapeRegExp(operationIdPrefix)}:`)),
      kind: 'mutation',
      sheetIds: [SHEET_A],
      domainIds: ['charts.source-range'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    }),
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('setupChartBridgeSubscriptions', () => {
  it('routes workbook theme changes through the full bridge cache clear callback', () => {
    const deps = createDeps();
    const cleanup = setupChartBridgeSubscriptions(deps);

    deps.ctx.eventBus.emit({
      type: 'workbook:theme-changed',
      oldThemeId: undefined,
      newThemeId: 'office',
      source: 'local',
    } as never);

    expect(deps.clearAllCaches).toHaveBeenCalledTimes(1);

    cleanup();
    deps.ctx.eventBus.emit({
      type: 'workbook:theme-changed',
      oldThemeId: 'office',
      newThemeId: 'custom',
      source: 'local',
    } as never);

    expect(deps.clearAllCaches).toHaveBeenCalledTimes(1);
  });

  it('deactivates in-flight fire-and-forget handlers when cleaned up', async () => {
    const sheetOrder = deferred<SheetId[]>();
    const deps = createDeps({
      ctx: {
        computeBridge: {
          getSheetOrder: jest.fn(() => sheetOrder.promise),
        } as never,
      },
    });

    const cleanup = setupChartBridgeSubscriptions(deps);
    deps.ctx.eventBus.emit({
      type: 'cell:changed',
      sheetId: SHEET_A as unknown as string,
      row: 1,
      col: 1,
      oldValue: undefined,
      newValue: undefined,
      source: 'local',
    } as never);

    cleanup();
    sheetOrder.resolve([SHEET_A]);
    await flushAsyncHandlers();

    expect(deps.invalidateChart).not.toHaveBeenCalled();
  });

  it('deactivates in-flight batch change handlers when cleaned up', async () => {
    const sheetOrder = deferred<SheetId[]>();
    const deps = createDeps({
      ctx: {
        computeBridge: {
          getSheetOrder: jest.fn(() => sheetOrder.promise),
          getAllCharts: jest.fn(async () => [chart()]),
        } as never,
      },
    });

    const cleanup = setupChartBridgeSubscriptions(deps);
    deps.ctx.eventBus.emit({
      type: 'cells:batch-changed',
      sheetId: SHEET_A as unknown as string,
      changes: [
        { row: 1, col: 1, oldValue: undefined, newValue: 10 },
        { row: 2, col: 2, oldValue: undefined, newValue: 20 },
      ],
      source: 'local',
    } as never);

    cleanup();
    sheetOrder.resolve([SHEET_A]);
    await flushAsyncHandlers();

    expect(deps.invalidateChart).not.toHaveBeenCalled();
  });

  it('invalidates the chart owner sheet for cross-sheet batch range references', async () => {
    const deps = createDeps({
      ctx: {
        computeBridge: {
          getSheetOrder: jest.fn(async () => [SHEET_A, SHEET_B]),
          getAllCharts: jest.fn(async (sheetId: SheetId) =>
            sheetId === SHEET_B
              ? [
                  chart({
                    id: CHART_2,
                    sheetId: SHEET_B as unknown as string,
                    dataRange: '',
                    series: [
                      {
                        name: 'Cross sheet',
                        values: "'Sheet A'!B2:B4",
                        categories: "'Sheet A'!A2:A4",
                      },
                    ],
                  } as never),
                ]
              : [],
          ),
        } as never,
      },
    });

    setupChartBridgeSubscriptions(deps);
    deps.ctx.eventBus.emit({
      type: 'cells:batch-changed',
      sheetId: SHEET_A as unknown as string,
      changes: [{ row: 2, col: 1, oldValue: undefined, newValue: 42 }],
      source: 'local',
    } as never);
    await flushAsyncHandlers();

    expect(deps.invalidateChart).toHaveBeenCalledWith(CHART_2, SHEET_B);
  });

  it.each([
    ['rows:inserted', { startRow: 2, count: 1 }],
    ['rows:deleted', { startRow: 2, count: 1 }],
    ['columns:inserted', { startCol: 2, count: 1 }],
    ['columns:deleted', { startCol: 2, count: 1 }],
  ])('deactivates in-flight %s handlers when cleaned up', async (type, eventFields) => {
    const charts = deferred<ChartFloatingObject[]>();
    const deps = createDeps({
      ctx: {
        computeBridge: {
          getAllCharts: jest.fn(() => charts.promise),
        } as never,
      },
    });
    const computeBridge = computeBridgeMock(deps.ctx);

    const cleanup = setupChartBridgeSubscriptions(deps);
    deps.ctx.eventBus.emit({
      type,
      sheetId: SHEET_A as unknown as string,
      source: 'local',
      ...eventFields,
    } as never);

    cleanup();
    charts.resolve([chart({ id: CHART_1, dataRange: 'B2:C4' })]);
    await flushAsyncHandlers();

    expect(computeBridge.updateChart).not.toHaveBeenCalled();
    expect(deps.invalidateChart).not.toHaveBeenCalled();
  });

  it('keeps chart sheet index and caches in sync for floating-object events', () => {
    const deps = createDeps();
    setupChartBridgeSubscriptions(deps);

    deps.ctx.eventBus.emit({
      type: 'floatingObject:created',
      sheetId: SHEET_A as unknown as string,
      containerId: SHEET_A as unknown as string,
      objectId: CHART_1,
      objectType: 'chart',
      source: 'local',
    } as never);

    expect(deps.renderCache.setSheetId).toHaveBeenCalledWith(CHART_1, SHEET_A);
    expect(deps.renderCache.syncImportRenderStatus).toHaveBeenCalledWith(
      CHART_1,
      undefined,
      SHEET_A,
    );
    expect(deps.invalidateChart).toHaveBeenCalledWith(CHART_1, SHEET_A);

    deps.ctx.eventBus.emit({
      type: 'floatingObject:deleted',
      sheetId: SHEET_A as unknown as string,
      containerId: SHEET_A as unknown as string,
      objectId: CHART_1,
      objectType: 'chart',
      source: 'local',
    } as never);

    expect(deps.renderCache.deleteSheetId).toHaveBeenCalledWith(CHART_1, SHEET_A);
    expect(deps.renderCache.deleteChartCaches).toHaveBeenCalledWith(CHART_1, SHEET_A);
  });

  it('uses floating-object container identity and evicts old chart context on sheet moves', () => {
    const deps = createDeps();
    deps.renderCache.getSheetId.mockReturnValue(SHEET_A);
    setupChartBridgeSubscriptions(deps);
    const data = { type: 'chart' };

    deps.ctx.eventBus.emit({
      type: 'floatingObject:updated',
      sheetId: SHEET_A as unknown as string,
      containerId: SHEET_B as unknown as string,
      previousSheetId: SHEET_A as unknown as string,
      previousContainerId: SHEET_A as unknown as string,
      objectId: CHART_1,
      data,
      changes: {},
      changedFields: ['anchorRow', 'anchorCol'],
      source: 'local',
    } as never);

    expect(deps.renderCache.deleteSheetId).toHaveBeenCalledWith(CHART_1, SHEET_A);
    expect(deps.renderCache.deleteChartCaches).toHaveBeenCalledWith(CHART_1, SHEET_A);
    expect(deps.renderCache.setSheetId).toHaveBeenCalledWith(CHART_1, SHEET_B);
    expect(deps.renderCache.syncImportRenderStatus).toHaveBeenCalledWith(CHART_1, data, SHEET_B);
    expect(deps.invalidateChart).toHaveBeenCalledWith(CHART_1, SHEET_B);
    expect(deps.invalidateChart).not.toHaveBeenCalledWith(CHART_1, SHEET_A);
  });

  it('routes sheet deletion through the render-cache sheet lifecycle API', () => {
    const deps = createDeps();
    setupChartBridgeSubscriptions(deps);

    deps.ctx.eventBus.emit({
      type: 'sheet:deleted',
      sheetId: SHEET_A as unknown as string,
      source: 'local',
    } as never);

    expect(deps.renderCache.deleteSheet).toHaveBeenCalledWith(SHEET_A);
    expect(deps.renderCache.deleteSheetId).not.toHaveBeenCalled();
    expect(deps.renderCache.deleteChartCaches).not.toHaveBeenCalled();
  });

  it('preserves terminal import-status and position-only update precedence', () => {
    const deps = createDeps();
    deps.renderCache.syncImportRenderStatus.mockReturnValueOnce(true);
    setupChartBridgeSubscriptions(deps);
    const terminalStatus = {
      importStatus: { renderable: false, message: 'Imported chart cannot render' },
    };

    deps.ctx.eventBus.emit({
      type: 'floatingObject:created',
      sheetId: SHEET_A as unknown as string,
      containerId: SHEET_A as unknown as string,
      objectId: CHART_1,
      objectType: 'chart',
      data: terminalStatus,
      source: 'local',
    } as never);

    expect(deps.renderCache.syncImportRenderStatus).toHaveBeenCalledWith(
      CHART_1,
      terminalStatus,
      SHEET_A,
    );
    expect(deps.invalidateChart).not.toHaveBeenCalled();

    deps.ctx.eventBus.emit({
      type: 'floatingObject:updated',
      sheetId: SHEET_A as unknown as string,
      containerId: SHEET_A as unknown as string,
      objectId: CHART_1,
      data: { type: 'chart' },
      changes: {},
      changedFields: ['anchorRow', 'anchorCol', 'width', 'height'],
      source: 'local',
    } as never);

    expect(deps.invalidateChart).not.toHaveBeenCalled();
  });
});

describe('chart bridge subscription range helpers', () => {
  it('finds workbook charts whose top-level resolved ranges overlap the changed range', async () => {
    const deps = createDeps({
      ctx: {
        computeBridge: {
          getSheetOrder: jest.fn(async () => [SHEET_A, SHEET_B]),
          getAllCharts: jest.fn(async (sheetId: SheetId) =>
            sheetId === SHEET_A
              ? [chart({ id: CHART_1, dataRange: 'B5:F11', sheetId: SHEET_A as unknown as string })]
              : [
                  chart({
                    id: CHART_2,
                    dataRange: 'B5:F11',
                    sheetId: SHEET_B as unknown as string,
                  }),
                ],
          ),
        } as never,
      },
    });

    await expect(
      getChartsAffectedByRange(deps.ctx, SHEET_A, {
        sheetId: SHEET_A,
        startRow: 7,
        startCol: 2,
        endRow: 8,
        endCol: 3,
      }),
    ).resolves.toEqual([CHART_1]);
  });

  it('finds charts whose explicit series and bubble-size ranges overlap the changed range', async () => {
    const deps = createDeps({
      ctx: {
        computeBridge: {
          getSheetOrder: jest.fn(async () => [SHEET_A, SHEET_B]),
          getAllCharts: jest.fn(async (sheetId: SheetId) =>
            sheetId === SHEET_B
              ? [
                  chart({
                    id: CHART_2,
                    sheetId: SHEET_B as unknown as string,
                    dataRange: '',
                    series: [
                      {
                        name: 'Bubbles',
                        values: "'Sheet A'!B2:B4",
                        categories: "'Sheet A'!A2:A4",
                        bubbleSize: "'Sheet A'!C2:C4",
                      },
                    ],
                  } as never),
                ]
              : [],
          ),
        } as never,
      },
    });

    await expect(
      getChartsAffectedByRange(deps.ctx, SHEET_A, {
        sheetId: SHEET_A,
        startRow: 3,
        startCol: 2,
        endRow: 3,
        endCol: 2,
      }),
    ).resolves.toEqual([CHART_2]);
  });

  it('updates A1 row and column ranges through chart-store and invalidates affected charts', async () => {
    const deps = createDeps();
    const computeBridge = computeBridgeMock(deps.ctx);
    computeBridge.getAllCharts
      .mockResolvedValueOnce([
        chart({ id: CHART_1, dataRange: 'B2:C4' }),
        chart({ id: 'identity-chart', dataRange: 'B2:C4', dataRangeIdentity: {} as never }),
      ])
      .mockResolvedValueOnce([chart({ id: CHART_2, dataRange: 'C2:E4' })]);

    await handleRowsInserted(deps, SHEET_A, 2, 2);
    await handleColumnsDeleted(deps, SHEET_A, 3, 1);

    expect(computeBridge.updateChart).toHaveBeenNthCalledWith(
      1,
      SHEET_A,
      CHART_1,
      {
        dataRange: 'B2:C6',
      },
      expectChartMutationOptions('charts.update'),
    );
    expect(computeBridge.updateChart).toHaveBeenNthCalledWith(
      2,
      SHEET_A,
      CHART_2,
      {
        dataRange: 'C2:D4',
      },
      expectChartMutationOptions('charts.update'),
    );
    expect(deps.invalidateChart).toHaveBeenCalledWith(CHART_1, SHEET_A);
    expect(deps.invalidateChart).toHaveBeenCalledWith(CHART_2, SHEET_A);
  });

  it('updates every explicit A1 range surface on row and column structural changes', async () => {
    const deps = createDeps();
    const computeBridge = computeBridgeMock(deps.ctx);
    computeBridge.getAllCharts
      .mockResolvedValueOnce([
        chart({
          id: CHART_1,
          dataRange: 'B2:C4',
          categoryRange: 'A2:A4',
          seriesRange: 'B1:C1',
          series: [
            {
              name: 'Series 1',
              values: 'B2:B4',
              categories: "'Sheet A'!A2:A4",
              bubbleSize: 'D2:D4',
            },
          ],
        } as never),
      ])
      .mockResolvedValueOnce([
        chart({
          id: CHART_2,
          dataRange: 'C2:E4',
          categoryRange: 'C2:C4',
          seriesRange: 'C1:E1',
          series: [
            {
              name: 'Series 2',
              values: 'D2:E4',
              categories: 'C2:C4',
              bubbleSize: "'Sheet A'!E2:E4",
            },
          ],
        } as never),
      ]);

    await handleRowsInserted(deps, SHEET_A, 2, 2);
    await handleColumnsDeleted(deps, SHEET_A, 3, 1);

    expect(computeBridge.updateChart).toHaveBeenNthCalledWith(
      1,
      SHEET_A,
      CHART_1,
      expect.objectContaining({
        dataRange: 'B2:C6',
        categoryRange: 'A2:A6',
        series: [
          expect.objectContaining({
            values: 'B2:B6',
            categories: "'Sheet A'!A2:A6",
            bubbleSize: 'D2:D6',
          }),
        ],
      }),
      expectChartMutationOptions('charts.update'),
    );
    expect(computeBridge.updateChart).toHaveBeenNthCalledWith(
      2,
      SHEET_A,
      CHART_2,
      expect.objectContaining({
        dataRange: 'C2:D4',
        seriesRange: 'C1:D1',
        series: [
          expect.objectContaining({
            values: 'D2:D4',
            categories: 'C2:C4',
            bubbleSize: "'Sheet A'!D2:D4",
          }),
        ],
      }),
      expectChartMutationOptions('charts.update'),
    );
    expect(deps.invalidateChart).toHaveBeenCalledWith(CHART_1, SHEET_A);
    expect(deps.invalidateChart).toHaveBeenCalledWith(CHART_2, SHEET_A);
  });

  it('sheet-scopes row-deletion invalidation when the deleted rows are before the chart range', async () => {
    const deps = createDeps();
    const computeBridge = computeBridgeMock(deps.ctx);
    computeBridge.getAllCharts.mockResolvedValueOnce([chart({ id: CHART_1, dataRange: 'B5:C7' })]);

    await handleRowsDeleted(deps, SHEET_A, 1, 2);

    expect(computeBridge.updateChart).toHaveBeenCalledWith(
      SHEET_A,
      CHART_1,
      {
        dataRange: 'B3:C5',
      },
      expectChartMutationOptions('charts.update'),
    );
    expect(deps.invalidateChart).toHaveBeenCalledWith(CHART_1, SHEET_A);
    expect(deps.invalidateChart).not.toHaveBeenCalledWith(CHART_1, undefined);
  });
});
