import type { ChannelSpec, LegendOrient, LegendSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartType, LegendConfig, SeriesConfig } from '../../types';
import { resolveChartTextColor } from '../../utils/chart-colors';
import { resolveChartOwnerFormat, resolverContextFromConfig } from '../style-resolver';
import { MARK_TYPE_MAP } from './constants';
import { isNoFillNoLineSeries } from './style';
import { seriesConfigForDataSeries } from '../series-identity';
import { pointsToCanvasPx } from './units';

type LegendEntryConfig = NonNullable<LegendConfig['entries']>[number];

export interface LegendDomain {
  values: string[];
  forceColorEncoding: boolean;
}

/**
 * Map LegendConfig.position to LegendOrient.
 */
export function legendPositionToOrient(position: string): LegendOrient {
  switch (position) {
    case 't':
    case 'top':
      return 'top';
    case 'b':
    case 'bottom':
      return 'bottom';
    case 'l':
    case 'left':
      return 'left';
    case 'r':
    case 'right':
      return 'right';
    case 'tr':
    case 'topRight':
    case 'top-right':
    case 'corner':
      return 'top-right';
    case 'none':
      return 'none';
    default:
      return 'bottom';
  }
}

export function isLegendShown(legend: LegendConfig | undefined): legend is LegendConfig {
  return Boolean(legend && legend.show && legend.visible !== false && legend.position !== 'none');
}

export function buildLegendSpec(
  legend: LegendConfig,
  config?: ChartConfig,
  options: {
    reverse?: boolean;
    symbolType?: LegendSpec['symbolType'];
    values?: string[];
  } = {},
): LegendSpec | null {
  if (!isLegendShown(legend)) return null;
  if (options.values && options.values.length === 0) return null;

  const legendFormat = config
    ? resolveChartOwnerFormat(config, 'legend', legend.format)
    : legend.format;
  const legendFont = legendFormat?.font ?? legend.font;
  const labelColor = resolveChartTextColor(
    legendFont?.color,
    config ? resolverContextFromConfig(config, 'legend') : {},
  );
  return {
    orient: legendPositionToOrient(legend.position),
    title: null,
    ...(legend.overlay !== undefined ? { overlay: legend.overlay } : {}),
    ...(options.values ? { values: options.values } : {}),
    ...(options.reverse ? { reverse: true } : {}),
    ...(options.symbolType ? { symbolType: options.symbolType } : {}),
    ...(legendFont?.size !== undefined
      ? { labelFontSize: pointsToCanvasPx(legendFont.size) }
      : {}),
    ...(legendFont?.name ? { labelFontFamily: legendFont.name } : {}),
    ...(labelColor ? { labelColor } : {}),
  };
}

/**
 * Build encoding for the color channel, including legend config.
 */
export function buildColorEncoding(
  hasMultipleSeries: boolean,
  legend?: LegendConfig,
  colors?: string[],
  reverseLegend?: boolean,
  legendDomain?: string[],
  symbolType?: LegendSpec['symbolType'],
  config?: ChartConfig,
  forceColorEncoding = false,
  legendValues?: string[],
): ChannelSpec | undefined {
  if (!hasMultipleSeries && !forceColorEncoding) return undefined;
  const channel: ChannelSpec = {
    field: 'series',
    type: 'nominal',
  };
  if ((colors && colors.length > 0) || (legendDomain && legendDomain.length > 0)) {
    channel.scale = {
      ...(legendDomain && legendDomain.length > 0 ? { domain: legendDomain } : {}),
      ...(colors && colors.length > 0 ? { range: colors } : {}),
    };
  }
  if (legend) {
    channel.legend = buildLegendSpec(legend, config, {
      reverse: reverseLegend,
      symbolType,
      values: legendValues,
    });
  }
  return channel;
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

function legendEntryForIndex(
  legend: LegendConfig,
  index: number,
): LegendEntryConfig | undefined {
  return legend.entries?.find((entry) => entry.idx === index);
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
