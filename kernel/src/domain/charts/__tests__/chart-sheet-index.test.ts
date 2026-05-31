import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import { ChartSheetIndex } from '../bridge/chart-sheet-index';

const SHEET_A: SheetId = toSheetId('sheet-a');
const SHEET_B: SheetId = toSheetId('sheet-b');
const CHART_1 = 'chart-1';
const CHART_2 = 'chart-2';
const CHART_3 = 'chart-3';

describe('ChartSheetIndex', () => {
  it('supports get, set, delete, and clear', () => {
    const index = new ChartSheetIndex();

    expect(index.get(CHART_1)).toBeUndefined();
    expect(index.has(CHART_1)).toBe(false);

    index.set(CHART_1, SHEET_A);
    expect(index.get(CHART_1)).toBe(SHEET_A);
    expect(index.has(CHART_1)).toBe(true);

    index.set(CHART_1, SHEET_B);
    expect(index.get(CHART_1)).toBe(SHEET_B);

    expect(index.delete(CHART_1)).toBe(true);
    expect(index.get(CHART_1)).toBeUndefined();
    expect(index.has(CHART_1)).toBe(false);
    expect(index.delete(CHART_1)).toBe(false);

    index.set(CHART_1, SHEET_A);
    index.set(CHART_2, SHEET_B);
    index.clear();
    expect(index.get(CHART_1)).toBeUndefined();
    expect(index.get(CHART_2)).toBeUndefined();
  });

  it('uses an explicit sheetId for cache keys before index lookup', () => {
    const index = new ChartSheetIndex();
    index.set(CHART_1, SHEET_A);

    expect(index.resolveSheetId(CHART_1, SHEET_B)).toBe(SHEET_B);
    expect(index.cacheKey(CHART_1, SHEET_B)).toBe(`${SHEET_B}::${CHART_1}`);
  });

  it('uses the indexed sheetId for cache keys when no explicit sheetId is provided', () => {
    const index = new ChartSheetIndex();
    index.set(CHART_1, SHEET_A);

    expect(index.resolveSheetId(CHART_1)).toBe(SHEET_A);
    expect(index.cacheKey(CHART_1)).toBe(`${SHEET_A}::${CHART_1}`);
  });

  it('falls back to the raw chartId cache key when no sheetId is known', () => {
    const index = new ChartSheetIndex();

    expect(index.resolveSheetId(CHART_1)).toBeUndefined();
    expect(index.cacheKey(CHART_1)).toBe(CHART_1);
  });

  it('returns chart ids for one sheet without changing the one-sheet-per-chart invariant', () => {
    const index = new ChartSheetIndex();
    index.set(CHART_1, SHEET_A);
    index.set(CHART_2, SHEET_B);
    index.set(CHART_3, SHEET_A);
    index.set(CHART_1, SHEET_B);

    expect(index.chartIdsForSheet(SHEET_A)).toEqual([CHART_3]);
    expect(index.chartIdsForSheet(SHEET_B)).toEqual([CHART_1, CHART_2]);
  });
});
