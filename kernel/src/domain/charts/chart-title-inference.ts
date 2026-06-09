import { extractChartDataFromRange } from '@mog/charts';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { ChartConfig, ChartType, SeriesConfig } from '@mog-sdk/contracts/data/charts';

import type { DocumentContext } from '../../context/types';
import { createCellAccessor } from './bridge/chart-cell-accessor';
import { resolveA1ChartRange, type ChartRangeDiagnostic } from './chart-range-references';

const PIE_LIKE_TITLE_TYPES = new Set<ChartType>([
  'pie',
  'pie3d',
  'pieExploded',
  'pie3dExploded',
  'doughnut',
  'doughnutExploded',
  'ofPie',
]);

function trimmedText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function hasExplicitTitleIntent(config: ChartConfig): boolean {
  if (config.title !== undefined) return true;
  if (config.autoTitleDeleted === true) return true;

  const chartTitle = config.chartTitle;
  if (!chartTitle) return false;
  return (
    chartTitle.visible === false ||
    chartTitle.text !== undefined ||
    chartTitle.richText !== undefined ||
    chartTitle.formula !== undefined
  );
}

function inferSingleSeriesName(series: readonly SeriesConfig[] | undefined): string | null {
  if (!series || series.length !== 1) return null;
  return trimmedText(series[0]?.name);
}

function isDefaultSeriesName(name: string, index: number): boolean {
  return name === `Series ${index + 1}`;
}

export function normalizeExplicitChartTitle(config: ChartConfig): ChartConfig {
  if (config.title !== undefined) return config;
  const chartTitleText = trimmedText(config.chartTitle?.text);
  return chartTitleText ? { ...config, title: chartTitleText } : config;
}

export async function inferPieLikeChartTitle(
  ctx: DocumentContext,
  sheetId: SheetId,
  config: ChartConfig,
): Promise<string | null> {
  if (!PIE_LIKE_TITLE_TYPES.has(config.type)) return null;
  if (hasExplicitTitleIntent(config)) return null;

  const configuredSeriesName = inferSingleSeriesName(config.series);
  if (configuredSeriesName) return configuredSeriesName;

  if (!config.dataRange) return null;

  const diagnostics: ChartRangeDiagnostic[] = [];
  const [dataRangeRef, categoryRangeRef, seriesRangeRef] = await Promise.all([
    resolveA1ChartRange(ctx, sheetId, 'dataRange', config.dataRange, diagnostics),
    resolveA1ChartRange(ctx, sheetId, 'categoryRange', config.categoryRange, diagnostics),
    resolveA1ChartRange(ctx, sheetId, 'seriesRange', config.seriesRange, diagnostics),
  ]);
  const dataRange = dataRangeRef?.range;
  if (!dataRange) return null;

  const categoryRange = categoryRangeRef?.range;
  const seriesRange = seriesRangeRef?.range;
  const accessor = await createCellAccessor(ctx, [dataRange, categoryRange, seriesRange]);
  const data = extractChartDataFromRange(accessor, dataRange, {
    categoryRange,
    chartType: config.type,
    seriesRange,
    seriesOrientation: config.seriesOrientation,
  });

  if (data.series.length !== 1) return null;
  const inferredName = trimmedText(data.series[0]?.name);
  if (!inferredName || isDefaultSeriesName(inferredName, 0)) return null;
  return inferredName;
}

export async function withInferredChartTitle(
  ctx: DocumentContext,
  sheetId: SheetId,
  config: ChartConfig,
): Promise<ChartConfig> {
  const normalized = normalizeExplicitChartTitle(config);
  const inferredTitle = await inferPieLikeChartTitle(ctx, sheetId, normalized);
  return inferredTitle ? { ...normalized, title: inferredTitle } : normalized;
}
