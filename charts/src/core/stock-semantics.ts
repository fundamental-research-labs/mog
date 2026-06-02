import type {
  ChartConfig,
  ChartData,
  ChartDataPoint,
  ChartSeriesStockRole,
  StockSubType,
} from '../types';

const STOCK_SUBTYPES = new Set(['hlc', 'ohlc', 'volume-hlc', 'volume-ohlc']);
const STOCK_ROLE_ORDER: ChartSeriesStockRole[] = ['volume', 'open', 'high', 'low', 'close'];
const STOCK_ROLES_BY_SUBTYPE: Record<StockSubType, ChartSeriesStockRole[]> = {
  hlc: ['high', 'low', 'close'],
  ohlc: ['open', 'high', 'low', 'close'],
  'volume-hlc': ['volume', 'high', 'low', 'close'],
  'volume-ohlc': ['volume', 'open', 'high', 'low', 'close'],
};

export interface StockRenderedPointProjection {
  sourcePointCount: number;
  renderedPointCount: number;
  renderedPointIndexes: number[];
  droppedPointIndexes: number[];
  trailingBlankPointCount: number;
}

export type StockPointValue =
  | Pick<ChartDataPoint, 'valueState' | 'open' | 'high' | 'low' | 'close' | 'volume'>
  | undefined;

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

export function asStockConfig(config: ChartConfig, data?: ChartData): ChartConfig {
  const stockConfig: ChartConfig = config.type === 'stock' ? config : { ...config, type: 'stock' };
  if (!data || hasStockSubtype(stockConfig)) return stockConfig;
  return { ...stockConfig, subType: stockSubTypeFromConfig(stockConfig, data) };
}

export function stockRoleOrder(): ChartSeriesStockRole[] {
  return [...STOCK_ROLE_ORDER];
}

export function stockSubTypeFromConfig(
  config: Pick<ChartConfig, 'subType'>,
  data?: ChartData,
): StockSubType {
  if (isStockSubType(config.subType)) return config.subType;

  if (data) {
    const hasOpen = data.series.some((series) =>
      series.data.some((point) => stockFiniteNumber(point.open) !== undefined),
    );
    const hasVolume = data.series.some((series) =>
      series.data.some((point) => stockFiniteNumber(point.volume) !== undefined),
    );
    if (hasVolume) return hasOpen ? 'volume-ohlc' : 'volume-hlc';
    return hasOpen ? 'ohlc' : 'hlc';
  }

  return 'hlc';
}

export function stockSubTypeFromRolePresence(
  roles: Partial<Record<ChartSeriesStockRole, unknown>>,
): StockSubType {
  const hasOpen = roles.open !== undefined;
  const hasVolume = roles.volume !== undefined;
  if (hasVolume) return hasOpen ? 'volume-ohlc' : 'volume-hlc';
  return hasOpen ? 'ohlc' : 'hlc';
}

export function expectedStockRolesForSubtype(subType: StockSubType): ChartSeriesStockRole[] {
  return [...STOCK_ROLES_BY_SUBTYPE[subType]];
}

export function requiredStockPriceRolesForSubtype(
  subType: StockSubType,
): ChartSeriesStockRole[] {
  return subType === 'ohlc' || subType === 'volume-ohlc'
    ? ['open', 'high', 'low', 'close']
    : ['high', 'low', 'close'];
}

export function isRenderableStockPoint(
  point: StockPointValue,
  subType: StockSubType,
): boolean {
  if (!point || point.valueState === 'hidden') return false;
  return requiredStockPriceRolesForSubtype(subType).every(
    (role) => stockFiniteNumber(point[role]) !== undefined,
  );
}

export function stockRenderedPointProjection(
  points: readonly StockPointValue[],
  subType: StockSubType,
): StockRenderedPointProjection {
  const renderedPointIndexes: number[] = [];
  const droppedPointIndexes: number[] = [];

  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    if (isRenderableStockPoint(points[pointIndex], subType)) {
      renderedPointIndexes.push(pointIndex);
    } else {
      droppedPointIndexes.push(pointIndex);
    }
  }

  let trailingBlankPointCount = 0;
  for (let pointIndex = points.length - 1; pointIndex >= 0; pointIndex -= 1) {
    if (isRenderableStockPoint(points[pointIndex], subType)) break;
    trailingBlankPointCount += 1;
  }

  return {
    sourcePointCount: points.length,
    renderedPointCount: renderedPointIndexes.length,
    renderedPointIndexes,
    droppedPointIndexes,
    trailingBlankPointCount,
  };
}

export function stockRenderedPointProjectionFromRoleValues(
  values: Partial<Record<ChartSeriesStockRole, readonly (number | null | undefined)[]>>,
  subType: StockSubType,
  sourcePointCount: number,
): StockRenderedPointProjection {
  const points = Array.from({ length: sourcePointCount }, (_, pointIndex): StockPointValue => {
    const open = stockNumberOrUndefined(values.open?.[pointIndex]);
    const high = stockNumberOrUndefined(values.high?.[pointIndex]);
    const low = stockNumberOrUndefined(values.low?.[pointIndex]);
    const close = stockNumberOrUndefined(values.close?.[pointIndex]);
    const volume = stockNumberOrUndefined(values.volume?.[pointIndex]);
    return {
      ...(open !== undefined ? { open } : {}),
      ...(high !== undefined ? { high } : {}),
      ...(low !== undefined ? { low } : {}),
      ...(close !== undefined ? { close } : {}),
      ...(volume !== undefined ? { volume } : {}),
    };
  });
  return stockRenderedPointProjection(points, subType);
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

function isStockSubType(value: unknown): value is StockSubType {
  return typeof value === 'string' && STOCK_SUBTYPES.has(value);
}

function stockFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stockNumberOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
