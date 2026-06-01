import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../../context/types';
import {
  resolveChartRangeReferences,
  type ResolvedChartRangeReference,
  type ResolvedChartRangeReferences,
} from '../chart-range-references';
import { getAll as getAllCharts } from '../chart-store';

export interface ChartReferenceScanOptions {
  isLive?: () => boolean;
}

export type AffectedChartInvalidation = {
  chartId: string;
  sheetId?: SheetId;
};

export async function getAllChartsInWorkbook(ctx: DocumentContext): Promise<ChartFloatingObject[]> {
  const sheetIds = await ctx.computeBridge.getSheetOrder();
  const perSheet = await Promise.all(sheetIds.map((id) => getAllCharts(ctx, toSheetId(id))));
  return perSheet.flat();
}

/**
 * Check if a chart's data range includes a specific cell.
 */
export async function chartReferencesCell(
  ctx: DocumentContext,
  chart: ChartFloatingObject,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  const resolved = await resolveChartRangeReferences(ctx, chart);
  const ranges = resolvedChartReferenceRanges(resolved);

  return ranges.some((entry) => {
    const range = entry?.range;
    return range !== undefined && rangeContainsCell(range, sheetId, row, col);
  });
}

/**
 * Get charts that are affected by changes in a specific cell range.
 */
export async function getChartsAffectedByRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  options: ChartReferenceScanOptions = {},
): Promise<string[]> {
  return (await getChartInvalidationsAffectedByRange(ctx, sheetId, range, options)).map(
    (chart) => chart.chartId,
  );
}

export async function getChartInvalidationsAffectedByRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  options: ChartReferenceScanOptions = {},
): Promise<AffectedChartInvalidation[]> {
  if (options.isLive && !options.isLive()) return [];

  const charts = await getAllChartsInWorkbook(ctx);
  if (options.isLive && !options.isLive()) return [];

  const affected: AffectedChartInvalidation[] = [];

  for (const chart of charts) {
    if (options.isLive && !options.isLive()) return affected;
    const resolved = await resolveChartRangeReferences(ctx, chart);
    if (options.isLive && !options.isLive()) return affected;
    const overlaps = resolvedChartReferenceRanges(resolved).some((entry) => {
      const chartRange = entry?.range;
      return chartRange !== undefined && rangesOverlapOnSheet(sheetId, range, chartRange);
    });

    if (overlaps) {
      affected.push({ chartId: chart.id, sheetId: chartOwnerSheetId(chart) });
    }
  }

  return affected;
}

export function resolvedChartReferenceRanges(
  resolved: ResolvedChartRangeReferences,
): Array<ResolvedChartRangeReference | null | undefined> {
  return [
    resolved.dataRange,
    resolved.categoryRange,
    resolved.seriesRange,
    ...resolved.seriesReferences.flatMap((series) => [
      series.name,
      series.values,
      series.categories,
      series.bubbleSizes,
    ]),
  ];
}

export function chartOwnerSheetId(chart: ChartFloatingObject): SheetId | undefined {
  return chart.sheetId ? toSheetId(chart.sheetId) : undefined;
}

function rangeContainsCell(range: CellRange, sheetId: SheetId, row: number, col: number): boolean {
  return (
    range.sheetId === sheetId &&
    row >= range.startRow &&
    row <= range.endRow &&
    col >= range.startCol &&
    col <= range.endCol
  );
}

function rangesOverlapOnSheet(sheetId: SheetId, changedRange: CellRange, chartRange: CellRange) {
  return (
    chartRange.sheetId === sheetId &&
    changedRange.startRow <= chartRange.endRow &&
    changedRange.endRow >= chartRange.startRow &&
    changedRange.startCol <= chartRange.endCol &&
    changedRange.endCol >= chartRange.startCol
  );
}
