import type { ChartConfig, DataLabelConfig } from '../../types';

export function labelPlacement(
  position: DataLabelConfig['position'],
  chartType?: ChartConfig['type'],
) {
  const isPie = chartType === 'pie' || chartType === 'doughnut' || chartType === 'pie3d';
  switch (position) {
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
    case 'top':
    case 'bestFit':
    case 'callout':
      return {
        dx: 0,
        dy: isPie ? -16 : -10,
        align: 'center',
        baseline: 'bottom',
        valueDelta: (v: number) => Math.max(Math.abs(v) * 0.08, 1),
      };
    case 'center':
    case 'inside':
    case 'insideEnd':
    default:
      return { dx: 0, dy: 0, align: 'center', baseline: 'middle', valueDelta: () => 0 };
  }
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
