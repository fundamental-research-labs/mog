import type { DataRow, EncodingSpec } from '../../../grammar/spec';
import type { ChartConfig } from '../../../types';
import {
  ANALYSIS_DIRECTION_FIELD,
  ANALYSIS_STROKE_WIDTH_FIELD,
  ANALYSIS_X2_FIELD,
  ANALYSIS_X_FIELD,
  ANALYSIS_Y2_FIELD,
  ANALYSIS_Y_FIELD,
  CATEGORY_FIELD,
  SERIES_INDEX_FIELD,
  SERIES_ORDER_FIELD,
  STOCK_CLOSE_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
  VALUE_FIELD,
} from '../fields';
import { upDownStrokeWidth } from './analysis-line-settings';

export function buildHighLowRows(rows: DataRow[], encoding: EncodingSpec): DataRow[] {
  const grouped = groupByCategory(rows);
  const horizontal = encoding.x?.field === VALUE_FIELD;
  const result: DataRow[] = [];

  for (const [category, categoryRows] of grouped) {
    const highs = categoryRows
      .map((row) => numeric(row[STOCK_HIGH_FIELD]) ?? numeric(row[VALUE_FIELD]))
      .filter(isFiniteNumber);
    const lows = categoryRows
      .map((row) => numeric(row[STOCK_LOW_FIELD]) ?? numeric(row[VALUE_FIELD]))
      .filter(isFiniteNumber);
    if (highs.length === 0 || lows.length === 0) continue;
    result.push(analysisRangeRow(category, Math.min(...lows), Math.max(...highs), horizontal));
  }

  return result;
}

export function buildSeriesLineRows(rows: DataRow[], encoding: EncodingSpec): DataRow[] {
  const grouped = groupByCategory(rows);
  const horizontal = encoding.x?.field === VALUE_FIELD;
  const result: DataRow[] = [];

  for (const [category, categoryRows] of grouped) {
    const ordered = [...categoryRows].sort((a, b) => seriesOrder(a) - seriesOrder(b));
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = numeric(ordered[i - 1][VALUE_FIELD]);
      const current = numeric(ordered[i][VALUE_FIELD]);
      if (previous === undefined || current === undefined) continue;
      result.push(analysisRangeRow(category, previous, current, horizontal));
    }
  }

  return result;
}

export function buildUpDownRows(
  config: ChartConfig,
  rows: DataRow[],
  encoding: EncodingSpec,
): DataRow[] {
  const grouped = groupByCategory(rows);
  const horizontal = encoding.x?.field === VALUE_FIELD;
  const result: DataRow[] = [];

  for (const [category, categoryRows] of grouped) {
    const pair = upDownPair(categoryRows);
    if (!pair) continue;
    const [start, end] = pair;
    const row = analysisRangeRow(category, start, end, horizontal);
    const strokeWidth = upDownStrokeWidth(config);
    if (strokeWidth !== undefined) row[ANALYSIS_STROKE_WIDTH_FIELD] = strokeWidth;
    row[ANALYSIS_DIRECTION_FIELD] = end >= start ? 'up' : 'down';
    result.push(row);
  }

  return result;
}

function upDownPair(rows: DataRow[]): [number, number] | undefined {
  const stockRow = rows.find(
    (row) =>
      numeric(row[STOCK_OPEN_FIELD]) !== undefined && numeric(row[STOCK_CLOSE_FIELD]) !== undefined,
  );
  if (stockRow) {
    return [numeric(stockRow[STOCK_OPEN_FIELD])!, numeric(stockRow[STOCK_CLOSE_FIELD])!];
  }

  const ordered = [...rows].sort((a, b) => seriesOrder(a) - seriesOrder(b));
  if (ordered.length < 2) return undefined;
  const start = numeric(ordered[0][VALUE_FIELD]);
  const end = numeric(ordered[1][VALUE_FIELD]);
  return start !== undefined && end !== undefined ? [start, end] : undefined;
}

function analysisRangeRow(
  category: unknown,
  start: number,
  end: number,
  horizontal: boolean,
): DataRow {
  return horizontal
    ? {
        [ANALYSIS_X_FIELD]: start,
        [ANALYSIS_X2_FIELD]: end,
        [ANALYSIS_Y_FIELD]: category,
      }
    : {
        [ANALYSIS_X_FIELD]: category,
        [ANALYSIS_Y_FIELD]: start,
        [ANALYSIS_Y2_FIELD]: end,
      };
}

function groupByCategory(rows: DataRow[]): Map<unknown, DataRow[]> {
  const grouped = new Map<unknown, DataRow[]>();
  for (const row of rows) {
    const category = row[CATEGORY_FIELD];
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category)!.push(row);
  }
  return grouped;
}

function seriesOrder(row: DataRow): number {
  return numeric(row[SERIES_ORDER_FIELD]) ?? numeric(row[SERIES_INDEX_FIELD]) ?? 0;
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined;
}
