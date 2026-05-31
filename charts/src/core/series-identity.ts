import type { ChartDataSeries, SeriesConfig } from '../types';

export function seriesConfigSourceIndex(seriesConfig: SeriesConfig, fallbackIndex: number): number {
  return finiteNonNegativeInteger(seriesConfig.sourceSeriesIndex) ?? fallbackIndex;
}

export function seriesConfigSourceKey(seriesConfig: SeriesConfig, fallbackIndex: number): string {
  if (seriesConfig.sourceSeriesKey) return seriesConfig.sourceSeriesKey;
  if (seriesConfig.pivotSeriesKey) return `pivot:${seriesConfig.pivotSeriesKey}`;
  if (finiteNonNegativeInteger(seriesConfig.idx) !== undefined) return `idx:${seriesConfig.idx}`;
  if (finiteNonNegativeInteger(seriesConfig.order) !== undefined) return `order:${seriesConfig.order}`;
  return `series:${fallbackIndex}`;
}

export function seriesSourceIndex(series: ChartDataSeries, renderedIndex: number): number {
  return finiteNonNegativeInteger(series.sourceSeriesIndex) ?? renderedIndex;
}

export function seriesSourceKey(series: ChartDataSeries, renderedIndex: number): string {
  return series.sourceSeriesKey ?? `series:${seriesSourceIndex(series, renderedIndex)}`;
}

export function seriesConfigForDataSeries(
  series: ChartDataSeries,
  seriesConfigs: SeriesConfig[],
  renderedIndex: number,
): SeriesConfig | undefined {
  return seriesConfigs[seriesSourceIndex(series, renderedIndex)] ?? seriesConfigs[renderedIndex];
}

export function seriesOrderForDataSeries(
  series: ChartDataSeries,
  seriesConfig: SeriesConfig | undefined,
  renderedIndex: number,
): number {
  return seriesConfig?.order ?? seriesConfig?.idx ?? series.visibleOrder ?? renderedIndex;
}

export function chartDataSeriesIdentity(
  seriesConfig: SeriesConfig,
  configIndex: number,
  visibleOrder: number,
): Pick<
  ChartDataSeries,
  | 'sourceSeriesIndex'
  | 'sourceSeriesKey'
  | 'visibleOrder'
  | 'pivotSeriesKey'
  | 'pivotDataFieldIndex'
  | 'projectionAuthority'
  | 'projectionDiagnostics'
> {
  const sourceSeriesIndex = seriesConfigSourceIndex(seriesConfig, configIndex);
  return {
    sourceSeriesIndex,
    sourceSeriesKey: seriesConfigSourceKey(seriesConfig, sourceSeriesIndex),
    visibleOrder: seriesConfig.visibleOrder ?? visibleOrder,
    pivotSeriesKey: seriesConfig.pivotSeriesKey,
    pivotDataFieldIndex: seriesConfig.pivotDataFieldIndex,
    projectionAuthority: seriesConfig.projectionAuthority ?? 'explicitSeries',
    projectionDiagnostics: seriesConfig.projectionDiagnostics,
  };
}

export function withSeriesConfigIdentity(
  seriesConfig: SeriesConfig,
  configIndex: number,
): SeriesConfig {
  const sourceSeriesIndex = seriesConfigSourceIndex(seriesConfig, configIndex);
  const sourceSeriesKey = seriesConfigSourceKey(seriesConfig, sourceSeriesIndex);
  if (
    seriesConfig.sourceSeriesIndex === sourceSeriesIndex &&
    seriesConfig.sourceSeriesKey === sourceSeriesKey
  ) {
    return seriesConfig;
  }
  return {
    ...seriesConfig,
    sourceSeriesIndex,
    sourceSeriesKey,
  };
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isFinite(value)
    ? value
    : undefined;
}
