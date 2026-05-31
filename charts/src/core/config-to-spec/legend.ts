import type { ChannelSpec, LegendOrient, LegendSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartType, LegendConfig } from '../../types';
import { resolveChartTextColor } from '../../utils/chart-colors';
import { resolveChartOwnerFormat, resolverContextFromConfig } from '../style-resolver';
import { MARK_TYPE_MAP } from './constants';
import { isNoFillNoLineSeries } from './series-style';
import { pointsToCanvasPx } from './units';

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
  } = {},
): LegendSpec | null {
  if (!isLegendShown(legend)) return null;

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
): ChannelSpec | undefined {
  if (!hasMultipleSeries) return undefined;
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
    });
  }
  return channel;
}

export function visibleLegendDomain(config: ChartConfig, data: ChartData): string[] | undefined {
  const seriesConfigs = config.series ?? [];
  if (!seriesConfigs.some(isNoFillNoLineSeries)) return undefined;

  const names: string[] = [];
  for (let index = 0; index < data.series.length; index += 1) {
    if (isNoFillNoLineSeries(seriesConfigs[index])) continue;
    const name = data.series[index]?.name;
    if (name && !names.includes(name)) names.push(name);
  }

  return names.length > 0 ? names : undefined;
}

export function legendSymbolType(
  config: ChartConfig,
  data: ChartData,
): LegendSpec['symbolType'] | undefined {
  const markTypes = data.series
    .map((series, index) => {
      const seriesConfig = config.series?.[index];
      if (isNoFillNoLineSeries(seriesConfig)) return undefined;
      const seriesType = (seriesConfig?.type ?? series.type ?? config.type) as ChartType;
      return MARK_TYPE_MAP[seriesType];
    })
    .filter(Boolean);

  return markTypes.length > 0 && markTypes.every((markType) => markType === 'line')
    ? 'line'
    : undefined;
}
