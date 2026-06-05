import { jest } from '@jest/globals';
import type { ChartConfig, ChartData } from '@mog/charts';
import type { ChartError, ChartLayoutSnapshot, ChartMark } from '@mog-sdk/contracts/bridges';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type { ChartExportOptionsSnapshot } from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { ResolvedChartRangeReferences } from '../chart-range-references';
import type { ChartDataResolver } from '../bridge/chart-data-resolver';
import { ChartRenderCache } from '../bridge/chart-render-cache';
import { ChartRenderOrchestrator } from '../bridge/chart-render-orchestrator';

const SHEET_A: SheetId = toSheetId('sheet-a');
const CHART_1 = 'chart-1';

const config: ChartConfig = {
  type: 'bar',
  width: 4,
  height: 3,
  title: 'Sales',
};

const chartData: ChartData = {
  categories: ['Jan', 'Feb'],
  series: [
    {
      name: 'Sales',
      data: [
        { x: 'Jan', y: 10 },
        { x: 'Feb', y: 20 },
      ],
    },
  ],
};

const chart = {
  id: CHART_1,
  type: 'chart',
  chartType: 'bar',
  width: 4,
  height: 3,
} as unknown as ChartFloatingObject;

const resolvedRanges: ResolvedChartRangeReferences = {
  dataRange: null,
  categoryRange: null,
  seriesRange: null,
  seriesReferences: [],
  diagnostics: [],
};

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

const cachedMarks = [{ type: 'group', children: [] }] as unknown as ChartMark[];
const cachedLayout: ChartLayoutSnapshot = {
  plotArea: { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
};

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

function createResolver(): ChartDataResolver {
  return {
    resolveForRendering: jest.fn(async () => ({
      chart,
      resolvedRanges,
      config,
      data: chartData,
    })),
  } as unknown as ChartDataResolver;
}

function createCompileFailingResolver(): ChartDataResolver {
  return {
    resolveForRendering: jest.fn(async () => ({
      chart,
      resolvedRanges,
      config: undefined as unknown as ChartConfig,
      data: chartData,
    })),
  } as unknown as ChartDataResolver;
}

function expectCompileFailed(error: ChartError): void {
  expect(error).toMatchObject({
    code: 'COMPILE_FAILED',
    chartId: CHART_1,
  });
  expect(error.message).toContain('Chart compilation failed');
}

describe('ChartRenderOrchestrator', () => {
  it('export-sized marks and diagnostics snapshots do not mutate UI render caches', async () => {
    const renderCache = new ChartRenderCache();
    renderCache.start();
    renderCache.setSheetId(CHART_1, SHEET_A);
    renderCache.commitMarks(CHART_1, cachedMarks, { sheetId: SHEET_A, layout: cachedLayout });
    renderCache.invalidateChart(CHART_1, SHEET_A);

    const cacheUpdates: string[] = [];
    renderCache.onCacheUpdate((chartId) => cacheUpdates.push(chartId));
    const dirtyKeysBefore = renderCache.getDirtyChartKeys();
    const resolver = createResolver();
    const orchestrator = new ChartRenderOrchestrator({
      renderCache,
      dataResolver: resolver,
      isLive: () => true,
    });

    const marksAtSize = await orchestrator.getMarksAtSize(SHEET_A, CHART_1, 640, 360);
    const snapshot = await orchestrator.getRenderSnapshotAtSize(
      SHEET_A,
      CHART_1,
      640,
      360,
      exportOptions,
    );

    expect(Array.isArray(marksAtSize)).toBe(true);
    expect('code' in snapshot).toBe(false);
    if (!('code' in snapshot)) {
      expect(marksAtSize).toEqual(snapshot.marks);
    }
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBe(cachedMarks);
    expect(renderCache.getCachedLayout(CHART_1, SHEET_A)).toEqual(cachedLayout);
    expect(renderCache.getDirtyChartKeys()).toEqual(dirtyKeysBefore);
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    expect(cacheUpdates).toEqual([]);
  });

  it('normalizes cache-backed compile exceptions into committed ChartError state', async () => {
    const renderCache = new ChartRenderCache();
    renderCache.start();
    renderCache.setSheetId(CHART_1, SHEET_A);
    const cacheUpdates: string[] = [];
    renderCache.onCacheUpdate((chartId) => cacheUpdates.push(chartId));
    const resolver = createCompileFailingResolver();
    const orchestrator = new ChartRenderOrchestrator({
      renderCache,
      dataResolver: resolver,
      isLive: () => true,
    });

    await expect(orchestrator.ensureCompiled(CHART_1, SHEET_A)).resolves.toBeUndefined();

    const cachedError = renderCache.getCachedError(CHART_1, SHEET_A);
    expect(cachedError).toBeDefined();
    expectCompileFailed(cachedError!);
    expect((cachedError!.details as { stage?: unknown }).stage).toBe('configToSpec');
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    expect(cacheUpdates).toEqual([CHART_1]);

    const result = await orchestrator.getMarks(SHEET_A, CHART_1);
    expect(result).toBe(cachedError);
    expect(resolver.resolveForRendering).toHaveBeenCalledTimes(1);
  });

  it('normalizes export-sized compile exceptions without mutating UI render caches', async () => {
    const renderCache = new ChartRenderCache();
    renderCache.start();
    renderCache.setSheetId(CHART_1, SHEET_A);
    renderCache.commitMarks(CHART_1, cachedMarks, { sheetId: SHEET_A, layout: cachedLayout });
    renderCache.invalidateChart(CHART_1, SHEET_A);

    const cacheUpdates: string[] = [];
    renderCache.onCacheUpdate((chartId) => cacheUpdates.push(chartId));
    const dirtyKeysBefore = renderCache.getDirtyChartKeys();
    const resolver = createCompileFailingResolver();
    const orchestrator = new ChartRenderOrchestrator({
      renderCache,
      dataResolver: resolver,
      isLive: () => true,
    });

    const marksAtSize = await orchestrator.getMarksAtSize(SHEET_A, CHART_1, 640, 360);
    const snapshot = await orchestrator.getRenderSnapshotAtSize(
      SHEET_A,
      CHART_1,
      640,
      360,
      exportOptions,
    );

    expect('code' in marksAtSize).toBe(true);
    if ('code' in marksAtSize) {
      expectCompileFailed(marksAtSize);
      expect((marksAtSize.details as { stage?: unknown }).stage).toBe('configToSpec');
    }
    expect('code' in snapshot).toBe(true);
    if ('code' in snapshot) {
      expectCompileFailed(snapshot);
      expect((snapshot.details as { stage?: unknown }).stage).toBe('configToSpec');
    }
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBe(cachedMarks);
    expect(renderCache.getCachedLayout(CHART_1, SHEET_A)).toEqual(cachedLayout);
    expect(renderCache.getCachedError(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getDirtyChartKeys()).toEqual(dirtyKeysBefore);
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    expect(cacheUpdates).toEqual([]);
  });

  it('does not repopulate render caches when a compile failure resolves after stop', async () => {
    const renderCache = new ChartRenderCache();
    renderCache.start();
    renderCache.setSheetId(CHART_1, SHEET_A);
    const cacheUpdates: string[] = [];
    renderCache.onCacheUpdate((chartId) => cacheUpdates.push(chartId));
    const renderData = deferred<Awaited<ReturnType<ChartDataResolver['resolveForRendering']>>>();
    const resolver = {
      resolveForRendering: jest.fn(() => renderData.promise),
    } as unknown as ChartDataResolver;
    const orchestrator = new ChartRenderOrchestrator({
      renderCache,
      dataResolver: resolver,
      isLive: () => true,
    });

    const marksPromise = orchestrator.getMarks(SHEET_A, CHART_1);
    await Promise.resolve();
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(true);

    renderCache.stop();
    renderData.resolve({
      chart,
      resolvedRanges,
      config: undefined as unknown as ChartConfig,
      data: chartData,
    });
    const result = await marksPromise;

    expect('code' in result).toBe(true);
    if ('code' in result) {
      expectCompileFailed(result);
    }
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getCachedLayout(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getCachedError(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getImportRenderStatus(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getDirtyChartKeys()).toEqual([]);
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    expect(cacheUpdates).toEqual([]);
  });

  it('does not repopulate render caches when a successful compile resolves after stop', async () => {
    const renderCache = new ChartRenderCache();
    renderCache.start();
    renderCache.setSheetId(CHART_1, SHEET_A);
    const cacheUpdates: string[] = [];
    renderCache.onCacheUpdate((chartId) => cacheUpdates.push(chartId));
    const renderData = deferred<Awaited<ReturnType<ChartDataResolver['resolveForRendering']>>>();
    const resolver = {
      resolveForRendering: jest.fn(() => renderData.promise),
    } as unknown as ChartDataResolver;
    const orchestrator = new ChartRenderOrchestrator({
      renderCache,
      dataResolver: resolver,
      isLive: () => true,
    });

    const marksPromise = orchestrator.getMarks(SHEET_A, CHART_1);
    await Promise.resolve();
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(true);

    renderCache.stop();
    renderData.resolve({
      chart,
      resolvedRanges,
      config,
      data: chartData,
    });
    const result = await marksPromise;

    expect(Array.isArray(result)).toBe(true);
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getCachedLayout(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getCachedError(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getImportRenderStatus(CHART_1, SHEET_A)).toBeUndefined();
    expect(renderCache.getDirtyChartKeys()).toEqual([]);
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    expect(cacheUpdates).toEqual([]);
  });
});
