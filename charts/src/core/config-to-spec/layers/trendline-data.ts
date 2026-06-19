import type { DataRow } from '../../../grammar/spec';
import { generateTrendlinePoints, type TrendlineResult } from '../../../math/trendlines';
import type { TrendlineConfig } from '../../../types';
import { SERIES_FIELD, SOURCE_SERIES_INDEX_FIELD, VALUE_FIELD } from '../fields';

export function normalizeTrendlines(
  trendlines: TrendlineConfig[] | undefined,
  singular: TrendlineConfig | undefined,
): TrendlineConfig[] {
  return [...(trendlines ?? []), ...(singular ? [singular] : [])].filter(
    (trendline) => trendline.show !== false,
  );
}

export function trendlineRows(result: TrendlineResult | null, xField: string): DataRow[] {
  return (result?.points ?? []).map(([x, y]) => ({ [xField]: x, [VALUE_FIELD]: y }));
}

export function trendlineResult(
  rows: DataRow[],
  xField: string,
  trendline: TrendlineConfig,
): TrendlineResult | null {
  const points = rows
    .map((row): [number, number] | undefined => {
      const x = numeric(row[xField]);
      const y = numeric(row[VALUE_FIELD]);
      return x !== undefined && y !== undefined ? [x, y] : undefined;
    })
    .filter((point): point is [number, number] => point !== undefined);
  return generateTrendlinePoints(points, {
    ...trendline,
    type: normalizedTrendlineType(trendline.type),
  });
}

export function sourceRows(rows: DataRow[], seriesName?: string): DataRow[] {
  return seriesName ? rows.filter((row) => row[SERIES_FIELD] === seriesName) : rows;
}

export function sourceSeriesIndexForRows(rows: DataRow[], seriesName?: string): number | undefined {
  const index = sourceRows(rows, seriesName).find(
    (row) => typeof row[SOURCE_SERIES_INDEX_FIELD] === 'number',
  )?.[SOURCE_SERIES_INDEX_FIELD];
  return typeof index === 'number' && Number.isFinite(index) ? index : undefined;
}

export function usesComputedTrendlineRows(trendline: TrendlineConfig): boolean {
  return (
    isMovingAverageTrendline(trendline) ||
    trendline.forward !== undefined ||
    trendline.backward !== undefined ||
    trendline.forwardPeriod !== undefined ||
    trendline.backwardPeriod !== undefined ||
    trendline.intercept !== undefined
  );
}

type LegacyTrendlineType =
  | NonNullable<TrendlineConfig['type']>
  | 'exp'
  | 'log'
  | 'poly'
  | 'pow'
  | 'movingAvg';

function normalizedTrendlineType(
  type: TrendlineConfig['type'] | LegacyTrendlineType | string | undefined,
): TrendlineConfig['type'] {
  switch (type) {
    case 'exp':
      return 'exponential';
    case 'log':
      return 'logarithmic';
    case 'poly':
      return 'polynomial';
    case 'pow':
      return 'power';
    case 'movingAvg':
      return 'moving-average';
    case 'linear':
    case 'exponential':
    case 'logarithmic':
    case 'polynomial':
    case 'power':
    case 'moving-average':
      return type;
    default:
      return undefined;
  }
}

function isMovingAverageTrendline(trendline: TrendlineConfig): boolean {
  return normalizedTrendlineType(trendline.type) === 'moving-average';
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
