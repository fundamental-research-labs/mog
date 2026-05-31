import type { DataRow, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData } from '../../../types';
import { buildWaterfallTransforms } from '../transforms';

/**
 * Build layers for waterfall charts.
 * Waterfall charts show running totals with increase/decrease coloring.
 * Creates a bar chart with color conditional on positive/negative values
 * and "total" bars that start from zero.
 */
export function buildWaterfallLayers(
  config: ChartConfig,
  _data: ChartData,
  _rows: DataRow[],
): UnitSpec[] {
  const waterfall = config.waterfall;
  const increaseColor = waterfall?.increaseColor ?? '#4caf50';
  const decreaseColor = waterfall?.decreaseColor ?? '#f44336';
  const totalColor = waterfall?.totalColor ?? '#2196f3';

  // For waterfall, we use a single bar layer with a color encoding
  // that maps to the _waterfallType field (increase/decrease/total)
  const mainLayer: UnitSpec = {
    mark: { type: 'bar' },
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
      color: {
        field: '_waterfallType',
        type: 'nominal',
        scale: {
          domain: ['increase', 'decrease', 'total'],
          range: [increaseColor, decreaseColor, totalColor],
        },
      },
    },
    transform: [...buildWaterfallTransforms()],
  };

  return [mainLayer];
}
