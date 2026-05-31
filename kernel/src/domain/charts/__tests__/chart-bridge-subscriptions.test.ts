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
  handleRowsInserted,
  setupChartBridgeSubscriptions,
} from '../bridge/chart-bridge-subscriptions';

const SHEET_A: SheetId = toSheetId('sheet-a');
const SHEET_B: SheetId = toSheetId('sheet-b');
const CHART_1 = 'chart-1';
const CHART_2 = 'chart-2';

type TestEvent = { type: string; [key: string]: unknown };
type Handler = (event: TestEvent) => void;

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
    chartIdsForSheet: jest.fn(() => []),
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
    let resolveSheetOrder: (sheetIds: SheetId[]) => void = () => {};
    const deps = createDeps({
      ctx: {
        computeBridge: {
          getSheetOrder: jest.fn(
            () =>
              new Promise<SheetId[]>((resolve) => {
                resolveSheetOrder = resolve;
              }),
          ),
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
    resolveSheetOrder([SHEET_A]);
    await flushAsyncHandlers();

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

    expect(deps.renderCache.deleteSheetId).toHaveBeenCalledWith(CHART_1);
    expect(deps.renderCache.deleteChartCaches).toHaveBeenCalledWith(CHART_1, SHEET_A);
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
              : [chart({ id: CHART_2, dataRange: 'B5:F11', sheetId: SHEET_B as unknown as string })],
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

    expect(computeBridge.updateChart).toHaveBeenNthCalledWith(1, SHEET_A, CHART_1, {
      dataRange: 'B2:C6',
    });
    expect(computeBridge.updateChart).toHaveBeenNthCalledWith(2, SHEET_A, CHART_2, {
      dataRange: 'C2:D4',
    });
    expect(deps.invalidateChart).toHaveBeenCalledWith(CHART_1, SHEET_A);
    expect(deps.invalidateChart).toHaveBeenCalledWith(CHART_2, SHEET_A);
  });
});
