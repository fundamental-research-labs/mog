import type { ChartConfig, ChartData, DataLabelConfig } from '../../types';

export interface PieLabelGeometry {
  cos: number;
  sin: number;
  innerRadiusRatio: number;
}

export function seriesTotal(values: Array<{ y: number } | undefined>): number {
  return values.reduce((sum, point) => {
    const value = point?.y;
    return typeof value === 'number' && Number.isFinite(value) ? sum + Math.abs(value) : sum;
  }, 0);
}

export function percentageForValue(value: number, total: number): number | undefined {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return undefined;
  return Math.abs(value) / total;
}

export function buildPieLabelGeometries(
  data: ChartData,
  config?: ChartConfig,
): PieLabelGeometry[][] {
  if (!config || !isPieLikeChart(config.type)) return [];

  return data.series.map((series) => {
    const total = seriesTotal(series.data);
    let startAngle = firstSliceAngleRadians(config);
    const innerRadiusRatio = doughnutInnerRadiusRatio(config);
    return series.data.map((point) => {
      const value = total > 0 ? Math.abs(point?.y ?? 0) : 1;
      const angle =
        total > 0 ? (value / total) * Math.PI * 2 : (Math.PI * 2) / Math.max(1, series.data.length);
      const midAngle = startAngle + angle / 2;
      startAngle += angle;
      const unit = arcAngleUnitVector(midAngle);
      return { cos: unit.x, sin: unit.y, innerRadiusRatio };
    });
  });
}

export function pieLabelCoordinates(
  geometry: PieLabelGeometry,
  position: DataLabelConfig['position'],
): { anchorX: number; anchorY: number; labelX: number; labelY: number } {
  const outside = position === 'outside' || position === 'outsideEnd' || position === 'callout';
  const labelRadius = labelRadiusFraction(geometry.innerRadiusRatio, position);
  const anchorRadius = outside ? 0.49 : labelRadius;
  return {
    anchorX: 0.5 + geometry.cos * anchorRadius,
    anchorY: 0.5 + geometry.sin * anchorRadius,
    labelX: 0.5 + geometry.cos * labelRadius,
    labelY: 0.5 + geometry.sin * labelRadius,
  };
}

function isPieLikeChart(type?: ChartConfig['type']): boolean {
  return type === 'pie' || type === 'doughnut' || type === 'pie3d' || type === 'ofPie';
}

function labelRadiusFraction(
  innerRadiusRatio: number,
  position: DataLabelConfig['position'],
): number {
  if (position === 'outside' || position === 'outsideEnd' || position === 'callout') {
    return 0.56;
  }
  const inner = Math.max(0, Math.min(0.95, innerRadiusRatio));
  const radiusRatio =
    position === 'insideBase'
      ? inner + (1 - inner) * 0.2
      : position === 'insideEnd' || position === 'top'
        ? inner + (1 - inner) * 0.82
        : inner > 0
          ? (inner + 1) / 2
          : 2 / 3;
  return radiusRatio / 2;
}

function firstSliceAngleRadians(config: ChartConfig | undefined): number {
  const angle =
    finiteDegrees(
      config?.series?.find((series) => series.firstSliceAngle !== undefined)?.firstSliceAngle,
    ) ?? finiteDegrees(config?.firstSliceAngle);
  return angle !== undefined ? (angle * Math.PI) / 180 : 0;
}

function doughnutInnerRadiusRatio(config: ChartConfig | undefined): number {
  if (!config || config.type !== 'doughnut') return 0;
  const holeSize =
    finitePercent(
      config.series?.find((series) => series.doughnutHoleSize !== undefined)?.doughnutHoleSize,
    ) ?? finitePercent(config.doughnutHoleSize);
  return holeSize !== undefined ? holeSize / 100 : 0.5;
}

function finitePercent(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : undefined;
}

function finiteDegrees(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function arcAngleUnitVector(angle: number): { x: number; y: number } {
  const canvasAngle = angle - Math.PI / 2;
  return { x: Math.cos(canvasAngle), y: Math.sin(canvasAngle) };
}
