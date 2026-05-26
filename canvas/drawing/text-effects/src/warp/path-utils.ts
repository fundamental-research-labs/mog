/**
 * TextEffect Path Utilities
 *
 * Path generators specific to TextEffect text warp presets.
 * Creates SVG path data strings for arc, sine, circular arc, and bulge shapes.
 * Uses Catmull-Rom to Bezier conversion for smooth curves.
 */

interface Point {
  x: number;
  y: number;
}

/**
 * Create a quadratic bezier arc path.
 *
 * @param width - Arc width
 * @param height - Arc height (controls curvature, negative for up, positive for down)
 * @param direction - 'up' or 'down'
 * @returns SVG path data string
 */
export function createArcPath(width: number, height: number, direction: 'up' | 'down'): string {
  const yOffset = direction === 'up' ? -Math.abs(height) : Math.abs(height);

  // Use quadratic bezier for smooth arc
  // M startX,startY Q controlX,controlY endX,endY
  return `M 0,0 Q ${width / 2},${yOffset} ${width},0`;
}

/**
 * Create a sine wave path.
 *
 * @param width - Total width
 * @param amplitude - Wave height (peak to center)
 * @param frequency - Number of waves
 * @param phase - Phase offset (0-1, where 1 = 2*PI)
 * @returns SVG path data string
 */
export function createSinePath(
  width: number,
  amplitude: number,
  frequency: number,
  phase: number = 0,
): string {
  const points: Point[] = [];
  const steps = Math.max(50, Math.ceil(width / 2));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = t * width;
    const y = amplitude * Math.sin(2 * Math.PI * frequency * t + phase * 2 * Math.PI);
    points.push({ x, y });
  }

  return pointsToSmoothPath(points);
}

/**
 * Create a circular arc path.
 *
 * @param radius - Arc radius
 * @param sweepAngle - Angle swept (in radians)
 * @param startAngle - Starting angle (in radians, 0 = right, PI/2 = up)
 * @returns SVG path data string
 */
export function createCircularArcPath(
  radius: number,
  sweepAngle: number,
  startAngle: number = Math.PI / 2 - sweepAngle / 2,
): string {
  const endAngle = startAngle + sweepAngle;

  const startX = radius * Math.cos(startAngle);
  const startY = -radius * Math.sin(startAngle);
  const endX = radius * Math.cos(endAngle);
  const endY = -radius * Math.sin(endAngle);

  const largeArc = sweepAngle > Math.PI ? 1 : 0;
  const sweep = 1; // Clockwise

  return `M ${startX},${startY} A ${radius},${radius} 0 ${largeArc},${sweep} ${endX},${endY}`;
}

/**
 * Create a bulge/pinch path (for inflate/deflate effects).
 *
 * @param width - Path width
 * @param amount - Bulge amount (positive = bulge down, negative = bulge up)
 * @param position - Where bulge is centered ('center', 'left', 'right')
 * @returns SVG path data string
 */
export function createBulgePath(
  width: number,
  amount: number,
  position: 'center' | 'left' | 'right' = 'center',
): string {
  const points: Point[] = [];
  const steps = 50;

  // Determine center position for the bulge
  let centerT: number;
  switch (position) {
    case 'left':
      centerT = 0.25;
      break;
    case 'right':
      centerT = 0.75;
      break;
    default:
      centerT = 0.5;
  }

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = t * width;

    // Gaussian-like bulge centered at position
    const distance = Math.abs(t - centerT);
    const bulge = amount * Math.exp(-distance * distance * 10);

    points.push({ x, y: bulge });
  }

  return pointsToSmoothPath(points);
}

/**
 * Convert points to a smooth SVG path using cubic bezier curves.
 *
 * Uses Catmull-Rom spline interpolation converted to Bezier curves
 * for smooth, natural-looking curves.
 *
 * @param points - Array of points to connect
 * @returns SVG path data string
 */
export function pointsToSmoothPath(points: Point[]): string {
  if (points.length < 2) {
    if (points.length === 1) {
      return `M ${points[0].x},${points[0].y}`;
    }
    return '';
  }

  let path = `M ${points[0].x},${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    // Get the four points needed for Catmull-Rom
    const p0 = points[Math.max(0, i - 2)];
    const p1 = points[i - 1];
    const p2 = points[i];
    const p3 = points[Math.min(points.length - 1, i + 1)];

    // Convert Catmull-Rom to Bezier control points
    // Formula: cp1 = p1 + (p2 - p0) / 6
    //          cp2 = p2 - (p3 - p1) / 6
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }

  return path;
}
