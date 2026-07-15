import type { ChartReadOptions, ChartTarget, SheetId } from '@mog-sdk/contracts/api';
import type { ChartAppModel } from '@mog-sdk/contracts/data/chart-app-model';

import type { DocumentContext } from '../../context';
import { chartToAppModel } from '../../domain/charts/chart-app-model';
import { serializedChartToChart } from '../../domain/charts/chart-public-api-converters';
import { awaitChartReadScope, resolveOptionalChartTarget } from './chart-api-helpers';

export async function getWorksheetChartAppModel(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  options?: ChartReadOptions,
): Promise<ChartAppModel | null> {
  await awaitChartReadScope(ctx, sheetId, options);
  const resolved = await resolveOptionalChartTarget(ctx, sheetId, chartTarget);
  const raw = resolved?.raw ?? null;
  return raw ? chartToAppModel(serializedChartToChart(raw)) : null;
}
