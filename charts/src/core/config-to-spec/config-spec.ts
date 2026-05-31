import type { ConfigSpec, EncodingSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { mergeChartFormats, resolveChartOwnerElementStyle } from '../style-resolver';
import { buildLayoutHints } from './layout-hints';
import { resolvedCategoryColors } from './style';
import { resolveStackMode } from './subtypes';
import { linePointsToCanvasPx } from './units';
import { effectiveBarGeometry } from './bar-geometry';

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
  if (
    config.displayBlanksAs === 'gap' ||
    config.displayBlanksAs === 'zero' ||
    config.displayBlanksAs === 'span'
  ) {
    configSpec.displayBlanksAs = config.displayBlanksAs;
    hasConfig = true;
  }
  if (typeof config.plotVisibleOnly === 'boolean') {
    configSpec.plotVisibleOnly = config.plotVisibleOnly;
    hasConfig = true;
  }

  const barGeometry = effectiveBarGeometry(config);
  if (barGeometry) {
    configSpec.barGeometry = barGeometry;
    hasConfig = true;
  }

  // Colors
  const categoryColors = resolvedCategoryColors(config, data);
  if (categoryColors && categoryColors.length > 0) {
    configSpec.range = { category: categoryColors };
    hasConfig = true;
  }

  if (config.type === 'bubble') {
    if (typeof config.bubbleScale === 'number') {
      configSpec.bubbleScale = config.bubbleScale;
      hasConfig = true;
    }
    if (typeof config.showNegBubbles === 'boolean') {
      configSpec.showNegBubbles = config.showNegBubbles;
      hasConfig = true;
    }
    if (config.sizeRepresents === 'area' || config.sizeRepresents === 'w') {
      configSpec.sizeRepresents = config.sizeRepresents;
      hasConfig = true;
    }
    if (typeof config.bubble3DEffect === 'boolean') {
      configSpec.bubble3DEffect = config.bubble3DEffect;
      hasConfig = true;
    }
  }

  const chartFormat = mergeChartFormats(
    mergeChartFormats(
      config.chartArea?.format,
      config.chartArea?.fill ? { fill: config.chartArea.fill } : undefined,
    ),
    config.chartFormat,
  );
  const chartStyle = resolveChartOwnerElementStyle(config, 'chartArea', chartFormat, {
    widthToPx: linePointsToCanvasPx,
  });
  const chartFill =
    chartStyle.paint ??
    (shouldUseImportedExcelDefaultFrame(config) ? excelDefaultChartFill() : undefined);
  const chartLine = chartStyle.line;
  const chartShadow = chartStyle.shadow;
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

  const plotFormat = mergeChartFormats(
    mergeChartFormats(
      config.plotArea?.format,
      config.plotArea?.fill ? { fill: config.plotArea.fill } : undefined,
    ),
    config.plotFormat,
  );
  const plotStyle = resolveChartOwnerElementStyle(config, 'plotArea', plotFormat, {
    widthToPx: linePointsToCanvasPx,
  });
  const plotFill = plotStyle.paint;
  const plotLine = plotStyle.line;
  const plotShadow = plotStyle.shadow;
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

function shouldUseImportedExcelDefaultFrame(config: ChartConfig): boolean {
  return config.style !== undefined || config.chartStyleContext !== undefined;
}

function excelDefaultChartFill(): { type: 'solid'; color: '#ffffff' } {
  return { type: 'solid', color: '#ffffff' };
}
