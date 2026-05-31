import type { ChannelSpec, EncodingSpec, LegendOrient, LegendSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartType, LegendConfig } from '../../types';
import { resolveChartTextColor } from '../../utils/chart-colors';
import {
  buildAxisScaleSpec,
  categoryDisplayLabel,
  categoryKeyForIndex,
  explicitDomainBound,
  isHorizontalBarType,
  mapAxisConfigToAxisSpec,
  resolveAxisConfigForChannel,
  shouldReverseHorizontalCategoryAxis,
  shouldUseDateSerialCategoryAxis,
  shouldUseStableCategoryKeys,
} from './axis';
import { MARK_TYPE_MAP, SERIES_OPACITY_FIELD } from './constants';
import { isNoFillNoLineSeries, resolvedCategoryColors } from './series-style';
import { resolveStackMode } from './subtypes';
import { pointsToCanvasPx } from './units';

/**
 * Map LegendConfig.position to LegendOrient.
 */
function legendPositionToOrient(position: string): LegendOrient {
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

/**
 * Build encoding for the color channel, including legend config.
 */
function buildColorEncoding(
  hasMultipleSeries: boolean,
  legend?: LegendConfig,
  colors?: string[],
  reverseLegend?: boolean,
  legendDomain?: string[],
  symbolType?: LegendSpec['symbolType'],
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
    if (!isLegendShown(legend)) {
      channel.legend = null;
    } else {
      const legendFont = legend.format?.font ?? legend.font;
      const labelColor = resolveChartTextColor(legendFont?.color);
      channel.legend = {
        orient: legendPositionToOrient(legend.position),
        title: null,
        ...(reverseLegend ? { reverse: true } : {}),
        ...(symbolType ? { symbolType } : {}),
        ...(legendFont?.size !== undefined
          ? { labelFontSize: pointsToCanvasPx(legendFont.size) }
          : {}),
        ...(legendFont?.name ? { labelFontFamily: legendFont.name } : {}),
        ...(labelColor ? { labelColor } : {}),
      };
    }
  }
  return channel;
}

function visibleLegendDomain(config: ChartConfig, data: ChartData): string[] | undefined {
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

function legendSymbolType(
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

/**
 * Build the main encoding spec for a chart.
 *
 * IMPORTANT: The old chart-engine.ts had a bug where bar chart x/y types were
 * inverted. This implementation FIXES that:
 *
 *   column (vertical bars): x = nominal (category), y = quantitative (value)
 *   bar (horizontal bars):  x = quantitative (value), y = nominal (category)
 */
export function buildEncoding(config: ChartConfig, data: ChartData): EncodingSpec {
  const encoding: EncodingSpec = {};
  const chartType = config.type;
  const hasMultipleSeries = data.series.length > 1;

  // --- Pie / Doughnut / Pie3D / OfPie: theta + color instead of x/y ---
  if (
    chartType === 'pie' ||
    chartType === 'doughnut' ||
    chartType === 'pie3d' ||
    chartType === 'ofPie'
  ) {
    encoding.theta = {
      field: 'value',
      type: 'quantitative',
    };
    encoding.color = {
      field: 'category',
      type: 'nominal',
    };
    const categoryColors = resolvedCategoryColors(config);
    if (categoryColors) {
      encoding.color.scale = { range: categoryColors };
    }
    // Apply legend config to color channel.
    if (config.legend) {
      if (!isLegendShown(config.legend)) {
        encoding.color.legend = null;
      } else {
        const legendFont = config.legend.format?.font ?? config.legend.font;
        const labelColor = resolveChartTextColor(legendFont?.color);
        encoding.color.legend = {
          orient: legendPositionToOrient(config.legend.position),
          title: null,
          ...(resolveStackMode(config) ? { reverse: true } : {}),
          ...(legendFont?.size !== undefined
            ? { labelFontSize: pointsToCanvasPx(legendFont.size) }
            : {}),
          ...(legendFont?.name ? { labelFontFamily: legendFont.name } : {}),
          ...(labelColor ? { labelColor } : {}),
        };
      }
    }
    return encoding;
  }

  // --- X/Y encoding for all other chart types ---
  // Excel column charts are vertical; Excel bar charts are horizontal.
  const isHorizontal = isHorizontalBarType(chartType);
  const useDateSerialCategoryAxis = shouldUseDateSerialCategoryAxis(config, data, isHorizontal);
  const useStableCategoryKeys = shouldUseStableCategoryKeys(
    config,
    data,
    useDateSerialCategoryAxis,
  );
  const categoryChannel: ChannelSpec = {
    field: 'category',
    type: useDateSerialCategoryAxis ? 'quantitative' : 'nominal',
    ...(useDateSerialCategoryAxis
      ? { scale: { type: 'linear', zero: false, nice: false } }
      : useStableCategoryKeys || shouldReverseHorizontalCategoryAxis(config, isHorizontal)
        ? {
            scale: {
              ...(useStableCategoryKeys
                ? { domain: data.categories.map((_category, index) => categoryKeyForIndex(index)) }
                : {}),
              ...(shouldReverseHorizontalCategoryAxis(config, isHorizontal)
                ? { reverse: true }
                : {}),
            },
          }
        : {}),
  };
  const valueChannel: ChannelSpec = { field: 'value', type: 'quantitative' };
  if (isHorizontal) {
    encoding.x = valueChannel;
    encoding.y = categoryChannel;
  } else {
    encoding.x = categoryChannel;
    encoding.y = valueChannel;
  }

  // Apply axis config.
  if (config.axis) {
    const xAxis = resolveAxisConfigForChannel(config.axis, 'x', isHorizontal);
    if (xAxis && encoding.x) {
      encoding.x.axis = mapAxisConfigToAxisSpec(xAxis);
      const scaleSpec = buildAxisScaleSpec(xAxis, useDateSerialCategoryAxis);
      if (scaleSpec) encoding.x.scale = { ...(encoding.x.scale ?? {}), ...scaleSpec };
    }
    const yAxis = resolveAxisConfigForChannel(config.axis, 'y', isHorizontal);
    if (yAxis && encoding.y) {
      encoding.y.axis = mapAxisConfigToAxisSpec(yAxis);
      const scaleSpec = buildAxisScaleSpec(yAxis, false);
      if (scaleSpec) encoding.y.scale = { ...(encoding.y.scale ?? {}), ...scaleSpec };
    }
  }

  applyBarCategorySpacingScale(config, encoding, isHorizontal);
  applyCategoryAxisLabels(data, encoding, isHorizontal, useStableCategoryKeys);

  // Color encoding for multi-series.
  const legendDomain = visibleLegendDomain(config, data);
  const colorChannel = buildColorEncoding(
    hasMultipleSeries,
    config.legend,
    resolvedCategoryColors(config),
    Boolean(resolveStackMode(config)) && !legendDomain,
    legendDomain,
    legendSymbolType(config, data),
  );
  if (colorChannel) {
    encoding.color = colorChannel;
  }
  if (config.series?.some(isNoFillNoLineSeries)) {
    encoding.opacity = {
      field: SERIES_OPACITY_FIELD,
      type: 'quantitative',
      scale: { domain: [0, 1], range: [0, 1] },
      legend: null,
    };
  }

  applyStackedValueDomain(config, data, encoding);
  applyAutomaticCategoryAxisCrossing(encoding);

  return encoding;
}

function hasBarSpacingConfig(config: ChartConfig): boolean {
  return typeof config.gapWidth === 'number' || typeof config.overlap === 'number';
}

function applyBarCategorySpacingScale(
  config: ChartConfig,
  encoding: EncodingSpec,
  isHorizontal: boolean,
): void {
  if (MARK_TYPE_MAP[config.type] !== 'bar' || !hasBarSpacingConfig(config)) return;
  const categoryChannel = isHorizontal ? encoding.y : encoding.x;
  if (!categoryChannel) return;

  categoryChannel.scale = {
    ...(categoryChannel.scale ?? {}),
    paddingInner: 0,
    paddingOuter: 0,
  };
}

function applyCategoryAxisLabels(
  data: ChartData,
  encoding: EncodingSpec,
  isHorizontal: boolean,
  useStableCategoryKeys: boolean,
): void {
  const categoryChannel = isHorizontal ? encoding.y : encoding.x;
  if (!categoryChannel || categoryChannel.axis === null) return;

  const labelTextByValue: Record<string, string> = {};
  if (useStableCategoryKeys) {
    data.categories.forEach((category, index) => {
      labelTextByValue[categoryKeyForIndex(index)] = categoryDisplayLabel(category);
    });
  }

  const labelFormatByValue: Record<string, string> = {};
  if (data.categoryFormatCodes?.some(Boolean)) {
    data.categories.forEach((category, index) => {
      const formatCode = data.categoryFormatCodes?.[index];
      if (formatCode) {
        const key = useStableCategoryKeys ? categoryKeyForIndex(index) : String(category);
        labelFormatByValue[key] = formatCode;
      }
    });
  }
  if (Object.keys(labelTextByValue).length === 0 && Object.keys(labelFormatByValue).length === 0) {
    return;
  }

  categoryChannel.axis = {
    ...(categoryChannel.axis ?? {}),
    ...(Object.keys(labelTextByValue).length > 0 ? { labelTextByValue } : {}),
    ...(Object.keys(labelFormatByValue).length > 0 ? { labelFormatByValue } : {}),
  };
}

function applyStackedValueDomain(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
): void {
  const stack = resolveStackMode(config);
  if (!stack || stack === 'normalize') return;

  const chartType = config.type;
  const valueChannel = isHorizontalBarType(chartType) ? encoding.x : encoding.y;
  if (!valueChannel) return;

  const existingDomain = Array.isArray(valueChannel.scale?.domain)
    ? valueChannel.scale.domain
    : undefined;
  const explicitMin = explicitDomainBound(existingDomain, 0);
  const explicitMax = explicitDomainBound(existingDomain, 1);

  let maxPositive = 0;
  let minNegative = 0;
  for (let pointIndex = 0; pointIndex < (data.categories?.length ?? 0); pointIndex += 1) {
    let positive = 0;
    let negative = 0;
    for (const series of data.series) {
      const value = series.data[pointIndex]?.y;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (value >= 0) positive += value;
      else negative += value;
    }
    if (positive > maxPositive) maxPositive = positive;
    if (negative < minNegative) minNegative = negative;
  }

  if (maxPositive === 0 && minNegative === 0) return;

  const isAutoDivergingStack =
    explicitMin === undefined && explicitMax === undefined && minNegative < 0 && maxPositive > 0;

  valueChannel.scale = {
    ...(valueChannel.scale ?? {}),
    domain: [explicitMin ?? minNegative, explicitMax ?? maxPositive],
    ...(isAutoDivergingStack ? { nice: valueChannel.scale?.nice ?? 6 } : {}),
  };

  if (isAutoDivergingStack) {
    valueChannel.axis = {
      ...(valueChannel.axis ?? {}),
      tickCount: valueChannel.axis?.tickCount ?? 6,
    };
  }
}

function applyAutomaticCategoryAxisCrossing(encoding: EncodingSpec): void {
  const x = encoding.x;
  const y = encoding.y;
  if (!x || !y || x.type !== 'nominal' || y.type !== 'quantitative') return;
  if (x.axis === null || x.axis?.crossesAt !== undefined) return;

  const scaleDomain = Array.isArray(y.scale?.domain) ? y.scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined || min >= 0 || max <= 0) return;

  x.axis = {
    ...(x.axis ?? {}),
    crossesAt: 'automatic',
  };
}
