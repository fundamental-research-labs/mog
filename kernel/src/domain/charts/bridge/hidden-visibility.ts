import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ChartConfig } from '@mog-sdk/contracts/data/charts';

import type { ResolvedChartRangeReferences } from '../chart-range-references';

export type HiddenCellVisibility = {
  hiddenRowsBySheet: Map<string, Set<number>>;
  hiddenColsBySheet: Map<string, Set<number>>;
};

export type HiddenDimensionBridge = {
  getHiddenRows?: (sheetId: SheetId) => Promise<number[]>;
  getHiddenColumns?: (sheetId: SheetId) => Promise<number[]>;
};

export function isCellHidden(
  sheetId: string | undefined,
  row: number,
  col: number,
  visibility: HiddenCellVisibility | undefined,
): boolean {
  if (!sheetId || !visibility) return false;
  const key = String(sheetId);
  return (
    (visibility.hiddenRowsBySheet.get(key)?.has(row) ?? false) ||
    (visibility.hiddenColsBySheet.get(key)?.has(col) ?? false)
  );
}

export function isRangeFullyHidden(range: CellRange, visibility: HiddenCellVisibility): boolean {
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      if (!isCellHidden(range.sheetId, row, col, visibility)) return false;
    }
  }
  return true;
}

export async function loadHiddenVisibility(
  ranges: Array<CellRange | null | undefined>,
  bridge: HiddenDimensionBridge | null | undefined,
): Promise<HiddenCellVisibility | undefined> {
  const sheetIds = new Set<string>();
  for (const range of ranges) {
    if (range?.sheetId) sheetIds.add(String(range.sheetId));
  }
  if (sheetIds.size === 0) return undefined;
  if (!bridge?.getHiddenRows && !bridge?.getHiddenColumns) return undefined;

  const hiddenRowsBySheet = new Map<string, Set<number>>();
  const hiddenColsBySheet = new Map<string, Set<number>>();
  await Promise.all(
    [...sheetIds].map(async (id) => {
      const sheet = toSheetId(id);
      const [rows, cols] = await Promise.all([
        bridge.getHiddenRows?.(sheet) ?? Promise.resolve([]),
        bridge.getHiddenColumns?.(sheet) ?? Promise.resolve([]),
      ]);
      hiddenRowsBySheet.set(id, new Set(rows));
      hiddenColsBySheet.set(id, new Set(cols));
    }),
  );

  return { hiddenRowsBySheet, hiddenColsBySheet };
}

export function withHiddenSeriesFiltered(
  config: ChartConfig,
  resolvedRanges: ResolvedChartRangeReferences,
  hiddenVisibility: HiddenCellVisibility,
): ChartConfig {
  if (!config.series?.length) return config;
  let changed = false;
  const seriesReferencesBySourceIndex = new Map(
    resolvedRanges.seriesReferences.map((reference) => [reference.index, reference]),
  );
  const series = config.series.flatMap((item, index) => {
    const sourceSeriesIndex = sourceSeriesIndexForConfig(item, index);
    const reference =
      seriesReferencesBySourceIndex.get(sourceSeriesIndex) ??
      resolvedRanges.seriesReferences[index];
    const liveDimensionRanges = [
      reference?.values?.range,
      reference?.categories?.range,
      reference?.bubbleSizes?.range,
    ];
    if (liveDimensionRanges.some((range) => range && isRangeFullyHidden(range, hiddenVisibility))) {
      changed = true;
      return [];
    }
    const sourceSeriesKey = sourceSeriesKeyForConfig(item, sourceSeriesIndex);
    if (item.sourceSeriesIndex === sourceSeriesIndex && item.sourceSeriesKey === sourceSeriesKey) {
      return [item];
    }
    changed = true;
    return [{ ...item, sourceSeriesIndex, sourceSeriesKey }];
  });
  return changed ? { ...config, series } : config;
}

function sourceSeriesIndexForConfig(
  series: NonNullable<ChartConfig['series']>[number],
  fallbackIndex: number,
): number {
  return typeof series.sourceSeriesIndex === 'number' &&
    Number.isInteger(series.sourceSeriesIndex) &&
    series.sourceSeriesIndex >= 0
    ? series.sourceSeriesIndex
    : fallbackIndex;
}

function sourceSeriesKeyForConfig(
  series: NonNullable<ChartConfig['series']>[number],
  fallbackIndex: number,
): string {
  if (series.sourceSeriesKey) return series.sourceSeriesKey;
  if (series.pivotSeriesKey) return `pivot:${series.pivotSeriesKey}`;
  if (typeof series.idx === 'number' && Number.isInteger(series.idx) && series.idx >= 0) {
    return `idx:${series.idx}`;
  }
  if (typeof series.order === 'number' && Number.isInteger(series.order) && series.order >= 0) {
    return `order:${series.order}`;
  }
  return `series:${fallbackIndex}`;
}
