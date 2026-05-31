import type { DataRow, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData } from '../../../types';
import { CANDLESTICK_BAR_WIDTH } from '../constants';
import {
  CATEGORY_FIELD,
  STOCK_CLOSE_FIELD,
  STOCK_DIRECTION_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
  STOCK_VOLUME_FIELD,
} from '../fields';

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
  rows: DataRow[],
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const subType = stockSubType(config, rows);
  const isHLC = subType === 'hlc' || subType === 'volume-hlc';
  const hasVolume = isVolumeStockSubType(subType);
  const priceScale = stockPriceScale(rows);

  // Volume layer (if applicable) - bar chart of volume at the bottom
  if (hasVolume) {
    const volumeLayer: UnitSpec = {
      mark: { type: 'bar', opacity: 0.3 },
      encoding: {
        x: { field: CATEGORY_FIELD, type: 'nominal' },
        y: { field: STOCK_VOLUME_FIELD, type: 'quantitative', axis: null },
        color: { value: '#888888' },
      },
    };
    layers.push(volumeLayer);
  }

  // Layer 1: High-Low rule (the wick)
  const wickLayer: UnitSpec = {
    mark: { type: 'rule' },
    encoding: {
      x: { field: CATEGORY_FIELD, type: 'nominal' },
      x2: { field: CATEGORY_FIELD, type: 'nominal' },
      y: { field: STOCK_LOW_FIELD, type: 'quantitative', scale: priceScale },
      y2: { field: STOCK_HIGH_FIELD, type: 'quantitative' },
    },
  };
  layers.push(wickLayer);

  if (isHLC) {
    // HLC: close marker as tick mark (no open-close body)
    const closeLayer: UnitSpec = {
      mark: { type: 'tick' },
      encoding: {
        x: { field: CATEGORY_FIELD, type: 'nominal' },
        y: { field: STOCK_CLOSE_FIELD, type: 'quantitative', scale: priceScale },
      },
    };
    layers.push(closeLayer);
  } else {
    // OHLC: Open-Close body
    const bodyLayer: UnitSpec = {
      mark: {
        type: 'rule',
        strokeWidth: CANDLESTICK_BAR_WIDTH,
      },
      encoding: {
        x: { field: CATEGORY_FIELD, type: 'nominal' },
        x2: { field: CATEGORY_FIELD, type: 'nominal' },
        y: { field: STOCK_OPEN_FIELD, type: 'quantitative', scale: priceScale },
        y2: { field: STOCK_CLOSE_FIELD, type: 'quantitative' },
        color: {
          field: STOCK_DIRECTION_FIELD,
          type: 'nominal',
        },
      },
    };
    layers.push(bodyLayer);
  }

  return layers;
}

export function hasStockVolumeLayer(config: ChartConfig, rows: DataRow[]): boolean {
  return isVolumeStockSubType(stockSubType(config, rows));
}

function stockSubType(config: ChartConfig, rows: DataRow[]): string {
  if (
    config.subType === 'hlc' ||
    config.subType === 'ohlc' ||
    config.subType === 'volume-hlc' ||
    config.subType === 'volume-ohlc'
  ) {
    return config.subType;
  }

  const hasOpen = rows.some((row) => finite(row[STOCK_OPEN_FIELD]) !== undefined);
  const hasVolume = rows.some((row) => finite(row[STOCK_VOLUME_FIELD]) !== undefined);
  if (hasVolume) return hasOpen ? 'volume-ohlc' : 'volume-hlc';
  return hasOpen ? 'ohlc' : 'hlc';
}

function isVolumeStockSubType(subType: string): boolean {
  return subType === 'volume-hlc' || subType === 'volume-ohlc';
}

function stockPriceScale(rows: DataRow[]): { domain: number[]; zero: false } | undefined {
  const values = rows.flatMap((row) =>
    [STOCK_OPEN_FIELD, STOCK_HIGH_FIELD, STOCK_LOW_FIELD, STOCK_CLOSE_FIELD]
      .map((field) => finite(row[field]))
      .filter((value): value is number => value !== undefined),
  );
  if (values.length === 0) return undefined;
  return { domain: [Math.min(...values), Math.max(...values)], zero: false };
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
