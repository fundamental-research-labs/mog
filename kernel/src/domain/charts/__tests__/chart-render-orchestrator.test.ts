import { jest } from '@jest/globals';
import type { ChartConfig, ChartData } from '@mog/charts';
import type { ChartLayoutSnapshot, ChartMark } from '@mog-sdk/contracts/bridges';
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
  format: 'png',
  width: 640,
  height: 360,
  physicalWidth: 640,
  physicalHeight: 360,
  pixelRatio: 1,
  backgroundColor: '#ffffff',
};

const cachedMarks = [{ type: 'group', children: [] }] as unknown as ChartMark[];
const cachedLayout: ChartLayoutSnapshot = {
  plotArea: { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
};

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
    expect(renderCache.getCachedMarks(CHART_1, SHEET_A)).toBe(cachedMarks);
    expect(renderCache.getCachedLayout(CHART_1, SHEET_A)).toEqual(cachedLayout);
    expect(renderCache.getDirtyChartKeys()).toEqual(dirtyKeysBefore);
    expect(renderCache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    expect(cacheUpdates).toEqual([]);
  });
});
