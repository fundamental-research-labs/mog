import type { ChannelSpec, LegendSpec } from '../../grammar/spec';
import type { ChartConfig, LegendConfig } from '../../types';
import { buildLegendSpec, isLegendShown } from './legend-spec';

export {
  buildCategoryLegendDomain,
  buildPiePointLegendDomain,
  buildSeriesLegendDomain,
  buildStockSourceLegendDomain,
  isLegendEntryVisible,
  legendSymbolType,
  pieLegendDisplayLabel,
  usesPointLegendEntries,
  visibleLegendDomain,
  type LegendDomain,
} from './legend-domain';
export { buildLegendSpec, isLegendShown, legendPositionToOrient } from './legend-spec';

/**
 * Build encoding for the color channel, including legend config.
 */
export function buildColorEncoding(options: {
  hasMultipleSeries: boolean;
  legend?: LegendConfig;
  colors?: string[];
  reverseLegend?: boolean;
  legendDomain?: string[];
  symbolType?: LegendSpec['symbolType'];
  legendEntries?: LegendSpec['entries'];
  config?: ChartConfig;
  forceColorEncoding?: boolean;
  legendValues?: string[];
}): ChannelSpec | undefined {
  const {
    hasMultipleSeries,
    legend,
    colors,
    reverseLegend,
    legendDomain,
    symbolType,
    legendEntries,
    config,
    forceColorEncoding = false,
    legendValues,
  } = options;
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
  if (isLegendShown(legend)) {
    channel.legend = buildLegendSpec(legend, config, {
      reverse: reverseLegend,
      symbolType,
      entries: legendEntries,
      values: legendValues,
    });
  } else {
    channel.legend = null;
  }
  return channel;
}
