import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import { ChartSheetIndex } from '../bridge/chart-sheet-index';

const SHEET_A: SheetId = toSheetId('sheet-a');
const SHEET_B: SheetId = toSheetId('sheet-b');
const CHART_1 = 'chart-1';
const CHART_2 = 'chart-2';
const CHART_3 = 'chart-3';

describe('ChartSheetIndex', () => {
  it('supports get, set, sheet-scoped delete, and clear for unambiguous chart ids', () => {
    const index = new ChartSheetIndex();

    expect(index.get(CHART_1)).toBeUndefined();
    expect(index.has(CHART_1)).toBe(false);
    expect(index.has(CHART_1, SHEET_A)).toBe(false);

    index.set(CHART_1, SHEET_A);
    expect(index.get(CHART_1)).toBe(SHEET_A);
    expect(index.has(CHART_1)).toBe(true);
    expect(index.has(CHART_1, SHEET_A)).toBe(true);
    expect(index.has(CHART_1, SHEET_B)).toBe(false);

    expect(index.delete(CHART_1, SHEET_A)).toBe(true);
    expect(index.get(CHART_1)).toBeUndefined();
    expect(index.has(CHART_1)).toBe(false);
    expect(index.delete(CHART_1, SHEET_A)).toBe(false);

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

  it('keeps the same chart id isolated across sheet contexts', () => {
    const index = new ChartSheetIndex();
    index.set(CHART_1, SHEET_A);
    index.set(CHART_1, SHEET_B);

    expect(index.has(CHART_1)).toBe(true);
    expect(index.has(CHART_1, SHEET_A)).toBe(true);
    expect(index.has(CHART_1, SHEET_B)).toBe(true);
    expect(index.get(CHART_1)).toBeUndefined();
    expect(index.resolveSheetId(CHART_1)).toBeUndefined();
    expect(index.cacheKey(CHART_1)).toBe(CHART_1);
    expect(index.cacheKey(CHART_1, SHEET_A)).toBe(`${SHEET_A}::${CHART_1}`);
    expect(index.cacheKey(CHART_1, SHEET_B)).toBe(`${SHEET_B}::${CHART_1}`);
    expect(index.chartIdsForSheet(SHEET_A)).toEqual([CHART_1]);
    expect(index.chartIdsForSheet(SHEET_B)).toEqual([CHART_1]);
  });

  it('does not perform ambiguous unscoped deletes for duplicated chart ids', () => {
    const index = new ChartSheetIndex();
    index.set(CHART_1, SHEET_A);
    index.set(CHART_1, SHEET_B);

    expect(index.delete(CHART_1)).toBe(false);
    expect(index.has(CHART_1, SHEET_A)).toBe(true);
    expect(index.has(CHART_1, SHEET_B)).toBe(true);

    expect(index.delete(CHART_1, SHEET_A)).toBe(true);
    expect(index.has(CHART_1, SHEET_A)).toBe(false);
    expect(index.has(CHART_1, SHEET_B)).toBe(true);
    expect(index.resolveSheetId(CHART_1)).toBe(SHEET_B);
  });

  it('handles duplicate same-sheet registrations idempotently', () => {
    const index = new ChartSheetIndex();
    index.set(CHART_1, SHEET_A);
    index.set(CHART_1, SHEET_A);

    expect(index.get(CHART_1)).toBe(SHEET_A);
    expect(index.chartIdsForSheet(SHEET_A)).toEqual([CHART_1]);
    expect(index.delete(CHART_1, SHEET_A)).toBe(true);
    expect(index.delete(CHART_1, SHEET_A)).toBe(false);
    expect(index.has(CHART_1)).toBe(false);
  });

  it('returns chart ids for one sheet without collapsing duplicate ids on other sheets', () => {
    const index = new ChartSheetIndex();
    index.set(CHART_1, SHEET_A);
    index.set(CHART_2, SHEET_B);
    index.set(CHART_3, SHEET_A);
    index.set(CHART_1, SHEET_B);

    expect(index.chartIdsForSheet(SHEET_A)).toEqual([CHART_1, CHART_3]);
    expect(index.chartIdsForSheet(SHEET_B)).toEqual([CHART_2, CHART_1]);
  });

  it('deletes a whole sheet context while preserving duplicate chart ids on other sheets', () => {
    const index = new ChartSheetIndex();
    index.set(CHART_1, SHEET_A);
    index.set(CHART_2, SHEET_A);
    index.set(CHART_1, SHEET_B);

    expect(index.deleteSheet(SHEET_A)).toEqual([CHART_1, CHART_2]);

    expect(index.chartIdsForSheet(SHEET_A)).toEqual([]);
    expect(index.has(CHART_1, SHEET_A)).toBe(false);
    expect(index.has(CHART_2)).toBe(false);
    expect(index.has(CHART_1, SHEET_B)).toBe(true);
    expect(index.resolveSheetId(CHART_1)).toBe(SHEET_B);
    expect(index.deleteSheet(SHEET_A)).toEqual([]);
  });
});
