import type { LegendEntrySpec, LegendSpec, LegendSymbolType, MarkType } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartType, LegendConfig, SeriesConfig } from '../../types';
import {
  seriesConfigForDataSeries,
  seriesSourceIndex,
  seriesSourceKey,
} from '../series-identity';
import { MARK_TYPE_MAP } from './constants';
import { isLegendShown } from './legend-spec';
import { isNoFillNoLineSeries } from './style';

type LegendEntryConfig = NonNullable<LegendConfig['entries']>[number];

export interface LegendDomain {
  values: string[];
  forceColorEncoding: boolean;
  entries?: LegendEntrySpec[];
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
  const entries: LegendEntrySpec[] = [];
  for (let index = 0; index < data.series.length; index += 1) {
    const series = data.series[index];
    if (!series) continue;
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    const sourceIndex = seriesConfig?.sourceSeriesIndex ?? seriesSourceIndex(series, index);
    const entry = legendEntryForIndex(legend, sourceIndex) ?? legendEntryForIndex(legend, index);
    if (!isLegendEntryVisible(entry, seriesConfig)) continue;
    const name = series?.name;
    if (!name) continue;
    if (!names.includes(name)) names.push(name);
    const sourceKey = seriesConfig?.sourceSeriesKey ?? seriesSourceKey(series, index);
    entries.push({
      value: name,
      label: name,
      symbolType: legendSymbolTypeForSeries(config, series, seriesConfig, index),
      seriesIndex: index,
      sourceSeriesIndex: sourceIndex,
      sourceSeriesKey: sourceKey,
    });
  }

  return {
    values: names,
    forceColorEncoding: data.series.length === 1 && names.length > 0,
    ...(entries.length > 0 ? { entries } : {}),
  };
}

export function buildCategoryLegendDomain(
  config: ChartConfig,
  data: ChartData,
): LegendDomain | undefined {
  const legend = config.legend;
  if (!isLegendShown(legend)) return undefined;

  const values: string[] = [];
  const entries: LegendEntrySpec[] = [];
  for (let index = 0; index < data.categories.length; index += 1) {
    const entry = legendEntryForIndex(legend, index);
    if (!isLegendEntryVisible(entry)) continue;
    const value = data.categories[index];
    const label = value !== undefined && value !== null ? String(value) : undefined;
    if (!label) continue;
    if (values.includes(label)) continue;
    values.push(label);
    entries.push({ value: label, label });
  }

  return {
    values,
    forceColorEncoding: false,
    ...(entries.length > 0 ? { entries } : {}),
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
  const symbolTypes = data.series
    .map((series, index) => {
      const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
      if (isNoFillNoLineSeries(seriesConfig)) return undefined;
      return legendSymbolTypeForSeries(config, series, seriesConfig, index);
    })
    .filter(Boolean);
  const distinctSymbolTypes = new Set(symbolTypes);

  if (distinctSymbolTypes.size === 1) return symbolTypes[0];
  return undefined;
}

function legendEntryForIndex(legend: LegendConfig, index: number): LegendEntryConfig | undefined {
  return legend.entries?.find((entry) => entry.idx === index);
}

function legendSymbolTypeForSeries(
  config: ChartConfig,
  series: ChartData['series'][number],
  seriesConfig: SeriesConfig | undefined,
  renderedIndex: number,
): LegendSymbolType {
  const seriesType = effectiveSeriesType(config, series, seriesConfig, renderedIndex);
  const markType = seriesType ? MARK_TYPE_MAP[seriesType] : undefined;
  return legendSymbolTypeForMark(markType, config, seriesConfig);
}

function effectiveSeriesType(
  config: ChartConfig,
  series: ChartData['series'][number],
  seriesConfig: SeriesConfig | undefined,
  renderedIndex: number,
): ChartType | undefined {
  const type = seriesConfig?.type ?? series.type;
  if (isChartType(type)) return type;
  if (config.type === 'combo') return renderedIndex === 0 ? 'column' : 'line';
  return isChartType(config.type) ? config.type : undefined;
}

function isChartType(value: unknown): value is ChartType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MARK_TYPE_MAP, value);
}

function legendSymbolTypeForMark(
  markType: MarkType | undefined,
  config: ChartConfig,
  seriesConfig: SeriesConfig | undefined,
): LegendSymbolType {
  switch (markType) {
    case 'line':
    case 'line3d':
    case 'rule':
    case 'tick':
    case 'trail':
      return 'line';
    case 'point':
    case 'circle':
      return seriesShowsConnectingLine(config, seriesConfig) ? 'line' : 'circle';
    case 'bar':
    case 'bar3d':
    case 'area':
    case 'area3d':
    case 'rect':
    case 'histogram':
    case 'boxplot':
    case 'violin':
    case 'contour':
    case 'surface3d':
      return 'area';
    case 'radar':
      return config.radarFilled || config.subType === 'filled' ? 'area' : 'line';
    default:
      return 'square';
  }
}

function seriesShowsConnectingLine(
  config: ChartConfig,
  seriesConfig: SeriesConfig | undefined,
): boolean {
  if (seriesConfig?.showLines !== undefined) return seriesConfig.showLines;
  return config.showLines === true;
}
