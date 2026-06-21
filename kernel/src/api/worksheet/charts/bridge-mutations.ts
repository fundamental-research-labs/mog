import type { SheetId } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../context';
import {
  awaitSheetMaterialized,
  chartMutationOptions,
  resolveChartIdInput,
} from '../chart-api-helpers';

export async function updateRawWorksheetChart(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await awaitSheetMaterialized(ctx, sheetId);
  const resolvedChartId = await resolveChartIdInput(ctx, sheetId, chartId);
  await ctx.computeBridge.updateChart(
    sheetId,
    resolvedChartId,
    fields,
    chartMutationOptions(ctx, sheetId, 'charts.update'),
  );
}

export async function bringWorksheetChartToFront(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<void> {
  await awaitSheetMaterialized(ctx, sheetId);
  await ctx.computeBridge.bringChartToFront(
    sheetId,
    await resolveChartIdInput(ctx, sheetId, chartId),
    chartMutationOptions(ctx, sheetId, 'charts.bringToFront'),
  );
}

export async function sendWorksheetChartToBack(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<void> {
  await awaitSheetMaterialized(ctx, sheetId);
  await ctx.computeBridge.sendChartToBack(
    sheetId,
    await resolveChartIdInput(ctx, sheetId, chartId),
    chartMutationOptions(ctx, sheetId, 'charts.sendToBack'),
  );
}

export async function bringWorksheetChartForward(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<void> {
  await awaitSheetMaterialized(ctx, sheetId);
  await ctx.computeBridge.bringChartForward(
    sheetId,
    await resolveChartIdInput(ctx, sheetId, chartId),
    chartMutationOptions(ctx, sheetId, 'charts.bringForward'),
  );
}

export async function sendWorksheetChartBackward(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<void> {
  await awaitSheetMaterialized(ctx, sheetId);
  await ctx.computeBridge.sendChartBackward(
    sheetId,
    await resolveChartIdInput(ctx, sheetId, chartId),
    chartMutationOptions(ctx, sheetId, 'charts.sendBackward'),
  );
}

export async function linkWorksheetChartToTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  tableId: string,
): Promise<void> {
  await awaitSheetMaterialized(ctx, sheetId);
  await ctx.computeBridge.linkChartToTable(
    sheetId,
    await resolveChartIdInput(ctx, sheetId, chartId),
    tableId,
    chartMutationOptions(ctx, sheetId, 'charts.linkToTable'),
  );
}

export async function unlinkWorksheetChartFromTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<void> {
  await awaitSheetMaterialized(ctx, sheetId);
  await ctx.computeBridge.unlinkChartFromTable(
    sheetId,
    await resolveChartIdInput(ctx, sheetId, chartId),
    chartMutationOptions(ctx, sheetId, 'charts.unlinkFromTable'),
  );
}
