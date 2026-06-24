import type { Chart, ChartConfig, ChartReadOptions, SheetId } from '@mog-sdk/contracts/api';
import type { SeriesConfig } from '@mog-sdk/contracts/data/charts';
import { detectSeriesOrientation } from '@mog/charts';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context';
import {
  chartUpdatesToInternal,
  serializedChartToChart,
  unsupportedNativeXlsxChartType,
} from '../../domain/charts/chart-public-api-converters';
import {
  createChartMutationOptions,
  nextChartMutationOptions,
  type ChartMutationOptions,
  type ChartMutationOptionsInput,
} from '../../domain/charts/chart-mutation-context';
import { chartNotFound, invalidChartConfig, operationFailed } from '../../errors/api';

export function assertSupportedNativeXlsxChartConfig(
  config: Partial<Pick<ChartConfig, 'type'>>,
): void {
  const unsupportedType = unsupportedNativeXlsxChartType(config);
  if (unsupportedType) {
    throw invalidChartConfig(
      `Chart type "${unsupportedType}" is not supported because it has no native Excel XLSX chart representation`,
    );
  }
}

export async function awaitSheetMaterialized(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<void> {
  await ctx.awaitMaterialized?.(sheetId);
}

export async function awaitChartReadScope(
  ctx: DocumentContext,
  sheetId: SheetId,
  options?: ChartReadOptions,
): Promise<void> {
  const materialization = options?.materialization ?? 'sheet';
  if (materialization === 'available') {
    return;
  }
  if (materialization === 'complete') {
    await ctx.awaitMaterialized?.('allSheets');
    return;
  }
  if (materialization === 'sheet') {
    await awaitSheetMaterialized(ctx, sheetId);
  }
}

export function chartMutationOptions(
  ctx: DocumentContext,
  sheetId: SheetId,
  operationIdPrefix: string,
): ChartMutationOptions {
  return createChartMutationOptions(ctx, {
    operationIdPrefix,
    sheetIds: [sheetId],
  });
}

export async function resolveChartIdInput(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<string> {
  const exact = (await ctx.computeBridge.getChart(sheetId, chartId)) as ChartFloatingObject | null;
  if (exact) return chartId;
  if (!/^chart-import-\d+$/.test(chartId)) return chartId;

  const candidate = `${chartId}-${sheetId}`;
  const scoped = (await ctx.computeBridge.getChart(
    sheetId,
    candidate,
  )) as ChartFloatingObject | null;
  return scoped ? candidate : chartId;
}

export async function requireChart(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<Chart> {
  await awaitSheetMaterialized(ctx, sheetId);
  const resolvedChartId = await resolveChartIdInput(ctx, sheetId, chartId);
  const raw = (await ctx.computeBridge.getChart(
    sheetId,
    resolvedChartId,
  )) as ChartFloatingObject | null;
  if (!raw) throw chartNotFound(chartId);
  return serializedChartToChart(raw);
}

export async function requireChartWithSeries(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<{ chart: Chart; series: SeriesConfig[] }> {
  const chart = await requireChart(ctx, sheetId, chartId);
  const series = [...(chart.series ?? [])];
  return { chart, series };
}

function inferredRangeSeriesMutationCapacity(chart: Chart): number {
  if (!chart.dataRange) return 0;
  const dataRange = parseCellRange(chart.dataRange);
  if (!dataRange) return 0;

  const rowCount = dataRange.endRow - dataRange.startRow + 1;
  const colCount = dataRange.endCol - dataRange.startCol + 1;
  if (rowCount <= 0 || colCount <= 0) return 0;

  if (rowCount === 1 || colCount === 1) return 1;

  const orientation = chart.seriesOrientation ?? detectSeriesOrientation(dataRange);
  if (orientation === 'columns') {
    return Math.max(0, colCount - (chart.categoryRange ? 0 : 1));
  }
  return Math.max(0, rowCount - (chart.categoryRange ? 0 : 1));
}

export function chartSeriesCount(chart: Chart): number {
  return chart.series?.length ?? 0;
}

function chartSeriesMutationCapacity(chart: Chart): number {
  const explicitSeriesCount = chartSeriesCount(chart);
  return explicitSeriesCount > 0 ? explicitSeriesCount : inferredRangeSeriesMutationCapacity(chart);
}

export async function requireChartSeriesForMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  seriesIndex: number,
  operation: string,
): Promise<{ chart: Chart; series: SeriesConfig[] }> {
  if (!Number.isInteger(seriesIndex) || seriesIndex < 0) {
    throw operationFailed(operation, `Series index ${seriesIndex} out of range`);
  }

  const { chart, series } = await requireChartWithSeries(ctx, sheetId, chartId);
  const capacity = chartSeriesMutationCapacity(chart);
  if (seriesIndex >= capacity) {
    throw operationFailed(
      operation,
      `Series index ${seriesIndex} out of range (0-${capacity - 1})`,
    );
  }

  while (series.length <= seriesIndex) {
    series.push({});
  }
  return { chart, series };
}

export async function applyUpdate(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  updates: Partial<ChartConfig>,
  admissionOptions?: ChartMutationOptionsInput,
): Promise<void> {
  await awaitSheetMaterialized(ctx, sheetId);
  const resolvedChartId = await resolveChartIdInput(ctx, sheetId, chartId);
  const existing = (await ctx.computeBridge.getChart(
    sheetId,
    resolvedChartId,
  )) as ChartFloatingObject | null;
  if (!existing) throw chartNotFound(chartId);
  const internalUpdates = chartUpdatesToInternal(updates);
  if (internalUpdates.anchor && existing.anchor) {
    internalUpdates.anchor = { ...existing.anchor, ...internalUpdates.anchor };
  }
  await ctx.computeBridge.updateChart(
    sheetId,
    resolvedChartId,
    internalUpdates,
    nextChartMutationOptions(admissionOptions) ??
      createChartMutationOptions(ctx, {
        operationIdPrefix: 'charts.update',
        sheetIds: [sheetId],
      }),
  );
}
