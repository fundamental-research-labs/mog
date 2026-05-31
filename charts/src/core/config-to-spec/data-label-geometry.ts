import type { ChartConfig, ChartData, DataLabelConfig } from '../../types';

export interface PieLabelGeometry {
  cos: number;
  sin: number;
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
    let startAngle = -Math.PI / 2;
    return series.data.map((point) => {
      const value = total > 0 ? Math.abs(point?.y ?? 0) : 1;
      const angle =
        total > 0 ? (value / total) * Math.PI * 2 : (Math.PI * 2) / Math.max(1, series.data.length);
      const midAngle = startAngle + angle / 2;
      startAngle += angle;
      return { cos: Math.cos(midAngle), sin: Math.sin(midAngle) };
    });
  });
}

export function pieLabelCoordinates(
  geometry: PieLabelGeometry,
  position: DataLabelConfig['position'],
): { anchorX: number; anchorY: number; labelX: number; labelY: number } {
  const outside =
    position === 'outside' ||
    position === 'outsideEnd' ||
    position === 'callout';
  const center = position === 'center';
  const anchorRadius = 0.42;
  const labelRadius = outside ? 0.56 : center ? 0.0 : 0.3;
  return {
    anchorX: 0.5 + geometry.cos * anchorRadius,
    anchorY: 0.5 + geometry.sin * anchorRadius,
    labelX: 0.5 + geometry.cos * labelRadius,
    labelY: 0.5 + geometry.sin * labelRadius,
  };
}

function isPieLikeChart(type?: ChartConfig['type']): boolean {
  return type === 'pie' || type === 'doughnut' || type === 'pie3d';
}
