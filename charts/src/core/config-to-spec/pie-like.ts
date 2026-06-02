import type { ChartConfig, ChartData } from '../../types';

export function isPieLikeChartType(type: ChartConfig['type'] | undefined): boolean {
  return (
    type === 'pie' ||
    type === 'pieExploded' ||
    type === 'pie3d' ||
    type === 'pie3dExploded' ||
    type === 'doughnut' ||
    type === 'doughnutExploded' ||
    type === 'ofPie'
  );
}

export function isDoughnutLikeChartType(type: ChartConfig['type'] | undefined): boolean {
  return type === 'doughnut' || type === 'doughnutExploded';
}

export function isPie3DLikeChartType(type: ChartConfig['type'] | undefined): boolean {
  return type === 'pie3d' || type === 'pie3dExploded';
}

export function isExplodedPieLikeChartType(type: ChartConfig['type'] | undefined): boolean {
  return type === 'pieExploded' || type === 'pie3dExploded' || type === 'doughnutExploded';
}

export function firstSliceAngleRadians(config: ChartConfig | undefined): number {
  const angle =
    finiteDegrees(
      config?.series?.find((series) => series.firstSliceAngle !== undefined)?.firstSliceAngle,
    ) ?? finiteDegrees(config?.firstSliceAngle);
  return angle !== undefined ? (angle * Math.PI) / 180 : 0;
}

export function doughnutInnerRadiusRatio(config: ChartConfig | undefined): number {
  if (!config || !isDoughnutLikeChartType(config.type)) return 0;
  const holeSize =
    finitePercent(
      config.series?.find((series) => series.doughnutHoleSize !== undefined)?.doughnutHoleSize,
    ) ?? finitePercent(config.doughnutHoleSize);
  return holeSize !== undefined ? holeSize / 100 : 0.5;
}

export function doughnutRingBand(input: {
  config: ChartConfig;
  ringCount: number;
  ringIndex: number;
}): { innerRadius: number; outerRadius: number } {
  const ringCount = Math.max(1, input.ringCount);
  const hole = Math.min(0.95, doughnutInnerRadiusRatio(input.config));
  const band = (1 - hole) / ringCount;
  const ringIndex = Math.max(0, Math.min(ringCount - 1, input.ringIndex));
  return {
    innerRadius: hole + band * ringIndex,
    outerRadius: hole + band * (ringIndex + 1),
  };
}

export function hasMultipleDoughnutSeries(config: ChartConfig, data: ChartData): boolean {
  return isDoughnutLikeChartType(config.type) && data.series.length > 1;
}

function finitePercent(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : undefined;
}

function finiteDegrees(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
