import type { ChartConfig, ChartData } from '../types';

const STOCK_SUBTYPES = new Set(['hlc', 'ohlc', 'volume-hlc', 'volume-ohlc']);

export function hasStockSubtype(config: ChartConfig): boolean {
  return typeof config.subType === 'string' && STOCK_SUBTYPES.has(config.subType);
}

export function hasStockRoleSeries(config: ChartConfig): boolean {
  return config.series?.some((series) => series.stockRole !== undefined) ?? false;
}

export function shouldProjectStockSeries(config: ChartConfig): boolean {
  return config.type === 'stock' || hasStockSubtype(config) || hasStockRoleSeries(config);
}

export function shouldRenderStockChart(config: ChartConfig, data: ChartData): boolean {
  return config.type === 'stock' || (shouldProjectStockSeries(config) && hasStockData(data));
}

export function asStockConfig(config: ChartConfig): ChartConfig {
  return config.type === 'stock' ? config : { ...config, type: 'stock' };
}

function hasStockData(data: ChartData): boolean {
  return data.series.some(
    (series) =>
      series.type === 'stock' ||
      series.data.some(
        (point) =>
          point.open !== undefined ||
          point.high !== undefined ||
          point.low !== undefined ||
          point.close !== undefined ||
          point.volume !== undefined,
      ),
  );
}
