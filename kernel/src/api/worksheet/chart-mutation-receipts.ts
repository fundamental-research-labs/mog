import type {
  Chart,
  ChartConfig,
  ChartMutationReceipt,
  ChartMutationReceiptKind,
  ChartSeriesMutationReceipt,
  OperationDiagnostic,
  OperationEffect,
  SheetId,
} from '@mog-sdk/contracts/api';
import type {
  ChartAxisRole,
  ChartSourceBindingChange,
  ChartSourceBindingAppModel,
} from '@mog-sdk/contracts/data/chart-app-model';
import type {
  BoxplotConfig,
  ChartBorder,
  DataLabelConfig,
  HistogramConfig,
  SeriesConfig,
  TrendlineConfig,
} from '@mog-sdk/contracts/data/charts';
import { detectSeriesOrientation } from '@mog/charts';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context';
import {
  applyUpdate,
  awaitSheetMaterialized,
  chartSeriesCount,
  resolveChartIdInput,
} from './chart-api-helpers';
import { serializedChartToChart } from '../../domain/charts/chart-public-api-converters';
import { ensurePointsArray } from '../../domain/charts/chart-series-mutations';

type ChartMutationReceiptFields = Pick<
  ChartSeriesMutationReceipt,
  | 'seriesIndex'
  | 'fromSeriesIndex'
  | 'toSeriesIndex'
  | 'trendlineIndex'
  | 'pointIndex'
  | 'axisType'
  | 'axisRole'
  | 'range'
  | 'visible'
  | 'title'
  | 'series'
  | 'trendline'
  | 'appModelBefore'
  | 'appModelAfter'
  | 'sourceBindingBefore'
  | 'sourceBindingAfter'
  | 'sourceBindingChange'
>;

export type ChartMutationTarget = Partial<ChartMutationReceiptFields> & {
  readonly changedRanges?: readonly (string | null | undefined)[];
  readonly chart?: Chart | null;
};

function compactDetails(details: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) compact[key] = value;
  }
  return compact;
}

function receiptTargetFields(
  target: ChartMutationTarget = {},
): Partial<ChartMutationReceiptFields> {
  return compactDetails({
    seriesIndex: target.seriesIndex,
    fromSeriesIndex: target.fromSeriesIndex,
    toSeriesIndex: target.toSeriesIndex,
    trendlineIndex: target.trendlineIndex,
    pointIndex: target.pointIndex,
    axisType: target.axisType,
    axisRole: target.axisRole,
    range: target.range,
    visible: target.visible,
    title: target.title,
    series: target.series,
    trendline: target.trendline,
    appModelBefore: target.appModelBefore,
    appModelAfter: target.appModelAfter,
    sourceBindingBefore: target.sourceBindingBefore,
    sourceBindingAfter: target.sourceBindingAfter,
    sourceBindingChange: target.sourceBindingChange,
  }) as Partial<ChartMutationReceiptFields>;
}

function receiptDetailFields(target: ChartMutationTarget = {}): Record<string, unknown> {
  return compactDetails({
    seriesIndex: target.seriesIndex,
    fromSeriesIndex: target.fromSeriesIndex,
    toSeriesIndex: target.toSeriesIndex,
    trendlineIndex: target.trendlineIndex,
    pointIndex: target.pointIndex,
    axisType: target.axisType,
    axisRole: target.axisRole,
    range: target.range,
    visible: target.visible,
    title: target.title,
    series: target.series,
    trendline: target.trendline,
    sourceBindingChange: target.sourceBindingChange,
  });
}

function addChangedRange(ranges: Set<string>, range: string | null | undefined): void {
  const trimmed = range?.trim();
  if (trimmed) ranges.add(trimmed);
}

export function changedRangesFromSeries(
  series: Partial<SeriesConfig> | null | undefined,
): string[] {
  const ranges = new Set<string>();
  addChangedRange(ranges, series?.nameRef);
  addChangedRange(ranges, series?.values);
  addChangedRange(ranges, series?.categories);
  addChangedRange(ranges, series?.bubbleSize);
  return [...ranges];
}

export function formulaRangeCandidate(formula: string): string | undefined {
  const candidate = formula.trim().replace(/^=/, '').trim();
  if (!candidate) return undefined;
  if (/^[A-Za-z_][\w .]*!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?$/i.test(candidate)) {
    return candidate;
  }
  if (/^\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?$/i.test(candidate)) {
    return candidate;
  }
  return undefined;
}

function collectChangedRanges(target: ChartMutationTarget = {}): string[] {
  const ranges = new Set<string>();
  for (const range of target.changedRanges ?? []) addChangedRange(ranges, range);
  if (target.range) addChangedRange(ranges, target.range);
  for (const range of changedRangesFromSeries(target.series)) addChangedRange(ranges, range);
  return [...ranges];
}

function chartMutationTargetKind(target: ChartMutationTarget): string {
  if (target.trendlineIndex !== undefined) return 'chartTrendline';
  if (target.sourceBindingBefore !== undefined || target.sourceBindingAfter !== undefined)
    return 'chartSourceBinding';
  if (target.pointIndex !== undefined) return 'chartPoint';
  if (target.seriesIndex !== undefined || target.fromSeriesIndex !== undefined)
    return 'chartSeries';
  if (target.axisType !== undefined || target.axisRole !== undefined) return 'chartAxis';
  return 'chart';
}

export function buildAppliedChartMutationReceipt(
  kind: ChartMutationReceiptKind,
  sheetId: SheetId,
  chartId: string,
  chart: Chart | null,
  target: ChartMutationTarget = {},
): ChartMutationReceipt {
  const targetFields = receiptTargetFields(target);
  const targetDetails = compactDetails({
    mutationKind: kind,
    targetType: chartMutationTargetKind(target),
    ...receiptDetailFields(target),
    objectType: 'chart',
  });
  const changedRanges = collectChangedRanges(target);
  const effects: OperationEffect[] = [
    {
      type: 'updatedObject',
      sheetId,
      objectId: chartId,
      details: targetDetails,
    },
    ...changedRanges.map(
      (range): OperationEffect => ({
        type: 'changedRange',
        sheetId,
        range,
        objectId: chartId,
        details: targetDetails,
      }),
    ),
    {
      type: 'changedSelectionTarget',
      sheetId,
      objectId: chartId,
      details: targetDetails,
    },
    {
      type: 'invalidatedCache',
      sheetId,
      objectId: chartId,
      details: {
        ...targetDetails,
        cache: 'chart',
      },
    },
  ];

  return {
    kind,
    status: 'applied',
    sheetId,
    chartId,
    chart,
    effects,
    diagnostics: [],
    ...targetFields,
  };
}

export function buildFailedChartMutationReceipt(
  kind: ChartMutationReceiptKind,
  sheetId: SheetId,
  chartId: string,
  message: string,
  target: ChartMutationTarget = {},
  details: Record<string, unknown> = {},
): ChartMutationReceipt {
  const targetFields = receiptTargetFields(target);
  const diagnosticDetails = compactDetails({
    mutationKind: kind,
    ...receiptDetailFields(target),
    ...details,
  });
  const diagnostic: OperationDiagnostic = {
    severity: 'error',
    code: 'chart.mutation.invalidTarget',
    message,
    target: { sheetId, objectId: chartId },
    recoverable: true,
    details: diagnosticDetails,
  };

  return {
    kind,
    status: 'failed',
    sheetId,
    chartId,
    chart: null,
    effects: [
      {
        type: 'worksheetUnchanged',
        sheetId,
        objectId: chartId,
        details: diagnosticDetails,
      },
    ],
    diagnostics: [diagnostic],
    ...targetFields,
  };
}

export function buildUnsupportedChartMutationReceipt(
  kind: ChartMutationReceiptKind,
  sheetId: SheetId,
  chartId: string,
  message: string,
  target: ChartMutationTarget = {},
  details: Record<string, unknown> = {},
): ChartMutationReceipt {
  const targetFields = receiptTargetFields(target);
  const diagnosticDetails = compactDetails({
    mutationKind: kind,
    ...receiptDetailFields(target),
    ...details,
  });
  const diagnostic: OperationDiagnostic = {
    severity: 'warning',
    code: 'chart.mutation.unsupported',
    message,
    target: { sheetId, objectId: chartId },
    recoverable: true,
    details: diagnosticDetails,
  };

  return {
    kind,
    status: 'unsupported',
    sheetId,
    chartId,
    chart: target.chart ?? null,
    effects: [
      {
        type: 'worksheetUnchanged',
        sheetId,
        objectId: chartId,
        details: diagnosticDetails,
      },
    ],
    diagnostics: [diagnostic],
    ...targetFields,
  };
}

export function formatIndexRange(capacity: number): string {
  return capacity > 0 ? `0-${capacity - 1}` : 'no valid indexes';
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

export function chartSeriesMutationCapacityForReceipt(chart: Chart): number {
  const explicitSeriesCount = chartSeriesCount(chart);
  return explicitSeriesCount > 0 ? explicitSeriesCount : inferredRangeSeriesMutationCapacity(chart);
}

export type ChartMutationReadResult =
  | {
      chart: Chart;
      series: SeriesConfig[];
      resolvedChartId: string;
    }
  | { receipt: ChartMutationReceipt };

export async function readChartForMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  kind: ChartMutationReceiptKind,
  chartId: string,
  target: ChartMutationTarget = {},
): Promise<ChartMutationReadResult> {
  await awaitSheetMaterialized(ctx, sheetId);
  const resolvedChartId = await resolveChartIdInput(ctx, sheetId, chartId);
  const raw = (await ctx.computeBridge.getChart(
    sheetId,
    resolvedChartId,
  )) as ChartFloatingObject | null;
  if (!raw) {
    return {
      receipt: buildFailedChartMutationReceipt(
        kind,
        sheetId,
        resolvedChartId,
        `Chart "${chartId}" not found`,
        target,
        { chartId },
      ),
    };
  }

  const chart = serializedChartToChart(raw);
  return {
    chart,
    series: [...(chart.series ?? [])],
    resolvedChartId,
  };
}

export async function readSeriesForMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  kind: ChartMutationReceiptKind,
  chartId: string,
  seriesIndex: number,
  target: ChartMutationTarget = {},
): Promise<ChartMutationReadResult> {
  const resolvedTarget = { ...target, seriesIndex };
  if (!Number.isInteger(seriesIndex) || seriesIndex < 0) {
    return {
      receipt: buildFailedChartMutationReceipt(
        kind,
        sheetId,
        chartId,
        `Series index ${seriesIndex} out of range`,
        resolvedTarget,
        { received: seriesIndex },
      ),
    };
  }

  const read = await readChartForMutation(ctx, sheetId, kind, chartId, resolvedTarget);
  if ('receipt' in read) return read;

  const capacity = chartSeriesMutationCapacityForReceipt(read.chart);
  if (seriesIndex >= capacity) {
    return {
      receipt: buildFailedChartMutationReceipt(
        kind,
        sheetId,
        read.resolvedChartId,
        `Series index ${seriesIndex} out of range (${formatIndexRange(capacity)})`,
        resolvedTarget,
        { received: seriesIndex, capacity },
      ),
    };
  }

  while (read.series.length <= seriesIndex) {
    read.series.push({});
  }
  return read;
}

export async function readResolvedChart(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<Chart | null> {
  const raw = (await ctx.computeBridge.getChart(sheetId, chartId)) as ChartFloatingObject | null;
  return raw ? serializedChartToChart(raw) : null;
}

export async function finishChartMutationReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  kind: ChartMutationReceiptKind,
  chartId: string,
  target: ChartMutationTarget = {},
): Promise<ChartMutationReceipt> {
  const chart = await readResolvedChart(ctx, sheetId, chartId);
  return buildAppliedChartMutationReceipt(kind, sheetId, chartId, chart, target);
}

async function applyChartUpdateAndReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  kind: ChartMutationReceiptKind,
  chartId: string,
  updates: Partial<ChartConfig>,
  target: ChartMutationTarget = {},
): Promise<ChartMutationReceipt> {
  await applyUpdate(ctx, sheetId, chartId, updates);
  return finishChartMutationReceipt(ctx, sheetId, kind, chartId, target);
}

export async function addChartSeriesMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  config: SeriesConfig,
): Promise<ChartMutationReceipt> {
  const kind = 'chart.series.add';
  const read = await readChartForMutation(ctx, sheetId, kind, chartId, {
    series: config,
    changedRanges: changedRangesFromSeries(config),
  });
  if ('receipt' in read) return read.receipt;

  read.series.push(config);
  const seriesIndex = read.series.length - 1;
  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    {
      series: read.series,
    },
    {
      seriesIndex,
      series: config,
      changedRanges: changedRangesFromSeries(config),
    },
  );
}

export async function removeChartSeriesMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  seriesIndex: number,
): Promise<ChartMutationReceipt> {
  const kind = 'chart.series.remove';
  const target = { seriesIndex };
  const read = await readChartForMutation(ctx, sheetId, kind, chartId, target);
  if ('receipt' in read) return read.receipt;
  if (!Number.isInteger(seriesIndex) || seriesIndex < 0 || seriesIndex >= read.series.length) {
    return buildFailedChartMutationReceipt(
      kind,
      sheetId,
      read.resolvedChartId,
      `Series index ${seriesIndex} out of range (${formatIndexRange(read.series.length)})`,
      target,
      { received: seriesIndex, capacity: read.series.length },
    );
  }

  const [removed] = read.series.splice(seriesIndex, 1);
  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    {
      series: read.series,
    },
    {
      seriesIndex,
      series: null,
      changedRanges: changedRangesFromSeries(removed),
    },
  );
}

export async function updateChartSeriesMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  kind: ChartMutationReceiptKind,
  chartId: string,
  seriesIndex: number,
  updates: Partial<SeriesConfig>,
): Promise<ChartMutationReceipt> {
  const read = await readSeriesForMutation(ctx, sheetId, kind, chartId, seriesIndex, {
    series: updates,
    changedRanges: changedRangesFromSeries(updates),
  });
  if ('receipt' in read) return read.receipt;

  const nextSeries = { ...read.series[seriesIndex], ...updates };
  read.series[seriesIndex] = nextSeries;
  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    {
      series: read.series,
    },
    {
      seriesIndex,
      series: nextSeries,
      changedRanges: changedRangesFromSeries(updates),
    },
  );
}

export async function reorderChartSeriesMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  fromIndex: number,
  toIndex: number,
): Promise<ChartMutationReceipt> {
  const kind = 'chart.series.reorder';
  const target = { fromSeriesIndex: fromIndex, toSeriesIndex: toIndex };
  const read = await readChartForMutation(ctx, sheetId, kind, chartId, target);
  if ('receipt' in read) return read.receipt;

  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= read.series.length) {
    return buildFailedChartMutationReceipt(
      kind,
      sheetId,
      read.resolvedChartId,
      `fromIndex ${fromIndex} out of range (${formatIndexRange(read.series.length)})`,
      target,
      { field: 'fromIndex', received: fromIndex, capacity: read.series.length },
    );
  }
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= read.series.length) {
    return buildFailedChartMutationReceipt(
      kind,
      sheetId,
      read.resolvedChartId,
      `toIndex ${toIndex} out of range (${formatIndexRange(read.series.length)})`,
      target,
      { field: 'toIndex', received: toIndex, capacity: read.series.length },
    );
  }

  const [item] = read.series.splice(fromIndex, 1);
  read.series.splice(toIndex, 0, item);
  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    {
      series: read.series,
    },
    target,
  );
}

export async function formatChartPointMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  seriesIndex: number,
  pointIndex: number,
  format: { fill?: string; border?: ChartBorder },
): Promise<ChartMutationReceipt> {
  const kind = 'chart.point.format';
  const target = { seriesIndex, pointIndex };
  if (!Number.isInteger(pointIndex) || pointIndex < 0) {
    return buildFailedChartMutationReceipt(
      kind,
      sheetId,
      chartId,
      `Point index ${pointIndex} out of range`,
      target,
      { received: pointIndex },
    );
  }

  const read = await readSeriesForMutation(ctx, sheetId, kind, chartId, seriesIndex, target);
  if ('receipt' in read) return read.receipt;

  const points = ensurePointsArray(read.series[seriesIndex], pointIndex);
  points[pointIndex] = { ...points[pointIndex], ...format };
  const nextSeries = { ...read.series[seriesIndex], points };
  read.series[seriesIndex] = nextSeries;
  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    {
      series: read.series,
    },
    {
      ...target,
      series: nextSeries,
    },
  );
}

export async function setChartPointDataLabelMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  seriesIndex: number,
  pointIndex: number,
  config: DataLabelConfig,
): Promise<ChartMutationReceipt> {
  const kind = 'chart.point.setDataLabel';
  const target = { seriesIndex, pointIndex };
  if (!Number.isInteger(pointIndex) || pointIndex < 0) {
    return buildFailedChartMutationReceipt(
      kind,
      sheetId,
      chartId,
      `Point index ${pointIndex} out of range`,
      target,
      { received: pointIndex },
    );
  }

  const read = await readSeriesForMutation(ctx, sheetId, kind, chartId, seriesIndex, target);
  if ('receipt' in read) return read.receipt;

  const points = ensurePointsArray(read.series[seriesIndex], pointIndex);
  points[pointIndex] = { ...points[pointIndex], dataLabel: config };
  const nextSeries = { ...read.series[seriesIndex], points };
  read.series[seriesIndex] = nextSeries;
  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    {
      series: read.series,
    },
    {
      ...target,
      series: nextSeries,
    },
  );
}

export async function addChartTrendlineMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  seriesIndex: number,
  trendline: TrendlineConfig,
): Promise<ChartMutationReceipt> {
  const kind = 'chart.trendline.add';
  const read = await readSeriesForMutation(ctx, sheetId, kind, chartId, seriesIndex, {
    seriesIndex,
    trendline,
  });
  if ('receipt' in read) return read.receipt;

  const trendlines = [...(read.series[seriesIndex].trendlines ?? []), trendline];
  const trendlineIndex = trendlines.length - 1;
  read.series[seriesIndex] = { ...read.series[seriesIndex], trendlines };
  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    {
      series: read.series,
    },
    {
      seriesIndex,
      trendlineIndex,
      trendline,
    },
  );
}

export async function updateChartTrendlineMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  seriesIndex: number,
  trendlineIndex: number,
  updates: Partial<TrendlineConfig>,
): Promise<ChartMutationReceipt> {
  const kind = 'chart.trendline.update';
  const target = { seriesIndex, trendlineIndex, trendline: updates };
  const read = await readSeriesForMutation(ctx, sheetId, kind, chartId, seriesIndex, target);
  if ('receipt' in read) return read.receipt;

  const trendlines = [...(read.series[seriesIndex].trendlines ?? [])];
  if (
    !Number.isInteger(trendlineIndex) ||
    trendlineIndex < 0 ||
    trendlineIndex >= trendlines.length
  ) {
    return buildFailedChartMutationReceipt(
      kind,
      sheetId,
      read.resolvedChartId,
      `Trendline index ${trendlineIndex} out of range (${formatIndexRange(trendlines.length)})`,
      target,
      { received: trendlineIndex, capacity: trendlines.length },
    );
  }

  const nextTrendline = { ...trendlines[trendlineIndex], ...updates };
  trendlines[trendlineIndex] = nextTrendline;
  read.series[seriesIndex] = { ...read.series[seriesIndex], trendlines };
  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    {
      series: read.series,
    },
    {
      seriesIndex,
      trendlineIndex,
      trendline: nextTrendline,
    },
  );
}

export async function removeChartTrendlineMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  seriesIndex: number,
  trendlineIndex: number,
): Promise<ChartMutationReceipt> {
  const kind = 'chart.trendline.remove';
  const target = { seriesIndex, trendlineIndex };
  const read = await readSeriesForMutation(ctx, sheetId, kind, chartId, seriesIndex, target);
  if ('receipt' in read) return read.receipt;

  const trendlines = [...(read.series[seriesIndex].trendlines ?? [])];
  if (
    !Number.isInteger(trendlineIndex) ||
    trendlineIndex < 0 ||
    trendlineIndex >= trendlines.length
  ) {
    return buildFailedChartMutationReceipt(
      kind,
      sheetId,
      read.resolvedChartId,
      `Trendline index ${trendlineIndex} out of range (${formatIndexRange(trendlines.length)})`,
      target,
      { received: trendlineIndex, capacity: trendlines.length },
    );
  }

  trendlines.splice(trendlineIndex, 1);
  read.series[seriesIndex] = { ...read.series[seriesIndex], trendlines };
  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    {
      series: read.series,
    },
    {
      seriesIndex,
      trendlineIndex,
      trendline: null,
    },
  );
}

export async function setChartAxisTitleMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  axisType: 'category' | 'value',
  formula: string,
): Promise<ChartMutationReceipt> {
  const kind = 'chart.axis.setTitle';
  const read = await readChartForMutation(ctx, sheetId, kind, chartId, {
    axisType,
    changedRanges: [formulaRangeCandidate(formula)],
  });
  if ('receipt' in read) return read.receipt;

  const axis = { ...(read.chart.axis ?? {}) };
  if (axisType === 'category') {
    axis.categoryAxis = { ...(axis.categoryAxis ?? { visible: true }), title: formula };
  } else {
    axis.valueAxis = { ...(axis.valueAxis ?? { visible: true }), title: formula };
  }

  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    { axis },
    {
      axisType,
      changedRanges: [formulaRangeCandidate(formula)],
    },
  );
}

export async function setChartCategoryNamesMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  range: string,
): Promise<ChartMutationReceipt> {
  const kind = 'chart.categoryNames.set';
  const read = await readChartForMutation(ctx, sheetId, kind, chartId, { range });
  if ('receipt' in read) return read.receipt;

  const updatedSeries = read.series.map((series) => ({ ...series, categories: range }));
  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    {
      series: updatedSeries,
    },
    {
      range,
      changedRanges: [range],
    },
  );
}

export async function setChartDataLabelDimensionMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  seriesIndex: number,
  pointIndex: number,
  dimension: 'height' | 'width',
  value: number,
): Promise<ChartMutationReceipt> {
  const kind = dimension === 'height' ? 'chart.dataLabel.setHeight' : 'chart.dataLabel.setWidth';
  const target = { seriesIndex, pointIndex };
  if (!Number.isFinite(value) || value < 0) {
    return buildFailedChartMutationReceipt(
      kind,
      sheetId,
      chartId,
      `${dimension} must be a non-negative finite number`,
      target,
      { dimension, value },
    );
  }
  if (!Number.isInteger(pointIndex) || pointIndex < 0) {
    return buildFailedChartMutationReceipt(
      kind,
      sheetId,
      chartId,
      `Point index ${pointIndex} out of range`,
      target,
      { received: pointIndex },
    );
  }

  const read = await readSeriesForMutation(ctx, sheetId, kind, chartId, seriesIndex, target);
  if ('receipt' in read) return read.receipt;

  const targetSeries = { ...read.series[seriesIndex] };
  const points = ensurePointsArray(targetSeries, pointIndex);
  const currentPoint = points[pointIndex];
  points[pointIndex] = {
    ...currentPoint,
    dataLabel: {
      show: currentPoint.dataLabel?.show ?? true,
      ...currentPoint.dataLabel,
      [dimension]: value,
    },
  };
  targetSeries.points = points;
  read.series[seriesIndex] = targetSeries;
  return applyChartUpdateAndReceipt(
    ctx,
    sheetId,
    kind,
    read.resolvedChartId,
    {
      series: read.series,
    },
    {
      ...target,
      series: targetSeries,
    },
  );
}

export async function setSeriesBinOptionsMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  seriesIndex: number,
  options: HistogramConfig,
): Promise<ChartMutationReceipt> {
  return updateChartSeriesMutation(
    ctx,
    sheetId,
    'chart.series.setBinOptions',
    chartId,
    seriesIndex,
    { binOptions: options },
  );
}

export async function setSeriesBoxwhiskerOptionsMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  seriesIndex: number,
  options: BoxplotConfig,
): Promise<ChartMutationReceipt> {
  return updateChartSeriesMutation(
    ctx,
    sheetId,
    'chart.series.setBoxwhiskerOptions',
    chartId,
    seriesIndex,
    { boxwhiskerOptions: options },
  );
}
