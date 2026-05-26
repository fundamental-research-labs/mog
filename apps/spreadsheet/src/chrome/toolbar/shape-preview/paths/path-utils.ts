/**
 * Path Utilities
 *
 * Pure utility functions for drawing common shape primitives.
 * These are used across multiple shape category modules.
 */

/**
 * Draw a regular polygon (pentagon, hexagon, octagon, etc.).
 */
export function drawRegularPolygon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  sides: number,
): void {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const angleStep = (Math.PI * 2) / sides;
  const startAngle = -Math.PI / 2; // Start at top

  ctx.moveTo(cx + radiusX * Math.cos(startAngle), cy + radiusY * Math.sin(startAngle));

  for (let i = 1; i <= sides; i++) {
    const angle = startAngle + angleStep * i;
    ctx.lineTo(cx + radiusX * Math.cos(angle), cy + radiusY * Math.sin(angle));
  }
  ctx.closePath();
}

/**
 * Draw a star with specified points.
 */
export function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  points: number,
): void {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const outerRadiusX = width / 2;
  const outerRadiusY = height / 2;
  const innerRadiusX = outerRadiusX * 0.4;
  const innerRadiusY = outerRadiusY * 0.4;
  const angleStep = Math.PI / points;
  const startAngle = -Math.PI / 2;

  for (let i = 0; i < points * 2; i++) {
    const angle = startAngle + angleStep * i;
    const radiusX = i % 2 === 0 ? outerRadiusX : innerRadiusX;
    const radiusY = i % 2 === 0 ? outerRadiusY : innerRadiusY;
    const px = cx + radiusX * Math.cos(angle);
    const py = cy + radiusY * Math.sin(angle);

    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}
