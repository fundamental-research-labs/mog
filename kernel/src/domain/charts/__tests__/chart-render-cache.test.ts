import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type { ChartError, ChartLayoutSnapshot, ChartMark } from '@mog-sdk/contracts/bridges';

import { ChartRenderCache } from '../bridge/chart-render-cache';

const SHEET_A: SheetId = toSheetId('sheet-a');
const SHEET_B: SheetId = toSheetId('sheet-b');
const CHART_1 = 'chart-1';

const marks = [] as ChartMark[];
const layout: ChartLayoutSnapshot = {
  plotArea: { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
};
const error: ChartError = {
  code: 'EMPTY_DATA',
  message: 'no data',
  chartId: CHART_1,
};

function startedCache(): ChartRenderCache {
  const cache = new ChartRenderCache();
  cache.start();
  return cache;
}

describe('ChartRenderCache', () => {
  it('keeps stale marks and layout through invalidation while clearing known errors', () => {
    const cache = startedCache();
    cache.setSheetId(CHART_1, SHEET_A);
    cache.commitMarks(CHART_1, marks, { sheetId: SHEET_A, layout });
    cache.commitError(CHART_1, error, SHEET_A);

    cache.invalidateChart(CHART_1, SHEET_A);

    expect(cache.getCachedMarks(CHART_1, SHEET_A)).toBe(marks);
    expect(cache.getCachedLayout(CHART_1, SHEET_A)).toEqual(layout);
    expect(cache.getCachedError(CHART_1, SHEET_A)).toBeUndefined();
    expect(cache.getDirtyChartKeys()).toContain(cache.cacheKey(CHART_1, SHEET_A));
  });

  it('pending compile stale-read state does not fire cache-update listeners', () => {
    const cache = startedCache();
    const seen: string[] = [];
    cache.onCacheUpdate((chartId) => seen.push(chartId));
    cache.commitMarks(CHART_1, marks, { sheetId: SHEET_A });
    seen.length = 0;

    cache.invalidateChart(CHART_1, SHEET_A);
    cache.beginCompilation(CHART_1, SHEET_A);
    const state = cache.getCompileState(CHART_1, SHEET_A);

    expect(state.marks).toBe(marks);
    expect(state.isDirty).toBe(true);
    expect(state.isCompilePending).toBe(true);
    expect(seen).toEqual([]);
  });

  it('commit after stop clears pending but does not repopulate caches or fire listeners', () => {
    const cache = startedCache();
    const seen: string[] = [];
    cache.onCacheUpdate((chartId) => seen.push(chartId));
    cache.beginCompilation(CHART_1, SHEET_A);

    cache.stop();
    cache.commitMarks(CHART_1, marks, { sheetId: SHEET_A, layout });
    cache.commitError(CHART_1, error, SHEET_A);

    const state = cache.getCompileState(CHART_1, SHEET_A);
    expect(state.isCompilePending).toBe(false);
    expect(cache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    expect(cache.getCachedLayout(CHART_1, SHEET_A)).toBeUndefined();
    expect(cache.getCachedError(CHART_1, SHEET_A)).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('clearAllCaches fires * and leaves the sheet index intact', () => {
    const cache = startedCache();
    const seen: string[] = [];
    cache.setSheetId(CHART_1, SHEET_A);
    cache.commitMarks(CHART_1, marks, { sheetId: SHEET_A, layout });
    cache.onCacheUpdate((chartId) => seen.push(chartId));

    cache.clearAllCaches();

    expect(seen).toEqual(['*']);
    expect(cache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    expect(cache.getSheetId(CHART_1)).toBe(SHEET_A);
  });

  it('stop clears listeners in place and clears the sheet index', () => {
    const cache = startedCache();
    const seen: string[] = [];
    cache.setSheetId(CHART_1, SHEET_A);
    const off = cache.onCacheUpdate((chartId) => seen.push(chartId));

    cache.stop();
    expect(() => off()).not.toThrow();

    cache.start();
    cache.clearAllCaches();

    expect(seen).toEqual([]);
    expect(cache.hasSheetId(CHART_1)).toBe(false);
  });

  it('sheet-scoped keys isolate same chart IDs on different sheets', () => {
    const cache = startedCache();
    const sheetAMarks = [{ type: 'group', children: [] }] as unknown as ChartMark[];
    const sheetBMarks = [{ type: 'group', children: [{ type: 'text' }] }] as unknown as ChartMark[];
    const sheetBLayout: ChartLayoutSnapshot = {
      plotArea: { left: 0.5, top: 0.6, width: 0.7, height: 0.8 },
    };

    cache.commitMarks(CHART_1, sheetAMarks, { sheetId: SHEET_A, layout });
    cache.commitMarks(CHART_1, sheetBMarks, { sheetId: SHEET_B, layout: sheetBLayout });
    cache.commitError(CHART_1, error, SHEET_A);
    cache.invalidateChart(CHART_1, SHEET_A);
    cache.beginCompilation(CHART_1, SHEET_B);

    expect(cache.getCachedMarks(CHART_1, SHEET_A)).toBe(sheetAMarks);
    expect(cache.getCachedMarks(CHART_1, SHEET_B)).toBe(sheetBMarks);
    expect(cache.getCachedLayout(CHART_1, SHEET_A)).toEqual(layout);
    expect(cache.getCachedLayout(CHART_1, SHEET_B)).toEqual(sheetBLayout);
    expect(cache.getDirtyChartKeys()).toContain(cache.cacheKey(CHART_1, SHEET_A));
    expect(cache.getDirtyChartKeys()).not.toContain(cache.cacheKey(CHART_1, SHEET_B));
    expect(cache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    expect(cache.isCompilationPending(CHART_1, SHEET_B)).toBe(true);
    expect(cache.getCachedError(CHART_1, SHEET_B)).toBeUndefined();

    cache.syncImportRenderStatus(
      CHART_1,
      {
        importStatus: {
          renderable: false,
          message: 'Sheet A imported chart cannot render',
        },
      },
      SHEET_A,
    );

    expect(cache.getImportRenderStatus(CHART_1, SHEET_A)?.message).toBe(
      'Sheet A imported chart cannot render',
    );
    expect(cache.getImportRenderStatus(CHART_1, SHEET_B)).toBeUndefined();
    expect(cache.getCachedError(CHART_1, SHEET_A)?.code).toBe('RENDER_FAILED');
    expect(cache.getCachedMarks(CHART_1, SHEET_B)).toBe(sheetBMarks);
    expect(cache.getCachedLayout(CHART_1, SHEET_B)).toEqual(sheetBLayout);
    expect(cache.isCompilationPending(CHART_1, SHEET_B)).toBe(true);
  });

  it('terminal import status clears render caches and commits a render error', () => {
    const cache = startedCache();
    cache.commitMarks(CHART_1, marks, { sheetId: SHEET_A, layout });
    cache.invalidateChart(CHART_1, SHEET_A);
    cache.beginCompilation(CHART_1, SHEET_A);

    const terminal = cache.syncImportRenderStatus(
      CHART_1,
      {
        importStatus: {
          state: 'non-renderable',
          message: 'Imported chart renderer unavailable',
        },
      },
      SHEET_A,
    );

    expect(terminal).toBe(true);
    expect(cache.getCachedMarks(CHART_1, SHEET_A)).toBeUndefined();
    expect(cache.getCachedLayout(CHART_1, SHEET_A)).toBeUndefined();
    expect(cache.getImportRenderStatus(CHART_1, SHEET_A)?.message).toBe(
      'Imported chart renderer unavailable',
    );
    expect(cache.getDirtyChartKeys()).not.toContain(cache.cacheKey(CHART_1, SHEET_A));
    expect(cache.isCompilationPending(CHART_1, SHEET_A)).toBe(false);
    expect(cache.getCachedError(CHART_1, SHEET_A)?.code).toBe('RENDER_FAILED');
  });
});
