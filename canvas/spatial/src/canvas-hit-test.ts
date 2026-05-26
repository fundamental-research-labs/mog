/**
 * Safe isPointInPath that resets transform to avoid DPR scaling issues.
 * Consolidates 4 duplicate implementations across the codebase.
 */
export function testPointInPath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  path: Path2D,
  x: number,
  y: number,
): boolean {
  ctx.save();
  ctx.resetTransform();
  const hit = ctx.isPointInPath(path, x, y);
  ctx.restore();
  return hit;
}

/**
 * Safe isPointInStroke that resets transform to avoid DPR scaling issues.
 */
export function testPointInStroke(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  path: Path2D,
  x: number,
  y: number,
): boolean {
  ctx.save();
  ctx.resetTransform();
  const hit = ctx.isPointInStroke(path, x, y);
  ctx.restore();
  return hit;
}
