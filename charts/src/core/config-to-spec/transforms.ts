import type { Transform } from '../../grammar/spec';
import type { TrendlineConfig } from '../../types';
import {
  CATEGORY_FIELD,
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
export function buildTrendlineTransform(trendline: TrendlineConfig): Transform[] {
  if (trendline.show === false) return [];
  const methodMap: Record<string, string> = {
    linear: 'linear',
    exponential: 'exp',
    logarithmic: 'log',
    polynomial: 'poly',
    power: 'pow',
    'moving-average': 'linear', // moving average handled separately
  };

  const transform: Transform = {
    type: 'regression',
    regression: VALUE_FIELD,
    on: CATEGORY_FIELD,
    method: (methodMap[trendline.type ?? 'linear'] ?? 'linear') as 'linear',
    ...(trendline.order !== undefined ? { order: trendline.order } : {}),
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
