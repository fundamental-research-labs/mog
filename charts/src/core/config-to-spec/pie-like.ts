import type { ChartConfig, ChartData } from '../../types';

export interface PieDoughnutPlotArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PieDoughnutLayoutHints {
  outsideLabelPadding?: number;
  leaderLinePadding?: number;
  explosionPaddingPx?: number;
  explosionPaddingPercent?: number;
  preferSquareArcPlot?: true;
  chartFrameBleed?: number;
  legendEntryCount?: number;
}

export interface PieDoughnutArcFrame {
  plotArea: PieDoughnutPlotArea;
  arcBox: PieDoughnutPlotArea;
  centerX: number;
  centerY: number;
  rawRadius: number;
  radius: number;
  padding: number;
}

export interface PieLikeSliceGeometry {
  index: number;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  angle: number;
  cos: number;
  sin: number;
  innerRadiusRatio: number;
  outerRadiusRatio: number;
}

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

export function pieDoughnutArcFrame(
  plotArea: PieDoughnutPlotArea,
  hints?: PieDoughnutLayoutHints,
): PieDoughnutArcFrame {
  const diameter = Math.max(0, Math.min(plotArea.width, plotArea.height));
  const arcBox = {
    x: plotArea.x + Math.max(0, (plotArea.width - diameter) / 2),
    y: plotArea.y + Math.max(0, (plotArea.height - diameter) / 2),
    width: diameter,
    height: diameter,
  };
  const rawRadius = diameter / 2;
  const padding = Math.min(rawRadius, pieDoughnutRadiusPadding(rawRadius, hints));
  return {
    plotArea,
    arcBox,
    centerX: arcBox.x + arcBox.width / 2,
    centerY: arcBox.y + arcBox.height / 2,
    rawRadius,
    radius: Math.max(0, rawRadius - padding),
    padding,
  };
}

export function pieDoughnutExplosionOffset(
  outerRadius: number,
  explosionPercent: number | undefined,
): number {
  const percent = clampPieDoughnutExplosionPercent(explosionPercent);
  if (percent === undefined || !Number.isFinite(outerRadius) || outerRadius <= 0) return 0;
  return outerRadius * (percent / 100);
}

export function clampPieDoughnutExplosionPercent(
  value: number | undefined,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(400, value))
    : undefined;
}

export function effectivePieLikeExplosionPercent(input: {
  seriesExplosion?: number;
  pointExplosion?: number;
  defaultExplosion?: number;
}): number | undefined {
  return (
    clampPieDoughnutExplosionPercent(input.pointExplosion) ??
    clampPieDoughnutExplosionPercent(input.seriesExplosion) ??
    clampPieDoughnutExplosionPercent(input.defaultExplosion)
  );
}

export function defaultPieLikeExplosionPercent(
  config: ChartConfig | undefined,
  pointIndex: number,
): number | undefined {
  if (!config) return undefined;
  const pieSlice = config.pieSlice as
    | (typeof config.pieSlice & { explodedIndex?: number })
    | undefined;
  const offset =
    finiteNumber(pieSlice?.explodeOffset) ??
    finiteNumber(pieSlice?.explosion) ??
    (isExplodedPieLikeChartType(config.type) ? 25 : undefined);
  if (offset === undefined || offset <= 0) return undefined;
  if (pieSlice?.explodeAll === true || isExplodedPieLikeChartType(config.type)) return offset;
  if (pieSlice?.explodedIndex === pointIndex) return offset;
  if (pieSlice?.explodedIndices?.includes(pointIndex)) return offset;
  if (
    (pieSlice?.explodeOffset !== undefined || pieSlice?.explosion !== undefined) &&
    pieSlice.explodedIndex === undefined &&
    (!pieSlice.explodedIndices || pieSlice.explodedIndices.length === 0)
  ) {
    return offset;
  }
  return undefined;
}

export function pieLikeSliceGeometries(input: {
  values: readonly unknown[];
  startAngle?: number;
  innerRadiusRatio?: number;
  outerRadiusRatio?: number;
}): PieLikeSliceGeometry[] {
  const values = input.values.map(sanitizedPieLikeValue);
  const total = values.reduce((sum, value) => sum + value, 0);
  const sliceCount = values.length;
  if (sliceCount === 0) return [];

  let startAngle = finiteRadians(input.startAngle) ?? 0;
  const innerRadiusRatio = clampRadiusRatio(input.innerRadiusRatio, 0);
  const outerRadiusRatio = clampRadiusRatio(input.outerRadiusRatio, 1);

  return values.map((value, index) => {
    const angle =
      total > 0 ? (value / total) * Math.PI * 2 : (Math.PI * 2) / Math.max(1, sliceCount);
    const endAngle = startAngle + angle;
    const midAngle = startAngle + angle / 2;
    const unit = pieLikeAngleUnitVector(midAngle);
    const geometry: PieLikeSliceGeometry = {
      index,
      startAngle,
      endAngle,
      midAngle,
      angle,
      cos: unit.x,
      sin: unit.y,
      innerRadiusRatio,
      outerRadiusRatio,
    };
    startAngle = endAngle;
    return geometry;
  });
}

export function pieLikeSeriesTotal(values: readonly unknown[]): number {
  return values.reduce<number>((sum, value) => sum + sanitizedPieLikeValue(value), 0);
}

export function pieLikeAngleUnitVector(angle: number): { x: number; y: number } {
  const canvasAngle = angle - Math.PI / 2;
  return { x: Math.cos(canvasAngle), y: Math.sin(canvasAngle) };
}

export function hasMultipleDoughnutSeries(config: ChartConfig, data: ChartData): boolean {
  return isDoughnutLikeChartType(config.type) && data.series.length > 1;
}

function sanitizedPieLikeValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : 0;
}

function finiteRadians(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampRadiusRatio(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function pieDoughnutRadiusPadding(
  rawRadius: number,
  hints: PieDoughnutLayoutHints | undefined,
): number {
  const basePadding = 10;
  const labelPadding =
    finiteNonNegative(hints?.outsideLabelPadding) ??
    finiteNonNegative(hints?.leaderLinePadding) ??
    0;
  const explosionPadding =
    finiteNonNegative(hints?.explosionPaddingPx) ??
    (finiteNonNegative(hints?.explosionPaddingPercent) ?? 0) * rawRadius / 100;
  const frameBleed = finiteNonNegative(hints?.chartFrameBleed) ?? 0;
  return Math.max(basePadding, labelPadding + explosionPadding + frameBleed);
}

function finitePercent(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : undefined;
}

function finiteDegrees(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined;
}
