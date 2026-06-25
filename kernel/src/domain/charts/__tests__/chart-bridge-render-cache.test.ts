/**
 * Chart Bridge — Sync Paint Contract Tests
 *
 * Covers the renderCached / onCacheUpdate / ensureCompiled triad that
 * replaced the async render() — the async chart paint canvas-state invariant.
 *
 * The legacy `render()` was async and the canvas dispatch loop discarded the
 * returned Promise. By the time the await chain resolved the engine had
 * restored its `(viewport.x, viewport.y)` translate, so the chart painted in
 * the wrong canvas frame. The tests here lock in the sync-from-cache
 * contract so the class of bug doesn't reappear.
 */

import { jest } from '@jest/globals';

// Mock chart store / range reference modules so the bridge doesn't try to talk
// to the real ComputeBridge in tests that exercise the production compile path.
jest.mock('../chart-store', () => ({
  get: jest.fn(),
  getAll: jest.fn(async () => [] as unknown[]),
  update: jest.fn(),
}));

jest.mock('../chart-range-references', () => ({
  resolveChartRangeReferences: jest.fn(),
}));

// Mock cell-reads so the cell-accessor pre-fetch returns null cleanly
// without needing a real document.
jest.mock('../../cells/cell-reads', () => ({
  getValue: jest.fn(async () => null),
}));

import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type { ChartLayoutSnapshot, ChartMark } from '@mog-sdk/contracts/bridges';
import type {
  FloatingObjectCreatedEvent,
  FloatingObjectDeletedEvent,
  FloatingObjectUpdatedEvent,
  IEventBus,
  SheetDeletedEvent,
} from '@mog-sdk/contracts/events';
import type { ChartExportOptionsSnapshot } from '@mog-sdk/contracts/data/charts';

import type { DocumentContext } from '../../../context/types';
import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { ChartBridge } from '../chart-bridge';
import type { ChartRenderCache } from '../bridge/chart-render-cache';
import { normalizeChartRenderFrame } from '../bridge/chart-render-frame';

const SHEET_A: SheetId = toSheetId('sheet-a');
const SHEET_B: SheetId = toSheetId('sheet-b');
const CHART_1 = 'chart-1';
const CHART_2 = 'chart-2';
type ChartObjectWithImportStatus = ChartFloatingObject & { importStatus?: unknown };

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

function createTestEventBus(): IEventBus & { handlers: Map<string, Set<Function>> } {
  const handlers = new Map<string, Set<Function>>();
  const bus = {
    handlers,
    on: ((type: string, handler: Function) => {
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
    emit: (event: { type: string }) => {
      handlers.get(event.type)?.forEach((h) => h(event));
    },
    emitBatch: () => {},
    clear: () => handlers.clear(),
  } as unknown as IEventBus & { handlers: Map<string, Set<Function>> };
  return bus;
}

function createTestCtx() {
  const eventBus = createTestEventBus();
  const ctx = { eventBus } as unknown as DocumentContext;
  return { ctx, eventBus };
}

function getRenderCache(bridge: ChartBridge): ChartRenderCache {
  return (bridge as unknown as { renderCache: ChartRenderCache }).renderCache;
}

/**
 * In-memory canvas-context recorder. Records the order of fillRect /
 * strokeRect / fillText calls so a test can assert what was painted
 * (placeholder vs error vs marks).
 */
type Op =
  | { kind: 'save' }
  | { kind: 'restore' }
  | { kind: 'rotate'; angle: number }
  | { kind: 'translate'; x: number; y: number }
  | { kind: 'fillRect'; x: number; y: number; w: number; h: number; style: string }
  | { kind: 'strokeRect'; x: number; y: number; w: number; h: number; style: string }
  | { kind: 'fillText'; text: string; x: number; y: number };

function createRecordingCtx(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  let fillStyle = '#000';
  let strokeStyle = '#000';
  const ctx = {
    save: () => ops.push({ kind: 'save' }),
    restore: () => ops.push({ kind: 'restore' }),
    set fillStyle(v: string) {
      fillStyle = v;
    },
    get fillStyle() {
      return fillStyle;
    },
    set strokeStyle(v: string) {
      strokeStyle = v;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: (x: number, y: number, w: number, h: number) =>
      ops.push({ kind: 'fillRect', x, y, w, h, style: fillStyle }),
    strokeRect: (x: number, y: number, w: number, h: number) =>
      ops.push({ kind: 'strokeRect', x, y, w, h, style: strokeStyle }),
    fillText: (text: string, x: number, y: number) => ops.push({ kind: 'fillText', text, x, y }),
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    rotate: (angle: number) => ops.push({ kind: 'rotate', angle }),
    translate: (x: number, y: number) => ops.push({ kind: 'translate', x, y }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

function emitChartCreated(
  bus: ReturnType<typeof createTestEventBus>,
  chartId: string,
  sheetId: SheetId,
  data?: ChartObjectWithImportStatus,
): void {
  const event: FloatingObjectCreatedEvent = {
    type: 'floatingObject:created',
    sheetId: sheetId as unknown as string,
    containerId: sheetId as unknown as string,
    objectId: chartId,
    objectType: 'chart',
    source: 'local',
    ...(data ? { data } : {}),
  };
  bus.emit(event);
}

function emitChartDeleted(
  bus: ReturnType<typeof createTestEventBus>,
  chartId: string,
  sheetId: SheetId,
): void {
  const event: FloatingObjectDeletedEvent = {
    type: 'floatingObject:deleted',
    sheetId: sheetId as unknown as string,
    containerId: sheetId as unknown as string,
    objectId: chartId,
    objectType: 'chart',
    source: 'local',
  };
  bus.emit(event);
}

function emitChartUpdated(
  bus: ReturnType<typeof createTestEventBus>,
  chartId: string,
  sheetId: SheetId,
  changedFields: string[],
  data: ChartObjectWithImportStatus | undefined = { type: 'chart' } as never,
  changes: { importStatus?: unknown } = {},
): void {
  const event: FloatingObjectUpdatedEvent = {
    type: 'floatingObject:updated',
    sheetId: sheetId as unknown as string,
    containerId: sheetId as unknown as string,
    objectId: chartId,
    changes: changes as never,
    ...(data ? { data: data as never } : {}),
    changedFields,
    source: 'local',
  };
  bus.emit(event);
}

function emitSheetDeleted(bus: ReturnType<typeof createTestEventBus>, sheetId: SheetId): void {
  const event: SheetDeletedEvent = {
    type: 'sheet:deleted',
    sheetId: sheetId as unknown as string,
    name: 'gone',
    source: 'local',
  };
  bus.emit(event);
}

const fakeChart: ChartFloatingObject = {
  id: CHART_1,
  type: 'chart',
  chartType: 'bar',
  anchor: { anchorRow: 0, anchorCol: 0, anchorCellId: 'cell-0' as never },
  widthCells: 4,
  heightCells: 10,
  dataRange: 'A1:B4',
} as unknown as ChartFloatingObject;

function bounds() {
  return { x: 100, y: 100, width: 200, height: 150 };
}

function renderFrame() {
  return normalizeChartRenderFrame(bounds());
}

beforeEach(() => {
  jest.clearAllMocks();
});

async function flushAsyncHandlers(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

// ---------------------------------------------------------------------------
// sync paint contract
// ---------------------------------------------------------------------------

describe('renderCached — sync paint contract', () => {
  it('paints a placeholder when the index has no entry for the chart', () => {
    const { ctx } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();

    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    // Placeholder: grey fillRect + grey strokeRect + "Chart loading…" label.
    expect(ops.find((o) => o.kind === 'fillRect' && o.style === '#f0f0f0')).toBeDefined();
    expect(ops.find((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBeDefined();
    bridge.stop();
  });

  it('paints from the marks cache without awaiting (cache hit is synchronous)', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    // Pretend a previous compile populated the cache and committed cleanly.
    getRenderCache(bridge).commitMarks(CHART_1, [], { sheetId: SHEET_A, frame: renderFrame() });

    const spy = jest.spyOn(bridge, 'ensureCompiled');
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    expect(spy).not.toHaveBeenCalled();
    expect(ops.find((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBeUndefined();
    bridge.stop();
  });

  it('cache miss paints placeholder and triggers ensureCompiled', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const frame = renderFrame();
    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled').mockResolvedValue(undefined);
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    expect(ensureSpy).toHaveBeenCalledWith(CHART_1, SHEET_A, frame);
    expect(ops.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(true);
    bridge.stop();
  });

  it('cache miss with compile already pending paints placeholder without spawning another compile', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    getRenderCache(bridge).beginCompilation(CHART_1, SHEET_A);

    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled').mockResolvedValue(undefined);
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds(), SHEET_A);

    expect(ensureSpy).not.toHaveBeenCalled();
    expect(ops.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(true);
    bridge.stop();
  });

  it('error precedence: errorCache hit paints error and does NOT retry', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    getRenderCache(bridge).commitError(
      CHART_1,
      {
        code: 'EMPTY_DATA',
        message: 'no data',
        chartId: CHART_1,
      },
      SHEET_A,
    );

    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled');
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    expect(ensureSpy).not.toHaveBeenCalled();
    // renderError uses #f8d7da background — distinguishes it from #f0f0f0 placeholder.
    expect(ops.some((o) => o.kind === 'fillRect' && o.style === '#f8d7da')).toBe(true);
    bridge.stop();
  });

  it('known imported non-renderable chart paints terminal placeholder and does NOT load', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A, {
      ...fakeChart,
      importStatus: {
        state: 'non-renderable',
        message: 'Imported chart type is not renderable',
      },
    });

    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled');
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    expect(ensureSpy).not.toHaveBeenCalled();
    expect(ops.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(false);
    expect(ops.some((o) => o.kind === 'fillRect' && o.style === '#f8d7da')).toBe(true);
    expect(ops.some((o) => o.kind === 'fillText' && o.text.startsWith('Imported chart'))).toBe(
      true,
    );
    bridge.stop();
  });

  it('known imported non-renderable status has precedence over no-sheet-index first paint', () => {
    const { ctx } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    getRenderCache(bridge).syncImportRenderStatus(CHART_1, {
      importStatus: {
        renderable: false,
        message: 'Imported chart cannot be rendered yet',
      },
    });

    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled');
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    expect(ensureSpy).not.toHaveBeenCalled();
    expect(ops.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(false);
    expect(ops.some((o) => o.kind === 'fillRect' && o.style === '#f8d7da')).toBe(true);
    bridge.stop();
  });

  it('floatingObject:updated can populate imported non-renderable terminal status', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A, fakeChart);
    emitChartUpdated(eventBus, CHART_1, SHEET_A, ['importStatus'], {
      ...fakeChart,
      importStatus: { renderable: false, message: 'Imported chart renderer unavailable' },
    });

    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled');
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    expect(ensureSpy).not.toHaveBeenCalled();
    expect(ops.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(false);
    expect(ops.some((o) => o.kind === 'fillText' && o.text.startsWith('Imported chart'))).toBe(
      true,
    );
    bridge.stop();
  });

  it('getMarksAtSize returns known terminal import status without fetching chart data', async () => {
    const { ctx, eventBus } = createTestCtx();
    const computeBridge = {
      getChart: jest.fn(),
    };
    (ctx as unknown as { computeBridge: unknown }).computeBridge = computeBridge;
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A, {
      ...fakeChart,
      importStatus: {
        state: 'non-renderable',
        message: 'Imported chart cannot be exported',
      },
    });

    const result = await bridge.getMarksAtSize(SHEET_A, CHART_1, 600, 400);

    expect('code' in result).toBe(true);
    if (!('code' in result)) return;
    expect(result).toMatchObject({
      code: 'RENDER_FAILED',
      message: 'Imported chart cannot be exported',
      chartId: CHART_1,
      details: {
        importStatus: {
          state: 'non-renderable',
          message: 'Imported chart cannot be exported',
        },
      },
    });
    expect(computeBridge.getChart).not.toHaveBeenCalled();
    bridge.stop();
  });

  it('getRenderSnapshotAtSize returns fetched terminal import status before range resolution', async () => {
    const { ctx } = createTestCtx();
    const chart = {
      ...fakeChart,
      id: CHART_1,
      sheetId: SHEET_A as unknown as string,
      importStatus: {
        renderable: false,
        message: 'ChartEx layout is preserved but not renderable',
      },
    } as unknown as ChartFloatingObject;
    const rangeReferencesMock = jest.requireMock('../chart-range-references') as {
      resolveChartRangeReferences: jest.Mock;
    };
    (ctx as unknown as { computeBridge: unknown }).computeBridge = {
      getChart: jest.fn(async () => chart),
    };
    const bridge = new ChartBridge(ctx);

    const result = await bridge.getRenderSnapshotAtSize(SHEET_A, CHART_1, 600, 400, {
      kind: 'raster',
      format: 'png',
      width: 600,
      height: 400,
      pixelRatio: 1,
      physicalWidth: 600,
      physicalHeight: 400,
      backgroundColor: '#ffffff',
      fittingMode: 'fill',
      frame: {
        exportWidth: 600,
        exportHeight: 400,
        contentX: 0,
        contentY: 0,
        contentWidth: 600,
        contentHeight: 400,
      },
    });

    expect('code' in result).toBe(true);
    if (!('code' in result)) return;
    expect(result).toMatchObject({
      code: 'RENDER_FAILED',
      message: 'ChartEx layout is preserved but not renderable',
      chartId: CHART_1,
      details: {
        importStatus: {
          renderable: false,
          message: 'ChartEx layout is preserved but not renderable',
        },
      },
    });
    expect(rangeReferencesMock.resolveChartRangeReferences).not.toHaveBeenCalled();
  });

  it('export-sized public compiles return marks and diagnostics without mutating UI render caches', async () => {
    const { ctx, eventBus } = createTestCtx();
    const chart: ChartFloatingObject = {
      ...fakeChart,
      id: CHART_1,
      sheetId: SHEET_A as unknown as string,
      chartType: 'bar',
      dataRange: '',
      importStatus: {
        source: 'xlsx',
        recoverability: 'partiallySupported',
        renderability: 'renderable',
        diagnostics: [
          {
            code: 'unsupportedFeature',
            message: 'Pivot chart formatting is preserved for export but not rendered',
          },
        ],
      },
      series: [
        {
          name: 'Revenue',
          values: 'Sheet1!A1:B1',
          categories: 'Sheet1!A2:B2',
        },
      ],
    } as unknown as ChartFloatingObject;
    const range = (row: number) => ({
      sheetId: SHEET_A as unknown as string,
      startRow: row,
      endRow: row,
      startCol: 0,
      endCol: 1,
    });
    const chartStoreMock = jest.requireMock('../chart-store') as {
      get: jest.Mock;
    };
    const rangeReferencesMock = jest.requireMock('../chart-range-references') as {
      resolveChartRangeReferences: jest.Mock;
    };
    const cellReadsMock = jest.requireMock('../../cells/cell-reads') as { getValue: jest.Mock };
    chartStoreMock.get.mockResolvedValue(chart);
    rangeReferencesMock.resolveChartRangeReferences.mockResolvedValue({
      dataRange: null,
      categoryRange: null,
      seriesRange: null,
      seriesReferences: [
        {
          index: 0,
          values: { kind: 'seriesValues', source: 'series', ref: 'Sheet1!A1:B1', range: range(0) },
          categories: {
            kind: 'seriesCategories',
            source: 'series',
            ref: 'Sheet1!A2:B2',
            range: range(1),
          },
        },
      ],
      diagnostics: [],
    });
    cellReadsMock.getValue.mockImplementation(async (_ctx, _sheetId, row, col) => {
      const raw = row === 0 ? [10, 20][col] : row === 1 ? ['Q1', 'Q2'][col] : null;
      return raw ?? null;
    });
    (ctx as unknown as { computeBridge: unknown }).computeBridge = {
      getChart: jest.fn(async () => chart),
      getSheetOrder: jest.fn(async () => [SHEET_A]),
      getSheetName: jest.fn(async () => 'Sheet1'),
      getHiddenRows: jest.fn(async () => []),
      getHiddenColumns: jest.fn(async () => []),
      getCellIdAt: jest.fn(async () => null),
      getProjectionSource: jest.fn(async () => null),
      getCellData: jest.fn(async (_sheetId: SheetId, row: number, col: number) => {
        const raw = row === 0 ? [10, 20][col] : row === 1 ? ['Q1', 'Q2'][col] : null;
        if (typeof raw === 'number') return { value: { type: 'number', value: raw } };
        if (typeof raw === 'string') return { value: { type: 'text', value: raw } };
        return null;
      }),
    };
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const renderCache = getRenderCache(bridge);
    const cachedMarks = [{ type: 'group', children: [] }] as unknown as ChartMark[];
    const cachedLayout: ChartLayoutSnapshot = {
      plotArea: { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
    };
    renderCache.commitMarks(CHART_1, cachedMarks, { sheetId: SHEET_A, layout: cachedLayout });
    renderCache.invalidateChart(CHART_1, SHEET_A);

    const cacheUpdates: string[] = [];
    bridge.onCacheUpdate((chartId) => cacheUpdates.push(chartId));
    const dirtyKeysBefore = renderCache.getDirtyChartKeys();
    const exportOptions: ChartExportOptionsSnapshot = {
      kind: 'raster',
      format: 'png',
      width: 640,
      height: 360,
      physicalWidth: 640,
      physicalHeight: 360,
      pixelRatio: 1,
      backgroundColor: '#ffffff',
      fittingMode: 'fill',
      frame: {
        exportWidth: 640,
        exportHeight: 360,
        contentX: 0,
        contentY: 0,
        contentWidth: 640,
        contentHeight: 360,
      },
    };

    const marksAtSize = await bridge.getMarksAtSize(SHEET_A, CHART_1, 640, 360);
    const snapshot = await bridge.getRenderSnapshotAtSize(
      SHEET_A,
      CHART_1,
      640,
      360,
      exportOptions,
    );

    expect(Array.isArray(marksAtSize)).toBe(true);
    expect('code' in snapshot).toBe(false);
    if (!Array.isArray(marksAtSize) || 'code' in snapshot) return;
    expect(marksAtSize.length).toBeGreaterThan(0);
    expect(snapshot.marks).toEqual(marksAtSize);
    expect(snapshot.resolvedChartSpec.implementation).toMatchObject({
      renderAuthority: 'chartBridge',
      renderStatus: 'renderable',
      compilerPathId: 'ts-grammar',
    });
    expect(snapshot.resolvedChartSpec.export).toEqual(exportOptions);
    expect(snapshot.resolvedChartSpec.diagnostics.unsupportedFeatures).toContain(
      'Pivot chart formatting is preserved for export but not rendered',
    );
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBe(cachedMarks);
    expect(renderCache.getCachedLayout(CHART_1, SHEET_A)).toEqual(cachedLayout);
    expect(renderCache.getDirtyChartKeys()).toEqual(dirtyKeysBefore);
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    expect(cacheUpdates).toEqual([]);
    bridge.stop();
  });

  it('stale-but-show: paints existing marks AND triggers a recompile when dirty', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const renderCache = getRenderCache(bridge);
    renderCache.commitMarks(CHART_1, [], { sheetId: SHEET_A, frame: renderFrame() });
    renderCache.invalidateChart(CHART_1, SHEET_A);

    const frame = renderFrame();
    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled').mockResolvedValue(undefined);
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    expect(ensureSpy).toHaveBeenCalledWith(CHART_1, SHEET_A, frame);
    // No placeholder — the stale marks render, not a "Chart loading…" overlay.
    expect(ops.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(false);
    bridge.stop();
  });

  it('same imported chartId renders sheet-scoped marks instead of colliding with another sheet', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartCreated(eventBus, CHART_1, SHEET_B);

    const renderCache = getRenderCache(bridge);
    renderCache.commitMarks(CHART_1, [], { sheetId: SHEET_A, frame: renderFrame() });
    renderCache.commitMarks(CHART_1, [], { sheetId: SHEET_B, frame: renderFrame() });

    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled');
    const { ctx: sheetACtx, ops: sheetAOps } = createRecordingCtx();
    bridge.renderCached(CHART_1, sheetACtx, bounds(), SHEET_A);
    const { ctx: sheetBCtx, ops: sheetBOps } = createRecordingCtx();
    bridge.renderCached(CHART_1, sheetBCtx, bounds(), SHEET_B);

    expect(ensureSpy).not.toHaveBeenCalled();
    expect(sheetAOps.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(false);
    expect(sheetBOps.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(false);
    bridge.stop();
  });

  it('same imported chartId does not reuse another sheet error state on render', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartCreated(eventBus, CHART_1, SHEET_B);

    const renderCache = getRenderCache(bridge);
    renderCache.commitError(
      CHART_1,
      {
        code: 'EMPTY_DATA',
        message: 'sheet A empty',
        chartId: CHART_1,
      },
      SHEET_A,
    );
    renderCache.commitMarks(CHART_1, [], { sheetId: SHEET_B, frame: renderFrame() });

    const { ctx: sheetACtx, ops: sheetAOps } = createRecordingCtx();
    bridge.renderCached(CHART_1, sheetACtx, bounds(), SHEET_A);
    const { ctx: sheetBCtx, ops: sheetBOps } = createRecordingCtx();
    bridge.renderCached(CHART_1, sheetBCtx, bounds(), SHEET_B);

    expect(sheetAOps.some((o) => o.kind === 'fillRect' && o.style === '#f8d7da')).toBe(true);
    expect(sheetBOps.some((o) => o.kind === 'fillRect' && o.style === '#f8d7da')).toBe(false);
    expect(sheetBOps.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(false);
    bridge.stop();
  });

  it('same imported chartId keeps cache lifecycle state sheet-scoped', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartCreated(eventBus, CHART_1, SHEET_B);

    const renderCache = getRenderCache(bridge);
    const sheetAMarks: ChartMark[] = [];
    const sheetBMarks: ChartMark[] = [];
    const layoutA = { plotArea: { left: 0.1, top: 0.2, width: 0.3, height: 0.4 } };
    const layoutB = { plotArea: { left: 0.5, top: 0.6, width: 0.7, height: 0.8 } };

    renderCache.commitMarks(CHART_1, sheetAMarks, { sheetId: SHEET_A, layout: layoutA });
    renderCache.commitMarks(CHART_1, sheetBMarks, { sheetId: SHEET_B, layout: layoutB });

    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBe(sheetAMarks);
    expect(renderCache.getCachedMarks(CHART_1, SHEET_B)).toBe(sheetBMarks);
    expect(renderCache.getCachedLayout(CHART_1, SHEET_A)).toEqual(layoutA);
    expect(renderCache.getCachedLayout(CHART_1, SHEET_B)).toEqual(layoutB);

    renderCache.invalidateChart(CHART_1, SHEET_A);
    renderCache.beginCompilation(CHART_1, SHEET_A);

    expect(renderCache.isChartDirty(CHART_1, SHEET_A)).toBe(true);
    expect(renderCache.isChartDirty(CHART_1, SHEET_B)).toBe(false);
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(true);
    expect(renderCache.isCompilationPending(CHART_1, SHEET_B)).toBe(false);

    renderCache.syncImportRenderStatus(
      CHART_1,
      {
        importStatus: {
          renderable: false,
          message: 'Sheet A imported chart is unsupported',
        },
      },
      SHEET_A,
    );

    expect(renderCache.getImportRenderStatus(CHART_1, SHEET_A)?.message).toBe(
      'Sheet A imported chart is unsupported',
    );
    expect(renderCache.getImportRenderStatus(CHART_1, SHEET_B)).toBeUndefined();
    expect(renderCache.getCachedError(CHART_1, SHEET_A)?.message).toBe(
      'Sheet A imported chart is unsupported',
    );
    expect(renderCache.getCachedError(CHART_1, SHEET_B)).toBeUndefined();
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getCachedMarks(CHART_1, SHEET_B)).toBe(sheetBMarks);
    expect(renderCache.getCachedLayout(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getCachedLayout(CHART_1, SHEET_B)).toEqual(layoutB);
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    expect(renderCache.isCompilationPending(CHART_1, SHEET_B)).toBe(false);
    bridge.stop();
  });
});

// ---------------------------------------------------------------------------
// listener lifecycle
// ---------------------------------------------------------------------------

describe('onCacheUpdate listener lifecycle', () => {
  it('add/remove round-trip — unsubscribe stops further notifications', () => {
    const { ctx } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    const seen: string[] = [];
    const off = bridge.onCacheUpdate((id) => seen.push(id));

    bridge.clearAllCaches(); // fires '*'
    expect(seen).toEqual(['*']);

    off();
    bridge.clearAllCaches();
    expect(seen).toEqual(['*']); // unchanged after unsubscribe
    bridge.stop();
  });

  it('clearAllCaches fires the listener with the "*" sentinel', () => {
    const { ctx } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    const seen: string[] = [];
    bridge.onCacheUpdate((id) => seen.push(id));
    bridge.clearAllCaches();
    expect(seen).toEqual(['*']);
    bridge.stop();
  });

  it('mid-iteration unsubscribe does not skip the next listener', () => {
    const { ctx } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();

    const order: string[] = [];
    let offA: () => void = () => {};
    offA = bridge.onCacheUpdate(() => {
      order.push('a');
      offA(); // unsubscribe self mid-iteration
    });
    bridge.onCacheUpdate(() => order.push('b'));

    bridge.clearAllCaches();
    expect(order).toEqual(['a', 'b']);
    bridge.stop();
  });

  it('stop() clears cacheUpdateListeners (in-place)', () => {
    const { ctx } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    const seen: string[] = [];
    bridge.onCacheUpdate((id) => seen.push(id));
    bridge.stop();

    // Restart and clear — the previous listener is gone (in-place clear).
    bridge.start();
    bridge.clearAllCaches();
    expect(seen).toEqual([]);
    bridge.stop();
  });

  it('stop() clears pendingCompilations (no leak across stop/start)', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const renderCache = getRenderCache(bridge);
    renderCache.beginCompilation(CHART_1, SHEET_A);
    bridge.stop();

    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
  });

  it('unsubscribe closure created before stop() is safe to call after stop()', () => {
    const { ctx } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    const off = bridge.onCacheUpdate(() => {});
    bridge.stop();
    expect(() => off()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// chartSheetIndex maintenance
// ---------------------------------------------------------------------------

describe('chartSheetIndex maintenance via floating-object events', () => {
  it('populates from floatingObject:created', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();

    const renderCache = getRenderCache(bridge);
    expect(renderCache.hasSheetId(CHART_1)).toBe(false);

    emitChartCreated(eventBus, CHART_1, SHEET_A);
    expect(renderCache.getSheetId(CHART_1)).toBe(SHEET_A);
    bridge.stop();
  });

  it('removes on floatingObject:deleted and clears all per-chart caches', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const renderCache = getRenderCache(bridge);
    renderCache.commitMarks(CHART_1, [], { sheetId: SHEET_A });
    renderCache.commitError(
      CHART_1,
      { code: 'EMPTY_DATA', message: 'empty', chartId: CHART_1 },
      SHEET_A,
    );
    renderCache.syncImportRenderStatus(
      CHART_1,
      { importStatus: { state: 'non-renderable', message: 'Unsupported imported chart' } },
      SHEET_A,
    );
    renderCache.invalidateChart(CHART_1, SHEET_A);
    renderCache.beginCompilation(CHART_1, SHEET_A);

    emitChartDeleted(eventBus, CHART_1, SHEET_A);

    expect(renderCache.hasSheetId(CHART_1)).toBe(false);
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getCachedError(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getImportRenderStatus(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getDirtyChartKeys()).not.toContain(renderCache.cacheKey(CHART_1, SHEET_A));
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    bridge.stop();
  });

  it('floatingObject:deleted removes only the matching sheet context for duplicated chart ids', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();

    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartCreated(eventBus, CHART_1, SHEET_B);

    const renderCache = getRenderCache(bridge);
    const sheetAMarks = [{ type: 'group', children: [] }] as unknown as ChartMark[];
    const sheetBMarks = [{ type: 'group', children: [{ type: 'text' }] }] as unknown as ChartMark[];
    renderCache.commitMarks(CHART_1, sheetAMarks, { sheetId: SHEET_A });
    renderCache.commitMarks(CHART_1, sheetBMarks, { sheetId: SHEET_B });

    emitChartDeleted(eventBus, CHART_1, SHEET_A);

    expect(renderCache.hasSheetId(CHART_1, SHEET_A)).toBe(false);
    expect(renderCache.hasSheetId(CHART_1, SHEET_B)).toBe(true);
    expect(renderCache.getSheetId(CHART_1)).toBe(SHEET_B);
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getCachedMarks(CHART_1, SHEET_B)).toBe(sheetBMarks);
    bridge.stop();
  });

  it('round-trips correctly through delete + recreate (undo/redo)', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();

    const renderCache = getRenderCache(bridge);
    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartDeleted(eventBus, CHART_1, SHEET_A);
    expect(renderCache.hasSheetId(CHART_1)).toBe(false);
    emitChartCreated(eventBus, CHART_1, SHEET_A);
    expect(renderCache.getSheetId(CHART_1)).toBe(SHEET_A);
    bridge.stop();
  });

  it('sheet:deleted cascade — every chart on the deleted sheet is evicted', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();

    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartCreated(eventBus, CHART_2, SHEET_B);

    const renderCache = getRenderCache(bridge);
    renderCache.commitMarks(CHART_1, [], { sheetId: SHEET_A });
    renderCache.commitMarks(CHART_2, [], { sheetId: SHEET_B });

    emitSheetDeleted(eventBus, SHEET_A);

    expect(renderCache.hasSheetId(CHART_1)).toBe(false);
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    // Chart on the surviving sheet untouched.
    expect(renderCache.getSheetId(CHART_2)).toBe(SHEET_B);
    expect(renderCache.getCachedMarks(CHART_2, SHEET_B)).toEqual([]);
    bridge.stop();
  });

  it('sheet:deleted removes only deleted-sheet contexts for duplicated chart ids', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();

    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartCreated(eventBus, CHART_1, SHEET_B);

    const renderCache = getRenderCache(bridge);
    const sheetAMarks = [{ type: 'group', children: [] }] as unknown as ChartMark[];
    const sheetBMarks = [{ type: 'group', children: [{ type: 'text' }] }] as unknown as ChartMark[];
    renderCache.commitMarks(CHART_1, sheetAMarks, { sheetId: SHEET_A });
    renderCache.commitMarks(CHART_1, sheetBMarks, { sheetId: SHEET_B });

    emitSheetDeleted(eventBus, SHEET_A);

    expect(renderCache.hasSheetId(CHART_1, SHEET_A)).toBe(false);
    expect(renderCache.hasSheetId(CHART_1, SHEET_B)).toBe(true);
    expect(renderCache.getSheetId(CHART_1)).toBe(SHEET_B);
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getCachedMarks(CHART_1, SHEET_B)).toBe(sheetBMarks);
    bridge.stop();
  });

  it('cross-sheet :updated moves sheet context and clears old sheet caches', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const renderCache = getRenderCache(bridge);
    const sheetAMarks = [{ type: 'group', children: [] }] as unknown as ChartMark[];
    renderCache.commitMarks(CHART_1, sheetAMarks, { sheetId: SHEET_A });
    expect(renderCache.getSheetId(CHART_1)).toBe(SHEET_A);
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBe(sheetAMarks);

    emitChartUpdated(eventBus, CHART_1, SHEET_B, ['anchorRow', 'anchorCol']);
    expect(renderCache.hasSheetId(CHART_1, SHEET_A)).toBe(false);
    expect(renderCache.getSheetId(CHART_1)).toBe(SHEET_B);
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.chartIdsForSheet(SHEET_A)).toEqual([]);
    expect(renderCache.chartIdsForSheet(SHEET_B)).toEqual([CHART_1]);
    bridge.stop();
  });

  it('clearAllCaches leaves the sheet index intact', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const renderCache = getRenderCache(bridge);

    bridge.clearAllCaches();

    expect(renderCache.getSheetId(CHART_1)).toBe(SHEET_A);
    bridge.stop();
  });

  it('stop() clears the sheet index', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const renderCache = getRenderCache(bridge);

    bridge.stop();

    expect(renderCache.hasSheetId(CHART_1)).toBe(false);
  });

  it('position-only :updated does not invalidate the marks cache', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const renderCache = getRenderCache(bridge);
    renderCache.commitMarks(CHART_1, [], { sheetId: SHEET_A });

    emitChartUpdated(eventBus, CHART_1, SHEET_A, ['anchorRow', 'anchorCol', 'width', 'height']);

    expect(renderCache.getDirtyChartKeys()).not.toContain(renderCache.cacheKey(CHART_1, SHEET_A));
    bridge.stop();
  });

  it('normal floatingObject:updated clears imported non-renderable terminal status', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A, {
      ...fakeChart,
      importStatus: { state: 'non-renderable', message: 'Unsupported imported chart' },
    });

    emitChartUpdated(eventBus, CHART_1, SHEET_A, ['chartType'], fakeChart);

    const frame = renderFrame();
    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled').mockResolvedValue(undefined);
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    expect(ensureSpy).toHaveBeenCalledWith(CHART_1, SHEET_A, frame);
    expect(ops.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(true);
    expect(ops.some((o) => o.kind === 'fillRect' && o.style === '#f8d7da')).toBe(false);
    bridge.stop();
  });
});

// ---------------------------------------------------------------------------
// getMarks integration with cache-update listeners
// ---------------------------------------------------------------------------

describe('getMarks listener-fire on real cache commits', () => {
  it('CHART_NOT_FOUND error commit fires the listener and goes through error precedence on next paint', async () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const seen: string[] = [];
    bridge.onCacheUpdate((id) => seen.push(id));

    getRenderCache(bridge).commitError(
      CHART_1,
      {
        code: 'CHART_NOT_FOUND',
        message: 'Chart not found',
        chartId: CHART_1,
      },
      SHEET_A,
    );
    expect(seen).toEqual([CHART_1]);

    // Subsequent renderCached must paint the error (precedence over loading).
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());
    expect(ops.some((o) => o.kind === 'fillRect' && o.style === '#f8d7da')).toBe(true);
    bridge.stop();
  });

  it('ensureCompiled — concurrent calls leave pendingCompilations empty after settle', async () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const renderCache = getRenderCache(bridge);
    renderCache.beginCompilation(CHART_1, SHEET_A);
    renderCache.commitError(
      CHART_1,
      {
        code: 'CHART_NOT_FOUND',
        message: 'Chart not found',
        chartId: CHART_1,
      },
      SHEET_A,
    );
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    bridge.stop();
  });

  it('same imported chartId commits errors under the requested sheet key', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartCreated(eventBus, CHART_1, SHEET_B);

    const renderCache = getRenderCache(bridge);
    renderCache.commitError(
      CHART_1,
      {
        code: 'CHART_NOT_FOUND',
        message: 'Sheet A chart missing',
        chartId: CHART_1,
      },
      SHEET_A,
    );

    expect(renderCache.getCachedError(CHART_1, SHEET_A)).toBeDefined();
    expect(renderCache.getCachedError(CHART_1, SHEET_B)).toBeUndefined();
    bridge.stop();
  });
});

describe('resolveChartData imported visibility semantics', () => {
  it('omits explicit imported series whose source value row is hidden when plotVisibleOnly is true', async () => {
    const { ctx } = createTestCtx();
    const chart: ChartFloatingObject = {
      ...fakeChart,
      id: CHART_1,
      sheetId: SHEET_A as unknown as string,
      chartType: 'column',
      dataRange: '',
      plotVisibleOnly: true,
      series: [
        {
          name: 'Visible',
          values: 'Sheet1!A1:C1',
          categories: 'Sheet1!A10:C10',
          idx: 0,
        },
        {
          name: 'Hidden',
          values: 'Sheet1!A2:C2',
          categories: 'Sheet1!A10:C10',
          idx: 1,
        },
      ],
    } as unknown as ChartFloatingObject;
    const range = (row: number) => ({
      sheetId: SHEET_A as unknown as string,
      startRow: row,
      endRow: row,
      startCol: 0,
      endCol: 2,
    });
    const chartStoreMock = jest.requireMock('../chart-store') as {
      get: jest.Mock;
    };
    const rangeReferencesMock = jest.requireMock('../chart-range-references') as {
      resolveChartRangeReferences: jest.Mock;
    };
    chartStoreMock.get.mockResolvedValue(chart);
    rangeReferencesMock.resolveChartRangeReferences.mockResolvedValue({
      dataRange: null,
      categoryRange: null,
      seriesRange: null,
      seriesReferences: [
        {
          values: { ref: 'Sheet1!A1:C1', range: range(0) },
          categories: { ref: 'Sheet1!A10:C10', range: range(9) },
        },
        {
          values: { ref: 'Sheet1!A2:C2', range: range(1) },
          categories: { ref: 'Sheet1!A10:C10', range: range(9) },
        },
      ],
      diagnostics: [],
    } as unknown);
    const cellReadsMock = jest.requireMock('../../cells/cell-reads') as { getValue: jest.Mock };
    cellReadsMock.getValue.mockImplementation(async (_ctx, _sheetId, row, col) => {
      const raw =
        row === 0
          ? [10, 20, 30][col]
          : row === 1
            ? [100, 200, 300][col]
            : row === 9
              ? ['FY19', 'FY20', 'FY21'][col]
              : null;
      return raw ?? null;
    });
    (ctx as unknown as { computeBridge: unknown }).computeBridge = {
      getChart: jest.fn(async () => chart),
      getSheetOrder: jest.fn(async () => [SHEET_A]),
      getSheetName: jest.fn(async () => 'Sheet1'),
      getHiddenRows: jest.fn(async () => [1]),
      getHiddenColumns: jest.fn(async () => []),
      getCellIdAt: jest.fn(async () => null),
      getProjectionSource: jest.fn(async () => null),
      getCellData: jest.fn(async (_sheetId: SheetId, row: number, col: number) => {
        const raw =
          row === 0
            ? [10, 20, 30][col]
            : row === 1
              ? [100, 200, 300][col]
              : row === 9
                ? ['FY19', 'FY20', 'FY21'][col]
                : null;
        if (typeof raw === 'number') return { value: { type: 'number', value: raw } };
        if (typeof raw === 'string') return { value: { type: 'text', value: raw } };
        return null;
      }),
    };
    const bridge = new ChartBridge(ctx);

    const result = await bridge.resolveChartData(SHEET_A, CHART_1);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual([
      expect.objectContaining({
        category: 'FY19',
        x: 'FY19',
        y: 10,
        value: 10,
        series: 'Visible',
        sourceSeriesIndex: 0,
        sourceSeriesKey: 'idx:0',
      }),
      expect.objectContaining({
        category: 'FY20',
        x: 'FY20',
        y: 20,
        value: 20,
        series: 'Visible',
        sourceSeriesIndex: 0,
        sourceSeriesKey: 'idx:0',
      }),
      expect.objectContaining({
        category: 'FY21',
        x: 'FY21',
        y: 30,
        value: 30,
        series: 'Visible',
        sourceSeriesIndex: 0,
        sourceSeriesKey: 'idx:0',
      }),
    ]);
  });

  it('keeps source series colors aligned after plotVisibleOnly filters hidden series', async () => {
    const { ctx } = createTestCtx();
    const chart: ChartFloatingObject = {
      ...fakeChart,
      id: CHART_1,
      sheetId: SHEET_A as unknown as string,
      chartType: 'column',
      dataRange: '',
      plotVisibleOnly: true,
      series: [
        {
          name: 'Visible',
          values: 'Sheet1!A1:B1',
          categories: 'Sheet1!A10:B10',
          idx: 0,
          format: { fill: { type: 'solid', color: { theme: 'accent1' } } },
        },
        {
          name: 'Hidden',
          values: 'Sheet1!A2:B2',
          categories: 'Sheet1!A10:B10',
          idx: 1,
          format: { fill: { type: 'solid', color: { theme: 'accent2' } } },
        },
        {
          name: 'Later',
          values: 'Sheet1!A3:B3',
          categories: 'Sheet1!A10:B10',
          idx: 2,
          format: { fill: { type: 'solid', color: { theme: 'accent3' } } },
        },
      ],
    } as unknown as ChartFloatingObject;
    const range = (row: number) => ({
      sheetId: SHEET_A as unknown as string,
      startRow: row,
      endRow: row,
      startCol: 0,
      endCol: 1,
    });
    const chartStoreMock = jest.requireMock('../chart-store') as {
      get: jest.Mock;
    };
    const rangeReferencesMock = jest.requireMock('../chart-range-references') as {
      resolveChartRangeReferences: jest.Mock;
    };
    chartStoreMock.get.mockResolvedValue(chart);
    rangeReferencesMock.resolveChartRangeReferences.mockResolvedValue({
      dataRange: null,
      categoryRange: null,
      seriesRange: null,
      seriesReferences: [
        {
          values: { ref: 'Sheet1!A1:B1', range: range(0) },
          categories: { ref: 'Sheet1!A10:B10', range: range(9) },
        },
        {
          values: { ref: 'Sheet1!A2:B2', range: range(1) },
          categories: { ref: 'Sheet1!A10:B10', range: range(9) },
        },
        {
          values: { ref: 'Sheet1!A3:B3', range: range(2) },
          categories: { ref: 'Sheet1!A10:B10', range: range(9) },
        },
      ],
      diagnostics: [],
    } as unknown);
    const cellReadsMock = jest.requireMock('../../cells/cell-reads') as { getValue: jest.Mock };
    cellReadsMock.getValue.mockImplementation(async (_ctx, _sheetId, row, col) => {
      const raw =
        row === 0
          ? [10, 20][col]
          : row === 1
            ? [100, 200][col]
            : row === 2
              ? [30, 40][col]
              : row === 9
                ? ['FY19', 'FY20'][col]
                : null;
      return raw ?? null;
    });
    (ctx as unknown as { computeBridge: unknown }).computeBridge = {
      getChart: jest.fn(async () => chart),
      getSheetOrder: jest.fn(async () => [SHEET_A]),
      getSheetName: jest.fn(async () => 'Sheet1'),
      getHiddenRows: jest.fn(async () => [1]),
      getHiddenColumns: jest.fn(async () => []),
      getCellIdAt: jest.fn(async () => null),
      getProjectionSource: jest.fn(async () => null),
      getCellData: jest.fn(async (_sheetId: SheetId, row: number, col: number) => {
        const raw =
          row === 0
            ? [10, 20][col]
            : row === 1
              ? [100, 200][col]
              : row === 2
                ? [30, 40][col]
                : row === 9
                  ? ['FY19', 'FY20'][col]
                  : null;
        if (typeof raw === 'number') return { value: { type: 'number', value: raw } };
        if (typeof raw === 'string') return { value: { type: 'text', value: raw } };
        return null;
      }),
    };
    const bridge = new ChartBridge(ctx);

    const marks = await bridge.getMarksAtSize(SHEET_A, CHART_1, 600, 400);

    expect(Array.isArray(marks)).toBe(true);
    if (!Array.isArray(marks)) return;
    const visibleMark = marks.find(
      (mark) => mark.type === 'rect' && (mark as any).datum?.series === 'Visible',
    ) as any;
    const laterMark = marks.find(
      (mark) => mark.type === 'rect' && (mark as any).datum?.series === 'Later',
    ) as any;
    const hiddenMark = marks.find(
      (mark) => mark.type === 'rect' && (mark as any).datum?.series === 'Hidden',
    );

    expect(hiddenMark).toBeUndefined();
    expect(visibleMark?.style.fill).toBe('#4472C4');
    expect(laterMark?.style.fill).toBe('#A5A5A5');
  });

  it('resolves imported chart scheme colors against the workbook theme', async () => {
    const { ctx } = createTestCtx();
    const chart: ChartFloatingObject = {
      ...fakeChart,
      id: CHART_1,
      sheetId: SHEET_A as unknown as string,
      chartType: 'line',
      dataRange: '',
      legend: { show: true, position: 'bottom' },
      series: [
        {
          name: 'Theme accent 3',
          values: 'Sheet1!A1:B1',
          categories: 'Sheet1!A3:B3',
          format: { line: { color: { theme: 'accent3' }, width: 2.25 } },
        },
        {
          name: 'Theme accent 2',
          values: 'Sheet1!A2:B2',
          categories: 'Sheet1!A3:B3',
          format: { line: { color: { theme: 'accent2' }, width: 2.25 } },
        },
      ],
    } as unknown as ChartFloatingObject;
    const range = (row: number) => ({
      sheetId: SHEET_A as unknown as string,
      startRow: row,
      endRow: row,
      startCol: 0,
      endCol: 1,
    });
    const chartStoreMock = jest.requireMock('../chart-store') as {
      get: jest.Mock;
    };
    const rangeReferencesMock = jest.requireMock('../chart-range-references') as {
      resolveChartRangeReferences: jest.Mock;
    };
    chartStoreMock.get.mockResolvedValue(chart);
    rangeReferencesMock.resolveChartRangeReferences.mockResolvedValue({
      dataRange: null,
      categoryRange: null,
      seriesRange: null,
      seriesReferences: [
        {
          values: { ref: 'Sheet1!A1:B1', range: range(0) },
          categories: { ref: 'Sheet1!A3:B3', range: range(2) },
        },
        {
          values: { ref: 'Sheet1!A2:B2', range: range(1) },
          categories: { ref: 'Sheet1!A3:B3', range: range(2) },
        },
      ],
      diagnostics: [],
    } as unknown);
    const cellReadsMock = jest.requireMock('../../cells/cell-reads') as { getValue: jest.Mock };
    cellReadsMock.getValue.mockImplementation(async (_ctx, _sheetId, row, col) => {
      const raw =
        row === 0
          ? [10, 20][col]
          : row === 1
            ? [30, 15][col]
            : row === 2
              ? ['Jan', 'Feb'][col]
              : null;
      return raw ?? null;
    });
    (ctx as unknown as { computeBridge: unknown }).computeBridge = {
      getChart: jest.fn(async () => chart),
      getSheetOrder: jest.fn(async () => [SHEET_A]),
      getSheetName: jest.fn(async () => 'Sheet1'),
      getHiddenRows: jest.fn(async () => []),
      getHiddenColumns: jest.fn(async () => []),
      getCellIdAt: jest.fn(async () => null),
      getProjectionSource: jest.fn(async () => null),
      getWorkbookTheme: jest.fn(async () => ({
        colors: [
          { name: 'accent2', color: '#C0504D' },
          { name: 'accent3', color: '#9BBB59' },
        ],
        majorFont: null,
        minorFont: null,
      })),
      getCellData: jest.fn(async (_sheetId: SheetId, row: number, col: number) => {
        const raw =
          row === 0
            ? [10, 20][col]
            : row === 1
              ? [30, 15][col]
              : row === 2
                ? ['Jan', 'Feb'][col]
                : null;
        if (typeof raw === 'number') return { value: { type: 'number', value: raw } };
        if (typeof raw === 'string') return { value: { type: 'text', value: raw } };
        return null;
      }),
    };
    const bridge = new ChartBridge(ctx);

    const marks = await bridge.getMarksAtSize(SHEET_A, CHART_1, 600, 400);

    expect(Array.isArray(marks)).toBe(true);
    if (!Array.isArray(marks)) return;
    const lineMarks = marks.filter(
      (mark) => mark.type === 'path' && Array.isArray((mark as any).datum),
    ) as any[];
    const legendLineMarks = marks.filter(
      (mark) => mark.type === 'path' && (mark as any).datum?.entryIndex !== undefined,
    ) as any[];

    expect(lineMarks.map((mark) => mark.style.stroke)).toEqual(['#9BBB59', '#C0504D']);
    expect(legendLineMarks.map((mark) => mark.style.stroke)).toEqual(['#9BBB59', '#C0504D']);
  });

  it('snapshots explicit per-series categories from point x values', async () => {
    const { ctx } = createTestCtx();
    const chart: ChartFloatingObject = {
      ...fakeChart,
      id: CHART_1,
      sheetId: SHEET_A as unknown as string,
      chartType: 'line',
      dataRange: '',
      series: [
        {
          name: 'Generated categories',
          values: 'Sheet1!A1:B1',
          idx: 0,
        },
        {
          name: 'Date categories',
          values: 'Sheet1!A2:B2',
          categories: 'Sheet1!O1:P1',
          idx: 1,
        },
      ],
    } as unknown as ChartFloatingObject;
    const range = (row: number, startCol = 0, endCol = 1) => ({
      sheetId: SHEET_A as unknown as string,
      startRow: row,
      endRow: row,
      startCol,
      endCol,
    });
    const chartStoreMock = jest.requireMock('../chart-store') as {
      get: jest.Mock;
    };
    const rangeReferencesMock = jest.requireMock('../chart-range-references') as {
      resolveChartRangeReferences: jest.Mock;
    };
    chartStoreMock.get.mockResolvedValue(chart);
    rangeReferencesMock.resolveChartRangeReferences.mockResolvedValue({
      dataRange: null,
      categoryRange: null,
      seriesRange: null,
      seriesReferences: [
        {
          index: 0,
          values: { kind: 'seriesValues', source: 'series', ref: 'Sheet1!A1:B1', range: range(0) },
          categories: null,
        },
        {
          index: 1,
          values: { kind: 'seriesValues', source: 'series', ref: 'Sheet1!A2:B2', range: range(1) },
          categories: {
            kind: 'seriesCategories',
            source: 'series',
            ref: 'Sheet1!O1:P1',
            range: range(0, 14, 15),
          },
        },
      ],
      diagnostics: [],
    } as unknown);
    const cellReadsMock = jest.requireMock('../../cells/cell-reads') as { getValue: jest.Mock };
    cellReadsMock.getValue.mockImplementation(async (_ctx, _sheetId, row, col) => {
      if (row === 0 && col <= 1) return [10, 20][col];
      if (row === 1) return [null, 40][col];
      if (row === 0 && col >= 14) return [43952, 43983][col - 14];
      return null;
    });
    (ctx as unknown as { computeBridge: unknown }).computeBridge = {
      getChart: jest.fn(async () => chart),
      getSheetOrder: jest.fn(async () => [SHEET_A]),
      getSheetName: jest.fn(async () => 'Sheet1'),
      getHiddenRows: jest.fn(async () => []),
      getHiddenColumns: jest.fn(async () => []),
      getCellIdAt: jest.fn(async () => null),
      getProjectionSource: jest.fn(async () => null),
      getCellData: jest.fn(async (_sheetId: SheetId, row: number, col: number) => {
        const raw =
          row === 0 && col <= 1
            ? [10, 20][col]
            : row === 1
              ? [null, 40][col]
              : row === 0 && col >= 14
                ? [43952, 43983][col - 14]
                : null;
        if (typeof raw === 'number') return { value: { type: 'number', value: raw } };
        return null;
      }),
    };
    const bridge = new ChartBridge(ctx);

    const snapshot = await bridge.getRenderSnapshotAtSize(SHEET_A, CHART_1, 600, 400, {
      kind: 'raster',
      format: 'png',
      width: 600,
      height: 400,
      pixelRatio: 1,
      physicalWidth: 600,
      physicalHeight: 400,
      backgroundColor: '#ffffff',
      fittingMode: 'fill',
      frame: {
        exportWidth: 600,
        exportHeight: 400,
        contentX: 0,
        contentY: 0,
        contentWidth: 600,
        contentHeight: 400,
      },
    });

    expect('code' in snapshot).toBe(false);
    if ('code' in snapshot) return;
    expect(snapshot.resolvedChartSpec.resolved.series[0]?.categories).toEqual([]);
    expect(snapshot.resolvedChartSpec.resolved.series[1]?.categories).toEqual([43952, 43983]);
    expect(snapshot.resolvedChartSpec.resolved.series[1]?.values).toEqual([null, 40]);
    expect(snapshot.resolvedChartSpec.resolved.series[1]?.blankMask).toEqual([true, false]);
  });
});

describe('getLayout sheet-scoped cache contract', () => {
  it('same imported chartId returns the layout for the requested sheet only', async () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartCreated(eventBus, CHART_1, SHEET_B);

    const layoutA = {
      plotArea: { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
    };
    const layoutB = {
      plotArea: { left: 0.5, top: 0.6, width: 0.7, height: 0.8 },
    };
    const renderCache = getRenderCache(bridge);
    renderCache.commitMarks(CHART_1, [], { sheetId: SHEET_A, layout: layoutA });
    renderCache.commitMarks(CHART_1, [], { sheetId: SHEET_B, layout: layoutB });

    await expect(bridge.getLayout(SHEET_A, CHART_1)).resolves.toEqual(layoutA);
    await expect(bridge.getLayout(SHEET_B, CHART_1)).resolves.toEqual(layoutB);
    bridge.stop();
  });
});

// ---------------------------------------------------------------------------
// rotation preservation under withRenderContext
// ---------------------------------------------------------------------------

describe('renderCached preserves rotation under withRenderContext-style wrap', () => {
  it('paint ops land BETWEEN save+rotate and restore (rotation survives)', () => {
    // The pre-fix async render() let the engine's save/rotate/restore run
    // before the chart's paint, so the chart painted in an unrotated frame.
    // Now that renderCached is sync, the chart's paint must land inside the
    // wrapper's save→rotate / restore window. We simulate withRenderContext
    // here without importing canvas/drawing-canvas (forbidden — kernel does
    // not depend on it; the simulation is the meaningful contract being
    // verified, not the canvas helper itself).
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    // Don't populate markCache — renderCached takes the placeholder path,
    // which paints fillRect + strokeRect + fillText synchronously. These
    // ops let us assert sequencing without depending on the real charts
    // mark format. The async-render bug would defer all of these past the
    // restore, so it's the same fingerprint either way.
    jest.spyOn(bridge, 'ensureCompiled').mockResolvedValue(undefined);

    const { ctx: canvasCtx, ops } = createRecordingCtx();

    // withRenderContext-style wrap.
    canvasCtx.save();
    canvasCtx.rotate(Math.PI / 4);
    bridge.renderCached(CHART_1, canvasCtx, bounds());
    canvasCtx.restore();

    const saveIdx = ops.findIndex((o) => o.kind === 'save');
    const rotateIdx = ops.findIndex((o) => o.kind === 'rotate');
    const restoreIdx = ops.findIndex((o) => o.kind === 'restore');
    // Some paint op (fillRect from renderMarks, OR the placeholder fallback
    // — either is an actual ctx draw call) must sit AFTER rotate and BEFORE
    // restore. The forbidden state is "paint op lands after restore".
    const paintIdx = ops.findIndex(
      (o, i) =>
        i > rotateIdx &&
        (o.kind === 'fillRect' || o.kind === 'fillText' || o.kind === 'strokeRect'),
    );

    expect(saveIdx).toBeGreaterThanOrEqual(0);
    expect(rotateIdx).toBeGreaterThan(saveIdx);
    expect(paintIdx).toBeGreaterThan(rotateIdx);
    expect(restoreIdx).toBeGreaterThan(paintIdx);
    bridge.stop();
  });
});

// ---------------------------------------------------------------------------
// event fanout control
// ---------------------------------------------------------------------------

describe('chart invalidation event fanout', () => {
  it('cells:batch-changed scans affected charts once for the batch bounding range', async () => {
    const { ctx, eventBus } = createTestCtx();
    const computeBridge = {
      getSheetOrder: jest.fn(async () => [SHEET_A]),
      getSheetName: jest.fn(async () => 'Sheet1'),
      getAllCharts: jest.fn(async () => [
        { ...fakeChart, sheetId: SHEET_A as unknown as string, dataRange: 'B5:F11' },
      ]),
    };
    (ctx as unknown as { computeBridge: unknown }).computeBridge = computeBridge;
    const rangeReferencesMock = jest.requireMock('../chart-range-references') as {
      resolveChartRangeReferences: jest.Mock;
    };
    rangeReferencesMock.resolveChartRangeReferences.mockResolvedValue({
      dataRange: {
        kind: 'dataRange',
        source: 'a1',
        range: { sheetId: SHEET_A, startRow: 4, startCol: 1, endRow: 10, endCol: 5 },
      },
      categoryRange: null,
      seriesRange: null,
      seriesReferences: [],
      diagnostics: [],
    });
    const bridge = new ChartBridge(ctx);
    const invalidateSpy = jest.spyOn(bridge, 'invalidateChart');
    bridge.start();
    expect(eventBus.handlers.get('cells:batch-changed')?.size).toBe(1);

    eventBus.emit({
      type: 'cells:batch-changed',
      sheetId: SHEET_A as unknown as string,
      timestamp: Date.now(),
      changes: [
        { row: 4, col: 2, newValue: undefined },
        { row: 10, col: 5, newValue: undefined },
        { row: 7, col: 1, newValue: undefined },
      ],
      source: 'formula',
    });
    await flushAsyncHandlers();

    expect(computeBridge.getSheetOrder).toHaveBeenCalledTimes(1);
    expect(computeBridge.getAllCharts).toHaveBeenCalledTimes(1);
    expect(computeBridge.getAllCharts).toHaveBeenCalledWith(SHEET_A);
    expect(invalidateSpy).toHaveBeenCalledWith(CHART_1, SHEET_A);
    expect(getRenderCache(bridge).getDirtyChartKeys()).toContain(
      getRenderCache(bridge).cacheKey(CHART_1, SHEET_A),
    );
    bridge.stop();
  });
});

// ---------------------------------------------------------------------------
// stop() mid-compile invariant
// ---------------------------------------------------------------------------

describe('stop() mid-compile', () => {
  it('does not re-pollute caches after stop runs while a compile is in flight', async () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const renderCache = getRenderCache(bridge);
    renderCache.beginCompilation(CHART_1, SHEET_A);
    bridge.stop();
    renderCache.commitError(
      CHART_1,
      {
        code: 'CHART_NOT_FOUND',
        message: 'Chart not found',
        chartId: CHART_1,
      },
      SHEET_A,
    );

    // Caches stayed empty after the post-stop resolution.
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getCachedError(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
  });
});
