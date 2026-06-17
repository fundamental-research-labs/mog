import type {
  ChartConfig,
  ChartRemoveReceipt,
  ChartUpdateReceipt,
  SheetId,
} from '@mog-sdk/contracts/api';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../../context';
import {
  chartUpdatesToInternal,
  serializedChartToChart,
} from '../../../domain/charts/chart-public-api-converters';
import { chartNotFound } from '../../../errors/api';
import {
  assertSupportedNativeXlsxChartConfig,
  awaitSheetMaterialized,
  resolveChartIdInput,
} from '../chart-api-helpers';
import { buildChartRemoveReceipt, buildChartUpdateReceipt } from './receipts';

export async function updateChartWithReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  updates: Partial<ChartConfig>,
): Promise<ChartUpdateReceipt> {
  assertSupportedNativeXlsxChartConfig(updates);
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
  const updated = (await ctx.computeBridge.getChart(
    sheetId,
    resolvedChartId,
  )) as ChartFloatingObject | null;
  const chart = serializedChartToChart(
    updated ?? ({ ...existing, ...internalUpdates, id: resolvedChartId } as ChartFloatingObject),
  );
  return buildChartUpdateReceipt(sheetId, chart, Object.keys(updates));
}

export async function removeChartWithReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<ChartRemoveReceipt> {
  await awaitSheetMaterialized(ctx, sheetId);
  const resolvedChartId = await resolveChartIdInput(ctx, sheetId, chartId);
  const existing = (await ctx.computeBridge.getChart(
    sheetId,
    resolvedChartId,
  )) as ChartFloatingObject | null;
  if (!existing) throw chartNotFound(chartId);

  await ctx.computeBridge.deleteChart(sheetId, resolvedChartId);
  return buildChartRemoveReceipt(sheetId, resolvedChartId);
}
