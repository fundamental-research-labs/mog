/**
 * Geometry Utilities for Chart Math
 *
 * Pure functions for path operations, curve generation, and geometric calculations.
 * Used by statistical charts for generating smooth curves and complex shapes.
 */

// =============================================================================
// Types
// =============================================================================

// Point2D and BoundingBox imported from contracts - canonical single source of truth
import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';
export type { BoundingBox, Point2D };

/**
 * A line segment between two points.
 */
export interface LineSegment {
  start: Point2D;
  end: Point2D;
}

/**
 * Cubic bezier curve control points.
 */
export interface CubicBezier {
  p0: Point2D;
  p1: Point2D; // First control point
  p2: Point2D; // Second control point
  p3: Point2D;
}

// =============================================================================
// Basic Point Operations
// =============================================================================

/**
 * Calculate the distance between two points.
 */
export function distance(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate the midpoint between two points.
 */
export function midpoint(p1: Point2D, p2: Point2D): Point2D {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
}

/**
 * Linear interpolation between two points.
 *
 * @param p1 - Start point
 * @param p2 - End point
 * @param t - Interpolation factor [0, 1]
 */
export function lerp(p1: Point2D, p2: Point2D, t: number): Point2D {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  };
}

/**
 * Rotate a point around an origin.
 *
 * @param point - Point to rotate
 * @param origin - Center of rotation
 * @param angle - Rotation angle in radians
 */
export function rotatePoint(point: Point2D, origin: Point2D, angle: number): Point2D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;

  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

/**
 * Scale a point relative to an origin.
 */
export function scalePoint(
  point: Point2D,
  origin: Point2D,
  scaleX: number,
  scaleY: number = scaleX,
): Point2D {
  return {
    x: origin.x + (point.x - origin.x) * scaleX,
    y: origin.y + (point.y - origin.y) * scaleY,
  };
}

/**
 * Translate a point by an offset.
 */
export function translatePoint(point: Point2D, dx: number, dy: number): Point2D {
  return {
    x: point.x + dx,
    y: point.y + dy,
  };
}

// =============================================================================
// Bounding Box Operations
// =============================================================================

/**
 * Calculate the bounding box of a set of points.
 */
export function boundingBox(points: Point2D[]): BoundingBox {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Check if a point is inside a bounding box.
 */
export function pointInBox(point: Point2D, box: BoundingBox): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/**
 * Check if two bounding boxes intersect.
 */
export function boxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Expand a bounding box by a padding amount.
 */
export function expandBox(box: BoundingBox, padding: number): BoundingBox {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + 2 * padding,
    height: box.height + 2 * padding,
  };
}

// =============================================================================
// SVG Path Generation
// =============================================================================

/**
 * Generate an SVG path d string for a line through points.
 *
 * @param points - Array of points
 * @returns SVG path d string (e.g., "M0,0 L10,10 L20,5")
 */
export function linePath(points: Point2D[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;

  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L${points[i].x},${points[i].y}`;
  }
  return d;
}

/**
 * Generate an SVG path for a closed polygon.
 */
export function polygonPath(points: Point2D[]): string {
  if (points.length < 3) return linePath(points);
  return linePath(points) + ' Z';
}

/**
 * Generate an SVG path for a smooth curve through points using Catmull-Rom splines.
 *
 * @param points - Array of points
 * @param tension - Tension parameter (0 = sharp corners, 1 = smooth)
 */
export function smoothCurvePath(points: Point2D[], tension: number = 0.5): string {
  if (points.length < 2) return linePath(points);
  if (points.length === 2) return linePath(points);

  // Convert Catmull-Rom to cubic Bezier control points
  const bezierPoints = catmullRomToBezier(points, tension);

  let d = `M${points[0].x},${points[0].y}`;
  for (const bezier of bezierPoints) {
    d += ` C${bezier.p1.x},${bezier.p1.y} ${bezier.p2.x},${bezier.p2.y} ${bezier.p3.x},${bezier.p3.y}`;
  }
  return d;
}

/**
 * Generate an SVG path for a closed smooth curve.
 */
export function smoothClosedPath(points: Point2D[], tension: number = 0.5): string {
  if (points.length < 3) return polygonPath(points);

  // Add points at beginning and end to close smoothly
  const extendedPoints = [points[points.length - 1], ...points, points[0], points[1]];

  const bezierPoints = catmullRomToBezier(extendedPoints, tension);

  // Start at first point
  let d = `M${points[0].x},${points[0].y}`;

  // Draw bezier curves, skipping first and last (they're for smooth closure)
  for (let i = 1; i < bezierPoints.length - 1; i++) {
    const bezier = bezierPoints[i];
    d += ` C${bezier.p1.x},${bezier.p1.y} ${bezier.p2.x},${bezier.p2.y} ${bezier.p3.x},${bezier.p3.y}`;
  }

  d += ' Z';
  return d;
}

/**
 * Generate an SVG path for an area under a curve.
 *
 * @param points - Array of points for the top edge
 * @param baseline - Y coordinate for the bottom edge
 */
export function areaPath(points: Point2D[], baseline: number): string {
  if (points.length === 0) return '';

  let d = `M${points[0].x},${baseline}`;
  d += ` L${points[0].x},${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    d += ` L${points[i].x},${points[i].y}`;
  }

  d += ` L${points[points.length - 1].x},${baseline}`;
  d += ' Z';

  return d;
}

/**
 * Generate an SVG path for a smooth area.
 */
export function smoothAreaPath(points: Point2D[], baseline: number, tension: number = 0.5): string {
  if (points.length < 2) return areaPath(points, baseline);

  const curvePath = smoothCurvePath(points, tension);

  // Extract the curve part (after the initial M command)
  const curveCommands = curvePath.substring(curvePath.indexOf(' '));

  let d = `M${points[0].x},${baseline}`;
  d += ` L${points[0].x},${points[0].y}`;
  d += curveCommands;
  d += ` L${points[points.length - 1].x},${baseline}`;
  d += ' Z';

  return d;
}

// =============================================================================
// Bezier and Spline Utilities
// =============================================================================

/**
 * Convert Catmull-Rom control points to cubic Bezier control points.
 */
export function catmullRomToBezier(points: Point2D[], tension: number = 0.5): CubicBezier[] {
  if (points.length < 4) return [];

  const beziers: CubicBezier[] = [];
  const alpha = tension;

  for (let i = 0; i < points.length - 3; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const p2 = points[i + 2];
    const p3 = points[i + 3];

    // Calculate control points for cubic Bezier
    const cp1: Point2D = {
      x: p1.x + ((p2.x - p0.x) * alpha) / 6,
      y: p1.y + ((p2.y - p0.y) * alpha) / 6,
    };

    const cp2: Point2D = {
      x: p2.x - ((p3.x - p1.x) * alpha) / 6,
      y: p2.y - ((p3.y - p1.y) * alpha) / 6,
    };

    beziers.push({
      p0: p1,
      p1: cp1,
      p2: cp2,
      p3: p2,
    });
  }

  return beziers;
}

/**
 * Evaluate a cubic Bezier curve at parameter t.
 */
export function evaluateBezier(bezier: CubicBezier, t: number): Point2D {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;

  return {
    x: mt3 * bezier.p0.x + 3 * mt2 * t * bezier.p1.x + 3 * mt * t2 * bezier.p2.x + t3 * bezier.p3.x,
    y: mt3 * bezier.p0.y + 3 * mt2 * t * bezier.p1.y + 3 * mt * t2 * bezier.p2.y + t3 * bezier.p3.y,
  };
}

/**
 * Sample points along a Bezier curve.
 */
export function sampleBezier(bezier: CubicBezier, numPoints: number): Point2D[] {
  const points: Point2D[] = [];
  for (let i = 0; i <= numPoints; i++) {
    points.push(evaluateBezier(bezier, i / numPoints));
  }
  return points;
}

// =============================================================================
// Violin Plot Specific Utilities
// =============================================================================

/**
 * Generate a violin shape path from KDE results.
 * Creates a symmetric shape around a center line.
 *
 * @param kdeX - X values from KDE (data values)
 * @param kdeY - Y values from KDE (density values)
 * @param centerX - X coordinate for the violin center
 * @param scaleY - Scale to apply to y positions
 * @param maxWidth - Maximum width of the violin (density will be scaled to this)
 */
export function violinPath(
  kdeX: number[],
  kdeY: number[],
  centerX: number,
  scaleY: (value: number) => number,
  maxWidth: number,
): string {
  if (kdeX.length === 0 || kdeY.length === 0) return '';

  // Normalize density values to maxWidth
  let maxDensity = -Infinity;
  for (const v of kdeY) {
    if (v > maxDensity) maxDensity = v;
  }
  const halfWidth = maxWidth / 2;

  // Generate points for right side (positive density)
  const rightPoints: Point2D[] = [];
  for (let i = 0; i < kdeX.length; i++) {
    const width = (kdeY[i] / maxDensity) * halfWidth;
    rightPoints.push({
      x: centerX + width,
      y: scaleY(kdeX[i]),
    });
  }

  // Generate points for left side (negative density = mirrored)
  const leftPoints: Point2D[] = [];
  for (let i = kdeX.length - 1; i >= 0; i--) {
    const width = (kdeY[i] / maxDensity) * halfWidth;
    leftPoints.push({
      x: centerX - width,
      y: scaleY(kdeX[i]),
    });
  }

  // Combine into closed path
  const allPoints = [...rightPoints, ...leftPoints];
  return smoothClosedPath(allPoints, 0.3);
}

// =============================================================================
// Box Plot Specific Utilities
// =============================================================================

/**
 * Box plot geometry parameters.
 */
export interface BoxPlotGeometry {
  /** Center X position */
  centerX: number;
  /** Box width */
  boxWidth: number;
  /** Y coordinate of Q1 (bottom of box) */
  q1Y: number;
  /** Y coordinate of median (line in box) */
  medianY: number;
  /** Y coordinate of Q3 (top of box) */
  q3Y: number;
  /** Y coordinate of lower whisker end */
  lowerWhiskerY: number;
  /** Y coordinate of upper whisker end */
  upperWhiskerY: number;
  /** Y coordinates of outlier points */
  outlierYs: number[];
}

/**
 * Generate SVG path for a box plot box (Q1 to Q3).
 */
export function boxPlotBoxPath(geom: BoxPlotGeometry): string {
  const left = geom.centerX - geom.boxWidth / 2;
  const right = geom.centerX + geom.boxWidth / 2;
  const top = Math.min(geom.q1Y, geom.q3Y);
  const bottom = Math.max(geom.q1Y, geom.q3Y);

  return `M${left},${top} L${right},${top} L${right},${bottom} L${left},${bottom} Z`;
}

/**
 * Generate SVG path for a box plot median line.
 */
export function boxPlotMedianPath(geom: BoxPlotGeometry): string {
  const left = geom.centerX - geom.boxWidth / 2;
  const right = geom.centerX + geom.boxWidth / 2;

  return `M${left},${geom.medianY} L${right},${geom.medianY}`;
}

/**
 * Generate SVG paths for box plot whiskers.
 * Returns [lowerWhisker, upperWhisker] paths.
 */
export function boxPlotWhiskerPaths(geom: BoxPlotGeometry): [string, string] {
  const whiskerCapWidth = geom.boxWidth * 0.5;
  const left = geom.centerX - whiskerCapWidth / 2;
  const right = geom.centerX + whiskerCapWidth / 2;

  // Lower whisker (from Q1 down to lower whisker end, with cap)
  const lowerWhisker = `M${geom.centerX},${Math.max(geom.q1Y, geom.q3Y)} L${geom.centerX},${geom.lowerWhiskerY} M${left},${geom.lowerWhiskerY} L${right},${geom.lowerWhiskerY}`;

  // Upper whisker (from Q3 up to upper whisker end, with cap)
  const upperWhisker = `M${geom.centerX},${Math.min(geom.q1Y, geom.q3Y)} L${geom.centerX},${geom.upperWhiskerY} M${left},${geom.upperWhiskerY} L${right},${geom.upperWhiskerY}`;

  return [lowerWhisker, upperWhisker];
}

// =============================================================================
// Arc and Circle Utilities
// =============================================================================

/**
 * Generate an SVG arc path.
 *
 * @param cx - Center X
 * @param cy - Center Y
 * @param radius - Arc radius
 * @param startAngle - Start angle in radians
 * @param endAngle - End angle in radians
 * @param counterClockwise - Draw counter-clockwise
 */
export function arcPath(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  counterClockwise: boolean = false,
): string {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);

  // Calculate arc parameters
  let angleDiff = endAngle - startAngle;
  if (counterClockwise) {
    angleDiff = -angleDiff;
  }
  const largeArcFlag = Math.abs(angleDiff) > Math.PI ? 1 : 0;
  const sweepFlag = counterClockwise ? 0 : 1;

  return `M${start.x},${start.y} A${radius},${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x},${end.y}`;
}

/**
 * Generate an SVG path for a pie/doughnut slice.
 *
 * @param cx - Center X
 * @param cy - Center Y
 * @param innerRadius - Inner radius (0 for pie)
 * @param outerRadius - Outer radius
 * @param startAngle - Start angle in radians
 * @param endAngle - End angle in radians
 */
export function slicePath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);

  const angleDiff = endAngle - startAngle;
  const largeArcFlag = angleDiff > Math.PI ? 1 : 0;

  if (innerRadius === 0) {
    // Pie slice (no inner arc)
    return `M${cx},${cy} L${outerStart.x},${outerStart.y} A${outerRadius},${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x},${outerEnd.y} Z`;
  }

  // Doughnut slice
  return `M${outerStart.x},${outerStart.y} A${outerRadius},${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x},${outerEnd.y} L${innerEnd.x},${innerEnd.y} A${innerRadius},${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x},${innerStart.y} Z`;
}

/**
 * Convert polar coordinates to Cartesian.
 */
export function polarToCartesian(cx: number, cy: number, radius: number, angle: number): Point2D {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

/**
 * Convert Cartesian coordinates to polar.
 */
export function cartesianToPolar(
  cx: number,
  cy: number,
  x: number,
  y: number,
): { radius: number; angle: number } {
  const dx = x - cx;
  const dy = y - cy;
  return {
    radius: Math.sqrt(dx * dx + dy * dy),
    angle: Math.atan2(dy, dx),
  };
}

// =============================================================================
// Histogram Bar Generation
// =============================================================================

/**
 * Generate bar rectangles for a histogram.
 */
export interface HistogramBar {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Generate histogram bars from bin data.
 *
 * @param bins - Array of bin objects with x0, x1, count
 * @param scaleX - Function to convert data x to pixel x
 * @param scaleY - Function to convert count to pixel y
 * @param baseline - Y coordinate for baseline (bottom of bars)
 */
export function histogramBars(
  bins: Array<{ x0: number; x1: number; count: number }>,
  scaleX: (value: number) => number,
  scaleY: (value: number) => number,
  baseline: number,
): HistogramBar[] {
  return bins.map((bin) => {
    const x = scaleX(bin.x0);
    const width = scaleX(bin.x1) - scaleX(bin.x0);
    const y = scaleY(bin.count);
    const height = baseline - y;

    return { x, y, width, height };
  });
}

// =============================================================================
// Heatmap Cell Generation
// =============================================================================

/**
 * A heatmap cell.
 */
export interface HeatmapCell {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  row: number;
  col: number;
}

/**
 * Generate heatmap cells from a 2D matrix.
 *
 * @param matrix - 2D array of values (rows x cols)
 * @param cellWidth - Width of each cell
 * @param cellHeight - Height of each cell
 * @param offsetX - X offset for the grid
 * @param offsetY - Y offset for the grid
 */
export function heatmapCells(
  matrix: number[][],
  cellWidth: number,
  cellHeight: number,
  offsetX: number = 0,
  offsetY: number = 0,
): HeatmapCell[] {
  const cells: HeatmapCell[] = [];

  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix[row].length; col++) {
      cells.push({
        x: offsetX + col * cellWidth,
        y: offsetY + row * cellHeight,
        width: cellWidth,
        height: cellHeight,
        value: matrix[row][col],
        row,
        col,
      });
    }
  }

  return cells;
}
