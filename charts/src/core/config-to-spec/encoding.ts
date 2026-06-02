import type { ChannelSpec, EncodingSpec, LegendSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData, SingleAxisConfig } from '../../types';
import {
  applyAutoValueAxisTicks,
  buildAxisScaleSpec,
  isHorizontalBarType,
  mapAxisConfigToAxisSpec,
  normalizeAxisOrient,
  resolveAxisConfigForChannel,
} from './axis';
import {
  categoryKeyForIndex,
  shouldReverseHorizontalCategoryAxis,
  shouldUseDateSerialCategoryAxis,
  shouldUseStableCategoryKeys,
} from './category-axis';
import { SERIES_OPACITY_FIELD } from './constants';
import {
  applyMogAutoValueAxisScale,
  applyAutomaticCategoryAxisCrossing,
  applyBarCategorySpacingScale,
  applyCategoryAxisLabels,
  applyStackedValueDomain,
} from './encoding-adjustments';
import { effectiveBarGeometry, shouldReverseImportedHorizontalBarSeries } from './bar-geometry';
import {
  applyExcelCartesianValueScales,
  applyExcelCategoryPointScale,
  chartValueValues,
  excelChartValueAxisIncludesZero,
  usesExcelCartesianGeometry,
} from './excel-cartesian-geometry';
import { hasSecondaryYAxis } from './secondary-axis';
import {
  buildCategoryLegendDomain,
  buildColorEncoding,
  buildLegendSpec,
  buildSeriesLegendDomain,
  legendSymbolType,
  visibleLegendDomain,
} from './legend';
import { BUBBLE_SIZE_FIELD, SCATTER_X_FIELD, VALUE_FIELD } from './fields';
import { isNoFillNoLineSeries, resolvedCategoryColors, variesColorsByCategory } from './style';
import { resolveStackMode } from './subtypes';

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
    const categoryColors = resolvedCategoryColors(config, data);
    if (categoryColors) {
      encoding.color.scale = { range: categoryColors };
    }
    // Apply legend config to color channel.
    if (config.legend) {
      const legendDomain = buildCategoryLegendDomain(config, data);
      encoding.color.legend = buildLegendSpec(config.legend, config, {
        reverse: Boolean(resolveStackMode(config)),
        entries: legendDomain?.entries,
        values: legendDomain?.values,
      });
    }
    return encoding;
  }

  if (chartType === 'histogram') {
    encoding.x = {
      field: VALUE_FIELD,
      type: 'quantitative',
      bin:
        config.histogram?.binCount || config.histogram?.binWidth
          ? { maxbins: config.histogram.binCount, step: config.histogram.binWidth }
          : true,
      scale: { zero: false, nice: true },
    };
    const seriesLegendDomain = buildSeriesLegendDomain(config, data);
    const colorChannel = buildColorEncoding({
      hasMultipleSeries,
      legend: config.legend,
      colors: resolvedCategoryColors(config, data),
      reverseLegend: false,
      legendDomain: visibleLegendDomain(config, data),
      symbolType: legendSymbolType(config, data),
      legendEntries: seriesLegendDomain?.entries,
      config,
      forceColorEncoding: seriesLegendDomain?.forceColorEncoding,
      legendValues: seriesLegendDomain?.values,
    });
    if (colorChannel) encoding.color = colorChannel;
    return encoding;
  }

  if (chartType === 'radar') {
    const valueAxis = config.axis
      ? resolveAxisConfigForChannel(config.axis, 'y', false)
      : undefined;
    const valueAxisSpec = valueAxis
      ? mapAxisConfigToAxisSpec(valueAxis, config, 'valueAxis')
      : undefined;
    const valueScaleSpec = valueAxis ? buildAxisScaleSpec(valueAxis, false) : undefined;
    encoding.x = {
      field: 'category',
      type: 'nominal',
      axis: null,
      scale: data.categories.length > 0 ? { domain: data.categories } : undefined,
    };
    encoding.y = {
      field: VALUE_FIELD,
      type: 'quantitative',
      axis: null,
      format: valueAxisSpec?.format,
      scale: { zero: true, nice: true, ...(valueScaleSpec ?? {}) },
    };
    const seriesLegendDomain = buildSeriesLegendDomain(config, data);
    const colorChannel = buildColorEncoding({
      hasMultipleSeries,
      legend: config.legend,
      colors: resolvedCategoryColors(config, data),
      reverseLegend: false,
      legendDomain: visibleLegendDomain(config, data),
      symbolType: legendSymbolType(config, data),
      legendEntries: seriesLegendDomain?.entries,
      config,
      forceColorEncoding: seriesLegendDomain?.forceColorEncoding,
      legendValues: seriesLegendDomain?.values,
    });
    if (colorChannel) encoding.color = colorChannel;
    return encoding;
  }

  // --- X/Y encoding for all other chart types ---
  // Excel column charts are vertical; Excel bar charts are horizontal.
  const isHorizontal = isHorizontalBarType(chartType);
  const isXYChart =
    chartType === 'scatter' || chartType === 'bubble' || chartType === 'bubble3DEffect';
  const useExcelCartesian = usesExcelCartesianGeometry(config);
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
  const valueChannel: ChannelSpec = { field: VALUE_FIELD, type: 'quantitative' };
  if (isXYChart) {
    encoding.x = {
      field: SCATTER_X_FIELD,
      type: 'quantitative',
      scale: { zero: false, nice: true },
    };
    encoding.y = valueChannel;
    if (chartType === 'bubble' || chartType === 'bubble3DEffect') {
      encoding.size = {
        field: BUBBLE_SIZE_FIELD,
        type: 'quantitative',
        scale: {
          range: [0, bubbleMaxArea(config)],
        },
        legend: null,
      };
    }
  } else if (isHorizontal) {
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
      encoding.x.axis = mapAxisConfigToAxisSpec(
        xAxis,
        config,
        isHorizontal ? 'valueAxis' : 'categoryAxis',
      );
      const scaleSpec = buildAxisScaleSpec(xAxis, useDateSerialCategoryAxis);
      if (scaleSpec) encoding.x.scale = { ...(encoding.x.scale ?? {}), ...scaleSpec };
    }
    const yAxis = resolveAxisConfigForChannel(config.axis, 'y', isHorizontal);
    if (yAxis && encoding.y) {
      encoding.y.axis = mapAxisConfigToAxisSpec(
        yAxis,
        config,
        isHorizontal ? 'categoryAxis' : 'valueAxis',
      );
      const scaleSpec = buildAxisScaleSpec(yAxis, false);
      if (scaleSpec) encoding.y.scale = { ...(encoding.y.scale ?? {}), ...scaleSpec };
    }
  }

  applySecondaryCategoryAxis(config, encoding, isHorizontal);
  applyBarCategorySpacingScale(config, encoding, isHorizontal);
  if (!isXYChart) {
    if (chartType !== 'combo') {
      applyExcelCategoryPointScale(isHorizontal ? encoding.y : encoding.x, config, data, {
        isHorizontal,
        useDateSerialCategoryAxis,
        useStableCategoryKeys,
      });
    }
    applyCategoryAxisLabels(
      data,
      encoding,
      isHorizontal,
      useStableCategoryKeys,
      config.categoryLabelLevel,
    );
  }

  if (variesColorsByCategory(config, data)) {
    const categoryLegendDomain = buildCategoryLegendDomain(config, data);
    const categoryColors = resolvedCategoryColors(config, data);
    encoding.color = {
      field: 'category',
      type: 'nominal',
      ...(data.categories.length > 0 || (categoryColors && categoryColors.length > 0)
        ? {
            scale: {
              ...(data.categories.length > 0
                ? { domain: data.categories.map((category) => String(category)) }
                : {}),
              ...(categoryColors && categoryColors.length > 0 ? { range: categoryColors } : {}),
            },
          }
        : {}),
      ...(config.legend
        ? {
            legend: buildLegendSpec(config.legend, config, {
              symbolType: categoryLegendSymbolType(config),
              entries: categoryLegendDomain?.entries,
              values: categoryLegendDomain?.values,
            }),
          }
        : {}),
    };
  } else {
    // Color encoding for multi-series.
    const legendDomain = visibleLegendDomain(config, data);
    const seriesLegendDomain = buildSeriesLegendDomain(config, data);
    const colorChannel = buildColorEncoding({
      hasMultipleSeries,
      legend: config.legend,
      colors: resolvedCategoryColors(config, data),
      reverseLegend: shouldReverseSeriesLegend(config),
      legendDomain,
      symbolType: legendSymbolType(config, data),
      legendEntries: seriesLegendDomain?.entries,
      config,
      forceColorEncoding: seriesLegendDomain?.forceColorEncoding,
      legendValues: seriesLegendDomain?.values,
    });
    if (colorChannel) {
      encoding.color = colorChannel;
    }
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
  applyCartesianValueAxisDefaults(encoding, {
    includeZero: useExcelCartesian ? excelChartValueAxisIncludesZero(config) : !isXYChart,
  });
  if (useExcelCartesian) {
    if (chartType !== 'combo') {
      applyExcelCartesianValueScales(config, data, encoding, { isHorizontal, isXYChart });
    }
  } else if (!isXYChart && !hasSecondaryYAxis(config, data)) {
    const valueChannel = isHorizontal ? encoding.x : encoding.y;
    applyMogAutoValueAxisScale(valueChannel, chartValueValues(data), { includeZero: true });
  }
  applyAutomaticCategoryAxisCrossing(encoding);

  return encoding;
}


function applyCartesianValueAxisDefaults(
  encoding: EncodingSpec,
  options: { includeZero: boolean },
): void {
  if (encoding.x?.field === VALUE_FIELD || encoding.x?.field === SCATTER_X_FIELD) {
    applyAutoValueAxisTicks(encoding.x, {
      includeZero: options.includeZero && encoding.x.field === VALUE_FIELD,
    });
  }
  if (encoding.y?.field === VALUE_FIELD) {
    applyAutoValueAxisTicks(encoding.y, { includeZero: options.includeZero });
  }
}

function shouldReverseSeriesLegend(config: ChartConfig): boolean {
  const barGeometry = effectiveBarGeometry(config);
  return barGeometry ? shouldReverseImportedHorizontalBarSeries(config, barGeometry) : false;
}

function bubbleMaxArea(config: ChartConfig): number {
  const scale = typeof config.bubbleScale === 'number' ? config.bubbleScale : 100;
  return 6400 * (Math.max(0, Math.min(300, scale)) / 100);
}

function categoryLegendSymbolType(config: ChartConfig): LegendSpec['symbolType'] | undefined {
  if (config.type === 'bubble' || config.type === 'bubble3DEffect' || config.type === 'scatter') {
    return 'circle';
  }
  return undefined;
}

function applySecondaryCategoryAxis(
  config: ChartConfig,
  encoding: EncodingSpec,
  isHorizontal: boolean,
): void {
  const secondaryCategoryAxis = config.axis?.secondaryCategoryAxis;
  if (!isVisibleAxis(secondaryCategoryAxis)) return;

  const categoryChannel = isHorizontal ? encoding.y : encoding.x;
  if (!categoryChannel) return;

  const axisSpec = mapAxisConfigToAxisSpec(secondaryCategoryAxis, config, 'secondaryCategoryAxis');
  const explicitOrient = normalizeAxisOrient(secondaryCategoryAxis.position);
  categoryChannel.secondaryAxis = {
    ...axisSpec,
    orient: explicitOrient ?? (isHorizontal ? 'right' : 'top'),
    title: axisSpec.title ?? secondaryCategoryAxis.title ?? null,
  };
}

function isVisibleAxis(axis: SingleAxisConfig | undefined): axis is SingleAxisConfig {
  return Boolean(axis && (axis.show ?? axis.visible) !== false);
}
