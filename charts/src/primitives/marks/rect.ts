/**
 * Rectangle mark - for bars, heatmap cells, backgrounds.
 *
 * Pure functions, no side effects outside canvas drawing.
 */

import type { MarkStyle, PaintSpec, RectMark, ShadowSpec } from '../types';

export interface PaintBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function withOpacity(color: string, opacity: number | undefined): string {
  if (opacity === undefined || opacity >= 1) return color;
  const normalized = color.startsWith('#') ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return color;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(opacity)})`;
}

function renderableSolid(color: string | undefined, opacity: number | undefined): string | null {
  return color ? withOpacity(color, opacity) : null;
}

function paintToCanvasStyle(
  ctx: CanvasRenderingContext2D,
  paint: PaintSpec | undefined,
  bounds: PaintBounds | undefined,
): string | CanvasGradient | CanvasPattern | null {
  if (!paint || paint.type === 'none') return null;
  if (paint.type === 'solid') return renderableSolid(paint.color, paint.opacity);
  if (paint.type === 'groupInherited') return paintToCanvasStyle(ctx, paint.fallback, bounds);
  if (paint.type === 'pattern') {
    return renderableSolid(paint.foreground ?? paint.background, paint.opacity);
  }
  if (paint.type === 'image') {
    return null;
  }

  const box = bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  if (paint.type === 'radialGradient' || paint.type === 'rectangularGradient') {
    const cx = box.x + box.width * (paint.type === 'radialGradient' ? (paint.centerX ?? 0.5) : 0.5);
    const cy =
      box.y + box.height * (paint.type === 'radialGradient' ? (paint.centerY ?? 0.5) : 0.5);
    const radius =
      paint.type === 'radialGradient'
        ? (paint.radius ?? Math.max(box.width, box.height) / 2)
        : Math.max(box.width, box.height) / 2;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, radius));
    for (const stop of paint.stops) {
      gradient.addColorStop(clamp01(stop.offset), withOpacity(stop.color, stop.opacity));
    }
    return gradient;
  }

  const angle = ((paint.angle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(angle) * box.width;
  const dy = Math.sin(angle) * box.height;
  const x0 = box.x + box.width / 2 - dx / 2;
  const y0 = box.y + box.height / 2 - dy / 2;
  const x1 = box.x + box.width / 2 + dx / 2;
  const y1 = box.y + box.height / 2 + dy / 2;
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const stop of paint.stops) {
    gradient.addColorStop(clamp01(stop.offset), withOpacity(stop.color, stop.opacity));
  }
  return gradient;
}

function applyShadow(ctx: CanvasRenderingContext2D, shadow: ShadowSpec | undefined): void {
  if (!shadow) return;
  ctx.shadowColor = withOpacity(shadow.color, shadow.opacity);
  ctx.shadowBlur = shadow.blur ?? 0;
  ctx.shadowOffsetX = shadow.offsetX ?? 0;
  ctx.shadowOffsetY = shadow.offsetY ?? 0;
}

export function hasRenderableFill(style: MarkStyle): boolean {
  if (style.fillPaint?.type === 'none') return false;
  return Boolean(style.fillPaint ?? style.fill);
}

export function hasRenderableStroke(style: MarkStyle): boolean {
  const paint = style.line?.paint ?? style.strokePaint;
  if (paint?.type === 'none') return false;
  return Boolean(paint ?? style.stroke);
}

/**
 * Apply common style properties to canvas context.
 */
export function applyStyle(
  ctx: CanvasRenderingContext2D,
  style: MarkStyle,
  bounds?: PaintBounds,
): void {
  const fill = paintToCanvasStyle(ctx, style.fillPaint, bounds) ?? style.fill;
  if (fill) {
    ctx.fillStyle = fill;
  }
  const stroke = paintToCanvasStyle(ctx, style.line?.paint ?? style.strokePaint, bounds) ?? style.stroke;
  if (stroke) {
    ctx.strokeStyle = stroke;
  }
  const strokeWidth = style.line?.width ?? style.strokeWidth;
  if (strokeWidth !== undefined) {
    ctx.lineWidth = strokeWidth;
  }
  const strokeDash = style.line?.dash ?? style.strokeDash;
  if (strokeDash !== undefined) {
    ctx.setLineDash(strokeDash);
  }
  if (style.line?.cap) {
    ctx.lineCap = style.line.cap;
  }
  if (style.line?.join) {
    ctx.lineJoin = style.line.join;
  }
  if (style.line?.miterLimit !== undefined) {
    ctx.miterLimit = style.line.miterLimit;
  }
  if (style.opacity !== undefined) {
    ctx.globalAlpha = style.opacity;
  }
  applyShadow(ctx, style.shadow ?? style.effects?.outerShadow);
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
  applyStyle(ctx, mark.style, mark);

  const hasCornerRadius = mark.style.cornerRadius !== undefined && mark.style.cornerRadius > 0;

  if (hasCornerRadius) {
    roundRect(ctx, mark.x, mark.y, mark.width, mark.height, mark.style.cornerRadius!);
    if (hasRenderableFill(mark.style)) {
      ctx.fill();
    }
    if (hasRenderableStroke(mark.style)) {
      ctx.stroke();
    }
  } else {
    if (hasRenderableFill(mark.style)) {
      ctx.fillRect(mark.x, mark.y, mark.width, mark.height);
    }
    if (hasRenderableStroke(mark.style)) {
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
