/**
 * Rectangle mark - for bars, heatmap cells, backgrounds.
 *
 * Pure functions, no side effects outside canvas drawing.
 */

import type { MarkStyle, RectMark } from '../types';

/**
 * Apply common style properties to canvas context.
 */
export function applyStyle(ctx: CanvasRenderingContext2D, style: MarkStyle): void {
  if (style.fill) {
    ctx.fillStyle = style.fill;
  }
  if (style.stroke) {
    ctx.strokeStyle = style.stroke;
  }
  if (style.strokeWidth !== undefined) {
    ctx.lineWidth = style.strokeWidth;
  }
  if (style.strokeDash !== undefined) {
    ctx.setLineDash(style.strokeDash);
  }
  if (style.opacity !== undefined) {
    ctx.globalAlpha = style.opacity;
  }
}

/**
 * Draw a rounded rectangle path.
 */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  // Clamp radius to half the smaller dimension
  const r = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Create a rectangle mark.
 *
 * @param props - Rectangle properties (excluding type)
 * @returns Complete RectMark
 */
export function createRect(props: Omit<RectMark, 'type'>): RectMark {
  return { type: 'rect', ...props };
}

/**
 * Render a rectangle mark to canvas.
 *
 * @param ctx - Canvas 2D rendering context
 * @param mark - Rectangle mark to render
 */
export function renderRect(ctx: CanvasRenderingContext2D, mark: RectMark): void {
  ctx.save();
  applyStyle(ctx, mark.style);

  const hasCornerRadius = mark.style.cornerRadius !== undefined && mark.style.cornerRadius > 0;

  if (hasCornerRadius) {
    roundRect(ctx, mark.x, mark.y, mark.width, mark.height, mark.style.cornerRadius!);
    if (mark.style.fill) {
      ctx.fill();
    }
    if (mark.style.stroke) {
      ctx.stroke();
    }
  } else {
    if (mark.style.fill) {
      ctx.fillRect(mark.x, mark.y, mark.width, mark.height);
    }
    if (mark.style.stroke) {
      ctx.strokeRect(mark.x, mark.y, mark.width, mark.height);
    }
  }

  ctx.restore();
}

/**
 * Check if a point is inside a rectangle mark.
 *
 * @param mark - Rectangle mark
 * @param px - Point x coordinate
 * @param py - Point y coordinate
 * @returns True if point is inside the rectangle
 */
export function hitTestRect(mark: RectMark, px: number, py: number): boolean {
  return px >= mark.x && px <= mark.x + mark.width && py >= mark.y && py <= mark.y + mark.height;
}
