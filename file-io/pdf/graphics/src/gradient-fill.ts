/**
 * Gradient Fill — linear and radial gradient fills for PDF output.
 *
 * Maps Excel gradient conventions to PDF shading types:
 * - Linear → PDF Type 2 (axial) shading
 * - Radial → PDF Type 3 (radial) shading
 *
 * Multi-stop gradients use stitching functions (FunctionType 3).
 */

import type { ContentOp } from './content-ops';

/** GradientStop — PDF output layer. Maps to CT_GradientStop (dml-main.xsd:1539) resolved to [r,g,b] tuples for PDF shading. */
export interface GradientStop {
  /** Position along the gradient axis (0-1). */
  position: number;
  /** Color at this stop [r, g, b] each 0-1. */
  color: [number, number, number];
}

/**
 * Linear gradient options.
 * Angle follows Excel convention: 0° = left→right, 90° = bottom→top.
 */
export interface LinearGradientOptions {
  /** Gradient angle in degrees (Excel convention). */
  angle: number;
  /** Color stops (must have at least 2). */
  stops: GradientStop[];
}

/**
 * Radial gradient options.
 * Center is specified in relative coordinates (0-1).
 */
export interface RadialGradientOptions {
  /** Center X as fraction of bounding box width (0-1). */
  centerX: number;
  /** Center Y as fraction of bounding box height (0-1). */
  centerY: number;
  /** Color stops (must have at least 2). */
  stops: GradientStop[];
}

/**
 * A PDF shading definition ready for resource registration.
 */
export interface ShadingDefinition {
  /** Resource name (e.g., 'Sh0'). */
  name: string;
  /** Shading type: 2 = axial, 3 = radial. */
  type: 2 | 3;
  /** Start point [x, y] in user space. */
  coords: number[];
  /** Color stops for the function definition. */
  stops: GradientStop[];
}

/**
 * Cache for shading definitions to deduplicate identical gradients.
 */
export class ShadingCache {
  private _shadings: Map<string, ShadingDefinition> = new Map();
  private _nextId = 0;

  getOrCreate(def: Omit<ShadingDefinition, 'name'>): ShadingDefinition {
    const key = makeShadingKey(def);
    const existing = this._shadings.get(key);
    if (existing) return existing;

    const name = `Sh${this._nextId++}`;
    const shading: ShadingDefinition = { ...def, name };
    this._shadings.set(key, shading);
    return shading;
  }

  getAll(): ShadingDefinition[] {
    return Array.from(this._shadings.values());
  }

  clear(): void {
    this._shadings.clear();
    this._nextId = 0;
  }
}

function makeShadingKey(def: Omit<ShadingDefinition, 'name'>): string {
  return `${def.type}:${def.coords.join(',')}:${def.stops.map((s) => `${s.position}:${s.color.join(',')}`).join('|')}`;
}

/**
 * Convert an Excel gradient angle to start/end points within a bounding box.
 *
 * Excel convention:
 * - 0° = left→right
 * - 90° = bottom→top
 * - 180° = right→left
 * - 270° = top→bottom
 *
 * @returns [x0, y0, x1, y1] coordinates in user space
 */
export function linearAngleToCoords(
  angle: number,
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number, number, number] {
  // Normalize angle to 0-360
  const normAngle = ((angle % 360) + 360) % 360;

  // Convert Excel angle to math angle in radians
  // Excel 0° = left→right = math 0°
  // Excel 90° = bottom→top = math 90°
  const radians = (normAngle * Math.PI) / 180;

  const cx = x + w / 2;
  const cy = y + h / 2;

  // Compute direction vector
  const dx = Math.cos(radians);
  const dy = -Math.sin(radians); // Negate because PDF Y increases upward but we use top-left origin

  // Project to bounding box edges
  // Find the scalar t such that the line from center hits the box edge
  const halfW = w / 2;
  const halfH = h / 2;

  let t: number;
  if (Math.abs(dx) < 1e-10) {
    t = halfH / Math.abs(dy);
  } else if (Math.abs(dy) < 1e-10) {
    t = halfW / Math.abs(dx);
  } else {
    const tX = halfW / Math.abs(dx);
    const tY = halfH / Math.abs(dy);
    t = Math.min(tX, tY);
  }

  const x0 = cx - dx * t;
  const y0 = cy - dy * t;
  const x1 = cx + dx * t;
  const y1 = cy + dy * t;

  return [x0, y0, x1, y1];
}

/**
 * Generate ContentOps for a linear gradient fill within a bounding box.
 *
 * Emits ops that:
 * 1. Save graphics state
 * 2. Clip to the bounding box
 * 3. Draw gradient bands (approximation of smooth gradient)
 * 4. Restore graphics state
 */
export function generateLinearGradientOps(
  gradient: LinearGradientOptions,
  x: number,
  y: number,
  w: number,
  h: number,
): ContentOp[] {
  if (gradient.stops.length < 2) return [];

  const ops: ContentOp[] = [];
  const sortedStops = [...gradient.stops].sort((a, b) => a.position - b.position);

  // Compute gradient axis endpoints
  const [x0, y0, x1, y1] = linearAngleToCoords(gradient.angle, x, y, w, h);

  ops.push({ op: 'SaveState' });

  // Clip to bounding box
  ops.push({ op: 'Rectangle', x, y, w, h });
  ops.push({ op: 'ClipNonZero' });

  // Draw gradient as bands along the gradient axis
  const numBands = 64; // Good balance of quality vs. size
  const axisLen = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);

  if (axisLen < 1e-10) {
    // Degenerate gradient -- fall back to solid fill using first stop color
    const color = sortedStops[0].color;
    ops.push({ op: 'SetFillColorRGB', r: color[0], g: color[1], b: color[2] });
    ops.push({ op: 'Rectangle', x, y, w, h });
    ops.push({ op: 'Fill' });
    ops.push({ op: 'RestoreState' });
    return ops;
  }

  const perpX = -(y1 - y0) / axisLen;
  const perpY = (x1 - x0) / axisLen;
  const perpExtent = Math.sqrt(w * w + h * h); // Enough to cover the box

  for (let i = 0; i < numBands; i++) {
    const t0 = i / numBands;
    const t1 = (i + 1) / numBands;
    const tMid = (t0 + t1) / 2;

    const color = interpolateStops(sortedStops, tMid);

    // Band endpoints along the axis
    const bx0 = x0 + (x1 - x0) * t0;
    const by0 = y0 + (y1 - y0) * t0;
    const bx1 = x0 + (x1 - x0) * t1;
    const by1 = y0 + (y1 - y0) * t1;

    // Build a quadrilateral perpendicular to the gradient axis
    ops.push({ op: 'SetFillColorRGB', r: color[0], g: color[1], b: color[2] });
    ops.push({ op: 'MoveTo', x: bx0 - perpX * perpExtent, y: by0 - perpY * perpExtent });
    ops.push({ op: 'LineTo', x: bx0 + perpX * perpExtent, y: by0 + perpY * perpExtent });
    ops.push({ op: 'LineTo', x: bx1 + perpX * perpExtent, y: by1 + perpY * perpExtent });
    ops.push({ op: 'LineTo', x: bx1 - perpX * perpExtent, y: by1 - perpY * perpExtent });
    ops.push({ op: 'ClosePath' });
    ops.push({ op: 'Fill' });
  }

  ops.push({ op: 'RestoreState' });
  return ops;
}

/**
 * Generate ContentOps for a radial gradient fill within a bounding box.
 *
 * Emits concentric filled circles from the outside in, creating a smooth gradient.
 */
export function generateRadialGradientOps(
  gradient: RadialGradientOptions,
  x: number,
  y: number,
  w: number,
  h: number,
): ContentOp[] {
  if (gradient.stops.length < 2) return [];

  const ops: ContentOp[] = [];
  const sortedStops = [...gradient.stops].sort((a, b) => a.position - b.position);

  const cx = x + gradient.centerX * w;
  const cy = y + gradient.centerY * h;

  // Max radius: distance from center to farthest corner
  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ];
  const maxRadius = Math.max(
    ...corners.map(([px, py]) => Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)),
  );

  ops.push({ op: 'SaveState' });

  // Clip to bounding box
  ops.push({ op: 'Rectangle', x, y, w, h });
  ops.push({ op: 'ClipNonZero' });

  // Draw from outside in (so inner rings paint over outer rings)
  const numRings = 64;
  for (let i = numRings - 1; i >= 0; i--) {
    const t = (i + 0.5) / numRings;
    const radius = maxRadius * ((i + 1) / numRings);
    const color = interpolateStops(sortedStops, t);

    ops.push({ op: 'SetFillColorRGB', r: color[0], g: color[1], b: color[2] });
    // Approximate circle with 4 cubic Bezier curves
    emitCirclePath(ops, cx, cy, radius);
    ops.push({ op: 'Fill' });
  }

  ops.push({ op: 'RestoreState' });
  return ops;
}

/**
 * Emit a circle path using 4 cubic Bezier curves.
 * The magic number 0.5522847498 is the standard approximation for
 * circular arcs using cubic Bezier curves.
 */
function emitCirclePath(ops: ContentOp[], cx: number, cy: number, r: number): void {
  const k = 0.5522847498;
  ops.push({ op: 'MoveTo', x: cx + r, y: cy });
  ops.push({
    op: 'CurveTo',
    x1: cx + r,
    y1: cy + k * r,
    x2: cx + k * r,
    y2: cy + r,
    x: cx,
    y: cy + r,
  });
  ops.push({
    op: 'CurveTo',
    x1: cx - k * r,
    y1: cy + r,
    x2: cx - r,
    y2: cy + k * r,
    x: cx - r,
    y: cy,
  });
  ops.push({
    op: 'CurveTo',
    x1: cx - r,
    y1: cy - k * r,
    x2: cx - k * r,
    y2: cy - r,
    x: cx,
    y: cy - r,
  });
  ops.push({
    op: 'CurveTo',
    x1: cx + k * r,
    y1: cy - r,
    x2: cx + r,
    y2: cy - k * r,
    x: cx + r,
    y: cy,
  });
  ops.push({ op: 'ClosePath' });
}

/**
 * Interpolate color between gradient stops at position t (0-1).
 */
export function interpolateStops(stops: GradientStop[], t: number): [number, number, number] {
  if (stops.length === 0) return [0, 0, 0];
  if (stops.length === 1) return [...stops[0].color];

  // Clamp t to stop range
  if (t <= stops[0].position) return [...stops[0].color];
  if (t >= stops[stops.length - 1].position) return [...stops[stops.length - 1].color];

  // Find the two stops that bracket t
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].position && t <= stops[i + 1].position) {
      const range = stops[i + 1].position - stops[i].position;
      if (range < 1e-10) return [...stops[i].color];

      const frac = (t - stops[i].position) / range;
      return [
        stops[i].color[0] + (stops[i + 1].color[0] - stops[i].color[0]) * frac,
        stops[i].color[1] + (stops[i + 1].color[1] - stops[i].color[1]) * frac,
        stops[i].color[2] + (stops[i + 1].color[2] - stops[i].color[2]) * frac,
      ];
    }
  }

  return [...stops[stops.length - 1].color];
}
