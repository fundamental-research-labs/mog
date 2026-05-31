import type { DataRow } from '../../grammar/spec';
import type { ChartData } from '../../types';
import { toFiniteNumber } from './category-axis';
import {
  STOCK_CLOSE_FIELD,
  STOCK_DIRECTION_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
  STOCK_VOLUME_FIELD,
} from './fields';

type ChartDataPoint = NonNullable<ChartData['series'][number]['data'][number]>;

export function applyStockFields(row: DataRow, point: ChartDataPoint): void {
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
}
