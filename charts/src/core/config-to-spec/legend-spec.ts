import type { LegendOrient, LegendSpec } from '../../grammar/spec';
import type { ChartConfig, LegendConfig } from '../../types';
import { resolveChartTextColor } from '../../utils/chart-colors';
import { resolveChartOwnerFormat, resolverContextFromConfig } from '../style-resolver';
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
    ...(legendFont?.size !== undefined ? { labelFontSize: pointsToCanvasPx(legendFont.size) } : {}),
    ...(legendFont?.name ? { labelFontFamily: legendFont.name } : {}),
    ...(labelColor ? { labelColor } : {}),
  };
}
