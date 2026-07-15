import type {
  ChartConfig,
  ChartRemoveReceipt,
  ChartTarget,
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
import {
  assertSupportedNativeXlsxChartConfig,
  chartMutationOptions,
  requireChartTarget,
} from '../chart-api-helpers';
import { callNativeChartMutation } from '../../../errors/chart';
import { buildChartRemoveReceipt, buildChartUpdateReceipt } from './receipts';

export async function updateChartWithReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  updates: Partial<ChartConfig>,
): Promise<ChartUpdateReceipt> {
  assertSupportedNativeXlsxChartConfig(updates);
  const { resolvedChartId, raw: existing } = await requireChartTarget(ctx, sheetId, chartTarget);

  const internalUpdates = chartUpdatesToInternal(updates);
  if (internalUpdates.anchor && existing.anchor) {
    internalUpdates.anchor = { ...existing.anchor, ...internalUpdates.anchor };
  }

  await callNativeChartMutation(
    chartTarget,
    () =>
      ctx.computeBridge.updateChart(
        sheetId,
        resolvedChartId,
        internalUpdates,
        chartMutationOptions(ctx, sheetId, 'charts.update'),
      ),
    resolvedChartId,
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
  chartTarget: ChartTarget,
  admissionOptions?: ChartMutationOptionsInput,
): Promise<ChartRemoveReceipt> {
  const { resolvedChartId } = await requireChartTarget(ctx, sheetId, chartTarget);

  await callNativeChartMutation(
    chartTarget,
    () =>
      ctx.computeBridge.deleteChart(
        sheetId,
        resolvedChartId,
        nextChartMutationOptions(admissionOptions) ??
          chartMutationOptions(ctx, sheetId, 'charts.delete'),
      ),
    resolvedChartId,
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
    await removeChartWithReceipt(ctx, sheetId, { id: chartId }, nextOptions);
  }
}
