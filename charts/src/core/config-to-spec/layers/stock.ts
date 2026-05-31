import type { DataRow, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData } from '../../../types';
import { CANDLESTICK_BAR_WIDTH } from '../constants';

/**
 * Build layers for stock (OHLC/candlestick) charts.
 * Stock charts show price ranges: open, high, low, close.
 *
 * Sub-type layer configurations:
 * - hlc (High-Low-Close): rule (H-L range) + tick (close marker)
 * - ohlc: rule (H-L range) + bar (O-C body) with directional color
 * - volume-hlc: volume bar layer + hlc layers
 * - volume-ohlc: volume bar layer + ohlc layers
 */
export function buildStockLayers(
  config: ChartConfig,
  _data: ChartData,
  _rows: DataRow[],
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const subType = (config.subType as string) ?? 'ohlc';
  const isHLC = subType === 'hlc' || subType === 'volume-hlc';
  const hasVolume = subType === 'volume-hlc' || subType === 'volume-ohlc';

  // Volume layer (if applicable) - bar chart of volume at the bottom
  if (hasVolume) {
    const volumeLayer: UnitSpec = {
      mark: { type: 'bar', opacity: 0.3 },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'volume', type: 'quantitative' },
        color: { value: '#888888' },
      },
    };
    layers.push(volumeLayer);
  }

  // Layer 1: High-Low rule (the wick)
  const wickLayer: UnitSpec = {
    mark: { type: 'rule' },
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'low', type: 'quantitative' },
      // y2 via a separate channel is not directly supported in our spec,
      // so we use the value field as a proxy for the range
      size: { value: 1 },
    },
  };
  layers.push(wickLayer);

  if (isHLC) {
    // HLC: close marker as tick mark (no open-close body)
    const closeLayer: UnitSpec = {
      mark: { type: 'tick' },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'close', type: 'quantitative' },
      },
    };
    layers.push(closeLayer);
  } else {
    // OHLC: Open-Close bar (the body)
    const bodyLayer: UnitSpec = {
      mark: {
        type: 'bar',
        // Use a narrow bar width for candlestick appearance
        size: CANDLESTICK_BAR_WIDTH,
      },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'open', type: 'quantitative' },
        color: {
          field: '_stockDirection',
          type: 'nominal',
        },
      },
    };
    layers.push(bodyLayer);
  }

  return layers;
}
