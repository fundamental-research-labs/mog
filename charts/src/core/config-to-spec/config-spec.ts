import type { ConfigSpec, EncodingSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { resolveFormatFillColor, resolveSolidFillColor } from '../../utils/chart-colors';
import { buildLayoutHints } from './layout-hints';
import { resolvedCategoryColors } from './series-style';
import { resolveStackMode } from './subtypes';

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

  const background =
    resolveFormatFillColor(config.chartFormat) ??
    resolveSolidFillColor(config.chartArea?.fill) ??
    resolveFormatFillColor(config.chartArea?.format);
  if (background) {
    configSpec.background = background;
    hasConfig = true;
  }

  const layoutHints = buildLayoutHints(config, encoding, data);
  if (layoutHints) {
    configSpec.layoutHints = layoutHints;
    hasConfig = true;
  }

  return hasConfig ? configSpec : undefined;
}
