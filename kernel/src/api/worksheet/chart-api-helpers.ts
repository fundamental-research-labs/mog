import type { Chart, ChartConfig, ChartReadOptions, SheetId } from '@mog-sdk/contracts/api';
import type { SeriesConfig } from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context';
import {
  chartUpdatesToInternal,
  serializedChartToChart,
  unsupportedNativeXlsxChartType,
} from '../../domain/charts/chart-public-api-converters';
import { chartNotFound, invalidChartConfig } from '../../errors/api';

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

export async function applyUpdate(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  updates: Partial<ChartConfig>,
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
  await ctx.computeBridge.updateChart(sheetId, resolvedChartId, internalUpdates);
}
