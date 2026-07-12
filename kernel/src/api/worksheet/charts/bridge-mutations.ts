import type { ChartTarget, SheetId } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../context';
import { callNativeChartMutation } from '../../../errors/chart';
import { chartMutationOptions, requireChartTarget } from '../chart-api-helpers';

export async function updateRawWorksheetChart(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  fields: Record<string, unknown>,
): Promise<void> {
  const { resolvedChartId } = await requireChartTarget(ctx, sheetId, chartTarget);
  await callNativeChartMutation(
    chartTarget,
    () =>
      ctx.computeBridge.updateChart(
        sheetId,
        resolvedChartId,
        fields,
        chartMutationOptions(ctx, sheetId, 'charts.update'),
      ),
    resolvedChartId,
  );
}

export async function bringWorksheetChartToFront(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
): Promise<void> {
  const { resolvedChartId } = await requireChartTarget(ctx, sheetId, chartTarget);
  await callNativeChartMutation(
    chartTarget,
    () =>
      ctx.computeBridge.bringChartToFront(
        sheetId,
        resolvedChartId,
        chartMutationOptions(ctx, sheetId, 'charts.bringToFront'),
      ),
    resolvedChartId,
  );
}

export async function sendWorksheetChartToBack(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
): Promise<void> {
  const { resolvedChartId } = await requireChartTarget(ctx, sheetId, chartTarget);
  await callNativeChartMutation(
    chartTarget,
    () =>
      ctx.computeBridge.sendChartToBack(
        sheetId,
        resolvedChartId,
        chartMutationOptions(ctx, sheetId, 'charts.sendToBack'),
      ),
    resolvedChartId,
  );
}

export async function bringWorksheetChartForward(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
): Promise<void> {
  const { resolvedChartId } = await requireChartTarget(ctx, sheetId, chartTarget);
  await callNativeChartMutation(
    chartTarget,
    () =>
      ctx.computeBridge.bringChartForward(
        sheetId,
        resolvedChartId,
        chartMutationOptions(ctx, sheetId, 'charts.bringForward'),
      ),
    resolvedChartId,
  );
}

export async function sendWorksheetChartBackward(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
): Promise<void> {
  const { resolvedChartId } = await requireChartTarget(ctx, sheetId, chartTarget);
  await callNativeChartMutation(
    chartTarget,
    () =>
      ctx.computeBridge.sendChartBackward(
        sheetId,
        resolvedChartId,
        chartMutationOptions(ctx, sheetId, 'charts.sendBackward'),
      ),
    resolvedChartId,
  );
}

export async function linkWorksheetChartToTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  tableId: string,
): Promise<void> {
  const { resolvedChartId } = await requireChartTarget(ctx, sheetId, chartTarget);
  await callNativeChartMutation(
    chartTarget,
    () =>
      ctx.computeBridge.linkChartToTable(
        sheetId,
        resolvedChartId,
        tableId,
        chartMutationOptions(ctx, sheetId, 'charts.linkToTable'),
      ),
    resolvedChartId,
  );
}

export async function unlinkWorksheetChartFromTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
): Promise<void> {
  const { resolvedChartId } = await requireChartTarget(ctx, sheetId, chartTarget);
  await callNativeChartMutation(
    chartTarget,
    () =>
      ctx.computeBridge.unlinkChartFromTable(
        sheetId,
        resolvedChartId,
        chartMutationOptions(ctx, sheetId, 'charts.unlinkFromTable'),
      ),
    resolvedChartId,
  );
}
