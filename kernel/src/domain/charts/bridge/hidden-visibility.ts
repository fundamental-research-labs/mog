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
  const series = config.series.filter((_, index) => {
    const valuesRange = resolvedRanges.seriesReferences[index]?.values?.range;
    return !valuesRange || !isRangeFullyHidden(valuesRange, hiddenVisibility);
  });
  return series.length === config.series.length ? config : { ...config, series };
}
