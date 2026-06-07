import type { ChartConfig, DataLabelConfig } from '../../types';
import { isHorizontalBarLikeChartType, isBarLikeChartType } from './bar-geometry';
import { isPieLikeChartType } from './pie-like';

export function labelPlacement(
  position: DataLabelConfig['position'],
  chartType?: ChartConfig['type'],
  value = 0,
) {
  const effectivePosition = position ?? defaultLabelPosition(chartType);
  const isPie = isPieLikeChartType(chartType);
  const isHorizontalBar = isHorizontalBarLikeChartType(chartType);
  switch (effectivePosition) {
    case 'left':
      return { dx: -10, dy: 0, align: 'right', baseline: 'middle', valueDelta: () => 0 };
    case 'right':
      return { dx: 10, dy: 0, align: 'left', baseline: 'middle', valueDelta: () => 0 };
    case 'bottom':
    case 'insideBase':
      return {
        dx: 0,
        dy: 10,
        align: 'center',
        baseline: 'top',
        valueDelta: (v: number) => -Math.abs(v) * 0.08,
      };
    case 'outsideEnd':
      return outsideEndPlacement(isHorizontalBar, value);
    case 'outside':
    case 'top':
    case 'callout':
      return {
        dx: 0,
        dy: isPie ? -16 : -10,
        align: 'center',
        baseline: 'bottom',
        valueDelta: (v: number) => Math.max(Math.abs(v) * 0.08, 1),
      };
    case 'bestFit':
      return isPie
        ? { dx: 0, dy: 0, align: 'center', baseline: 'middle', valueDelta: () => 0 }
        : outsideEndPlacement(isHorizontalBar, value);
    case 'center':
    case 'inside':
    case 'insideEnd':
    default:
      return { dx: 0, dy: 0, align: 'center', baseline: 'middle', valueDelta: () => 0 };
  }
}

function defaultLabelPosition(
  chartType: ChartConfig['type'] | undefined,
): DataLabelConfig['position'] {
  if (!chartType) return undefined;
  if (isBarLikeChartType(chartType)) return 'outsideEnd';
  return undefined;
}

function outsideEndPlacement(isHorizontalBar: boolean, value: number) {
  const sign = value < 0 ? -1 : 1;
  if (isHorizontalBar) {
    return {
      dx: sign >= 0 ? 10 : -10,
      dy: 0,
      align: sign >= 0 ? 'left' : 'right',
      baseline: 'middle',
      valueDelta: (v: number) => signedOutsideDelta(v),
    };
  }
  return {
    dx: 0,
    dy: sign >= 0 ? -10 : 10,
    align: 'center',
    baseline: sign >= 0 ? 'bottom' : 'top',
    valueDelta: (v: number) => signedOutsideDelta(v),
  };
}

function signedOutsideDelta(value: number): number {
  if (value === 0) return 0;
  const sign = value < 0 ? -1 : 1;
  return sign * Math.max(Math.abs(value) * 0.08, 1);
}

export function manualLabelLayout(label: DataLabelConfig): {
  manualX: number | undefined;
  manualY: number | undefined;
  hasManualPosition: boolean;
  layoutTarget: 'inner' | 'outer';
} {
  const manualX = finiteNumber(label.layout?.x);
  const manualY = finiteNumber(label.layout?.y);
  return {
    manualX,
    manualY,
    hasManualPosition: manualX !== undefined || manualY !== undefined,
    layoutTarget: label.layout?.layoutTarget === 'inner' ? 'inner' : 'outer',
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
