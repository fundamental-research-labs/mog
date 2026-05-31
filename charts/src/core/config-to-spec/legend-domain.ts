import type { LegendSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartType, LegendConfig, SeriesConfig } from '../../types';
import { seriesConfigForDataSeries } from '../series-identity';
import { MARK_TYPE_MAP } from './constants';
import { isLegendShown } from './legend-spec';
import { isNoFillNoLineSeries } from './style';

type LegendEntryConfig = NonNullable<LegendConfig['entries']>[number];

export interface LegendDomain {
  values: string[];
  forceColorEncoding: boolean;
}

export function visibleLegendDomain(config: ChartConfig, data: ChartData): string[] | undefined {
  const seriesConfigs = config.series ?? [];
  const renderedSeriesConfigs = data.series.map((series, index) =>
    seriesConfigForDataSeries(series, seriesConfigs, index),
  );
  if (!renderedSeriesConfigs.some(isNoFillNoLineSeries)) return undefined;

  const names: string[] = [];
  for (let index = 0; index < data.series.length; index += 1) {
    if (isNoFillNoLineSeries(renderedSeriesConfigs[index])) continue;
    const name = data.series[index]?.name;
    if (name && !names.includes(name)) names.push(name);
  }

  return names.length > 0 ? names : undefined;
}

export function buildSeriesLegendDomain(
  config: ChartConfig,
  data: ChartData,
): LegendDomain | undefined {
  const legend = config.legend;
  if (!isLegendShown(legend)) return undefined;

  const names: string[] = [];
  for (let index = 0; index < data.series.length; index += 1) {
    const series = data.series[index];
    if (!series) continue;
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    const sourceIndex = seriesConfig?.sourceSeriesIndex ?? series.sourceSeriesIndex ?? index;
    const entry = legendEntryForIndex(legend, sourceIndex) ?? legendEntryForIndex(legend, index);
    if (!isLegendEntryVisible(entry, seriesConfig)) continue;
    const name = series?.name;
    if (name && !names.includes(name)) names.push(name);
  }

  return {
    values: names,
    forceColorEncoding: data.series.length === 1 && names.length > 0,
  };
}

export function buildCategoryLegendDomain(
  config: ChartConfig,
  data: ChartData,
): LegendDomain | undefined {
  const legend = config.legend;
  if (!isLegendShown(legend)) return undefined;

  const values: string[] = [];
  for (let index = 0; index < data.categories.length; index += 1) {
    const entry = legendEntryForIndex(legend, index);
    if (!isLegendEntryVisible(entry)) continue;
    const value = data.categories[index];
    const label = value !== undefined && value !== null ? String(value) : undefined;
    if (label && !values.includes(label)) values.push(label);
  }

  return {
    values,
    forceColorEncoding: false,
  };
}

export function isLegendEntryVisible(
  entry: LegendEntryConfig | undefined,
  seriesConfig?: SeriesConfig,
): boolean {
  if (isNoFillNoLineSeries(seriesConfig)) return false;
  if (entry?.delete === false) return true;
  if (entry?.delete === true) return false;
  if (entry?.visible === false) return false;
  return true;
}

export function legendSymbolType(
  config: ChartConfig,
  data: ChartData,
): LegendSpec['symbolType'] | undefined {
  const markTypes = data.series
    .map((series, index) => {
      const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
      if (isNoFillNoLineSeries(seriesConfig)) return undefined;
      const seriesType = (seriesConfig?.type ?? series.type ?? config.type) as ChartType;
      return MARK_TYPE_MAP[seriesType];
    })
    .filter(Boolean);

  if (markTypes.length > 0 && markTypes.every((markType) => markType === 'line')) {
    return 'line';
  }
  if (markTypes.length > 0 && markTypes.every((markType) => markType === 'point')) {
    return 'circle';
  }
  return undefined;
}

function legendEntryForIndex(legend: LegendConfig, index: number): LegendEntryConfig | undefined {
  return legend.entries?.find((entry) => entry.idx === index);
}
