import type { ChartSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';

/**
 * Check whether a secondary Y-axis should be used.
 * Returns true when a modeled secondary value axis is visible and at least
 * one series uses yAxisIndex=1.
 */
export function hasSecondaryYAxis(config: ChartConfig, data?: ChartData): boolean {
  const secondaryAxis = config.axis?.secondaryValueAxis ?? config.axis?.secondaryYAxis;
  if (!(secondaryAxis?.show ?? secondaryAxis?.visible)) return false;
  return (
    (config.series ?? []).some((s) => s.yAxisIndex === 1) ||
    (data?.series ?? []).some((s) => s.yAxisIndex === 1)
  );
}

/**
 * Build the resolve spec for dual-axis charts.
 * When series have different yAxisIndex values, use independent y scales.
 */
export function buildResolve(
  config: ChartConfig,
  data?: ChartData,
): ChartSpec['resolve'] | undefined {
  if (!hasSecondaryYAxis(config, data)) return undefined;
  return {
    scale: { y: 'independent' },
    axis: { y: 'independent' },
  };
}
