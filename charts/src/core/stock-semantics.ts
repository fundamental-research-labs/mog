import type {
  ChartConfig,
  ChartData,
  ChartDataPoint,
  ChartSeriesStockRole,
  SeriesConfig,
  StockSourceComposition,
  StockSubType,
  StockVolumeAxisPolicy,
} from '../types';
import { isStockVolumeSeriesType, stockRolePlanWithEvidence } from './stock-role-plan';

const STOCK_SUBTYPES = new Set(['hlc', 'ohlc', 'volume-hlc', 'volume-ohlc']);
const STOCK_ROLE_ORDER: ChartSeriesStockRole[] = ['volume', 'open', 'high', 'low', 'close'];
const STOCK_SOURCE_KINDS = new Set(['singleStockChart', 'comboVolumeBarStockChart', 'modeled']);
const STOCK_VOLUME_AXIS_POLICIES = new Set(['stockValueAxis', 'separateVolumeAxis']);
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

export type StockRoleValueArrays = Record<ChartSeriesStockRole, Array<number | null>>;
export type StockSourceRoleValueArrays = Partial<
  Record<ChartSeriesStockRole, readonly (number | null | undefined)[]>
>;

export interface StockRenderedRoleValueProjection extends StockRenderedPointProjection {
  renderedRoleValues: StockRoleValueArrays;
  renderedCategories: Array<string | number | null>;
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

export function stockSourceCompositionFromConfig(
  config: Pick<
    ChartConfig,
    'series' | 'subType' | 'stockSourceComposition' | 'highLowLines' | 'upDownBars'
  >,
  data?: ChartData,
): StockSourceComposition {
  const explicit = normalizedStockSourceComposition(config.stockSourceComposition);
  const evidence = stockRolePlanWithEvidence(config.series ?? [], explicit);
  if (explicit) {
    return stockSourceCompositionWithEvidence(explicit, evidence);
  }

  const subType = stockSubTypeFromConfig(config, data);
  const sourceRoleOrder = evidence?.sourceRoleOrder ?? expectedStockRolesForSubtype(subType);
  const hasVolume = sourceRoleOrder.includes('volume');
  const volumeIndex = evidence?.roles.volume;
  const volumeSeries =
    volumeIndex !== undefined
      ? config.series?.[volumeIndex]
      : sourceSeriesForRole(config.series ?? [], 'volume');
  const separateVolumeAxis = Boolean(volumeSeries && isStockVolumeSeriesType(volumeSeries.type));
  const roleSemanticsUsable = isUsableStockRoleSemanticStatus(evidence?.sourceRoleSemanticStatus);
  const sourceKind =
    hasVolume && separateVolumeAxis
      ? 'comboVolumeBarStockChart'
      : roleSemanticsUsable
        ? 'singleStockChart'
        : 'modeled';
  const volumeAxisPolicy: StockVolumeAxisPolicy =
    hasVolume && (separateVolumeAxis || !roleSemanticsUsable)
      ? 'separateVolumeAxis'
      : 'stockValueAxis';

  return stockSourceCompositionWithEvidence(
    {
      sourceKind,
      sourceRoleOrder,
      highLowLines: config.highLowLines?.visible !== false,
      upDownBars: config.upDownBars !== undefined,
      volumeAxisPolicy,
    },
    evidence,
  );
}

export function stockSourceRoleOrder(
  config: Pick<
    ChartConfig,
    'series' | 'subType' | 'stockSourceComposition' | 'highLowLines' | 'upDownBars'
  >,
  data?: ChartData,
): ChartSeriesStockRole[] {
  return [...stockSourceCompositionFromConfig(config, data).sourceRoleOrder];
}

export function stockVolumeAxisPolicy(
  config: Pick<
    ChartConfig,
    'series' | 'subType' | 'stockSourceComposition' | 'highLowLines' | 'upDownBars'
  >,
  data?: ChartData,
): StockVolumeAxisPolicy {
  return stockSourceCompositionFromConfig(config, data).volumeAxisPolicy;
}

export function stockValueAxisRoles(
  config: Pick<
    ChartConfig,
    'series' | 'subType' | 'stockSourceComposition' | 'highLowLines' | 'upDownBars'
  >,
  data?: ChartData,
): ChartSeriesStockRole[] {
  const composition = stockSourceCompositionFromConfig(config, data);
  return composition.volumeAxisPolicy === 'stockValueAxis'
    ? [...composition.sourceRoleOrder]
    : composition.sourceRoleOrder.filter((role) => role !== 'volume');
}

export function requiredStockPriceRolesForSubtype(subType: StockSubType): ChartSeriesStockRole[] {
  return subType === 'ohlc' || subType === 'volume-ohlc'
    ? ['open', 'high', 'low', 'close']
    : ['high', 'low', 'close'];
}

export function isRenderableStockPoint(point: StockPointValue, subType: StockSubType): boolean {
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
  values: StockSourceRoleValueArrays,
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

export function stockRenderedRoleValueProjectionFromRoleValues(
  values: StockSourceRoleValueArrays,
  categories: readonly (string | number | null | undefined)[] | undefined,
  subType: StockSubType,
  sourcePointCount = stockSourcePointCount(values, categories),
): StockRenderedRoleValueProjection {
  const projection = stockRenderedPointProjectionFromRoleValues(values, subType, sourcePointCount);
  return {
    ...projection,
    renderedRoleValues: {
      open: renderedStockRoleValues(values, projection, 'open'),
      high: renderedStockRoleValues(values, projection, 'high'),
      low: renderedStockRoleValues(values, projection, 'low'),
      close: renderedStockRoleValues(values, projection, 'close'),
      volume: renderedStockRoleValues(values, projection, 'volume'),
    },
    renderedCategories: projection.renderedPointIndexes.map((pointIndex) =>
      stockCategoryOrNull(categories?.[pointIndex]),
    ),
  };
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

function normalizedStockSourceComposition(value: unknown): StockSourceComposition | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<StockSourceComposition>;
  const sourceKind =
    typeof candidate.sourceKind === 'string' && STOCK_SOURCE_KINDS.has(candidate.sourceKind)
      ? candidate.sourceKind
      : undefined;
  const volumeAxisPolicy =
    typeof candidate.volumeAxisPolicy === 'string' &&
    STOCK_VOLUME_AXIS_POLICIES.has(candidate.volumeAxisPolicy)
      ? candidate.volumeAxisPolicy
      : undefined;
  const sourceRoleOrder = Array.isArray(candidate.sourceRoleOrder)
    ? candidate.sourceRoleOrder.filter(isStockRole)
    : [];
  if (!sourceKind || !volumeAxisPolicy || sourceRoleOrder.length === 0) return undefined;
  return {
    sourceKind,
    sourceRoleOrder,
    ...(candidate.sourceRoleSemanticStatus === 'exact' ||
    candidate.sourceRoleSemanticStatus === 'verifiedDefault' ||
    candidate.sourceRoleSemanticStatus === 'approximate' ||
    candidate.sourceRoleSemanticStatus === 'missing'
      ? { sourceRoleSemanticStatus: candidate.sourceRoleSemanticStatus }
      : {}),
    ...(typeof candidate.sourceRoleSemanticSource === 'string'
      ? { sourceRoleSemanticSource: candidate.sourceRoleSemanticSource }
      : {}),
    ...(typeof candidate.sourceRoleSemanticReason === 'string'
      ? { sourceRoleSemanticReason: candidate.sourceRoleSemanticReason }
      : {}),
    highLowLines: candidate.highLowLines !== false,
    upDownBars: candidate.upDownBars === true,
    volumeAxisPolicy,
  };
}

function stockSourceCompositionWithEvidence(
  composition: StockSourceComposition,
  evidence: ReturnType<typeof stockRolePlanWithEvidence>,
): StockSourceComposition {
  if (!evidence) return composition;
  return {
    ...composition,
    sourceRoleSemanticStatus:
      composition.sourceRoleSemanticStatus ?? evidence.sourceRoleSemanticStatus,
    sourceRoleSemanticSource:
      composition.sourceRoleSemanticSource ?? evidence.sourceRoleSemanticSource,
    ...(composition.sourceRoleSemanticReason !== undefined
      ? { sourceRoleSemanticReason: composition.sourceRoleSemanticReason }
      : evidence.sourceRoleSemanticReason !== undefined
        ? { sourceRoleSemanticReason: evidence.sourceRoleSemanticReason }
        : {}),
  };
}

function isUsableStockRoleSemanticStatus(status: string | undefined): boolean {
  return status === 'exact' || status === 'verifiedDefault';
}

function sourceSeriesForRole(
  seriesConfigs: readonly SeriesConfig[],
  role: ChartSeriesStockRole,
): SeriesConfig | undefined {
  return seriesConfigs.find((series) => series.stockRole === role);
}

function isStockRole(value: unknown): value is ChartSeriesStockRole {
  return (
    value === 'volume' ||
    value === 'open' ||
    value === 'high' ||
    value === 'low' ||
    value === 'close'
  );
}

function stockFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stockNumberOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stockNumberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function renderedStockRoleValues(
  values: StockSourceRoleValueArrays,
  projection: StockRenderedPointProjection,
  role: ChartSeriesStockRole,
): Array<number | null> {
  const sourceValues = values[role];
  return projection.renderedPointIndexes.map((pointIndex) =>
    stockNumberOrNull(sourceValues?.[pointIndex]),
  );
}

function stockCategoryOrNull(value: string | number | null | undefined): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function stockSourcePointCount(
  values: StockSourceRoleValueArrays,
  categories: readonly unknown[] | undefined,
): number {
  return Math.max(
    categories?.length ?? 0,
    ...STOCK_ROLE_ORDER.map((role) => values[role]?.length ?? 0),
  );
}
