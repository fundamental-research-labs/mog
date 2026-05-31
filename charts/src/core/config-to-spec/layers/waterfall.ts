import type { DataRow, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData } from '../../../types';
import { CATEGORY_FIELD, WATERFALL_END_FIELD, WATERFALL_TYPE_FIELD } from '../fields';
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
      x: { field: CATEGORY_FIELD, type: 'nominal' },
      y: { field: WATERFALL_END_FIELD, type: 'quantitative' },
      color: {
        field: WATERFALL_TYPE_FIELD,
        type: 'nominal',
        scale: {
          domain: ['increase', 'decrease', 'total'],
          range: [increaseColor, decreaseColor, totalColor],
        },
      },
    },
    transform: [...buildWaterfallTransforms()],
  };

  if (waterfall?.showConnectorLines === false) {
    return [mainLayer];
  }

  const connectorLayer: UnitSpec = {
    mark: { type: 'line', stroke: '#6b7280', strokeWidth: 1 },
    encoding: {
      x: { field: CATEGORY_FIELD, type: 'nominal' },
      y: { field: WATERFALL_END_FIELD, type: 'quantitative' },
    },
  };

  return [mainLayer, connectorLayer];
}
