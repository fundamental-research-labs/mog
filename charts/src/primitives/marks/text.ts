/**
 * Text mark - for labels, titles, annotations.
 *
 * Pure functions, no side effects outside canvas drawing.
 */

import type { TextAlign, TextBaseline, TextMark } from '../types';
import { applyStyle } from './rect';

/**
 * Create a text mark.
 *
 * @param props - Text properties (excluding type)
 * @returns Complete TextMark
 */
export function createText(props: Omit<TextMark, 'type'>): TextMark {
  return { type: 'text', ...props };
}

/**
 * Build font string for canvas context.
 */
function buildFontString(mark: TextMark): string {
  const weight = mark.fontWeight ?? 'normal';
  return `${weight} ${mark.fontSize}px ${mark.fontFamily}`;
}

/**
 * Render a text mark to canvas.
 *
 * @param ctx - Canvas 2D rendering context
 * @param mark - Text mark to render
 */
export function renderText(ctx: CanvasRenderingContext2D, mark: TextMark): void {
  ctx.save();
  applyStyle(ctx, mark.style);

  ctx.font = buildFontString(mark);
  ctx.textAlign = mark.textAlign;
  ctx.textBaseline = mark.textBaseline;

  // Handle rotation
  if (mark.rotation) {
    ctx.translate(mark.x, mark.y);
    ctx.rotate(mark.rotation);
    if (mark.style.fill) {
      ctx.fillText(mark.text, 0, 0);
    }
    if (mark.style.stroke) {
      ctx.strokeText(mark.text, 0, 0);
    }
  } else {
    if (mark.style.fill) {
      ctx.fillText(mark.text, mark.x, mark.y);
    }
    if (mark.style.stroke) {
      ctx.strokeText(mark.text, mark.x, mark.y);
    }
  }

  ctx.restore();
}

/**
 * Measure the width of text as it would be rendered.
 *
 * @param ctx - Canvas 2D rendering context
 * @param mark - Text mark to measure
 * @returns Width in pixels
 */
export function measureTextWidth(ctx: CanvasRenderingContext2D, mark: TextMark): number {
  ctx.save();
  ctx.font = buildFontString(mark);
  const metrics = ctx.measureText(mark.text);
  ctx.restore();
  return metrics.width;
}

/**
 * Get the bounding box of a text mark.
 *
 * @param ctx - Canvas 2D rendering context
 * @param mark - Text mark
 * @returns Bounding box { x, y, width, height }
 */
export function getTextBounds(
  ctx: CanvasRenderingContext2D,
  mark: TextMark,
): { x: number; y: number; width: number; height: number } {
  ctx.save();
  ctx.font = buildFontString(mark);
  const metrics = ctx.measureText(mark.text);
  ctx.restore();

  const width = metrics.width;
  // Approximate height from font size (actual depends on font metrics)
  const height = mark.fontSize;

  // Calculate x offset based on textAlign
  let x = mark.x;
  if (mark.textAlign === 'center') {
    x -= width / 2;
  } else if (mark.textAlign === 'right') {
    x -= width;
  }

  // Calculate y offset based on textBaseline
  let y = mark.y;
  if (mark.textBaseline === 'top') {
    // y is at top, no adjustment
  } else if (mark.textBaseline === 'middle') {
    y -= height / 2;
  } else if (mark.textBaseline === 'bottom') {
    y -= height;
  }

  return { x, y, width, height };
}

/**
 * Check if a point is inside a text mark's bounding box.
 *
 * @param ctx - Canvas 2D rendering context
 * @param mark - Text mark
 * @param px - Point x coordinate
 * @param py - Point y coordinate
 * @returns True if point is inside the text bounds
 */
export function hitTestText(
  ctx: CanvasRenderingContext2D,
  mark: TextMark,
  px: number,
  py: number,
): boolean {
  const bounds = getTextBounds(ctx, mark);
  return (
    px >= bounds.x &&
    px <= bounds.x + bounds.width &&
    py >= bounds.y &&
    py <= bounds.y + bounds.height
  );
}

/**
 * Create default text mark options.
 */
export function defaultTextOptions(): {
  fontSize: number;
  fontFamily: string;
  textAlign: TextAlign;
  textBaseline: TextBaseline;
} {
  return {
    fontSize: 12,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    textAlign: 'left',
    textBaseline: 'top',
  };
}

/**
 * Create a title text mark.
 *
 * @param text - Title text
 * @param x - X coordinate (usually center of chart)
 * @param y - Y coordinate (usually top of chart)
 * @returns TextMark configured as a title
 */
export function createTitle(text: string, x: number, y: number): TextMark {
  return createText({
    x,
    y,
    text,
    fontSize: 16,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontWeight: 'bold',
    textAlign: 'center',
    textBaseline: 'top',
    style: {
      fill: '#333333',
    },
  });
}

/**
 * Create an axis label text mark.
 *
 * @param text - Label text
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param rotation - Optional rotation in radians
 * @returns TextMark configured as an axis label
 */
export function createAxisLabel(text: string, x: number, y: number, rotation?: number): TextMark {
  return createText({
    x,
    y,
    text,
    fontSize: 11,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    textAlign: 'center',
    textBaseline: 'top',
    rotation,
    style: {
      fill: '#666666',
    },
  });
}

/**
 * Truncate text to fit within a given width, adding ellipsis if needed.
 *
 * @param ctx - Canvas 2D rendering context
 * @param text - Text to truncate
 * @param maxWidth - Maximum width in pixels
 * @param font - Font string
 * @returns Truncated text with ellipsis if needed
 */
export function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string,
): string {
  ctx.save();
  ctx.font = font;

  if (ctx.measureText(text).width <= maxWidth) {
    ctx.restore();
    return text;
  }

  const ellipsis = '...';
  const ellipsisWidth = ctx.measureText(ellipsis).width;

  if (ellipsisWidth >= maxWidth) {
    ctx.restore();
    return ellipsis;
  }

  let low = 0;
  let high = text.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const truncated = text.slice(0, mid);
    const width = ctx.measureText(truncated).width + ellipsisWidth;

    if (width <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  ctx.restore();
  return text.slice(0, low) + ellipsis;
}
