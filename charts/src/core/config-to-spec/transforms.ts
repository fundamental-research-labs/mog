import type { Transform } from '../../grammar/spec';
import type { TrendlineConfig } from '../../types';
import {
  CATEGORY_FIELD,
  POINT_INDEX_FIELD,
  SCATTER_X_FIELD,
  VALUE_FIELD,
  WATERFALL_END_FIELD,
  WATERFALL_RUNNING_TOTAL_FIELD,
} from './fields';

/**
 * Build transforms for waterfall charts.
 * Waterfall charts need cumulative running totals with special "total" bars.
 * The calculate transform produces a running total end position per bar.
 */
export function buildWaterfallTransforms(): Transform[] {
  const transforms: Transform[] = [];
  // Calculate running total for waterfall positioning
  transforms.push({
    type: 'calculate',
    calculate: `datum.${WATERFALL_RUNNING_TOTAL_FIELD}`,
    as: WATERFALL_END_FIELD,
  });
  return transforms;
}

/**
 * Build transforms for trendlines (scatter charts).
 * Maps showEquation, showR2, and period from TrendlineConfig.
 */
export function buildTrendlineTransform(
  trendline: TrendlineConfig,
  xField: string = CATEGORY_FIELD,
  yField: string = VALUE_FIELD,
): Transform[] {
  if (trendline.show === false) return [];
  const methodMap: Record<string, string> = {
    linear: 'linear',
    exp: 'exp',
    exponential: 'exp',
    log: 'log',
    logarithmic: 'log',
    poly: 'poly',
    polynomial: 'poly',
    pow: 'pow',
    power: 'pow',
    movingAvg: 'linear',
    'moving-average': 'linear',
  };

  const transform: Transform = {
    type: 'regression',
    regression: yField,
    on: xField,
    method: (methodMap[trendline.type ?? 'linear'] ?? 'linear') as 'linear',
    ...(trendline.order !== undefined ? { order: trendline.order } : {}),
    as: [xField, yField],
  };

  // Attach showEquation/showR2/period as extra metadata on the transform
  // These are consumed by the OOXML exporter for trendline generation
  if (trendline.showEquation !== undefined) transform._showEquation = trendline.showEquation;
  if (trendline.showR2 !== undefined) transform._showR2 = trendline.showR2;
  if (trendline.type === 'moving-average' && trendline.period !== undefined) {
    transform._movingAveragePeriod = trendline.period;
  }

  return [transform];
}

export function trendlineXFieldForChartType(chartType: string): string {
  return chartType === 'scatter' || chartType === 'bubble' ? SCATTER_X_FIELD : POINT_INDEX_FIELD;
}
