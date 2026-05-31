import type { AxisSpec } from '../../grammar/spec';
import type { SingleAxisConfig } from '../../types';
import { toFiniteNumber } from './category-axis';

export function dateAxisTickInterval(
  axisConf: SingleAxisConfig,
): AxisSpec['tickInterval'] | undefined {
  const majorUnit = toFiniteNumber(axisConf.majorUnit);
  if (majorUnit === undefined || majorUnit <= 0) return undefined;

  const unit = normalizeDateAxisTimeUnit(axisConf.majorTimeUnit ?? axisConf.baseTimeUnit);
  return unit ? { unit, step: majorUnit } : undefined;
}

export function dateAxisMinorTickInterval(
  axisConf: SingleAxisConfig,
): AxisSpec['minorTickInterval'] | undefined {
  const minorUnit = toFiniteNumber(axisConf.minorUnit);
  if (minorUnit === undefined || minorUnit <= 0) return undefined;

  const unit = normalizeDateAxisTimeUnit(axisConf.minorTimeUnit);
  return unit ? { unit, step: minorUnit } : undefined;
}

function normalizeDateAxisTimeUnit(
  value: string | undefined,
): NonNullable<AxisSpec['tickInterval']>['unit'] | undefined {
  switch (value?.toLowerCase()) {
    case 'day':
    case 'days':
      return 'day';
    case 'month':
    case 'months':
      return 'month';
    case 'year':
    case 'years':
      return 'year';
    default:
      return undefined;
  }
}
