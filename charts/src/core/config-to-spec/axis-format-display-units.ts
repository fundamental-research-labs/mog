import type { SingleAxisConfig } from '../../types';
import { toFiniteNumber } from './category-axis';

const DISPLAY_UNIT_FACTORS: Record<string, number> = {
  hundreds: 100,
  thousands: 1_000,
  tenthousands: 10_000,
  ten_thousands: 10_000,
  tenThousands: 10_000,
  hundredthousands: 100_000,
  hundred_thousands: 100_000,
  hundredThousands: 100_000,
  millions: 1_000_000,
  tenmillions: 10_000_000,
  ten_millions: 10_000_000,
  tenMillions: 10_000_000,
  hundredmillions: 100_000_000,
  hundred_millions: 100_000_000,
  hundredMillions: 100_000_000,
  billions: 1_000_000_000,
  trillions: 1_000_000_000_000,
};

export function resolveDisplayUnitFactor(axisConf: SingleAxisConfig): number | undefined {
  const custom = toFiniteNumber(axisConf.customDisplayUnit);
  if (custom !== undefined && custom > 0) return custom;
  if (!axisConf.displayUnit) return undefined;

  const raw = axisConf.displayUnit.trim();
  const key = raw.replace(/[\s_-]/g, '').toLowerCase();
  return DISPLAY_UNIT_FACTORS[raw] ?? DISPLAY_UNIT_FACTORS[key];
}
