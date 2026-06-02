import type { ChartConfig, ChartData } from '../../types';

export interface PieDoughnutPlotArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PieDoughnutLegendPosition =
  | 'none'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'custom'
  | 'overlay';

export type PieDoughnutLayoutAuthority =
  | 'excelLikeAuto'
  | 'manualLayout'
  | 'genericFallback';

export type PieDoughnutLayoutFamily =
  | 'pie'
  | 'doughnut'
  | 'ofPie'
  | 'pie3dApproximation';

export type PieDoughnutManualLayoutSource =
  | 'plotLayout'
  | 'plotAreaLayout'
  | 'manualLayout';

export type PieDoughnutVisualStatus =
  | 'exact'
  | 'verifiedDefault'
  | 'approximate'
  | 'unknown';

export type PieDoughnutStyleContextStatus =
  | 'none'
  | 'resolvedSimple'
  | 'modeledReservation'
  | 'unmodeledFrameFootprint'
  | 'unmodeledSliceFootprint'
  | 'unresolvedDrawingMlOrDiagnostics'
  | 'builtInChartStyleEffect';

export type PieDoughnutStyleContextReservationMode =
  | 'none'
  | 'modeledEffectBleed';

export interface PieDoughnutLayoutReservation {
  top: number;
  right: number;
  bottom: number;
  left: number;
  radial: number;
}

export interface PieDoughnutLayoutHints {
  outsideLabelPadding?: number;
  leaderLinePadding?: number;
  explosionPaddingPx?: number;
  explosionPaddingPercent?: number;
  maxExplosionPercent?: number;
  preferSquareArcPlot?: true;
  chartFrameBleed?: number;
  legendEntryCount?: number;
  legendMaxLabelLength?: number;
  legendPosition?: PieDoughnutLegendPosition;
  labelCount?: number;
  outsideLabelCount?: number;
  defaultLabelCount?: number;
  zeroValueLabelCount?: number;
  nearZeroValueLabelCount?: number;
  maxLabelTextLength?: number;
  hasManualLayout?: boolean;
  manualLayoutSource?: PieDoughnutManualLayoutSource;
  family?: PieDoughnutLayoutFamily;
  ringCount?: number;
  holeSize?: number;
  hasRoundedFrame?: boolean;
  hasChartFrameShadow?: boolean;
  hasPlotFrameShadow?: boolean;
  hasFrameStyleEffect?: boolean;
  hasSliceStyleEffect?: boolean;
  styleId?: number;
  hasBuiltInStyleEffect?: boolean;
  hasChartStyleContext?: boolean;
  styleContextStatus?: PieDoughnutStyleContextStatus;
  styleContextReason?: string;
  styleContextEffectFlags?: string[];
  unmodeledStyleOwnerKeys?: string[];
  styleContextReservationMode?: PieDoughnutStyleContextReservationMode;
  modeledStyleContextEffectBleed?: number;
}

export interface PieDoughnutArcFrame {
  plotArea: PieDoughnutPlotArea;
  availableContentRect: PieDoughnutPlotArea;
  legendReservation: PieDoughnutLayoutReservation;
  labelReservation: PieDoughnutLayoutReservation;
  explosionReservation: PieDoughnutLayoutReservation;
  styleReservation: PieDoughnutLayoutReservation;
  arcBox: PieDoughnutPlotArea;
  centerX: number;
  centerY: number;
  rawRadius: number;
  radius: number;
  padding: number;
  layoutAuthority: PieDoughnutLayoutAuthority;
  manualArcInsetProfile?: string;
  manualArcInsetStatus?: PieDoughnutVisualStatus;
  manualArcInsetStatusReason?: string;
  arcFrameStatus: PieDoughnutVisualStatus;
  arcFrameStatusReason?: string;
  radiusStatus: PieDoughnutVisualStatus;
  radiusStatusReason?: string;
  legendLayoutStatus: PieDoughnutVisualStatus;
  legendLayoutStatusReason?: string;
  labelLayoutStatus: PieDoughnutVisualStatus;
  labelLayoutStatusReason?: string;
  explosionLayoutStatus: PieDoughnutVisualStatus;
  explosionLayoutStatusReason?: string;
  styleFootprintStatus: PieDoughnutVisualStatus;
  styleFootprintStatusReason?: string;
  sliceStyleStatus: PieDoughnutVisualStatus;
  sliceStyleStatusReason?: string;
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
  return computePieDoughnutArcFootprintFrame(plotArea, hints);
}

export function computePieDoughnutArcFootprintFrame(
  plotArea: PieDoughnutPlotArea,
  hints?: PieDoughnutLayoutHints,
): PieDoughnutArcFrame {
  const initialRawRadius = Math.max(0, Math.min(plotArea.width, plotArea.height)) / 2;
  const legendReservation = pieDoughnutLegendReservation(plotArea, hints);
  const labelReservation = pieDoughnutLabelReservation(initialRawRadius, hints);
  const explosionReservation = pieDoughnutExplosionReservation(initialRawRadius, hints);
  const styleReservation = pieDoughnutStyleReservation(hints);
  const availableContentRect = insetPlotArea(
    plotArea,
    pieDoughnutContentReservation({ labelReservation, explosionReservation, styleReservation }),
  );
  const diameter = Math.max(0, Math.min(availableContentRect.width, availableContentRect.height));
  const arcBox = {
    x: availableContentRect.x + Math.max(0, (availableContentRect.width - diameter) / 2),
    y: availableContentRect.y + Math.max(0, (availableContentRect.height - diameter) / 2),
    width: diameter,
    height: diameter,
  };
  const rawRadius = diameter / 2;
  const padding = Math.min(rawRadius, pieDoughnutRadiusPadding(rawRadius));
  const layoutAuthority = pieDoughnutLayoutAuthority(hints);
  const manualArcInsetProfile = manualPieDoughnutArcInsetProfile(hints);
  const arcFrameStatus = pieDoughnutArcFrameStatus(hints, manualArcInsetProfile);
  const radiusStatus = rawRadius > 0 ? arcFrameStatus.status : 'unknown';
  const legendLayoutStatus = pieDoughnutLegendLayoutStatus(hints);
  const labelLayoutStatus = pieDoughnutLabelLayoutStatus(hints);
  const explosionLayoutStatus = pieDoughnutExplosionLayoutStatus(explosionReservation.radial);
  const styleFootprintStatus = pieDoughnutStyleFootprintStatus(hints);
  const sliceStyleStatus = pieDoughnutSliceStyleStatus(hints);
  return {
    plotArea,
    availableContentRect,
    legendReservation,
    labelReservation,
    explosionReservation,
    styleReservation,
    arcBox,
    centerX: arcBox.x + arcBox.width / 2,
    centerY: arcBox.y + arcBox.height / 2,
    rawRadius,
    radius: Math.max(0, rawRadius - padding),
    padding,
    layoutAuthority,
    ...(manualArcInsetProfile
      ? {
          manualArcInsetProfile: manualArcInsetProfile.profile,
          manualArcInsetStatus: manualArcInsetProfile.status,
          ...(manualArcInsetProfile.reason
            ? { manualArcInsetStatusReason: manualArcInsetProfile.reason }
            : {}),
        }
      : {}),
    arcFrameStatus: arcFrameStatus.status,
    ...(arcFrameStatus.reason ? { arcFrameStatusReason: arcFrameStatus.reason } : {}),
    radiusStatus,
    ...(radiusStatus === 'unknown'
      ? { radiusStatusReason: 'excelGeometryEvidenceMissing' }
      : arcFrameStatus.reason
        ? { radiusStatusReason: arcFrameStatus.reason }
        : {}),
    legendLayoutStatus: legendLayoutStatus.status,
    ...(legendLayoutStatus.reason
      ? { legendLayoutStatusReason: legendLayoutStatus.reason }
      : {}),
    labelLayoutStatus: labelLayoutStatus.status,
    ...(labelLayoutStatus.reason ? { labelLayoutStatusReason: labelLayoutStatus.reason } : {}),
    explosionLayoutStatus: explosionLayoutStatus.status,
    ...(explosionLayoutStatus.reason
      ? { explosionLayoutStatusReason: explosionLayoutStatus.reason }
      : {}),
    styleFootprintStatus: styleFootprintStatus.status,
    ...(styleFootprintStatus.reason
      ? { styleFootprintStatusReason: styleFootprintStatus.reason }
      : {}),
    sliceStyleStatus: sliceStyleStatus.status,
    ...(sliceStyleStatus.reason ? { sliceStyleStatusReason: sliceStyleStatus.reason } : {}),
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

function pieDoughnutRadiusPadding(rawRadius: number): number {
  return rawRadius <= 2 ? 0 : 10;
}

function pieDoughnutLayoutAuthority(
  hints: PieDoughnutLayoutHints | undefined,
): PieDoughnutLayoutAuthority {
  if (hints?.hasManualLayout) return 'manualLayout';
  if (hints?.preferSquareArcPlot === true) return 'excelLikeAuto';
  return 'genericFallback';
}

function pieDoughnutLegendReservation(
  plotArea: PieDoughnutPlotArea,
  hints: PieDoughnutLayoutHints | undefined,
): PieDoughnutLayoutReservation {
  const position = hints?.legendPosition ?? ((hints?.legendEntryCount ?? 0) > 0 ? 'right' : 'none');
  const entryCount = Math.max(0, Math.ceil(finiteNonNegative(hints?.legendEntryCount) ?? 0));
  if (entryCount === 0 || position === 'none' || position === 'overlay') {
    return zeroReservation();
  }

  const labelLength = finiteNonNegative(hints?.legendMaxLabelLength) ?? 0;
  const entryWidth = Math.max(54, Math.min(180, 22 + labelLength * 7));
  if (position === 'left' || position === 'right' || position === 'custom') {
    const width = Math.min(Math.max(70, entryWidth), Math.max(0, plotArea.width * 0.45));
    return {
      top: 0,
      right: position === 'left' ? 0 : width,
      bottom: 0,
      left: position === 'left' ? width : 0,
      radial: 0,
    };
  }

  const maxColumns = Math.max(1, Math.floor(Math.max(1, plotArea.width) / entryWidth));
  const rowCount = Math.ceil(entryCount / maxColumns);
  const height = Math.min(Math.max(24, rowCount * 18 + 10), Math.max(0, plotArea.height * 0.35));
  return {
    top: position === 'bottom' ? 0 : height,
    right: 0,
    bottom: position === 'bottom' ? height : 0,
    left: 0,
    radial: 0,
  };
}

function pieDoughnutLabelReservation(
  rawRadius: number,
  hints: PieDoughnutLayoutHints | undefined,
): PieDoughnutLayoutReservation {
  const labelCount = Math.max(0, Math.ceil(finiteNonNegative(hints?.labelCount) ?? 0));
  const outsideCount = Math.max(0, Math.ceil(finiteNonNegative(hints?.outsideLabelCount) ?? 0));
  const defaultCount = Math.max(0, Math.ceil(finiteNonNegative(hints?.defaultLabelCount) ?? 0));
  const zeroValueCount = Math.max(0, Math.ceil(finiteNonNegative(hints?.zeroValueLabelCount) ?? 0));
  const nearZeroValueCount = Math.max(
    0,
    Math.ceil(finiteNonNegative(hints?.nearZeroValueLabelCount) ?? 0),
  );
  const maxTextLength = finiteNonNegative(hints?.maxLabelTextLength) ?? 0;
  const explicitOutsidePadding = finiteNonNegative(hints?.outsideLabelPadding) ?? 0;
  const leaderPadding = finiteNonNegative(hints?.leaderLinePadding) ?? 0;
  if (
    labelCount <= 0 ||
    (outsideCount <= 0 && defaultCount <= 0 && zeroValueCount <= 0 && nearZeroValueCount <= 0)
  ) {
    return zeroReservation();
  }

  const textPressure =
    outsideCount > 0
      ? Math.min(34, Math.ceil(maxTextLength * 0.45))
      : defaultCount > 0
        ? Math.max(
            Math.min(36, Math.ceil(rawRadius * 0.11)),
            Math.min(32, Math.ceil(maxTextLength * 1.3)),
            18,
          )
        : Math.min(12, Math.ceil(Math.max(0, maxTextLength - 18) * 0.25));
  const zeroSlicePressure =
    zeroValueCount > 0 || nearZeroValueCount > 0
      ? Math.max(14, Math.min(28, Math.ceil(rawRadius * 0.055)))
      : 0;
  const maxRadialReservation = Math.max(0, rawRadius * 0.45);
  const radial = Math.min(
    maxRadialReservation,
    Math.max(explicitOutsidePadding, leaderPadding + textPressure, zeroSlicePressure),
  );
  return symmetricReservation(radial);
}

function pieDoughnutExplosionReservation(
  rawRadius: number,
  hints: PieDoughnutLayoutHints | undefined,
): PieDoughnutLayoutReservation {
  const percent =
    finiteNonNegative(hints?.maxExplosionPercent) ??
    finiteNonNegative(hints?.explosionPaddingPercent) ??
    0;
  const radial =
    finiteNonNegative(hints?.explosionPaddingPx) ??
    Math.min(rawRadius, (Math.max(0, percent) * rawRadius) / 100);
  return symmetricReservation(radial);
}

function pieDoughnutStyleReservation(
  hints: PieDoughnutLayoutHints | undefined,
): PieDoughnutLayoutReservation {
  const strokeBleed = finiteNonNegative(hints?.chartFrameBleed) ?? 0;
  const shadowBleed = hints?.hasChartFrameShadow || hints?.hasPlotFrameShadow ? 6 : 0;
  const frameEffectBleed = hints?.hasFrameStyleEffect ? 3 : 0;
  const roundedBleed = hints?.hasRoundedFrame ? 2 : 0;
  const sliceEffectBleed = hints?.hasSliceStyleEffect || hints?.hasBuiltInStyleEffect ? 2 : 0;
  const styleContextBleed = finiteNonNegative(hints?.modeledStyleContextEffectBleed) ?? 0;
  return symmetricReservation(
    Math.max(
      strokeBleed,
      shadowBleed,
      frameEffectBleed,
      roundedBleed,
      sliceEffectBleed,
      styleContextBleed,
    ),
  );
}

interface ManualPieDoughnutArcInsetProfile {
  profile: string;
  status: PieDoughnutVisualStatus;
  reason?: string;
}

function manualPieDoughnutArcInsetProfile(
  hints: PieDoughnutLayoutHints | undefined,
): ManualPieDoughnutArcInsetProfile | undefined {
  if (!hints?.hasManualLayout) return undefined;

  const family = hints.family;
  if (family !== 'pie' && family !== 'doughnut') {
    return approximateManualArcInsetProfile('unsupportedFamily');
  }

  const ringCount = Math.max(1, Math.ceil(finiteNonNegative(hints.ringCount) ?? 1));
  if (ringCount !== 1) {
    return approximateManualArcInsetProfile('multiRing');
  }

  const maxExplosionPercent =
    finiteNonNegative(hints.maxExplosionPercent) ??
    finiteNonNegative(hints.explosionPaddingPercent) ??
    0;
  if (maxExplosionPercent > 0 || (finiteNonNegative(hints.explosionPaddingPx) ?? 0) > 0) {
    return approximateManualArcInsetProfile('exploded');
  }

  const legendProfile = manualArcInsetLegendProfile(hints);
  if (!legendProfile) {
    return approximateManualArcInsetProfile('legend');
  }

  const labelProfile = manualArcInsetLabelProfile(hints);
  if (!labelProfile) {
    return approximateManualArcInsetProfile('labels');
  }

  const layoutSource = hints.manualLayoutSource ?? 'manualLayout';
  const styleProfile = manualArcInsetStyleProfile(hints);
  return {
    profile:
      `manual-${family}-single-ring-${layoutSource}-${legendProfile}-${labelProfile}-${styleProfile}`,
    status: 'exact',
    reason: 'manualArcInsetCalibrated',
  };
}

function approximateManualArcInsetProfile(profile: string): ManualPieDoughnutArcInsetProfile {
  return {
    profile: `manual-unsupported-${profile}`,
    status: 'approximate',
    reason: 'excelAutoArcInsetUncalibrated',
  };
}

function manualArcInsetLegendProfile(
  hints: PieDoughnutLayoutHints,
): string | undefined {
  const entryCount = finiteNonNegative(hints.legendEntryCount) ?? 0;
  const position = hints.legendPosition ?? (entryCount > 0 ? 'right' : 'none');
  if (entryCount <= 0 || position === 'none') return 'no-legend';
  if (
    position === 'left' ||
    position === 'right' ||
    position === 'top' ||
    position === 'bottom'
  ) {
    return `${position}-legend`;
  }
  return undefined;
}

function manualArcInsetLabelProfile(
  hints: PieDoughnutLayoutHints,
): string | undefined {
  const labelCount = finiteNonNegative(hints.labelCount) ?? 0;
  const outsideCount = finiteNonNegative(hints.outsideLabelCount) ?? 0;
  const defaultCount = finiteNonNegative(hints.defaultLabelCount) ?? 0;
  const zeroValueCount = finiteNonNegative(hints.zeroValueLabelCount) ?? 0;
  const nearZeroValueCount = finiteNonNegative(hints.nearZeroValueLabelCount) ?? 0;
  if (labelCount <= 0) return 'no-labels';
  if (outsideCount > 0) return undefined;
  if (zeroValueCount > 0) return 'zero-slice-labels';
  if (nearZeroValueCount > 0) return 'near-zero-slice-labels';
  if (defaultCount > 0) return 'default-labels';
  return undefined;
}

function manualArcInsetStyleProfile(hints: PieDoughnutLayoutHints): string {
  const hasFrameStyleReservation =
    hints.hasChartFrameShadow ||
    hints.hasPlotFrameShadow ||
    hints.hasFrameStyleEffect ||
    hints.hasRoundedFrame;
  const hasSliceStyleReservation =
    hints.hasBuiltInStyleEffect ||
    (finiteNonNegative(hints.modeledStyleContextEffectBleed) ?? 0) > 0 ||
    hints.hasSliceStyleEffect;
  if (!hasFrameStyleReservation && !hasSliceStyleReservation) return 'no-style-reservation';
  if (hasFrameStyleReservation && hasSliceStyleReservation) {
    return 'frame-and-slice-style-reserved';
  }
  return hasFrameStyleReservation ? 'frame-style-reserved' : 'slice-style-reserved';
}

function pieDoughnutArcFrameStatus(
  hints: PieDoughnutLayoutHints | undefined,
  manualArcInsetProfile: ManualPieDoughnutArcInsetProfile | undefined,
): { status: PieDoughnutVisualStatus; reason?: string } {
  if (hints?.hasManualLayout) {
    if (manualArcInsetProfile?.status === 'exact') {
      return {
        status: 'exact',
        reason: manualArcInsetProfile.reason,
      };
    }
    return {
      status: 'approximate',
      reason: manualArcInsetProfile?.reason ?? 'excelAutoArcInsetUncalibrated',
    };
  }
  if (hints?.preferSquareArcPlot === true) {
    return hasPieDoughnutLabelPressure(hints)
      ? { status: 'approximate', reason: 'dataLabelArcFootprintEstimated' }
      : { status: 'verifiedDefault' };
  }
  return { status: 'approximate', reason: 'arcFrameDerivedFromGenericLayout' };
}

function pieDoughnutLegendLayoutStatus(
  hints: PieDoughnutLayoutHints | undefined,
): { status: PieDoughnutVisualStatus; reason?: string } {
  const entryCount = finiteNonNegative(hints?.legendEntryCount) ?? 0;
  if (entryCount <= 0 || hints?.legendPosition === 'none') return { status: 'verifiedDefault' };
  if (hints?.legendPosition === 'overlay') {
    return { status: 'approximate', reason: 'legendFlowEstimated' };
  }
  return { status: 'approximate', reason: 'legendFlowEstimated' };
}

function pieDoughnutLabelLayoutStatus(
  hints: PieDoughnutLayoutHints | undefined,
): { status: PieDoughnutVisualStatus; reason?: string } {
  const labelCount = finiteNonNegative(hints?.labelCount) ?? 0;
  const outsideCount = finiteNonNegative(hints?.outsideLabelCount) ?? 0;
  const defaultCount = finiteNonNegative(hints?.defaultLabelCount) ?? 0;
  const zeroValueCount = finiteNonNegative(hints?.zeroValueLabelCount) ?? 0;
  const nearZeroValueCount = finiteNonNegative(hints?.nearZeroValueLabelCount) ?? 0;
  if (labelCount <= 0) return { status: 'verifiedDefault' };
  if (zeroValueCount > 0) {
    return { status: 'approximate', reason: 'zeroSliceLabelPlacementEstimated' };
  }
  if (nearZeroValueCount > 0) {
    return { status: 'approximate', reason: 'nearZeroSliceLabelPlacementEstimated' };
  }
  if (outsideCount > 0) {
    return { status: 'approximate', reason: 'outsideLabelBoundsEstimated' };
  }
  if (defaultCount > 0) {
    return { status: 'approximate', reason: 'defaultLabelAutoPlacementEstimated' };
  }
  return { status: 'approximate', reason: 'dataLabelBoundsEstimated' };
}

function pieDoughnutExplosionLayoutStatus(
  radialReservation: number,
): { status: PieDoughnutVisualStatus; reason?: string } {
  if (radialReservation <= 0) return { status: 'verifiedDefault' };
  return { status: 'approximate', reason: 'excelAutoLayoutApproximation' };
}

function pieDoughnutStyleFootprintStatus(
  hints: PieDoughnutLayoutHints | undefined,
): { status: PieDoughnutVisualStatus; reason?: string } {
  if (hints?.hasBuiltInStyleEffect) {
    return { status: 'approximate', reason: 'builtInSliceEffectUnmodeled' };
  }
  if (hints?.styleContextStatus === 'unresolvedDrawingMlOrDiagnostics') {
    return {
      status: 'approximate',
      reason: hints.styleContextReason ?? 'styleContextDrawingMlOrDiagnosticsUnmodeled',
    };
  }
  if (hints?.styleContextStatus === 'unmodeledSliceFootprint') {
    return {
      status: 'approximate',
      reason: hints.styleContextReason ?? 'sliceBevelOrGradientUnmodeled',
    };
  }
  if (hints?.styleContextStatus === 'unmodeledFrameFootprint') {
    return {
      status: 'approximate',
      reason: hints.styleContextReason ?? 'frameStyleFootprintUnmodeled',
    };
  }
  if (hints?.hasSliceStyleEffect) {
    return { status: 'approximate', reason: 'sliceBevelOrGradientUnmodeled' };
  }
  if (
    hints?.hasChartFrameShadow ||
    hints?.hasPlotFrameShadow ||
    hints?.hasFrameStyleEffect ||
    hints?.hasRoundedFrame
  ) {
    return { status: 'approximate', reason: 'frameStyleFootprintUnmodeled' };
  }
  if (
    hints?.styleContextStatus === 'resolvedSimple' ||
    hints?.styleContextStatus === 'modeledReservation'
  ) {
    return {
      status: 'exact',
      reason: hints.styleContextReason ?? 'styleContextFootprintResolved',
    };
  }
  return { status: 'verifiedDefault' };
}

function pieDoughnutSliceStyleStatus(
  hints: PieDoughnutLayoutHints | undefined,
): { status: PieDoughnutVisualStatus; reason?: string } {
  if (hints?.hasBuiltInStyleEffect) {
    return { status: 'approximate', reason: 'builtInSliceEffectUnmodeled' };
  }
  if (hints?.hasSliceStyleEffect) {
    return { status: 'approximate', reason: 'sliceBevelOrGradientUnmodeled' };
  }
  return { status: 'verifiedDefault' };
}

function symmetricReservation(value: number): PieDoughnutLayoutReservation {
  const radial = Math.max(0, Number.isFinite(value) ? value : 0);
  return { top: radial, right: radial, bottom: radial, left: radial, radial };
}

function pieDoughnutContentReservation(input: {
  labelReservation: PieDoughnutLayoutReservation;
  explosionReservation: PieDoughnutLayoutReservation;
  styleReservation: PieDoughnutLayoutReservation;
}): PieDoughnutLayoutReservation {
  return addReservations(
    addReservations(input.labelReservation, input.explosionReservation),
    input.styleReservation,
  );
}

function addReservations(
  a: PieDoughnutLayoutReservation,
  b: PieDoughnutLayoutReservation,
): PieDoughnutLayoutReservation {
  return {
    top: a.top + b.top,
    right: a.right + b.right,
    bottom: a.bottom + b.bottom,
    left: a.left + b.left,
    radial: a.radial + b.radial,
  };
}

function insetPlotArea(
  plotArea: PieDoughnutPlotArea,
  reservation: PieDoughnutLayoutReservation,
): PieDoughnutPlotArea {
  const horizontal = fitReservationPair(reservation.left, reservation.right, plotArea.width);
  const vertical = fitReservationPair(reservation.top, reservation.bottom, plotArea.height);
  return {
    x: plotArea.x + horizontal.start,
    y: plotArea.y + vertical.start,
    width: Math.max(0, plotArea.width - horizontal.start - horizontal.end),
    height: Math.max(0, plotArea.height - vertical.start - vertical.end),
  };
}

function fitReservationPair(
  start: number,
  end: number,
  size: number,
): { start: number; end: number } {
  const safeStart = Math.max(0, Number.isFinite(start) ? start : 0);
  const safeEnd = Math.max(0, Number.isFinite(end) ? end : 0);
  const safeSize = Math.max(0, Number.isFinite(size) ? size : 0);
  const total = safeStart + safeEnd;
  if (total <= safeSize || total <= 0) return { start: safeStart, end: safeEnd };
  const scale = safeSize / total;
  return { start: safeStart * scale, end: safeEnd * scale };
}

function hasPieDoughnutLabelPressure(hints: PieDoughnutLayoutHints | undefined): boolean {
  return (
    (finiteNonNegative(hints?.outsideLabelCount) ?? 0) > 0 ||
    (finiteNonNegative(hints?.defaultLabelCount) ?? 0) > 0 ||
    (finiteNonNegative(hints?.zeroValueLabelCount) ?? 0) > 0 ||
    (finiteNonNegative(hints?.nearZeroValueLabelCount) ?? 0) > 0 ||
    (finiteNonNegative(hints?.maxLabelTextLength) ?? 0) > 18
  );
}

function zeroReservation(): PieDoughnutLayoutReservation {
  return symmetricReservation(0);
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
