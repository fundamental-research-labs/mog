import type { ChartReadOptions, SheetId } from '@mog-sdk/contracts/api';
import type { ChartAppModel } from '@mog-sdk/contracts/data/chart-app-model';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context';
import { chartToAppModel } from '../../domain/charts/chart-app-model';
import { serializedChartToChart } from '../../domain/charts/chart-public-api-converters';
import { awaitChartReadScope, resolveChartIdInput } from './chart-api-helpers';

export async function getWorksheetChartAppModel(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  options?: ChartReadOptions,
): Promise<ChartAppModel | null> {
  await awaitChartReadScope(ctx, sheetId, options);
  const resolvedChartId = await resolveChartIdInput(ctx, sheetId, chartId);
  const raw = (await ctx.computeBridge.getChart(
    sheetId,
    resolvedChartId,
  )) as ChartFloatingObject | null;
  return raw ? chartToAppModel(serializedChartToChart(raw)) : null;
}
