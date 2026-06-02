export const RADAR_PLOT_INSET = 8;
export const RADAR_LABEL_GAP = 8;
export const RADAR_START_ANGLE = -Math.PI / 2;

export interface RadarGeometry {
  cx: number;
  cy: number;
  radius: number;
}

export interface RadarValueDomain {
  min: number;
  max: number;
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
  const finiteValues = values.filter((value) => Number.isFinite(value));
  let min = explicitDomain?.min;
  let max = explicitDomain?.max;

  if (min === undefined) {
    min = Math.min(0, ...(finiteValues.length > 0 ? finiteValues : [0]));
  }
  if (max === undefined) {
    if (finiteValues.length === 0 && explicitDomain?.min === undefined) return undefined;
    max = Math.max(...(finiteValues.length > 0 ? finiteValues : [min + 1]));
  }

  if (min === max) {
    max = min + 1;
  }

  return { min, max };
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
