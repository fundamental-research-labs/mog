/**
 * Path Interpolation Helpers
 *
 * Pure math functions for building SVG path strings from coordinate points
 * using various interpolation modes (linear, smooth, stepped).
 *
 * Extracted from compiler.ts - no logic changes.
 */

/**
 * Build an SVG path string from points using the specified interpolation.
 */
export function buildInterpolatedPath(
  pts: Array<{ x: number; y: number }>,
  interpolate?: string,
): string {
  if (pts.length === 0) return '';

  // Single point: generate M + L to same position (degenerate segment)
  if (pts.length === 1) {
    return `M${pts[0].x},${pts[0].y} L${pts[0].x},${pts[0].y}`;
  }

  const smoothModes = [
    'basis',
    'basis-open',
    'basis-closed',
    'cardinal',
    'cardinal-open',
    'cardinal-closed',
    'monotone',
  ];
  const steppedModes = ['step', 'step-before', 'step-after'];

  if (interpolate && smoothModes.includes(interpolate)) {
    return buildSmoothPath(pts);
  }

  if (interpolate && steppedModes.includes(interpolate)) {
    return buildSteppedPath(pts, interpolate);
  }

  // Default: linear interpolation with L commands
  let path = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    path += ` L${pts[i].x},${pts[i].y}`;
  }
  return path;
}

/**
 * Build a smooth (cubic bezier) path using monotone cubic Hermite interpolation.
 * Uses C (cubic bezier) commands for smooth curves.
 */
export function buildSmoothPath(pts: Array<{ x: number; y: number }>): string {
  const n = pts.length;
  if (n < 2) return `M${pts[0].x},${pts[0].y}`;

  if (n === 2) {
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const cp1x = pts[0].x + dx / 3;
    const cp1y = pts[0].y + dy / 3;
    const cp2x = pts[0].x + (2 * dx) / 3;
    const cp2y = pts[0].y + (2 * dy) / 3;
    return `M${pts[0].x},${pts[0].y} C${cp1x},${cp1y} ${cp2x},${cp2y} ${pts[1].x},${pts[1].y}`;
  }

  const tangents = computeMonotoneTangents(pts);
  let path = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const dx = p1.x - p0.x;
    const cp1x = p0.x + dx / 3;
    const cp1y = p0.y + tangents[i] * (dx / 3);
    const cp2x = p1.x - dx / 3;
    const cp2y = p1.y - tangents[i + 1] * (dx / 3);
    path += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p1.x},${p1.y}`;
  }
  return path;
}

/**
 * Compute monotone tangent slopes for cubic Hermite interpolation (Fritsch-Carlson).
 */
export function computeMonotoneTangents(pts: Array<{ x: number; y: number }>): number[] {
  const n = pts.length;
  const tangents: number[] = new Array(n);
  const delta: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    delta.push(dx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx);
  }

  tangents[0] = delta[0];
  tangents[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    tangents[i] = (delta[i - 1] + delta[i]) / 2;
  }

  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const alpha = tangents[i] / delta[i];
      const beta = tangents[i + 1] / delta[i];
      const s = alpha * alpha + beta * beta;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        tangents[i] = t * alpha * delta[i];
        tangents[i + 1] = t * beta * delta[i];
      }
    }
  }

  return tangents;
}

/**
 * Build a stepped path using only H (horizontal) and V (vertical) commands.
 */
export function buildSteppedPath(pts: Array<{ x: number; y: number }>, mode: string): string {
  let path = `M${pts[0].x},${pts[0].y}`;

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];

    if (mode === 'step-after') {
      path += ` H${curr.x} V${curr.y}`;
    } else if (mode === 'step-before') {
      path += ` V${curr.y} H${curr.x}`;
    } else {
      const midX = (prev.x + curr.x) / 2;
      path += ` H${midX} V${curr.y} H${curr.x}`;
    }
  }

  return path;
}
