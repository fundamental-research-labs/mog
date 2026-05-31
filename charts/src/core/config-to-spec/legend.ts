import type { ChannelSpec, LegendSpec } from '../../grammar/spec';
import type { ChartConfig, LegendConfig } from '../../types';
import { buildLegendSpec } from './legend-spec';

export {
  buildCategoryLegendDomain,
  buildSeriesLegendDomain,
  isLegendEntryVisible,
  legendSymbolType,
  visibleLegendDomain,
  type LegendDomain,
} from './legend-domain';
export { buildLegendSpec, isLegendShown, legendPositionToOrient } from './legend-spec';

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
  symbolTypeByValue?: LegendSpec['symbolTypeByValue'],
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
      symbolTypeByValue,
      values: legendValues,
    });
  }
  return channel;
}
