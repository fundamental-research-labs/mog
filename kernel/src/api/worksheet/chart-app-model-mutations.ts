import type {
  Chart,
  ChartConfig,
  ChartMutationReceipt,
  ChartMutationReceiptKind,
  ChartTarget,
  SheetId,
} from '@mog-sdk/contracts/api';
import type {
  ChartAxisRole,
  ChartSourceBindingAppModel,
  ChartSourceBindingChange,
} from '@mog-sdk/contracts/data/chart-app-model';

import type { DocumentContext } from '../../context';
import { chartToAppModel } from '../../domain/charts/chart-app-model';
import { toggleSeriesOrientation } from '../../domain/charts/chart-source-binding';
import {
  axisTitleUpdate,
  axisVisibilityUpdate,
  chartTitleVisibilityUpdate,
  legendVisibilityUpdate,
} from '../../domain/charts/chart-update-normalizer';
import { applyResolvedChartUpdate } from './chart-api-helpers';
import {
  buildAppliedChartMutationReceipt,
  buildUnsupportedChartMutationReceipt,
  readChartForMutation,
  readResolvedChart,
  type ChartMutationTarget,
} from './chart-mutation-receipts';

function axisTypeForRole(role: ChartAxisRole): 'category' | 'value' | undefined {
  if (role === 'category' || role === 'secondaryCategory') return 'category';
  if (role === 'value' || role === 'secondaryValue') return 'value';
  return undefined;
}

function sourceBindingChange(
  before: ChartSourceBindingAppModel,
  after: ChartSourceBindingAppModel,
  explicitSeriesAction: NonNullable<ChartSourceBindingChange['explicitSeriesAction']>,
): ChartSourceBindingChange {
  return {
    before,
    after,
    renderedGroupingChanged: before.orientation !== after.orientation,
    explicitSeriesAction,
  };
}

function explicitSeriesSwitchAction(
  source: ChartSourceBindingAppModel,
): NonNullable<ChartSourceBindingChange['explicitSeriesAction']> {
  if (!source.explicitSeriesCount || source.explicitSeriesCount <= 0) return 'notApplicable';
  return source.supportsOrientationSwitch &&
    source.dataRange &&
    (source.renderableSeriesCount ?? 0) > 0
    ? 'cleared'
    : 'preserved';
}

async function applyChartAppModelUpdateAndReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  kind: ChartMutationReceiptKind,
  chartTarget: ChartTarget,
  updateForChart: (chart: Chart) => Partial<ChartConfig>,
  target: ChartMutationTarget = {},
): Promise<ChartMutationReceipt> {
  const read = await readChartForMutation(ctx, sheetId, chartTarget);

  const appModelBefore = chartToAppModel(read.chart);
  await applyResolvedChartUpdate(
    ctx,
    sheetId,
    read.resolvedChartId,
    read.raw,
    updateForChart(read.chart),
    undefined,
    read.chartTarget,
  );
  const chart = await readResolvedChart(ctx, sheetId, read.resolvedChartId);
  const appModelAfter = chart ? chartToAppModel(chart) : undefined;

  return buildAppliedChartMutationReceipt(kind, sheetId, read.resolvedChartId, chart, {
    ...target,
    appModelBefore,
    appModelAfter,
    sourceBindingBefore: appModelBefore.source,
    sourceBindingAfter: appModelAfter?.source,
  });
}

export async function setChartLegendVisibleMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  visible: boolean,
): Promise<ChartMutationReceipt> {
  return applyChartAppModelUpdateAndReceipt(
    ctx,
    sheetId,
    'chart.legend.setVisible',
    chartTarget,
    (chart) => legendVisibilityUpdate(chart, visible),
    { visible },
  );
}

export async function setChartAxisVisibleMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  axisRole: ChartAxisRole,
  visible: boolean,
): Promise<ChartMutationReceipt> {
  return applyChartAppModelUpdateAndReceipt(
    ctx,
    sheetId,
    'chart.axis.setVisible',
    chartTarget,
    (chart) => axisVisibilityUpdate(chart, axisRole, visible),
    { axisRole, axisType: axisTypeForRole(axisRole), visible },
  );
}

export async function setChartAxisTitleAppModelMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  axisRole: ChartAxisRole,
  title: string,
): Promise<ChartMutationReceipt> {
  return applyChartAppModelUpdateAndReceipt(
    ctx,
    sheetId,
    'chart.axis.setTitle',
    chartTarget,
    (chart) => axisTitleUpdate(chart, axisRole, title),
    {
      axisRole,
      axisType: axisTypeForRole(axisRole),
      title,
    },
  );
}

export async function setChartTitleVisibleMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  visible: boolean,
): Promise<ChartMutationReceipt> {
  return applyChartAppModelUpdateAndReceipt(
    ctx,
    sheetId,
    'chart.title.setVisible',
    chartTarget,
    (chart) => chartTitleVisibilityUpdate(chart, visible),
    { visible },
  );
}

export async function switchChartSeriesOrientationMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
): Promise<ChartMutationReceipt> {
  const kind: ChartMutationReceiptKind = 'chart.source.switchSeriesOrientation';
  const read = await readChartForMutation(ctx, sheetId, chartTarget);

  const appModelBefore = chartToAppModel(read.chart);
  if (!appModelBefore.source.supportsOrientationSwitch) {
    return buildUnsupportedChartMutationReceipt(
      kind,
      sheetId,
      read.resolvedChartId,
      'Chart source binding does not support switching series orientation',
      {
        chart: read.chart,
        appModelBefore,
        appModelAfter: appModelBefore,
        sourceBindingBefore: appModelBefore.source,
        sourceBindingAfter: appModelBefore.source,
        sourceBindingChange: sourceBindingChange(
          appModelBefore.source,
          appModelBefore.source,
          explicitSeriesSwitchAction(appModelBefore.source),
        ),
      },
      {
        sourceBindingKind: appModelBefore.source.kind,
        diagnostics: appModelBefore.source.diagnostics,
      },
    );
  }

  await applyResolvedChartUpdate(
    ctx,
    sheetId,
    read.resolvedChartId,
    read.raw,
    {
      seriesOrientation: toggleSeriesOrientation(appModelBefore.source.orientation),
      ...(appModelBefore.source.renderableSeriesCount &&
      appModelBefore.source.renderableSeriesCount > 0 &&
      appModelBefore.source.dataRange
        ? { series: [] }
        : {}),
    },
    undefined,
    read.chartTarget,
  );
  const chart = await readResolvedChart(ctx, sheetId, read.resolvedChartId);
  const appModelAfter = chart ? chartToAppModel(chart) : undefined;
  const sourceAfter = appModelAfter?.source ?? appModelBefore.source;

  return buildAppliedChartMutationReceipt(kind, sheetId, read.resolvedChartId, chart, {
    appModelBefore,
    appModelAfter,
    sourceBindingBefore: appModelBefore.source,
    sourceBindingAfter: sourceAfter,
    sourceBindingChange: sourceBindingChange(
      appModelBefore.source,
      sourceAfter,
      explicitSeriesSwitchAction(appModelBefore.source),
    ),
  });
}
