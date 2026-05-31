import type { ChartConfig, ChartLineSettings } from '../../../types';

export function upDownStrokeWidth(config: ChartConfig): number | undefined {
  const gapWidth = config.upDownBars?.gapWidth;
  if (typeof gapWidth !== 'number' || !Number.isFinite(gapWidth)) return undefined;
  return Math.max(2, 12 * (100 / Math.max(1, gapWidth)));
}

export function isVisibleLine(settings: ChartLineSettings | undefined): boolean {
  return Boolean(settings && settings.visible !== false && settings.format?.noFill !== true);
}
