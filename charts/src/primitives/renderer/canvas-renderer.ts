/**
 * Canvas Renderer - Main Canvas2D rendering implementation
 *
 * Handles rendering marks to a Canvas2D context with support for:
 * - Retina/HiDPI display scaling
 * - Proper canvas sizing
 * - Style-based batching: marks are grouped by visual style (fill, stroke,
 *   strokeWidth, opacity) and rendered in batches with a single
 *   save()/restore() cycle per unique style. This reduces context state
 *   changes from O(n) to O(unique_styles).
 *
 * No framework dependencies - pure Canvas2D operations.
 */

import { renderMark } from '../marks';
import { buildCanvasFontString } from '../font';
import type { PathCommand } from '../marks/path';
import { applyPathCommands, parsePath } from '../marks/path';
import { applyStyle, hasRenderableFill, hasRenderableStroke, roundRect } from '../marks/rect';
import { drawSymbolShape } from '../marks/symbol';
import type {
  AnyMark,
  ArcMark,
  MarkClip,
  PaintSpec,
  PathMark,
  RectMark,
  SymbolMark,
  TextMark,
} from '../types';

// =============================================================================
// Renderer Interface
// =============================================================================

/**
 * Renderer interface - abstracts the rendering backend.
 */
export interface Renderer {
  /** Render an array of marks */
  render(marks: AnyMark[]): void;
  /** Clear the canvas */
  clear(): void;
  /** Resize the canvas to new dimensions */
  resize(width: number, height: number): void;
  /** Clean up resources */
  destroy(): void;
  /** Get the canvas element */
  getCanvas(): HTMLCanvasElement;
  /** Get current width (logical pixels) */
  getWidth(): number;
  /** Get current height (logical pixels) */
  getHeight(): number;
}

// =============================================================================
// Style Key + Batching Helpers
// =============================================================================

/**
 * Compute a style key for batching. Marks with the same key can share
 * a single save()/applyStyle()/restore() cycle.
 *
 * Text marks always get a unique-ish key because they carry per-mark font
 * and alignment state that must be set individually.
 */
function clipKey(clip: MarkClip | undefined): string {
  return clip ? `|clip:${clip.x},${clip.y},${clip.width},${clip.height}` : '';
}

function styleKey(mark: AnyMark): string {
  const s = mark.style;
  const clip = clipKey(mark.clip);
  const richKey =
    mark.type === 'text'
      ? `|${(mark as TextMark).fontStyle ?? ''}|${(mark as TextMark).underline ?? ''}|${(mark as TextMark).strikethrough ?? ''}|${JSON.stringify((mark as TextMark).richText ?? null)}`
      : '';
  const paintKey = `${JSON.stringify(s.fillPaint ?? null)}|${JSON.stringify(s.strokePaint ?? null)}|${JSON.stringify(s.line ?? null)}|${JSON.stringify(s.shadow ?? s.effects ?? null)}`;
  const paintBoundsKey = needsMarkBoundsForPaint(s.fillPaint) || needsMarkBoundsForPaint(s.strokePaint)
    ? `|bounds:${boundsKey(mark)}`
    : '';
  // Text marks need per-mark font/alignment, so we include those properties
  // in the key to ensure correct rendering within a batch.
  if (mark.type === 'text') {
    const t = mark as TextMark;
    const font = buildCanvasFontString(t.fontWeight, t.fontSize, t.fontFamily, t.fontStyle);
    return `text|${s.fill ?? ''}|${s.stroke ?? ''}|${s.strokeWidth ?? ''}|${s.strokeDash?.join(',') ?? ''}|${s.opacity ?? ''}|${paintKey}|${font}|${t.textAlign}|${t.textBaseline}${richKey}${paintBoundsKey}${clip}`;
  }
  return `${mark.type}|${s.fill ?? ''}|${s.stroke ?? ''}|${s.strokeWidth ?? ''}|${s.strokeDash?.join(',') ?? ''}|${s.opacity ?? ''}|${s.cornerRadius ?? ''}|${paintKey}${paintBoundsKey}${clip}`;
}

function needsMarkBoundsForPaint(paint: PaintSpec | undefined): boolean {
  return Boolean(
    paint &&
      (paint.type === 'linearGradient' ||
        paint.type === 'radialGradient' ||
        paint.type === 'rectangularGradient'),
  );
}

function boundsKey(mark: AnyMark): string {
  if (mark.type === 'rect') return `${mark.x},${mark.y},${mark.width},${mark.height}`;
  if (mark.type === 'arc') {
    const size = mark.outerRadius * 2;
    return `${mark.x - mark.outerRadius},${mark.y - mark.outerRadius},${size},${size}`;
  }
  return `${mark.x},${mark.y},1,1`;
}

function boundsForMark(mark: AnyMark): { x: number; y: number; width: number; height: number } {
  if (mark.type === 'rect') return mark;
  if (mark.type === 'arc') {
    const size = mark.outerRadius * 2;
    return { x: mark.x - mark.outerRadius, y: mark.y - mark.outerRadius, width: size, height: size };
  }
  return { x: mark.x, y: mark.y, width: 1, height: 1 };
}

// =============================================================================
// Batched Mark Drawing (no save/restore per mark)
// =============================================================================

/** Draw a rect mark without save/restore/applyStyle. */
function drawRect(ctx: CanvasRenderingContext2D, mark: RectMark): void {
  const hasCornerRadius = mark.style.cornerRadius !== undefined && mark.style.cornerRadius > 0;
  if (hasCornerRadius) {
    roundRect(ctx, mark.x, mark.y, mark.width, mark.height, mark.style.cornerRadius!);
    if (hasRenderableFill(mark.style)) ctx.fill();
    if (hasRenderableStroke(mark.style)) ctx.stroke();
  } else {
    if (hasRenderableFill(mark.style)) ctx.fillRect(mark.x, mark.y, mark.width, mark.height);
    if (hasRenderableStroke(mark.style)) ctx.strokeRect(mark.x, mark.y, mark.width, mark.height);
  }
}

/** Draw an arc mark without save/restore/applyStyle. */
function drawArc(ctx: CanvasRenderingContext2D, mark: ArcMark): void {
  const canvasStartAngle = mark.startAngle - Math.PI / 2;
  const canvasEndAngle = mark.endAngle - Math.PI / 2;
  ctx.beginPath();
  if (mark.innerRadius > 0) {
    ctx.arc(mark.x, mark.y, mark.outerRadius, canvasStartAngle, canvasEndAngle, false);
    ctx.arc(mark.x, mark.y, mark.innerRadius, canvasEndAngle, canvasStartAngle, true);
    ctx.closePath();
  } else {
    ctx.moveTo(mark.x, mark.y);
    ctx.arc(mark.x, mark.y, mark.outerRadius, canvasStartAngle, canvasEndAngle, false);
    ctx.closePath();
  }
  if (hasRenderableFill(mark.style)) ctx.fill();
  if (hasRenderableStroke(mark.style)) ctx.stroke();
}

/** Draw a path mark without save/restore/applyStyle. */
function drawPath(ctx: CanvasRenderingContext2D, mark: PathMark): void {
  const commands = parsePath(mark.path) as PathCommand[];
  applyPathCommands(ctx, commands, mark.x, mark.y);
  if (hasRenderableFill(mark.style)) ctx.fill();
  if (hasRenderableStroke(mark.style)) ctx.stroke();
}

/** Draw symbol geometry without save/restore/applyStyle. */
function drawSymbol(ctx: CanvasRenderingContext2D, mark: SymbolMark): void {
  drawSymbolShape(ctx, mark.shape, mark.x, mark.y, mark.size);
  if (hasRenderableFill(mark.style)) ctx.fill();
  if (hasRenderableStroke(mark.style)) ctx.stroke();
}

/** Draw a text mark without save/restore/applyStyle (font/align already set by batch). */
function drawText(ctx: CanvasRenderingContext2D, mark: TextMark): void {
  if (mark.richText?.length || mark.underline || mark.strikethrough || mark.rotation) {
    renderMark(ctx, mark);
    return;
  }
  if (mark.rotation) {
    // Rotation requires its own save/restore for the transform
    ctx.save();
    ctx.translate(mark.x, mark.y);
    ctx.rotate(mark.rotation);
    if (hasRenderableFill(mark.style)) ctx.fillText(mark.text, 0, 0);
    if (hasRenderableStroke(mark.style)) ctx.strokeText(mark.text, 0, 0);
    ctx.restore();
  } else {
    if (hasRenderableFill(mark.style)) ctx.fillText(mark.text, mark.x, mark.y);
    if (hasRenderableStroke(mark.style)) ctx.strokeText(mark.text, mark.x, mark.y);
  }
}

/**
 * Draw a single mark without save/restore/applyStyle (used inside a batch).
 * Falls back to the standalone renderMark for safety on unknown types.
 */
function drawMarkBatched(ctx: CanvasRenderingContext2D, mark: AnyMark): void {
  switch (mark.type) {
    case 'rect':
      drawRect(ctx, mark);
      break;
    case 'arc':
      drawArc(ctx, mark);
      break;
    case 'path':
      drawPath(ctx, mark);
      break;
    case 'symbol':
      drawSymbol(ctx, mark);
      break;
    case 'text':
      drawText(ctx, mark);
      break;
    default:
      // Fallback: use the standalone per-mark renderer (includes its own save/restore)
      renderMark(ctx, mark);
      break;
  }
}

/**
 * Apply text-specific context state (font, alignment) for a text-mark batch.
 */
function applyTextState(ctx: CanvasRenderingContext2D, mark: TextMark): void {
  ctx.font = buildCanvasFontString(mark.fontWeight, mark.fontSize, mark.fontFamily, mark.fontStyle);
  ctx.textAlign = mark.textAlign;
  ctx.textBaseline = mark.textBaseline;
}

function applyClip(ctx: CanvasRenderingContext2D, clip: MarkClip): void {
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.width, clip.height);
  ctx.clip();
}

// =============================================================================
// Canvas Renderer Implementation
// =============================================================================

/**
 * Canvas2D renderer with retina display support and style-based batching.
 *
 * Usage:
 * ```ts
 * const canvas = document.createElement('canvas');
 * const renderer = new CanvasRenderer(canvas);
 * renderer.resize(800, 600);
 * renderer.render(marks);
 * ```
 *
 * Performance: marks are grouped by visual style key
 * (fill|stroke|strokeWidth|opacity). All marks sharing the same style are
 * rendered in a single save()/restore() cycle, reducing context state changes
 * from O(n) to O(unique_styles).
 */
export class CanvasRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D | null;
  private width: number = 0;
  private height: number = 0;
  private dpr: number;
  private canvas: HTMLCanvasElement | null;
  private destroyed: boolean = false;

  /**
   * Create a new canvas renderer.
   *
   * @param canvas - The canvas element to render to
   * @param options - Renderer options
   */
  constructor(canvas: HTMLCanvasElement, options: { devicePixelRatio?: number } = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }

    this.canvas = canvas;
    this.ctx = ctx;
    this.dpr =
      options.devicePixelRatio ??
      (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ??
      1;

    // Initialize with canvas's current size if set
    if (canvas.width > 0 && canvas.height > 0) {
      this.width = canvas.width / this.dpr;
      this.height = canvas.height / this.dpr;
    }
  }

  /**
   * Render marks to the canvas using style-based batching.
   *
   * Marks are grouped by their visual style key so that all marks with the
   * same fill/stroke/strokeWidth/opacity share a single save()/restore()
   * cycle. For 10K bars with 5 unique colors this reduces context state
   * changes from 10,000 to 5.
   */
  render(marks: AnyMark[]): void {
    if (this.destroyed || !this.ctx || !this.canvas) return;

    this.clear();

    if (marks.length === 0) return;

    const ctx = this.ctx;

    // --- Build consecutive batches keyed by style ---
    // Only batch marks that are adjacent in the marks array and share the
    // same style key. This preserves z-order (painter's algorithm) so that
    // marks appearing later in the array always render on top of earlier ones,
    // even when non-adjacent marks happen to share the same style.
    const consecutiveBatches: Array<{ key: string; marks: AnyMark[] }> = [];

    for (const mark of marks) {
      const key = styleKey(mark);
      const lastBatch =
        consecutiveBatches.length > 0 ? consecutiveBatches[consecutiveBatches.length - 1] : null;

      if (lastBatch && lastBatch.key === key) {
        // Same style as previous mark -- extend current batch
        lastBatch.marks.push(mark);
      } else {
        // Different style -- start a new batch
        consecutiveBatches.push({ key, marks: [mark] });
      }
    }

    // --- Render each batch ---
    for (const batch of consecutiveBatches) {
      const firstMark = batch.marks[0];

      ctx.save();
      applyStyle(ctx, firstMark.style, boundsForMark(firstMark));
      if (firstMark.clip) {
        applyClip(ctx, firstMark.clip);
      }

      // For text batches, also set font/alignment from the first mark (all
      // marks in the batch share the same font properties because the key
      // includes them).
      if (firstMark.type === 'text') {
        applyTextState(ctx, firstMark as TextMark);
      }

      for (const mark of batch.marks) {
        drawMarkBatched(ctx, mark);
      }

      ctx.restore();
    }
  }

  /**
   * Clear the canvas.
   */
  clear(): void {
    if (this.destroyed || !this.ctx || !this.canvas) return;

    // Reset transform to clear the entire canvas
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Restore scale for retina
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * Resize the canvas to new logical dimensions.
   * Handles device pixel ratio for retina displays.
   *
   * @param width - Logical width in CSS pixels
   * @param height - Logical height in CSS pixels
   */
  resize(width: number, height: number): void {
    if (this.destroyed || !this.ctx || !this.canvas) return;

    this.width = width;
    this.height = height;

    // Set physical size (actual pixels on screen)
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);

    // Set CSS size (logical pixels)
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    // Scale context to handle retina
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * Clean up resources. Nulls out the drawing context and sets a destroyed
   * flag to guard against post-destroy renders. The canvas reference is
   * kept so that callers (e.g. chart-engine) can still access it for DOM
   * cleanup after destruction.
   */
  destroy(): void {
    if (this.destroyed) return;

    // Clear any pending state
    this.clear();

    // Null out the drawing context to release GPU/native resources.
    // The canvas element reference is intentionally kept so getCanvas()
    // remains usable for DOM removal by the owner.
    this.ctx = null;
    this.destroyed = true;
  }

  /**
   * Get the underlying canvas element.
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas!;
  }

  /**
   * Get the rendering context.
   */
  getContext(): CanvasRenderingContext2D {
    return this.ctx!;
  }

  /**
   * Get current logical width.
   */
  getWidth(): number {
    return this.width;
  }

  /**
   * Get current logical height.
   */
  getHeight(): number {
    return this.height;
  }

  /**
   * Get device pixel ratio.
   */
  getDevicePixelRatio(): number {
    return this.dpr;
  }

  /**
   * Update device pixel ratio (e.g., when window moves to different display).
   */
  setDevicePixelRatio(dpr: number): void {
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      // Re-apply sizing
      this.resize(this.width, this.height);
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a canvas renderer with automatic DPR detection.
 */
export function createCanvasRenderer(
  canvas: HTMLCanvasElement,
  options: { devicePixelRatio?: number } = {},
): CanvasRenderer {
  return new CanvasRenderer(canvas, options);
}
