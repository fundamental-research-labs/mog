import type { AxisOrient, AxisSpec, ScaleSpec, ScaleType } from '../../grammar/spec';
import type { AxisConfig, AxisType, ChartConfig, ChartType, SingleAxisConfig } from '../../types';
import { toFiniteNumber } from './category-axis';
import { mapAxisConfigToAxisSpec as mapAxisConfigToAxisFormatSpec } from './axis-format';

/**
 * Map AxisConfig.xAxis / yAxis type to a ChartSpec AxisSpec partial.
 */
export function mapAxisConfigToAxisSpec(
  axisConf: SingleAxisConfig,
  config?: ChartConfig,
  ownerKey = 'axis',
): AxisSpec {
  return mapAxisConfigToAxisFormatSpec(
    axisConf,
    normalizeAxisOrient(axisConf.position),
    config,
    ownerKey,
  );
}

/**
 * Map AxisType to ScaleType for encoding scale configuration.
 * Returns undefined for default types that don't need explicit scale setting.
 */
function axisTypeToScaleType(axisType: AxisType | undefined): ScaleType | undefined {
  if (!axisType) return undefined;
  if (axisType === 'log') return 'log';
  if (axisType === 'time') return 'time';
  // 'linear', 'category', 'value' are defaults - no explicit scale needed.
  return undefined;
}

/**
 * Build axis scale domain from min/max config.
 */
function buildAxisScaleDomain(
  axisConf: { min?: number; max?: number } | undefined,
): { domain?: [number | undefined, number | undefined] } | undefined {
  if (!axisConf) return undefined;
  if (axisConf.min !== undefined || axisConf.max !== undefined) {
    const domain: [number | undefined, number | undefined] = [axisConf.min, axisConf.max];
    return { domain };
  }
  return undefined;
}

export function buildAxisScaleSpec(
  axisConf: SingleAxisConfig | undefined,
  useDateSerialCategoryAxis: boolean,
): ScaleSpec | undefined {
  if (!axisConf) {
    return useDateSerialCategoryAxis ? { type: 'linear', zero: false, nice: false } : undefined;
  }

  const scaleDomain = buildAxisScaleDomain(axisConf);
  const scaleType = useDateSerialCategoryAxis ? 'linear' : axisConfigToScaleType(axisConf);
  const hasExplicitDomain = Boolean(scaleDomain?.domain?.some((bound) => bound !== undefined));
  const logBase = toFiniteNumber(axisConf.logBase);
  const scaleSpec: ScaleSpec = {
    ...(scaleDomain ?? {}),
    ...(scaleType ? { type: scaleType } : {}),
    ...(scaleType === 'log' ? { base: logBase && logBase > 1 ? logBase : 10 } : {}),
    ...(useDateSerialCategoryAxis ? { zero: false } : {}),
    ...(useDateSerialCategoryAxis || hasExplicitDomain ? { nice: false } : {}),
  };

  return Object.keys(scaleSpec).length > 0 ? scaleSpec : undefined;
}

function axisConfigToScaleType(axisConf: SingleAxisConfig): ScaleType | undefined {
  if (axisConf.scaleType === 'logarithmic' || axisConf.logBase !== undefined) return 'log';
  return axisTypeToScaleType(axisConf.type);
}

export function resolveAxisConfigForChannel(
  axis: AxisConfig | undefined,
  channel: 'x' | 'y',
  isHorizontal: boolean,
): SingleAxisConfig | undefined {
  if (!axis) return undefined;
  if (channel === 'x') {
    return isHorizontal ? (axis.valueAxis ?? axis.xAxis) : (axis.xAxis ?? axis.categoryAxis);
  }
  return isHorizontal ? (axis.categoryAxis ?? axis.yAxis) : (axis.yAxis ?? axis.valueAxis);
}

export function normalizeAxisOrient(value: string | undefined): AxisOrient | undefined {
  switch (value?.toLowerCase()) {
    case 'b':
    case 'bottom':
      return 'bottom';
    case 't':
    case 'top':
      return 'top';
    case 'l':
    case 'left':
      return 'left';
    case 'r':
    case 'right':
      return 'right';
    default:
      return undefined;
  }
}

export function explicitDomainBound(
  domain: unknown[] | undefined,
  index: number,
): number | undefined {
  const value = domain?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function isHorizontalBarType(chartType: ChartType): boolean {
  switch (chartType) {
    case 'bar':
    case 'bar3d':
    case 'cylinderBarClustered':
    case 'cylinderBarStacked':
    case 'cylinderBarStacked100':
    case 'coneBarClustered':
    case 'coneBarStacked':
    case 'coneBarStacked100':
    case 'pyramidBarClustered':
    case 'pyramidBarStacked':
    case 'pyramidBarStacked100':
      return true;
    default:
      return false;
  }
}
