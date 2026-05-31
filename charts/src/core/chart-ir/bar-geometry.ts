import type {
  BarGeometryGrouping,
  BarGeometrySpec,
  ConfigSpec,
  StackMode,
} from '../../grammar/spec';
import type { ChartConfig, ChartType } from '../../types';

export const DEFAULT_EXCEL_BAR_GAP_WIDTH = 150;
export const DEFAULT_EXCEL_CLUSTERED_BAR_OVERLAP = 0;
export const DEFAULT_EXCEL_STACKED_BAR_OVERLAP = 100;

const BAR_LIKE_CHART_TYPES = new Set<string>([
  'bar',
  'column',
  'bar3d',
  'column3d',
  'cylinderColClustered',
  'cylinderColStacked',
  'cylinderColStacked100',
  'cylinderBarClustered',
  'cylinderBarStacked',
  'cylinderBarStacked100',
  'cylinderCol',
  'coneColClustered',
  'coneColStacked',
  'coneColStacked100',
  'coneBarClustered',
  'coneBarStacked',
  'coneBarStacked100',
  'coneCol',
  'pyramidColClustered',
  'pyramidColStacked',
  'pyramidColStacked100',
  'pyramidBarClustered',
  'pyramidBarStacked',
  'pyramidBarStacked100',
  'pyramidCol',
]);

const HORIZONTAL_BAR_TYPES = new Set<string>([
  'bar',
  'bar3d',
  'cylinderBarClustered',
  'cylinderBarStacked',
  'cylinderBarStacked100',
  'coneBarClustered',
  'coneBarStacked',
  'coneBarStacked100',
  'pyramidBarClustered',
  'pyramidBarStacked',
  'pyramidBarStacked100',
]);

const STACKED_100_CHART_TYPES = new Set<string>([
  'cylinderColStacked100',
  'cylinderBarStacked100',
  'coneColStacked100',
  'coneBarStacked100',
  'pyramidColStacked100',
  'pyramidBarStacked100',
  'lineMarkersStacked100',
]);

const STACKED_CHART_TYPES = new Set<string>([
  'cylinderColStacked',
  'cylinderBarStacked',
  'coneColStacked',
  'coneBarStacked',
  'pyramidColStacked',
  'pyramidBarStacked',
  'lineMarkersStacked',
]);

export interface BarSlotGeometry {
  offset: number;
  size: number;
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isBarLikeChartType(type: ChartType | string | undefined): boolean {
  return typeof type === 'string' && BAR_LIKE_CHART_TYPES.has(type);
}

export function barOrientationForChartType(
  type: ChartType | string | undefined,
): BarGeometrySpec['orientation'] {
  return HORIZONTAL_BAR_TYPES.has(String(type)) ? 'horizontal' : 'vertical';
}

export function stackModeForChartType(type: ChartType | string | undefined): StackMode | undefined {
  if (STACKED_100_CHART_TYPES.has(String(type))) return 'normalize';
  if (STACKED_CHART_TYPES.has(String(type))) return 'zero';
  return undefined;
}

export function barGroupingForConfig(
  config: Pick<ChartConfig, 'type' | 'subType'>,
): BarGeometryGrouping {
  if (config.subType === 'stacked') return 'stacked';
  if (config.subType === 'percentStacked') return 'percentStacked';
  if (stackModeForChartType(config.type) === 'zero') return 'stacked';
  if (stackModeForChartType(config.type) === 'normalize') return 'percentStacked';
  return 'clustered';
}

export function barGroupingForConfigSpec(config: ConfigSpec | undefined): BarGeometryGrouping {
  if (config?.barGeometry?.grouping) return config.barGeometry.grouping;
  if (config?.stack === 'zero' || config?.stack === 'center') return 'stacked';
  if (config?.stack === 'normalize') return 'percentStacked';
  return 'clustered';
}

export function isStackedBarGrouping(grouping: BarGeometryGrouping | string): boolean {
  return grouping === 'stacked' || grouping === 'percentStacked';
}

export function effectiveGapWidth(sourceGapWidth: number | undefined): number {
  return clamp(finiteNumber(sourceGapWidth) ?? DEFAULT_EXCEL_BAR_GAP_WIDTH, 0, 500);
}

export function effectiveOverlap(
  sourceOverlap: number | undefined,
  grouping: BarGeometryGrouping | string,
): number {
  const fallback = isStackedBarGrouping(grouping)
    ? DEFAULT_EXCEL_STACKED_BAR_OVERLAP
    : DEFAULT_EXCEL_CLUSTERED_BAR_OVERLAP;
  return clamp(finiteNumber(sourceOverlap) ?? fallback, -100, 100);
}

export function hasExcelBarGeometryConfig(config: Pick<ChartConfig, 'type' | 'series'>): boolean {
  if (isBarLikeChartType(config.type)) return true;
  if (config.type !== 'combo') return false;

  const series = config.series ?? [];
  if (series.length === 0) return true;
  return series.some((item) => isBarLikeChartType(item.type));
}

export function effectiveBarGeometry(
  config: Pick<ChartConfig, 'type' | 'subType' | 'gapWidth' | 'overlap' | 'series'>,
): BarGeometrySpec | undefined {
  if (!hasExcelBarGeometryConfig(config)) return undefined;

  const sourceGapWidth = finiteNumber(config.gapWidth);
  const sourceOverlap = finiteNumber(config.overlap);
  const firstBarSeriesType =
    config.type === 'combo'
      ? config.series?.find((series) => isBarLikeChartType(series.type))?.type
      : undefined;
  const geometryType = firstBarSeriesType ?? config.type;
  const grouping = barGroupingForConfig({
    type: geometryType as ChartType,
    subType: config.subType,
  });
  const gapWidth = effectiveGapWidth(sourceGapWidth);
  const overlap = effectiveOverlap(sourceOverlap, grouping);

  return {
    orientation: barOrientationForChartType(geometryType),
    grouping,
    sourceGapWidth,
    sourceOverlap,
    gapWidth,
    overlap,
    ...(sourceGapWidth !== undefined && sourceGapWidth !== gapWidth
      ? { gapWidthClamped: true }
      : {}),
    ...(sourceOverlap !== undefined && sourceOverlap !== overlap ? { overlapClamped: true } : {}),
  };
}

export function hasExcelBarGeometrySpec(config: ConfigSpec | undefined): boolean {
  return (
    config?.barGeometry !== undefined ||
    finiteNumber(config?.gapWidth) !== undefined ||
    finiteNumber(config?.overlap) !== undefined
  );
}

export function effectiveBarGeometryFromSpec(config: ConfigSpec | undefined): BarGeometrySpec {
  if (config?.barGeometry) return config.barGeometry;

  const grouping = barGroupingForConfigSpec(config);
  const sourceGapWidth = finiteNumber(config?.gapWidth);
  const sourceOverlap = finiteNumber(config?.overlap);
  return {
    grouping,
    sourceGapWidth,
    sourceOverlap,
    gapWidth: effectiveGapWidth(sourceGapWidth),
    overlap: effectiveOverlap(sourceOverlap, grouping),
  };
}

export function excelBarSlotGeometry(
  categoryStep: number,
  groupCount: number,
  groupIndex: number,
  geometry: BarGeometrySpec,
): BarSlotGeometry {
  const safeGroupCount = isStackedBarGrouping(geometry.grouping) ? 1 : Math.max(1, groupCount);
  const safeGroupIndex = isStackedBarGrouping(geometry.grouping)
    ? 0
    : clamp(groupIndex, 0, safeGroupCount - 1);
  const gapRatio = effectiveGapWidth(geometry.gapWidth) / 100;
  const overlapRatio = effectiveOverlap(geometry.overlap, geometry.grouping) / 100;
  const groupStepUnits = 1 - overlapRatio;
  const clusterUnits = 1 + (safeGroupCount - 1) * groupStepUnits;
  const barSize = categoryStep / (clusterUnits + gapRatio);
  const clusterSize = barSize * clusterUnits;
  return {
    offset: (categoryStep - clusterSize) / 2 + safeGroupIndex * barSize * groupStepUnits,
    size: barSize,
  };
}
