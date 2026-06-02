import {
  resolveExcelAutoValueAxisScale,
  roundExcelAxisBound,
} from './chart-ir/excel-value-axis-scale';

export const RADAR_PLOT_INSET = 8;
export const RADAR_LABEL_GAP = 8;
export const RADAR_START_ANGLE = -Math.PI / 2;
export const RADAR_AUTO_VALUE_TICK_COUNT = 9;
export const RADAR_DEFAULT_FILLED_OPACITY = 0.18;
export const RADAR_DEFAULT_MARKER_SIZE = 49;

const RADAR_TICK_EPSILON = 1e-10;
const FALLBACK_RADAR_TICK_STEP = 0.2;
const RADAR_AUTO_MARKER_SHAPES = [
  'circle',
  'square',
  'diamond',
  'triangle-up',
  'x',
  'star',
  'cross',
] as const;

export interface RadarGeometry {
  cx: number;
  cy: number;
  radius: number;
}

export interface RadarValueDomain {
  min: number;
  max: number;
}

export type RadarValueScaleAuthority = 'explicitAxis' | 'excelAuto' | 'fallback';

export interface RadarValueScale {
  domain: RadarValueDomain;
  ticks: number[];
  tickStep?: number;
  explicitDomain: boolean;
  explicitTickStep: boolean;
  authority: RadarValueScaleAuthority;
}

export interface ResolveRadarValueScaleInput {
  values: readonly number[];
  explicitMin?: number;
  explicitMax?: number;
  explicitMajorUnit?: number;
  includeZero?: boolean;
  tickCount?: number;
}

export interface RadarPolarPoint {
  x: number;
  y: number;
  angle: number;
}

export function radarGeometryForPlotArea(input: {
  x: number;
  y: number;
  width: number;
  height: number;
}): RadarGeometry {
  const radius = Math.max(0, Math.min(input.width, input.height) / 2 - RADAR_PLOT_INSET);
  return {
    cx: input.x + input.width / 2,
    cy: input.y + input.height / 2,
    radius,
  };
}

export function radarValueDomainFromValues(
  values: readonly number[],
  explicitDomain?: { min?: number; max?: number },
): RadarValueDomain | undefined {
  return resolveRadarValueScale({
    values,
    explicitMin: explicitDomain?.min,
    explicitMax: explicitDomain?.max,
  })?.domain;
}

export function resolveRadarValueScale(
  input: ResolveRadarValueScaleInput,
): RadarValueScale | undefined {
  const explicitTickStep = positiveNumber(input.explicitMajorUnit);
  const resolved = resolveExcelAutoValueAxisScale({
    values: input.values,
    includeZero: input.includeZero ?? true,
    tickCount: input.tickCount ?? RADAR_AUTO_VALUE_TICK_COUNT,
    explicitMin: finiteNumber(input.explicitMin),
    explicitMax: finiteNumber(input.explicitMax),
    explicitTickStep,
  });

  if (resolved) {
    const domain = {
      min: resolved.domain[0],
      max: resolved.domain[1],
    };
    return {
      domain,
      ticks: radarTicksFromStep(domain, resolved.tickStep),
      tickStep: resolved.tickStep,
      explicitDomain: resolved.explicitDomain,
      explicitTickStep: explicitTickStep !== undefined,
      authority:
        resolved.explicitDomain || explicitTickStep !== undefined ? 'explicitAxis' : 'excelAuto',
    };
  }

  const fallbackDomain = fallbackRadarDomain(input);
  if (!fallbackDomain) return undefined;
  const fallbackTickStep = explicitTickStep ?? FALLBACK_RADAR_TICK_STEP;
  return {
    domain: fallbackDomain,
    ticks: radarTicksFromStep(fallbackDomain, fallbackTickStep),
    tickStep: fallbackTickStep,
    explicitDomain: false,
    explicitTickStep: explicitTickStep !== undefined,
    authority: explicitTickStep !== undefined ? 'explicitAxis' : 'fallback',
  };
}

export function radarRadiusForValue(
  value: number,
  domain: RadarValueDomain,
  maxRadius: number,
): number {
  const span = domain.max - domain.min;
  if (span <= 0) return 0;
  const t = (value - domain.min) / span;
  return Math.max(0, Math.min(maxRadius, t * maxRadius));
}

export function radarPointAt(
  index: number,
  count: number,
  geometry: Pick<RadarGeometry, 'cx' | 'cy'>,
  radius: number,
): RadarPolarPoint {
  const angle = RADAR_START_ANGLE + (Math.PI * 2 * index) / count;
  return {
    x: geometry.cx + Math.cos(angle) * radius,
    y: geometry.cy + Math.sin(angle) * radius,
    angle,
  };
}

export function radarAutomaticMarkerShape(
  seriesIndex: number,
): (typeof RADAR_AUTO_MARKER_SHAPES)[number] {
  const index = Math.max(0, Math.floor(seriesIndex));
  return RADAR_AUTO_MARKER_SHAPES[index % RADAR_AUTO_MARKER_SHAPES.length];
}

function fallbackRadarDomain(input: ResolveRadarValueScaleInput): RadarValueDomain | undefined {
  const explicitMin = finiteNumber(input.explicitMin);
  const explicitMax = finiteNumber(input.explicitMax);
  if (explicitMin !== undefined || explicitMax !== undefined) {
    const min = explicitMin ?? Math.min(0, explicitMax ?? 0);
    let max = explicitMax ?? Math.max(min + 1, 0);
    if (min === max) max = min + 1;
    return { min, max };
  }
  return { min: 0, max: 1 };
}

function radarTicksFromStep(domain: RadarValueDomain, rawStep: number | undefined): number[] {
  const step = positiveNumber(rawStep);
  if (step === undefined) return [];
  const ticks: number[] = [];
  const start = Math.ceil((domain.min - RADAR_TICK_EPSILON) / step) * step;
  for (let value = start; value <= domain.max + RADAR_TICK_EPSILON; value += step) {
    ticks.push(roundExcelAxisBound(value));
    if (ticks.length > 1000) break;
  }
  return uniqueSortedTicks(ticks, domain);
}

function uniqueSortedTicks(values: readonly number[], domain: RadarValueDomain): number[] {
  const seen = new Set<number>();
  const ticks: number[] = [];
  for (const value of values) {
    const rounded = roundExcelAxisBound(value);
    if (
      !Number.isFinite(rounded) ||
      rounded < domain.min - RADAR_TICK_EPSILON ||
      rounded > domain.max + RADAR_TICK_EPSILON ||
      seen.has(rounded)
    ) {
      continue;
    }
    seen.add(rounded);
    ticks.push(rounded);
  }
  return ticks;
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
