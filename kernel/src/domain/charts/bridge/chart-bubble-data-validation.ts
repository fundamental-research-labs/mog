import type { ChartData } from '@mog/charts';
import type { ChartError } from '@mog-sdk/contracts/bridges';
import type { ChartConfig } from '@mog-sdk/contracts/data/charts';

import { hasRenderablePointCache } from './chart-series-cache-fallback';

type ChartSeriesConfig = NonNullable<ChartConfig['series']>[number];
type ChartPointCache =
  | ChartSeriesConfig['valueCache']
  | ChartSeriesConfig['categoryCache']
  | ChartSeriesConfig['bubbleSizeCache'];
type ChartDataPoint = ChartData['series'][number]['data'][number];

function hasBubbleDimensionSource(ref: string | undefined, cache: ChartPointCache): boolean {
  return Boolean(ref?.trim()) || hasRenderablePointCache(cache);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function hasRenderableBubblePoint(point: ChartDataPoint | undefined, config: ChartConfig): boolean {
  if (!point || (point.valueState && point.valueState !== 'value')) return false;
  const x = finiteNumber(point.x);
  const y = finiteNumber(point.y);
  const size = finiteNumber(point.size);
  if (x === undefined || y === undefined || size === undefined) return false;
  return config.showNegBubbles === true || size > 0;
}

export function bubbleDataUnavailableError(
  config: ChartConfig,
  data: ChartData,
  chartId: string,
): ChartError | null {
  if (config.type !== 'bubble') return null;
  if (
    data.series.some((series) =>
      series.data.some((point) => hasRenderableBubblePoint(point, config)),
    )
  ) {
    return null;
  }

  const seriesConfigs = config.series ?? [];
  const missingDimensions: string[] = [];
  if (!seriesConfigs.some((series) => hasBubbleDimensionSource(series.values, series.valueCache))) {
    missingDimensions.push('y values');
  }
  if (
    !seriesConfigs.some((series) =>
      hasBubbleDimensionSource(series.categories, series.categoryCache),
    )
  ) {
    missingDimensions.push('x values');
  }
  if (
    !seriesConfigs.some((series) =>
      hasBubbleDimensionSource(series.bubbleSize, series.bubbleSizeCache),
    )
  ) {
    missingDimensions.push('bubble sizes');
  }

  if (missingDimensions.length > 0) {
    return {
      code: 'DATA_UNAVAILABLE',
      message: `Bubble chart data is missing ${missingDimensions.join(', ')}`,
      chartId,
    };
  }

  const points = data.series.flatMap((series) => series.data);
  const allPointsHidden =
    points.length > 0 && points.every((point) => point?.valueState === 'hidden');
  return {
    code: 'DATA_UNAVAILABLE',
    message: allPointsHidden
      ? 'Bubble chart has no renderable points because all points are hidden'
      : 'Bubble chart has no renderable points after filtering invalid x, y, or size values',
    chartId,
  };
}
