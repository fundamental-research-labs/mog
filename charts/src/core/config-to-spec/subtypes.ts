import type { MarkSpec, StackMode } from '../../grammar/spec';
import type { ChartConfig } from '../../types';

/**
 * Derive the StackMode from the config subType.
 * Returns undefined when no stacking applies.
 */
export function resolveStackMode(config: ChartConfig): StackMode | undefined {
  const sub = config.subType;
  if (!sub) return undefined;
  if (sub === 'stacked') return 'zero';
  if (sub === 'percentStacked') return 'normalize';
  // 'clustered', 'standard', 'basic', etc. => no stacking
  return undefined;
}

/**
 * Resolve mark-level properties implied by the subType.
 * Returns partial MarkSpec overrides (e.g. interpolation for smooth/stepped lines).
 */
export function resolveSubTypeMarkProps(config: ChartConfig): Partial<MarkSpec> | undefined {
  const sub = config.subType;
  if (!sub) return undefined;
  switch (sub) {
    case 'smooth':
      return { interpolate: 'monotone' };
    case 'stepped':
      return { interpolate: 'step' };
    case 'filled':
      // RadarSubType 'filled' - area fill behind the line
      return { type: 'area' };
    default:
      return undefined;
  }
}
