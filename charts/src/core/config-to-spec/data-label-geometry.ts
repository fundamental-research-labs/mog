import type { ChartConfig, ChartData, DataLabelConfig } from '../../types';
import { seriesConfigForDataSeries } from '../series-identity';
import {
  defaultPieLikeExplosionPercent,
  doughnutInnerRadiusRatio,
  doughnutRingBand,
  effectivePieLikeExplosionPercent,
  firstSliceAngleRadians,
  isPieLikeChartType,
  pieLikeSeriesTotal,
  pieLikeSliceGeometries,
} from './pie-like';
import { isNoFillNoLineSeries } from './style';

export interface PieLabelGeometry {
  cos: number;
  sin: number;
  centerX: number;
  centerY: number;
  innerRadiusRatio: number;
  outerRadiusRatio: number;
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
  if (!config || !isPieLikeChartType(config.type)) return [];

  const visibleRingIndices =
    config.type === 'doughnut' || config.type === 'doughnutExploded'
      ? visibleDoughnutSeriesIndices(config, data)
      : [];
  const ringCount = visibleRingIndices.length > 1 ? visibleRingIndices.length : 1;
  const ringIndexBySeriesIndex = new Map(
    visibleRingIndices.map((seriesIndex, ringIndex) => [seriesIndex, ringIndex]),
  );

  return data.series.map((series, seriesIndex) => {
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], seriesIndex);
    const ringIndex = ringIndexBySeriesIndex.get(seriesIndex);
    const band =
      ringIndex !== undefined && ringCount > 1
        ? doughnutRingBand({ config, ringCount, ringIndex })
        : { innerRadius: doughnutInnerRadiusRatio(config), outerRadius: 1 };
    return pieLikeSliceGeometries({
      values: series.data.map((point) => point?.y),
      startAngle: firstSliceAngleRadians(config),
      innerRadiusRatio: band.innerRadius,
      outerRadiusRatio: band.outerRadius,
    }).map((geometry) => {
      const pointIndex = geometry.index;
      const pointExplosion = seriesConfig?.points?.find((point) => point.idx === pointIndex)
        ?.explosion;
      const explosionPercent =
        effectivePieLikeExplosionPercent({
          seriesExplosion: seriesConfig?.explosion,
          pointExplosion,
          defaultExplosion: defaultPieLikeExplosionPercent(config, pointIndex),
        }) ?? 0;
      const centerOffset = (geometry.outerRadiusRatio / 2) * (explosionPercent / 100);
      return {
        ...geometry,
        centerX: 0.5 + geometry.cos * centerOffset,
        centerY: 0.5 + geometry.sin * centerOffset,
      };
    });
  });
}

export function pieLabelCoordinates(
  geometry: PieLabelGeometry,
  position: DataLabelConfig['position'],
): { anchorX: number; anchorY: number; labelX: number; labelY: number } {
  const outside = position === 'outside' || position === 'outsideEnd' || position === 'callout';
  const labelRadius = labelRadiusFraction(
    geometry.innerRadiusRatio,
    geometry.outerRadiusRatio,
    position,
  );
  const anchorRadius = outside ? Math.max(0, geometry.outerRadiusRatio * 0.49) : labelRadius;
  const centerX = Number.isFinite(geometry.centerX) ? geometry.centerX : 0.5;
  const centerY = Number.isFinite(geometry.centerY) ? geometry.centerY : 0.5;
  return {
    anchorX: centerX + geometry.cos * anchorRadius,
    anchorY: centerY + geometry.sin * anchorRadius,
    labelX: centerX + geometry.cos * labelRadius,
    labelY: centerY + geometry.sin * labelRadius,
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

function visibleDoughnutSeriesIndices(config: ChartConfig, data: ChartData): number[] {
  const seriesConfigs = config.series ?? [];
  const indices: number[] = [];
  for (let index = 0; index < data.series.length; index += 1) {
    const seriesConfig = seriesConfigForDataSeries(data.series[index], seriesConfigs, index);
    if (isNoFillNoLineSeries(seriesConfig)) continue;
    indices.push(index);
  }
  return indices;
}
