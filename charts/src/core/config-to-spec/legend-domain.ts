import type {
  DataRow,
  LegendEntrySpec,
  LegendSpec,
  LegendSymbolType,
  MarkType,
} from '../../grammar/spec';
import type {
  ChartConfig,
  ChartData,
  ChartSeriesStockRole,
  ChartType,
  LegendConfig,
  SeriesConfig,
} from '../../types';
import { stockRolePlan } from '../data-extractor-imported';
import {
  seriesConfigForDataSeries,
  seriesConfigSourceIndex,
  seriesConfigSourceKey,
  seriesSourceIndex,
  seriesSourceKey,
} from '../series-identity';
import { stockSourceCompositionFromConfig, stockSubTypeFromConfig } from '../stock-semantics';
import { MARK_TYPE_MAP } from './constants';
import { isLegendShown } from './legend-spec';
import { buildPieDoughnutGeometry, pieDisplayLabel } from './pie-doughnut-geometry';
import { isPieLikeChartType } from './pie-like';
import { resolveStockGlyphVisual } from './stock-visual';
import { isNoFillNoLineSeries } from './style';

type LegendEntryConfig = NonNullable<LegendConfig['entries']>[number];
type SeriesLegendEntryValueResolver = (input: {
  series: ChartData['series'][number];
  renderedIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  name: string;
}) => string | undefined;

export interface LegendDomain {
  values: string[];
  forceColorEncoding: boolean;
  colors?: string[];
  entries?: LegendEntrySpec[];
}

export function visibleLegendDomain(config: ChartConfig, data: ChartData): string[] | undefined {
  const seriesConfigs = config.series ?? [];
  const renderedSeriesConfigs = data.series.map((series, index) =>
    seriesConfigForDataSeries(series, seriesConfigs, index),
  );
  if (!renderedSeriesConfigs.some(isNoFillNoLineSeries)) return undefined;

  const names: string[] = [];
  for (let index = 0; index < data.series.length; index += 1) {
    if (isNoFillNoLineSeries(renderedSeriesConfigs[index])) continue;
    const name = data.series[index]?.name;
    if (name && !names.includes(name)) names.push(name);
  }

  return names.length > 0 ? names : undefined;
}

export function buildSeriesLegendDomain(
  config: ChartConfig,
  data: ChartData,
  options: {
    entryValueForSeries?: SeriesLegendEntryValueResolver;
  } = {},
): LegendDomain | undefined {
  const legend = config.legend;
  if (!isLegendShown(legend)) return undefined;

  const names: string[] = [];
  const entries: LegendEntrySpec[] = [];
  for (let index = 0; index < data.series.length; index += 1) {
    const series = data.series[index];
    if (!series) continue;
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    const sourceIndex = seriesConfig?.sourceSeriesIndex ?? seriesSourceIndex(series, index);
    const entry = legendEntryForIndex(legend, sourceIndex) ?? legendEntryForIndex(legend, index);
    if (!isLegendEntryVisible(entry, seriesConfig)) continue;
    const name = series?.name;
    if (!name) continue;
    if (!names.includes(name)) names.push(name);
    const sourceKey = seriesConfig?.sourceSeriesKey ?? seriesSourceKey(series, index);
    const entryValue =
      options.entryValueForSeries?.({
        series,
        renderedIndex: index,
        sourceSeriesIndex: sourceIndex,
        sourceSeriesKey: sourceKey,
        name,
      }) ?? name;
    entries.push({
      value: entryValue,
      label: name,
      symbolType: legendSymbolTypeForSeries(config, series, seriesConfig, index),
      seriesIndex: index,
      sourceSeriesIndex: sourceIndex,
      sourceSeriesKey: sourceKey,
    });
  }

  return {
    values: names,
    forceColorEncoding: data.series.length === 1 && names.length > 0,
    ...(entries.length > 0 ? { entries } : {}),
  };
}

export function buildStockSourceLegendDomain(
  config: ChartConfig,
  data: ChartData,
  rows: DataRow[],
): LegendDomain | undefined {
  const legend = config.legend;
  if (!isLegendShown(legend)) return undefined;

  const composition = stockSourceCompositionFromConfig(config, data);
  if (composition.sourceKind === 'modeled') return undefined;

  const sourceSeries = stockSourceSeriesByRole(config.series ?? []);
  const stockVisual = resolveStockGlyphVisual({
    config,
    rows,
    subType: stockSubTypeFromConfig(config, data),
  });
  const visualByRole = new Map(
    (stockVisual.sourceRoleVisuals ?? []).map((visual) => [visual.role, visual]),
  );
  const values: string[] = [];
  const colors: string[] = [];
  const entries: LegendEntrySpec[] = [];

  for (const role of composition.sourceRoleOrder) {
    const source = sourceSeries[role];
    if (!source) continue;
    const sourceIndex = seriesConfigSourceIndex(source.series, source.index);
    const entry =
      legendEntryForIndex(legend, sourceIndex) ?? legendEntryForIndex(legend, source.index);
    if (!isLegendEntryVisible(entry, source.series)) continue;

    const sourceKey = seriesConfigSourceKey(source.series, sourceIndex);
    const value = `stock:${role}:${sourceKey}`;
    const visual = visualByRole.get(role);
    const color =
      role === 'volume' && stockVisual.volume ? stockVisual.volume.fill : visual?.line.stroke;
    values.push(value);
    if (color) colors.push(color);
    entries.push({
      value,
      label: source.series.name ?? `Series ${sourceIndex + 1}`,
      symbolType: role === 'volume' ? 'area' : 'line',
      sourceSeriesIndex: sourceIndex,
      sourceSeriesKey: sourceKey,
      stockRole: role,
    });
  }

  if (entries.length === 0) return undefined;

  return {
    values,
    forceColorEncoding: true,
    ...(colors.length === values.length ? { colors } : {}),
    entries,
  };
}

export function usesPointLegendEntries(
  config: Pick<ChartConfig, 'type' | 'varyByCategories'>,
): boolean {
  if (isPieLikeChartType(config.type)) return true;
  return isXYPointLegendConfig(config);
}

export function buildCategoryLegendDomain(
  config: ChartConfig,
  data: ChartData,
): LegendDomain | undefined {
  const legend = config.legend;
  if (!isLegendShown(legend)) return undefined;

  const values: string[] = [];
  const entries: LegendEntrySpec[] = [];
  for (let index = 0; index < data.categories.length; index += 1) {
    const entry = legendEntryForIndex(legend, index);
    if (!isLegendEntryVisible(entry)) continue;
    const value = data.categories[index];
    const label = value !== undefined && value !== null ? String(value) : undefined;
    if (!label) continue;
    if (values.includes(label)) continue;
    values.push(label);
    entries.push({ value: label, label });
  }

  return {
    values,
    forceColorEncoding: false,
    ...(entries.length > 0 ? { entries } : {}),
  };
}

export function buildPiePointLegendDomain(
  config: ChartConfig,
  data: ChartData,
): LegendDomain | undefined {
  const legend = config.legend;
  if (!isLegendShown(legend)) return undefined;

  const entries: LegendEntrySpec[] = [];
  for (const point of pieLegendPoints(config, data)) {
    const entry = legendEntryForIndex(legend, point.pointIndex);
    if (!isLegendEntryVisible(entry)) continue;
    entries.push({
      value: point.colorKey,
      label: pieLegendDisplayLabel(point.category, point.pointIndex),
      symbolType: 'square',
      pointIndex: point.pointIndex,
      pointKey: point.key,
      legendKey: point.legendKey,
      colorKey: point.colorKey,
      seriesIndex: point.seriesIndex,
      sourceSeriesIndex: point.sourceSeriesIndex,
      sourceSeriesKey: point.sourceSeriesKey,
    });
  }

  return {
    values: entries.map((entry) => entry.value),
    forceColorEncoding: entries.length > 0,
    ...(entries.length > 0 ? { entries } : {}),
  };
}

export function isLegendEntryVisible(
  entry: LegendEntryConfig | undefined,
  seriesConfig?: SeriesConfig,
): boolean {
  if (isNoFillNoLineSeries(seriesConfig)) return false;
  if (entry?.delete === false) return true;
  if (entry?.delete === true) return false;
  if (entry?.visible === false) return false;
  return true;
}

export function legendSymbolType(
  config: ChartConfig,
  data: ChartData,
): LegendSpec['symbolType'] | undefined {
  const symbolTypes = data.series
    .map((series, index) => {
      const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
      if (isNoFillNoLineSeries(seriesConfig)) return undefined;
      return legendSymbolTypeForSeries(config, series, seriesConfig, index);
    })
    .filter(Boolean);
  const distinctSymbolTypes = new Set(symbolTypes);

  if (distinctSymbolTypes.size === 1) return symbolTypes[0];
  return undefined;
}

function legendEntryForIndex(legend: LegendConfig, index: number): LegendEntryConfig | undefined {
  return legend.entries?.find((entry) => entry.idx === index);
}

function isXYPointLegendConfig(config: Pick<ChartConfig, 'type' | 'varyByCategories'>): boolean {
  if (config.varyByCategories !== true) return false;
  return config.type === 'bubble' || config.type === 'bubble3DEffect' || config.type === 'scatter';
}

function pieLegendPoints(
  config: ChartConfig,
  data: ChartData,
): Array<{
  key: string;
  legendKey: string;
  colorKey: string;
  category: string | number | null;
  pointIndex: number;
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
}> {
  const points: Array<{
    key: string;
    legendKey: string;
    colorKey: string;
    category: string | number | null;
    pointIndex: number;
    seriesIndex: number;
    sourceSeriesIndex: number;
    sourceSeriesKey: string;
  }> = [];
  const geometry = buildPieDoughnutGeometry({
    config,
    data,
    chartWidth: 2,
    chartHeight: 2,
    plotArea: { x: 0, y: 0, width: 2, height: 2 },
    includeSeries: ({ seriesConfig }) => !isNoFillNoLineSeries(seriesConfig),
  });
  for (const slice of geometry?.rings[0]?.slices ?? []) {
    points.push({
      key: slice.pointKey,
      legendKey: slice.legendKey,
      colorKey: slice.colorKey,
      category: slice.category,
      pointIndex: slice.pointIndex,
      seriesIndex: slice.seriesIndex,
      sourceSeriesIndex: slice.sourceSeriesIndex,
      sourceSeriesKey: slice.sourceSeriesKey,
    });
  }
  return points;
}

interface StockLegendSourceSeries {
  series: SeriesConfig;
  index: number;
}

function stockSourceSeriesByRole(
  seriesConfigs: SeriesConfig[],
): Partial<Record<ChartSeriesStockRole, StockLegendSourceSeries>> {
  const plan = stockRolePlan(seriesConfigs);
  if (!plan) return {};
  const byRole: Partial<Record<ChartSeriesStockRole, StockLegendSourceSeries>> = {};
  for (const role of ['volume', 'open', 'high', 'low', 'close'] as const) {
    const index = plan[role];
    if (index === undefined) continue;
    const series = seriesConfigs[index];
    if (series) byRole[role] = { series, index };
  }
  return byRole;
}

export function pieLegendDisplayLabel(
  category: string | number | null | undefined,
  pointIndex: number,
): string {
  return pieDisplayLabel(category, pointIndex);
}

function legendSymbolTypeForSeries(
  config: ChartConfig,
  series: ChartData['series'][number],
  seriesConfig: SeriesConfig | undefined,
  renderedIndex: number,
): LegendSymbolType {
  const seriesType = effectiveSeriesType(config, series, seriesConfig, renderedIndex);
  const markType = seriesType ? MARK_TYPE_MAP[seriesType] : undefined;
  return legendSymbolTypeForMark(markType, config, seriesConfig);
}

function effectiveSeriesType(
  config: ChartConfig,
  series: ChartData['series'][number],
  seriesConfig: SeriesConfig | undefined,
  renderedIndex: number,
): ChartType | undefined {
  const type = seriesConfig?.type ?? series.type;
  if (isChartType(type)) return type;
  if (config.type === 'combo') return renderedIndex === 0 ? 'column' : 'line';
  return isChartType(config.type) ? config.type : undefined;
}

function isChartType(value: unknown): value is ChartType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MARK_TYPE_MAP, value);
}

function legendSymbolTypeForMark(
  markType: MarkType | undefined,
  config: ChartConfig,
  seriesConfig: SeriesConfig | undefined,
): LegendSymbolType {
  switch (markType) {
    case 'line':
    case 'line3d':
    case 'rule':
    case 'tick':
    case 'trail':
      return 'line';
    case 'point':
    case 'circle':
      return seriesShowsConnectingLine(config, seriesConfig) ? 'line' : 'circle';
    case 'bar':
    case 'bar3d':
    case 'area':
    case 'area3d':
    case 'rect':
    case 'histogram':
    case 'boxplot':
    case 'violin':
    case 'contour':
    case 'surface3d':
      return 'area';
    case 'radar':
      return config.radarFilled || config.subType === 'filled' ? 'area' : 'line';
    default:
      return 'square';
  }
}

function seriesShowsConnectingLine(
  config: ChartConfig,
  seriesConfig: SeriesConfig | undefined,
): boolean {
  if (seriesConfig?.showLines !== undefined) return seriesConfig.showLines;
  return config.showLines === true;
}
