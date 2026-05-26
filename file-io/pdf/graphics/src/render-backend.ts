/**
 * RenderBackend — the central abstraction for all rendering in pdf-graphics.
 *
 * ALL cell renderers, chart renderers, and drawing renderers code against
 * this interface, NOT PdfCanvas directly. This makes the system
 * backend-swappable: a future SVG or Canvas2D backend can implement
 * RenderBackend without touching any layout or rendering code.
 *
 * The interface is format-agnostic — it contains no PDF-specific concepts.
 */

import type { AffineTransform, Path } from '@mog/geometry';
import type {
  FontHandle,
  ImageFormat,
  TextBlockOptions,
  TextMeasurement,
  TextOptions,
  TextRun,
} from './types';

export interface RenderBackend {
  // ── Page Lifecycle ──────────────────────────────────────────────────────

  /** Begin a new page with the given dimensions in points. */
  beginPage(width: number, height: number): void;

  /** End the current page, flushing any buffered content. */
  endPage(): Promise<void>;

  // ── Graphics State ─────────────────────────────────────────────────────

  /** Save the current graphics state (push onto stack). */
  save(): void;

  /** Restore the previously saved graphics state (pop from stack). */
  restore(): void;

  // ── Transforms ─────────────────────────────────────────────────────────

  /** Apply a translation to the current transform. */
  translate(tx: number, ty: number): void;

  /** Apply a rotation (in radians) to the current transform. */
  rotate(angleRad: number): void;

  /** Apply a scale to the current transform. */
  scale(sx: number, sy: number): void;

  /**
   * Apply an arbitrary affine transform to the current transform.
   * Matrix layout: | a c tx |
   *                | b d ty |
   *                | 0 0 1  |
   */
  transform(a: number, b: number, c: number, d: number, tx: number, ty: number): void;

  /**
   * Replace the current transform with the given AffineTransform.
   * Uses @mog/geometry AffineTransform type.
   */
  setTransform(transform: AffineTransform): void;

  // ── Path Construction ──────────────────────────────────────────────────

  /** Begin a new path, discarding any existing path. */
  beginPath(): void;

  /** Move the pen to (x, y) without drawing. */
  moveTo(x: number, y: number): void;

  /** Draw a straight line from the current point to (x, y). */
  lineTo(x: number, y: number): void;

  /** Draw a cubic Bezier curve. */
  curveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;

  /**
   * Draw a quadratic Bezier curve.
   * Implementations that only support cubic curves (e.g., PDF) should
   * auto-convert using quadraticToCubic from @mog/geometry.
   */
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;

  /** Add a rectangle to the current path. */
  rect(x: number, y: number, w: number, h: number): void;

  /** Close the current subpath. */
  closePath(): void;

  /** Intersect the current clipping region with the current path. */
  clip(): void;

  /**
   * Replay a @mog/geometry Path by walking its PathSegment[].
   * Follows the same pattern as drawing-engine's replayPathToCanvas.
   */
  replayPath(path: Path): void;

  // ── Fill & Stroke ──────────────────────────────────────────────────────

  /** Set the fill color (r, g, b each 0-1). */
  setFillColor(r: number, g: number, b: number): void;

  /** Set the stroke color (r, g, b each 0-1). */
  setStrokeColor(r: number, g: number, b: number): void;

  /** Set the fill opacity (0.0 - 1.0). */
  setFillAlpha(alpha: number): void;

  /** Set the stroke opacity (0.0 - 1.0). */
  setStrokeAlpha(alpha: number): void;

  /** Set the line width in points. */
  setLineWidth(width: number): void;

  /** Set the line dash pattern and phase offset. */
  setLineDash(segments: number[], phase: number): void;

  /** Set the line cap style. */
  setLineCap(cap: 'butt' | 'round' | 'square'): void;

  /** Set the line join style. */
  setLineJoin(join: 'miter' | 'round' | 'bevel'): void;

  /** Fill the current path using the current fill color. */
  fill(): void;

  /** Stroke the current path using the current stroke color. */
  stroke(): void;

  /** Fill and then stroke the current path. */
  fillAndStroke(): void;

  // ── Text ───────────────────────────────────────────────────────────────

  /** Draw a single string at (x, y) with the given options. */
  drawText(text: string, x: number, y: number, options: TextOptions): void;

  /** Draw rich text (multiple runs with different formatting). */
  drawTextRuns(runs: TextRun[], x: number, y: number, options: TextBlockOptions): void;

  /** Measure the width of a single string in the given font at the given size. */
  measureText(text: string, font: FontHandle, size: number): number;

  /** Measure a block of text runs, computing line breaks and dimensions. */
  measureTextRuns(runs: TextRun[], maxWidth: number): TextMeasurement;

  // ── Images ─────────────────────────────────────────────────────────────

  /** Draw an image at the given position and size. */
  drawImage(
    data: Uint8Array,
    format: ImageFormat,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void;

  // ── Font ───────────────────────────────────────────────────────────────

  /** Set the current font and size. */
  setFont(handle: FontHandle, size: number): void;
}
