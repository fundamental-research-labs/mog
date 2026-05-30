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

// Mock Charts.get / getChartDataRange so the bridge doesn't try to talk to
// the real ComputeBridge. The bridge uses `import * as Charts from
// './chart-crud'` so a module-level mock intercepts everything.
jest.mock('../chart-crud', () => ({
  get: jest.fn(),
  getAll: jest.fn(async () => [] as unknown[]),
  getChartDataRange: jest.fn(),
  resolveChartRangeReferences: jest.fn(),
}));

// Mock cell-reads so the cell-accessor pre-fetch returns null cleanly
// without needing a real document.
jest.mock('../../cells/cell-reads', () => ({
  getValue: jest.fn(async () => null),
}));

import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type {
  FloatingObjectCreatedEvent,
  FloatingObjectDeletedEvent,
  FloatingObjectUpdatedEvent,
  IEventBus,
  SheetDeletedEvent,
} from '@mog-sdk/contracts/events';

import type { DocumentContext } from '../../../context/types';
import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { ChartBridge } from '../chart-bridge';

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

beforeEach(() => {
  jest.clearAllMocks();
});

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

    // Pretend a previous compile populated the cache and committed cleanly
    // (mark commit clears dirtyCharts; emitChartCreated's invalidateChart
    // sets it, so we mirror what a real compile commit would have left).
    const internals = bridge as unknown as {
      markCache: Map<string, unknown[]>;
      dirtyCharts: Set<string>;
    };
    internals.markCache.set(CHART_1, []);
    internals.dirtyCharts.delete(CHART_1);

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

    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled').mockResolvedValue(undefined);
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    expect(ensureSpy).toHaveBeenCalledWith(CHART_1, SHEET_A);
    expect(ops.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(true);
    bridge.stop();
  });

  it('cache miss with compile already pending paints placeholder without spawning another compile', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const key = `${SHEET_A}::${CHART_1}`;
    (bridge as unknown as { pendingCompilations: Set<string> }).pendingCompilations.add(key);

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

    (bridge as unknown as { errorCache: Map<string, unknown> }).errorCache.set(CHART_1, {
      code: 'EMPTY_DATA',
      message: 'no data',
      chartId: CHART_1,
    });

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
    const internals = bridge as unknown as {
      chartImportRenderStatus: Map<string, { terminal: true; message: string; raw: unknown }>;
    };
    internals.chartImportRenderStatus.set(CHART_1, {
      terminal: true,
      message: 'Imported chart cannot be rendered yet',
      raw: { renderable: false },
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

  it('stale-but-show: paints existing marks AND triggers a recompile when dirty', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const internals = bridge as unknown as {
      markCache: Map<string, unknown[]>;
      dirtyCharts: Set<string>;
    };
    internals.markCache.set(CHART_1, []);
    internals.dirtyCharts.add(CHART_1);

    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled').mockResolvedValue(undefined);
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    expect(ensureSpy).toHaveBeenCalledWith(CHART_1, SHEET_A);
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

    const internals = bridge as unknown as {
      markCache: Map<string, unknown[]>;
      dirtyCharts: Set<string>;
    };
    internals.markCache.set(`${SHEET_A}::${CHART_1}`, []);
    internals.markCache.set(`${SHEET_B}::${CHART_1}`, []);
    internals.dirtyCharts.delete(`${SHEET_A}::${CHART_1}`);
    internals.dirtyCharts.delete(`${SHEET_B}::${CHART_1}`);

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

    const internals = bridge as unknown as {
      markCache: Map<string, unknown[]>;
      errorCache: Map<string, unknown>;
      dirtyCharts: Set<string>;
    };
    internals.errorCache.set(`${SHEET_A}::${CHART_1}`, {
      code: 'EMPTY_DATA',
      message: 'sheet A empty',
      chartId: CHART_1,
    });
    internals.markCache.set(`${SHEET_B}::${CHART_1}`, []);
    internals.dirtyCharts.delete(`${SHEET_B}::${CHART_1}`);

    const { ctx: sheetACtx, ops: sheetAOps } = createRecordingCtx();
    bridge.renderCached(CHART_1, sheetACtx, bounds(), SHEET_A);
    const { ctx: sheetBCtx, ops: sheetBOps } = createRecordingCtx();
    bridge.renderCached(CHART_1, sheetBCtx, bounds(), SHEET_B);

    expect(sheetAOps.some((o) => o.kind === 'fillRect' && o.style === '#f8d7da')).toBe(true);
    expect(sheetBOps.some((o) => o.kind === 'fillRect' && o.style === '#f8d7da')).toBe(false);
    expect(sheetBOps.some((o) => o.kind === 'fillText' && o.text === 'Chart loading…')).toBe(false);
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

    const internals = bridge as unknown as { pendingCompilations: Set<string> };
    internals.pendingCompilations.add(CHART_1);
    bridge.stop();

    expect(internals.pendingCompilations.size).toBe(0);
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

    const internals = bridge as unknown as { chartSheetIndex: Map<string, SheetId> };
    expect(internals.chartSheetIndex.has(CHART_1)).toBe(false);

    emitChartCreated(eventBus, CHART_1, SHEET_A);
    expect(internals.chartSheetIndex.get(CHART_1)).toBe(SHEET_A);
    bridge.stop();
  });

  it('removes on floatingObject:deleted and clears all per-chart caches', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const internals = bridge as unknown as {
      chartSheetIndex: Map<string, SheetId>;
      markCache: Map<string, unknown[]>;
      errorCache: Map<string, unknown>;
      chartImportRenderStatus: Map<string, unknown>;
      dirtyCharts: Set<string>;
      pendingCompilations: Set<string>;
    };
    internals.markCache.set(CHART_1, []);
    internals.errorCache.set(CHART_1, { code: 'EMPTY_DATA' });
    internals.chartImportRenderStatus.set(CHART_1, { terminal: true });
    internals.dirtyCharts.add(CHART_1);
    internals.pendingCompilations.add(CHART_1);

    emitChartDeleted(eventBus, CHART_1, SHEET_A);

    expect(internals.chartSheetIndex.has(CHART_1)).toBe(false);
    expect(internals.markCache.has(CHART_1)).toBe(false);
    expect(internals.errorCache.has(CHART_1)).toBe(false);
    expect(internals.chartImportRenderStatus.has(CHART_1)).toBe(false);
    expect(internals.dirtyCharts.has(CHART_1)).toBe(false);
    expect(internals.pendingCompilations.has(CHART_1)).toBe(false);
    bridge.stop();
  });

  it('round-trips correctly through delete + recreate (undo/redo)', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();

    const internals = bridge as unknown as { chartSheetIndex: Map<string, SheetId> };
    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartDeleted(eventBus, CHART_1, SHEET_A);
    expect(internals.chartSheetIndex.has(CHART_1)).toBe(false);
    emitChartCreated(eventBus, CHART_1, SHEET_A);
    expect(internals.chartSheetIndex.get(CHART_1)).toBe(SHEET_A);
    bridge.stop();
  });

  it('sheet:deleted cascade — every chart on the deleted sheet is evicted', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();

    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartCreated(eventBus, CHART_2, SHEET_B);

    const internals = bridge as unknown as {
      chartSheetIndex: Map<string, SheetId>;
      markCache: Map<string, unknown[]>;
    };
    internals.markCache.set(CHART_1, []);
    internals.markCache.set(CHART_2, []);

    emitSheetDeleted(eventBus, SHEET_A);

    expect(internals.chartSheetIndex.has(CHART_1)).toBe(false);
    expect(internals.markCache.has(CHART_1)).toBe(false);
    // Chart on the surviving sheet untouched.
    expect(internals.chartSheetIndex.get(CHART_2)).toBe(SHEET_B);
    expect(internals.markCache.has(CHART_2)).toBe(true);
    bridge.stop();
  });

  it('cross-sheet :updated forward-looking handler updates the index', () => {
    // Charts cannot move between sheets in the current API. The conditional
    // re-set in the :updated handler costs nothing today and prevents silent
    // drift if cross-sheet move ever lands.
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const internals = bridge as unknown as { chartSheetIndex: Map<string, SheetId> };
    expect(internals.chartSheetIndex.get(CHART_1)).toBe(SHEET_A);

    // Hypothetical future cross-sheet move event.
    emitChartUpdated(eventBus, CHART_1, SHEET_B, ['anchorRow', 'anchorCol']);
    expect(internals.chartSheetIndex.get(CHART_1)).toBe(SHEET_B);
    bridge.stop();
  });

  it('position-only :updated does not invalidate the marks cache', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);

    const internals = bridge as unknown as {
      markCache: Map<string, unknown[]>;
      dirtyCharts: Set<string>;
    };
    internals.markCache.set(CHART_1, []);
    internals.dirtyCharts.delete(CHART_1);

    emitChartUpdated(eventBus, CHART_1, SHEET_A, ['anchorRow', 'anchorCol', 'width', 'height']);

    expect(internals.dirtyCharts.has(CHART_1)).toBe(false);
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

    const ensureSpy = jest.spyOn(bridge, 'ensureCompiled').mockResolvedValue(undefined);
    const { ctx: canvasCtx, ops } = createRecordingCtx();
    bridge.renderCached(CHART_1, canvasCtx, bounds());

    expect(ensureSpy).toHaveBeenCalledWith(CHART_1, SHEET_A);
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

    (
      bridge as unknown as {
        commitError: (
          chartId: string,
          error: { code: string; message: string; chartId: string },
        ) => void;
      }
    ).commitError(CHART_1, {
      code: 'CHART_NOT_FOUND',
      message: 'Chart not found',
      chartId: CHART_1,
    });
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

    const internals = bridge as unknown as {
      pendingCompilations: Set<string>;
      commitError: (
        chartId: string,
        error: { code: string; message: string; chartId: string },
      ) => void;
    };
    internals.pendingCompilations.add(CHART_1);
    internals.commitError(CHART_1, {
      code: 'CHART_NOT_FOUND',
      message: 'Chart not found',
      chartId: CHART_1,
    });
    expect(internals.pendingCompilations.size).toBe(0);
    bridge.stop();
  });

  it('same imported chartId commits errors under the requested sheet key', () => {
    const { ctx, eventBus } = createTestCtx();
    const bridge = new ChartBridge(ctx);
    bridge.start();
    emitChartCreated(eventBus, CHART_1, SHEET_A);
    emitChartCreated(eventBus, CHART_1, SHEET_B);

    const internals = bridge as unknown as {
      errorCache: Map<string, unknown>;
      commitError: (
        chartId: string,
        error: { code: string; message: string; chartId: string },
        sheetId?: SheetId,
      ) => void;
    };
    internals.commitError(
      CHART_1,
      {
        code: 'CHART_NOT_FOUND',
        message: 'Sheet A chart missing',
        chartId: CHART_1,
      },
      SHEET_A,
    );

    expect(internals.errorCache.has(`${SHEET_A}::${CHART_1}`)).toBe(true);
    expect(internals.errorCache.has(`${SHEET_B}::${CHART_1}`)).toBe(false);
    bridge.stop();
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
    const internals = bridge as unknown as {
      layoutCache: Map<string, unknown>;
      dirtyCharts: Set<string>;
    };
    internals.layoutCache.set(`${SHEET_A}::${CHART_1}`, layoutA);
    internals.layoutCache.set(`${SHEET_B}::${CHART_1}`, layoutB);
    internals.dirtyCharts.delete(`${SHEET_A}::${CHART_1}`);
    internals.dirtyCharts.delete(`${SHEET_B}::${CHART_1}`);

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
    const bridge = new ChartBridge(ctx);
    bridge.start();

    const affectedSpy = jest.spyOn(bridge, 'getChartsAffectedByRange').mockResolvedValue([CHART_1]);

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
    await Promise.resolve();

    expect(affectedSpy).toHaveBeenCalledTimes(1);
    expect(affectedSpy).toHaveBeenCalledWith(SHEET_A, {
      sheetId: SHEET_A,
      startRow: 4,
      startCol: 1,
      endRow: 10,
      endCol: 5,
    });
    expect((bridge as unknown as { dirtyCharts: Set<string> }).dirtyCharts.has(CHART_1)).toBe(true);
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

    const internals = bridge as unknown as {
      markCache: Map<string, unknown[]>;
      errorCache: Map<string, unknown>;
      pendingCompilations: Set<string>;
      commitError: (
        chartId: string,
        error: { code: string; message: string; chartId: string },
      ) => void;
    };
    internals.pendingCompilations.add(CHART_1);
    bridge.stop();
    internals.commitError(CHART_1, {
      code: 'CHART_NOT_FOUND',
      message: 'Chart not found',
      chartId: CHART_1,
    });

    // Caches stayed empty after the post-stop resolution.
    expect(internals.markCache.size).toBe(0);
    expect(internals.errorCache.size).toBe(0);
    expect(internals.pendingCompilations.size).toBe(0);
  });
});
