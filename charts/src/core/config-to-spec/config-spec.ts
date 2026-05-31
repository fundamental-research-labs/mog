import type { ConfigSpec, EncodingSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import {
  resolveChartFillPaint,
  resolveChartLineStyle,
  resolveChartShadow,
  resolverContextFromConfig,
} from '../style-resolver';
import { buildLayoutHints } from './layout-hints';
import { resolvedCategoryColors } from './series-style';
import { resolveStackMode } from './subtypes';
import { linePointsToCanvasPx } from './units';

/**
 * Build the ConfigSpec from chart-level settings: stacking, colors, and layout hints.
 */
export function buildConfigSpec(
  config: ChartConfig,
  encoding?: EncodingSpec,
  data?: ChartData,
): ConfigSpec | undefined {
  const configSpec: ConfigSpec = {};
  let hasConfig = false;

  // Stacking
  const stack = resolveStackMode(config);
  if (stack !== undefined) {
    configSpec.stack = stack;
    hasConfig = true;
  }

  if (typeof config.gapWidth === 'number') {
    configSpec.gapWidth = config.gapWidth;
    hasConfig = true;
  }
  if (typeof config.overlap === 'number') {
    configSpec.overlap = config.overlap;
    hasConfig = true;
  }

  // Colors
  const categoryColors = resolvedCategoryColors(config);
  if (categoryColors && categoryColors.length > 0) {
    configSpec.range = { category: categoryColors };
    hasConfig = true;
  }

  const chartContext = resolverContextFromConfig(config, 'chartArea');
  const chartFill =
    resolveChartFillPaint(config.chartFormat?.fill, chartContext) ??
    resolveChartFillPaint(config.chartArea?.fill, chartContext) ??
    resolveChartFillPaint(config.chartArea?.format?.fill, chartContext);
  const chartLine =
    resolveChartLineStyle(config.chartFormat?.line, chartContext, {
      widthToPx: linePointsToCanvasPx,
    }) ??
    resolveChartLineStyle(config.chartArea?.format?.line, chartContext, {
      widthToPx: linePointsToCanvasPx,
    });
  const chartShadow =
    resolveChartShadow(config.chartFormat?.shadow, chartContext) ??
    resolveChartShadow(config.chartArea?.format?.shadow, chartContext);
  if (chartFill?.type === 'solid') {
    configSpec.background = chartFill.color;
  }
  if (chartFill || chartLine || chartShadow || config.roundedCorners) {
    configSpec.chartFrame = {
      ...(chartFill ? { fill: chartFill } : {}),
      ...(chartLine ? { line: chartLine } : {}),
      ...(chartShadow ? { shadow: chartShadow } : {}),
      ...(config.roundedCorners ? { cornerRadius: 12 } : {}),
    };
    hasConfig = true;
  }

  const plotContext = resolverContextFromConfig(config, 'plotArea');
  const plotFill =
    resolveChartFillPaint(config.plotFormat?.fill, plotContext) ??
    resolveChartFillPaint(config.plotArea?.fill, plotContext) ??
    resolveChartFillPaint(config.plotArea?.format?.fill, plotContext);
  const plotLine =
    resolveChartLineStyle(config.plotFormat?.line, plotContext, {
      widthToPx: linePointsToCanvasPx,
    }) ??
    resolveChartLineStyle(config.plotArea?.format?.line, plotContext, {
      widthToPx: linePointsToCanvasPx,
    });
  const plotShadow =
    resolveChartShadow(config.plotFormat?.shadow, plotContext) ??
    resolveChartShadow(config.plotArea?.format?.shadow, plotContext);
  if (plotFill || plotLine || plotShadow) {
    configSpec.plotFrame = {
      ...(plotFill ? { fill: plotFill } : {}),
      ...(plotLine ? { line: plotLine } : {}),
      ...(plotShadow ? { shadow: plotShadow } : {}),
    };
    hasConfig = true;
  }

  const layoutHints = buildLayoutHints(config, encoding, data);
  if (layoutHints) {
    configSpec.layoutHints = layoutHints;
    hasConfig = true;
  }

  return hasConfig ? configSpec : undefined;
}
