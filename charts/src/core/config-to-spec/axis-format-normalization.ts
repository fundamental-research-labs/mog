import type { AxisSpec, AxisTickMark } from '../../grammar/spec';
import type { ChartFormat, SingleAxisConfig } from '../../types';
import { toFiniteNumber } from './category-axis';

export function normalizeAxisLabelAngle(axisConf: SingleAxisConfig): number | undefined {
  const textVerticalType = (
    axisConf.format as (ChartFormat & { textVerticalType?: string }) | undefined
  )?.textVerticalType;
  switch (textVerticalType) {
    case 'vert':
    case 'wordArtVert':
    case 'eaVert':
    case 'mongolianVert':
      return 90;
    case 'vert270':
    case 'wordArtVertRtl':
      return -90;
    case 'horz':
      break;
    default:
      break;
  }

  const raw = axisConf.textOrientation ?? axisConf.format?.textRotation;
  if (raw === undefined) return undefined;
  if (raw === 0) return 0;
  const degrees = Math.abs(raw) >= 60000 ? raw / 60000 : raw;
  if (Math.abs(degrees) > 90) return undefined;
  if (Math.abs(degrees) <= 90) return degrees;
  return undefined;
}

export function normalizeTickMark(value: string | undefined): AxisTickMark | undefined {
  switch (value?.toLowerCase()) {
    case 'none':
      return 'none';
    case 'in':
      return 'in';
    case 'out':
      return 'out';
    case 'cross':
      return 'cross';
    default:
      return undefined;
  }
}

export function normalizeTickLabelPosition(
  value: string | undefined,
): AxisSpec['labelPosition'] | undefined {
  switch (value?.toLowerCase()) {
    case 'none':
      return 'none';
    case 'low':
      return 'low';
    case 'high':
      return 'high';
    case 'nextto':
    case 'next_to':
    case 'next-to':
      return 'nextTo';
    default:
      return undefined;
  }
}

export function normalizeCategoryCrossing(
  axisConf: SingleAxisConfig,
): AxisSpec['categoryCrossing'] | undefined {
  const crossBetween = axisConf.crossBetween?.toLowerCase();
  if (crossBetween === 'between') return 'between';
  if (crossBetween === 'midcat' || crossBetween === 'mid_cat' || crossBetween === 'mid-cat') {
    return 'midCat';
  }
  if (axisConf.isBetweenCategories === true) return 'between';
  if (axisConf.isBetweenCategories === false) return 'midCat';
  return undefined;
}

export function positiveInteger(value: number | undefined): number | undefined {
  const numeric = toFiniteNumber(value);
  if (numeric === undefined || numeric < 1) return undefined;
  return Math.floor(numeric);
}
