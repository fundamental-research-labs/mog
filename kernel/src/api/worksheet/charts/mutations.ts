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
import {
  createGroupedChartMutationOptions,
  nextChartMutationOptions,
  type ChartMutationOptionsInput,
} from '../../../domain/charts/chart-mutation-context';
import { chartNotFound } from '../../../errors/api';
import {
  assertSupportedNativeXlsxChartConfig,
  awaitSheetMaterialized,
  chartMutationOptions,
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

  await ctx.computeBridge.updateChart(
    sheetId,
    resolvedChartId,
    internalUpdates,
    chartMutationOptions(ctx, sheetId, 'charts.update'),
  );
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
  admissionOptions?: ChartMutationOptionsInput,
): Promise<ChartRemoveReceipt> {
  await awaitSheetMaterialized(ctx, sheetId);
  const resolvedChartId = await resolveChartIdInput(ctx, sheetId, chartId);
  const existing = (await ctx.computeBridge.getChart(
    sheetId,
    resolvedChartId,
  )) as ChartFloatingObject | null;
  if (!existing) throw chartNotFound(chartId);

  await ctx.computeBridge.deleteChart(
    sheetId,
    resolvedChartId,
    nextChartMutationOptions(admissionOptions) ??
      chartMutationOptions(ctx, sheetId, 'charts.delete'),
  );
  return buildChartRemoveReceipt(sheetId, resolvedChartId);
}

export async function clearWorksheetCharts(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartIds: readonly string[],
): Promise<void> {
  const nextOptions = createGroupedChartMutationOptions(ctx, {
    operationIdPrefix: 'charts.delete',
    sheetIds: [sheetId],
  });
  for (const chartId of chartIds) {
    await removeChartWithReceipt(ctx, sheetId, chartId, nextOptions);
  }
}
