import type { DataRow } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartSeriesStockRole } from '../../types';
import { stockValueAxisRoles } from '../stock-semantics';
import { toFiniteNumber } from './category-axis';
import {
  STOCK_CLOSE_FIELD,
  STOCK_DIRECTION_FIELD,
  STOCK_HIGH_LOW_MAX_FIELD,
  STOCK_HIGH_LOW_MIN_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
  STOCK_VOLUME_FIELD,
} from './fields';

type ChartDataPoint = NonNullable<ChartData['series'][number]['data'][number]>;
type StockValueField = 'open' | 'high' | 'low' | 'close' | 'volume';

export function applyStockFields(row: DataRow, point: ChartDataPoint, config?: ChartConfig): void {
  if (point[STOCK_OPEN_FIELD] !== undefined) row[STOCK_OPEN_FIELD] = point[STOCK_OPEN_FIELD];
  if (point[STOCK_HIGH_FIELD] !== undefined) row[STOCK_HIGH_FIELD] = point[STOCK_HIGH_FIELD];
  if (point[STOCK_LOW_FIELD] !== undefined) row[STOCK_LOW_FIELD] = point[STOCK_LOW_FIELD];
  if (point[STOCK_CLOSE_FIELD] !== undefined) {
    row[STOCK_CLOSE_FIELD] = point[STOCK_CLOSE_FIELD];
  }
  const stockOpen = toFiniteNumber(point[STOCK_OPEN_FIELD]);
  const stockClose = toFiniteNumber(point[STOCK_CLOSE_FIELD]);
  if (stockOpen !== undefined && stockClose !== undefined) {
    row[STOCK_DIRECTION_FIELD] = stockClose >= stockOpen ? 'up' : 'down';
  }
  if (point[STOCK_VOLUME_FIELD] !== undefined) {
    row[STOCK_VOLUME_FIELD] = point[STOCK_VOLUME_FIELD];
  }
  applyStockHighLowEndpointFields(row, point, config);
}

function applyStockHighLowEndpointFields(
  row: DataRow,
  point: ChartDataPoint,
  config: ChartConfig | undefined,
): void {
  const roles = config ? stockValueAxisRoles(config) : defaultStockValueAxisRoles(point);
  const values = roles
    .map((role) => toFiniteNumber(point[fieldForStockRole(role)]))
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return;
  row[STOCK_HIGH_LOW_MIN_FIELD] = Math.min(...values);
  row[STOCK_HIGH_LOW_MAX_FIELD] = Math.max(...values);
}

function defaultStockValueAxisRoles(point: ChartDataPoint): ChartSeriesStockRole[] {
  const roles: ChartSeriesStockRole[] = ['high', 'low', 'close'];
  if (point[STOCK_OPEN_FIELD] !== undefined) roles.unshift('open');
  return roles;
}

function fieldForStockRole(role: ChartSeriesStockRole): StockValueField {
  switch (role) {
    case 'volume':
      return STOCK_VOLUME_FIELD;
    case 'open':
      return STOCK_OPEN_FIELD;
    case 'high':
      return STOCK_HIGH_FIELD;
    case 'low':
      return STOCK_LOW_FIELD;
    case 'close':
      return STOCK_CLOSE_FIELD;
  }
}
