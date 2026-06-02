import type { ChartConfig, ChartData, DataLabelConfig } from '../../types';
import { pieLikeAngleUnitVector, pieLikeSeriesTotal } from './pie-like';
import { buildPieDoughnutGeometry } from './pie-doughnut-geometry';
import { isNoFillNoLineSeries } from './style';

export interface PieLabelGeometry {
  cos: number;
  sin: number;
  centerX: number;
  centerY: number;
  innerRadiusRatio: number;
  outerRadiusRatio: number;
  sliceAngle: number;
  maxWidth: number;
  lineHeight: number;
  leaderVisible: boolean;
}

export function seriesTotal(values: Array<{ y: number } | undefined>): number {
  return pieLikeSeriesTotal(values.map((point) => point?.y));
}

export function percentageForValue(value: number, total: number): number | undefined {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return undefined;
  return Math.abs(value) / total;
}

export function buildPieLabelGeometries(
  data: ChartData,
  config?: ChartConfig,
): PieLabelGeometry[][] {
  if (!config) return [];

  const rows: PieLabelGeometry[][] = data.series.map(() => []);
  const geometry = buildPieDoughnutGeometry({
    config,
    data,
    chartWidth: 2,
    chartHeight: 2,
    plotArea: { x: 0, y: 0, width: 2, height: 2 },
    includeSeries: ({ seriesConfig }) => !isNoFillNoLineSeries(seriesConfig),
  });

  for (const ring of geometry?.rings ?? []) {
    const seriesGeometries = rows[ring.seriesIndex] ?? [];
    rows[ring.seriesIndex] = seriesGeometries;
    for (const slice of ring.slices) {
      const vector = pieLikeAngleUnitVector(slice.midAngle);
      const centerOffset = (slice.outerRadiusRatio / 2) * (slice.explosionPercent / 100);
      seriesGeometries[slice.pointIndex] = {
        cos: vector.x,
        sin: vector.y,
        centerX: 0.5 + vector.x * centerOffset,
        centerY: 0.5 + vector.y * centerOffset,
        innerRadiusRatio: slice.innerRadiusRatio,
        outerRadiusRatio: slice.outerRadiusRatio,
        sliceAngle: slice.angle,
        maxWidth: labelMaxWidthFraction(
          slice.angle,
          slice.innerRadiusRatio,
          slice.outerRadiusRatio,
        ),
        lineHeight: 1.18,
        leaderVisible: false,
      };
    }
  }

  return rows;
}

export function pieLabelCoordinates(
  geometry: PieLabelGeometry,
  position: DataLabelConfig['position'],
): {
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
  maxWidth: number;
  lineHeight: number;
  leaderVisible: boolean;
} {
  const outside = position === 'outside' || position === 'outsideEnd' || position === 'callout';
  const labelRadius = labelRadiusFraction(
    geometry.innerRadiusRatio,
    geometry.outerRadiusRatio,
    position,
  );
  const anchorRadius = outside ? Math.max(0, geometry.outerRadiusRatio * 0.49) : labelRadius;
  const centerX = Number.isFinite(geometry.centerX) ? geometry.centerX : 0.5;
  const centerY = Number.isFinite(geometry.centerY) ? geometry.centerY : 0.5;
  const maxWidth = outside
    ? Math.max(0.12, Math.min(0.34, geometry.maxWidth * 1.25))
    : geometry.maxWidth;
  return {
    anchorX: centerX + geometry.cos * anchorRadius,
    anchorY: centerY + geometry.sin * anchorRadius,
    labelX: centerX + geometry.cos * labelRadius,
    labelY: centerY + geometry.sin * labelRadius,
    maxWidth,
    lineHeight: geometry.lineHeight,
    leaderVisible: outside || geometry.leaderVisible,
  };
}

function labelRadiusFraction(
  innerRadiusRatio: number,
  outerRadiusRatio: number,
  position: DataLabelConfig['position'],
): number {
  if (position === 'outside' || position === 'outsideEnd' || position === 'callout') {
    return Math.min(0.6, Math.max(0, outerRadiusRatio / 2 + 0.06));
  }
  const inner = Math.max(0, Math.min(0.95, innerRadiusRatio));
  const outer = Math.max(inner, Math.min(1, outerRadiusRatio));
  const radiusRatio =
    position === 'insideBase'
      ? inner + (outer - inner) * 0.2
      : position === 'insideEnd' || position === 'top'
        ? inner + (outer - inner) * 0.82
        : inner > 0
          ? (inner + outer) / 2
          : outer * (2 / 3);
  return radiusRatio / 2;
}

function labelMaxWidthFraction(
  angle: number,
  innerRadiusRatio: number,
  outerRadiusRatio: number,
): number {
  const radiusRatio =
    innerRadiusRatio > 0 ? (innerRadiusRatio + outerRadiusRatio) / 2 : outerRadiusRatio * 0.66;
  const chord = Math.max(0.08, Math.sin(Math.min(Math.PI, Math.max(0, angle)) / 2) * radiusRatio);
  const ringThickness = Math.max(0.08, outerRadiusRatio - innerRadiusRatio);
  return Math.max(0.1, Math.min(0.42, Math.min(chord, ringThickness * 1.8)));
}
