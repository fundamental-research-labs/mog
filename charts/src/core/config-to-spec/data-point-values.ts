import type { ChartConfig, ChartData, ChartDataPoint, SeriesConfig } from '../../types';
import { toFiniteNumber } from './category-axis';
import { seriesConfigForDataSeries } from '../series-identity';

export function isQuantitativeXSeries(
  config: ChartConfig | undefined,
  seriesConfig: SeriesConfig | undefined,
): boolean {
  if (seriesConfig?.xRole === 'quantitative') return true;
  if (seriesConfig?.xRole === 'category') return false;
  return (
    isScatterLikeChart(config) ||
    seriesConfig?.type === 'scatter' ||
    seriesConfig?.type === 'bubble'
  );
}

export function isBubbleSeries(
  config: ChartConfig | undefined,
  seriesConfig: SeriesConfig | undefined,
): boolean {
  return config?.type === 'bubble' || seriesConfig?.type === 'bubble';
}

export function scatterXValue(point: ChartDataPoint): number {
  return toFiniteNumber(point.x)!;
}

export function bubbleSizeValue(
  point: ChartDataPoint,
  config: ChartConfig | undefined,
  maxBubbleMagnitude: number,
): number {
  const rawSize = toFiniteNumber(point.size)!;
  const magnitude = Math.abs(rawSize);
  if (config?.sizeRepresents === 'w' && maxBubbleMagnitude > 0) {
    return (magnitude * magnitude) / maxBubbleMagnitude;
  }
  return magnitude;
}

export function shouldIncludePointInRows(
  point: ChartDataPoint,
  config?: ChartConfig,
  seriesConfig?: SeriesConfig,
): boolean {
  if (point.valueState === 'hidden') return false;
  if (config?.type === 'stock' && !isRenderableStockPoint(point, config)) return false;
  const isQuantitativeX = isQuantitativeXSeries(config, seriesConfig);
  if (isQuantitativeX && toFiniteNumber(point.x) === undefined) return false;
  if (isBubbleSeries(config, seriesConfig)) {
    const size = toFiniteNumber(point.size);
    if (size === undefined) return false;
    if (size <= 0 && config?.showNegBubbles !== true) return false;
  }
  if (isQuantitativeX && point.valueState) return false;
  if (!point.valueState || point.valueState === 'value') return true;
  if (point.valueState === 'blank') {
    return config?.displayBlanksAs === 'zero';
  }
  return false;
}

export function shouldEmitBlankRow(
  point: ChartDataPoint | undefined,
  config?: ChartConfig,
  seriesConfig?: SeriesConfig,
): boolean {
  if (isQuantitativeXSeries(config, seriesConfig)) return false;
  if (config?.displayBlanksAs !== 'gap' && config?.displayBlanksAs !== 'span') return false;
  if (!point) return true;
  return point.valueState === 'blank';
}

export function shouldBreakScatterLineAtPoint(
  point: ChartDataPoint | undefined,
  config?: ChartConfig,
  seriesConfig?: SeriesConfig,
): boolean {
  return (
    isQuantitativeXSeries(config, seriesConfig) &&
    (seriesConfig?.showLines ?? config?.showLines) === true &&
    config?.displayBlanksAs === 'gap' &&
    (!point || point.valueState === 'blank')
  );
}

export function maxRenderableBubbleMagnitude(data: ChartData, config?: ChartConfig): number {
  if (!config) return 0;
  let max = 0;
  for (let seriesIndex = 0; seriesIndex < data.series.length; seriesIndex += 1) {
    const series = data.series[seriesIndex];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], seriesIndex);
    if (!isBubbleSeries(config, seriesConfig)) continue;
    for (const point of series.data) {
      if (!shouldIncludePointInRows(point, config, seriesConfig)) continue;
      const size = toFiniteNumber(point.size);
      if (size !== undefined) max = Math.max(max, Math.abs(size));
    }
  }
  return max;
}

function isScatterLikeChart(config?: ChartConfig): boolean {
  return config?.type === 'scatter' || config?.type === 'bubble';
}

function isRenderableStockPoint(point: ChartDataPoint, config: ChartConfig): boolean {
  const hasHighLowClose =
    toFiniteNumber(point.high) !== undefined &&
    toFiniteNumber(point.low) !== undefined &&
    toFiniteNumber(point.close) !== undefined;
  if (hasHighLowClose) {
    return (
      (config.subType !== 'ohlc' && config.subType !== 'volume-ohlc') ||
      toFiniteNumber(point.open) !== undefined
    );
  }

  return toFiniteNumber(point.open) !== undefined && toFiniteNumber(point.close) !== undefined;
}
