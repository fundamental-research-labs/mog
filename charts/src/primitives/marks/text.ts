/**
 * Text mark - for labels, titles, annotations.
 *
 * Pure functions, no side effects outside canvas drawing.
 */

import type { TextAlign, TextBaseline, TextMark, TextRunSpec } from '../types';
import { buildCanvasFontString } from '../font';
import { applyStyle, hasRenderableFill, hasRenderableStroke } from './rect';

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
  return buildCanvasFontString(mark.fontWeight, mark.fontSize, mark.fontFamily, mark.fontStyle);
}

function runFontString(mark: TextMark, run: TextRunSpec): string {
  return buildCanvasFontString(
    run.fontWeight ?? mark.fontWeight,
    run.fontSize ?? mark.fontSize,
    run.fontFamily ?? mark.fontFamily,
    run.fontStyle ?? mark.fontStyle,
  );
}

function decorationY(mark: TextMark, kind: 'underline' | 'strikethrough'): number {
  switch (mark.textBaseline) {
    case 'middle':
      return kind === 'underline' ? mark.fontSize * 0.38 : 0;
    case 'bottom':
      return kind === 'underline' ? -mark.fontSize * 0.1 : -mark.fontSize * 0.45;
    case 'top':
    default:
      return kind === 'underline' ? mark.fontSize * 0.9 : mark.fontSize * 0.55;
  }
}

function drawDecoration(
  ctx: CanvasRenderingContext2D,
  mark: TextMark,
  x: number,
  width: number,
  kind: 'underline' | 'strikethrough',
): void {
  const y = decorationY(mark, kind);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
}

function measureRichText(ctx: CanvasRenderingContext2D, mark: TextMark): number {
  let width = 0;
  for (const run of mark.richText ?? []) {
    ctx.font = runFontString(mark, run);
    width += ctx.measureText(run.text).width;
  }
  return width;
}

function richTextStartX(totalWidth: number, align: TextAlign): number {
  if (align === 'center') return -totalWidth / 2;
  if (align === 'right') return -totalWidth;
  return 0;
}

function renderTextAtOrigin(ctx: CanvasRenderingContext2D, mark: TextMark): void {
  if (mark.richText && mark.richText.length > 0) {
    const totalWidth = measureRichText(ctx, mark);
    let cursor = richTextStartX(totalWidth, mark.textAlign);
    ctx.textAlign = 'left';
    for (const run of mark.richText) {
      ctx.font = runFontString(mark, run);
      const width = ctx.measureText(run.text).width;
      applyStyle(ctx, {
        ...mark.style,
        ...(run.fill ? { fillPaint: run.fill } : {}),
        ...(run.stroke ? { strokePaint: run.stroke } : {}),
      });
      if (hasRenderableFill({ ...mark.style, ...(run.fill ? { fillPaint: run.fill } : {}) })) {
        ctx.fillText(run.text, cursor, 0);
      }
      if (
        hasRenderableStroke({ ...mark.style, ...(run.stroke ? { strokePaint: run.stroke } : {}) })
      ) {
        ctx.strokeText(run.text, cursor, 0);
      }
      if (run.underline ?? mark.underline) drawDecoration(ctx, mark, cursor, width, 'underline');
      if (run.strikethrough ?? mark.strikethrough) {
        drawDecoration(ctx, mark, cursor, width, 'strikethrough');
      }
      cursor += width;
    }
    return;
  }

  const lines = wrappedPlainTextLines(ctx, mark);
  if (lines.length > 1 || mark.maxWidth !== undefined) {
    renderPlainTextLinesAtOrigin(ctx, mark, lines);
    return;
  }

  if (hasRenderableFill(mark.style)) {
    ctx.fillText(mark.text, 0, 0);
  }
  if (hasRenderableStroke(mark.style)) {
    ctx.strokeText(mark.text, 0, 0);
  }
  const width = ctx.measureText(mark.text).width;
  const x = richTextStartX(width, mark.textAlign);
  if (mark.underline) drawDecoration(ctx, mark, x, width, 'underline');
  if (mark.strikethrough) drawDecoration(ctx, mark, x, width, 'strikethrough');
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
    renderTextAtOrigin(ctx, mark);
  } else if (
    mark.richText?.length ||
    mark.underline ||
    mark.strikethrough ||
    mark.maxWidth !== undefined
  ) {
    ctx.translate(mark.x, mark.y);
    renderTextAtOrigin(ctx, mark);
  } else {
    if (hasRenderableFill(mark.style)) {
      ctx.fillText(mark.text, mark.x, mark.y);
    }
    if (hasRenderableStroke(mark.style)) {
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
  const width = mark.richText?.length
    ? measureRichText(ctx, mark)
    : (() => {
        ctx.font = buildFontString(mark);
        return maxPlainTextLineWidth(ctx, mark, wrappedPlainTextLines(ctx, mark));
      })();
  ctx.restore();
  return width;
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
  const lines = mark.richText?.length ? [mark.text] : wrappedPlainTextLines(ctx, mark);
  const width = mark.richText?.length
    ? measureRichText(ctx, mark)
    : maxPlainTextLineWidth(ctx, mark, lines);
  ctx.restore();

  // Approximate height from font size (actual depends on font metrics)
  const height =
    lines.length > 1
      ? mark.fontSize + (lines.length - 1) * effectiveLineHeight(mark)
      : mark.fontSize;

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

function renderPlainTextLinesAtOrigin(
  ctx: CanvasRenderingContext2D,
  mark: TextMark,
  lines: string[],
): void {
  const lineHeight = effectiveLineHeight(mark);
  const startY = firstLineY(mark, lines.length, lineHeight);
  for (let index = 0; index < lines.length; index += 1) {
    const y = startY + index * lineHeight;
    if (hasRenderableFill(mark.style)) {
      ctx.fillText(lines[index], 0, y);
    }
    if (hasRenderableStroke(mark.style)) {
      ctx.strokeText(lines[index], 0, y);
    }
  }
}

function wrappedPlainTextLines(ctx: CanvasRenderingContext2D, mark: TextMark): string[] {
  const maxWidth =
    typeof mark.maxWidth === 'number' && Number.isFinite(mark.maxWidth) && mark.maxWidth > 0
      ? mark.maxWidth
      : undefined;
  if (maxWidth === undefined) return mark.text.split(/\r?\n/);

  const lines: string[] = [];
  for (const paragraph of mark.text.split(/\r?\n/)) {
    lines.push(...wrapParagraph(ctx, paragraph, maxWidth));
  }
  return lines.length > 0 ? lines : [''];
}

function wrapParagraph(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
    } else {
      const broken = breakLongWord(ctx, word, maxWidth);
      lines.push(...broken.slice(0, -1));
      line = broken[broken.length - 1] ?? '';
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function breakLongWord(ctx: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const char of word) {
    const candidate = line + char;
    if (!line || ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = char;
  }
  if (line) lines.push(line);
  return lines;
}

function maxPlainTextLineWidth(
  ctx: CanvasRenderingContext2D,
  mark: TextMark,
  lines: readonly string[],
): number {
  const measured = lines.map((line) => ctx.measureText(line).width);
  const width = Math.max(0, ...measured);
  return mark.maxWidth !== undefined ? Math.min(width, mark.maxWidth) : width;
}

function effectiveLineHeight(mark: TextMark): number {
  return typeof mark.lineHeight === 'number' &&
    Number.isFinite(mark.lineHeight) &&
    mark.lineHeight > 0
    ? mark.lineHeight
    : mark.fontSize * 1.2;
}

function firstLineY(mark: TextMark, lineCount: number, lineHeight: number): number {
  const blockAdvance = Math.max(0, lineCount - 1) * lineHeight;
  if (mark.textBaseline === 'middle') return -blockAdvance / 2;
  if (mark.textBaseline === 'bottom') return -blockAdvance;
  return 0;
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
