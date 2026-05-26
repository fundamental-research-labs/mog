/**
 * PdfCanvas — implements RenderBackend for PDF output.
 *
 * Builds a command buffer of ContentOp objects per page, then flushes them
 * to Rust via the IpcBridge interface at endPage(). Does NOT write PDF bytes
 * directly.
 *
 * Key design decisions:
 * - Command buffer approach: all operations append to an ops array
 * - Y-flip at beginPage: applies `1 0 0 -1 0 pageHeight` so all subsequent
 *   operations use top-left origin. Text rendering compensates with Tm matrix.
 * - Graphics state stack: save/restore tracks current transform, colors, etc.
 * - quadraticCurveTo auto-converts to cubic (PDF only supports cubic Bezier)
 *
 * Font metrics strategy:
 * - When bridge.supportsRealFonts is false (MockIpcBridge), uses the AFM
 *   scaffold metrics synchronously for backward compatibility.
 * - When bridge.supportsRealFonts is true (TauriFontBridge), the synchronous
 *   measureText() still uses AFM as a fast fallback. For real TrueType metrics,
 *   callers should use measureTextAsync() which delegates to the Rust pipeline.
 */

import type { AffineTransform, Path } from '@mog/geometry';
import type { ContentOp } from './content-ops';
import { lineCapToInt, lineJoinToInt } from './content-ops';
import { GraphicsStateStack } from './graphics-state';
import type { IpcBridge } from './ipc-bridge';
import type { RenderBackend } from './render-backend';
import { createScaffoldFont, measureTextWidth } from './text/afm-metrics';
import { measureTextRuns as measureTextRunsLayout } from './text/text-layout';
import { emitDrawText, emitDrawTextRuns } from './text/text-renderer';
import type {
  FontHandle,
  ImageFormat,
  TextBlockOptions,
  TextMeasurement,
  TextOptions,
  TextRun,
} from './types';

export class PdfCanvas implements RenderBackend {
  private readonly _bridge: IpcBridge;
  private readonly _stateStack: GraphicsStateStack;
  private _ops: ContentOp[] = [];
  private _pageIndex = -1;
  private _pageWidth = 0;
  private _pageHeight = 0;
  private _inPage = false;

  // Track current pen position for quadraticCurveTo conversion
  private _penX = 0;
  private _penY = 0;
  private _pathStartX = 0;
  private _pathStartY = 0;

  constructor(bridge: IpcBridge) {
    this._bridge = bridge;
    this._stateStack = new GraphicsStateStack();
  }

  // ── Accessors (for testing) ──────────────────────────────────────────

  /** Get the current command buffer (for testing). */
  get ops(): readonly ContentOp[] {
    return this._ops;
  }

  /** Get the current page index. */
  get pageIndex(): number {
    return this._pageIndex;
  }

  /** Get the current page height. */
  get pageHeight(): number {
    return this._pageHeight;
  }

  /** Get the current page width. */
  get pageWidth(): number {
    return this._pageWidth;
  }

  /** Get the underlying IPC bridge. */
  get bridge(): IpcBridge {
    return this._bridge;
  }

  // ── Page Lifecycle ──────────────────────────────────────────────────

  beginPage(width: number, height: number): void {
    this._pageIndex++;
    this._pageWidth = width;
    this._pageHeight = height;
    this._ops = [];
    this._stateStack.reset();
    this._inPage = true;
    this._penX = 0;
    this._penY = 0;
    this._pathStartX = 0;
    this._pathStartY = 0;

    // Apply global Y-flip transform so all operations use top-left origin.
    // Matrix: 1 0 0 -1 0 pageHeight  =>  y' = pageHeight - y
    this._ops.push({
      op: 'ConcatMatrix',
      a: 1,
      b: 0,
      c: 0,
      d: -1,
      tx: 0,
      ty: height,
    });
  }

  async endPage(): Promise<void> {
    if (!this._inPage) return;
    this._inPage = false;

    // Flush command buffer to Rust via IPC
    await this._bridge.writeContentOps(this._pageIndex, this._ops);
    this._ops = [];
  }

  // ── Graphics State ──────────────────────────────────────────────────

  save(): void {
    this._stateStack.save();
    this._ops.push({ op: 'SaveState' });
  }

  restore(): void {
    this._stateStack.restore();
    this._ops.push({ op: 'RestoreState' });
  }

  // ── Transforms ──────────────────────────────────────────────────────

  translate(tx: number, ty: number): void {
    this._applyTransformToState({ a: 1, b: 0, c: 0, d: 1, tx, ty });
    this._ops.push({ op: 'ConcatMatrix', a: 1, b: 0, c: 0, d: 1, tx, ty });
  }

  rotate(angleRad: number): void {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    this._applyTransformToState({ a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 });
    this._ops.push({ op: 'ConcatMatrix', a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 });
  }

  scale(sx: number, sy: number): void {
    this._applyTransformToState({ a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 });
    this._ops.push({ op: 'ConcatMatrix', a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 });
  }

  transform(a: number, b: number, c: number, d: number, tx: number, ty: number): void {
    this._applyTransformToState({ a, b, c, d, tx, ty });
    this._ops.push({ op: 'ConcatMatrix', a, b, c, d, tx, ty });
  }

  setTransform(transform: AffineTransform): void {
    // To set an absolute transform, we need to invert the current transform
    // and then apply the new one. For simplicity, we use save/restore pattern.
    // This replaces the current transform on the state stack.
    const state = this._stateStack.current;
    state.transform = { ...transform };
    // Emit the cm operator with the full matrix
    // Note: In practice this would need to compute the delta transform.
    // For now, emit a direct concat (callers should use save/restore).
    this._ops.push({
      op: 'ConcatMatrix',
      a: transform.a,
      b: transform.b,
      c: transform.c,
      d: transform.d,
      tx: transform.tx,
      ty: transform.ty,
    });
  }

  // ── Path Construction ──────────────────────────────────────────────

  beginPath(): void {
    // PDF doesn't have an explicit "begin path" operator — the path is
    // implicitly started by the first path construction operator.
    // We just reset the pen tracking.
    this._penX = 0;
    this._penY = 0;
  }

  moveTo(x: number, y: number): void {
    this._ops.push({ op: 'MoveTo', x, y });
    this._penX = x;
    this._penY = y;
    this._pathStartX = x;
    this._pathStartY = y;
  }

  lineTo(x: number, y: number): void {
    this._ops.push({ op: 'LineTo', x, y });
    this._penX = x;
    this._penY = y;
  }

  curveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this._ops.push({ op: 'CurveTo', x1: cp1x, y1: cp1y, x2: cp2x, y2: cp2y, x, y });
    this._penX = x;
    this._penY = y;
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    // PDF only supports cubic Bezier curves. Convert quadratic to cubic
    // using the exact conversion from @mog/geometry's quadraticToCubic.
    //
    // CP1 = P0 + 2/3 * (P1 - P0)
    // CP2 = P2 + 2/3 * (P1 - P2)
    const p0x = this._penX;
    const p0y = this._penY;
    const cp1x = p0x + (2 / 3) * (cpx - p0x);
    const cp1y = p0y + (2 / 3) * (cpy - p0y);
    const cp2x = x + (2 / 3) * (cpx - x);
    const cp2y = y + (2 / 3) * (cpy - y);

    this._ops.push({ op: 'CurveTo', x1: cp1x, y1: cp1y, x2: cp2x, y2: cp2y, x, y });
    this._penX = x;
    this._penY = y;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this._ops.push({ op: 'Rectangle', x, y, w, h });
    // Rectangle implicitly closes; pen returns to (x, y)
    this._penX = x;
    this._penY = y;
  }

  closePath(): void {
    this._ops.push({ op: 'ClosePath' });
    this._penX = this._pathStartX;
    this._penY = this._pathStartY;
  }

  clip(): void {
    this._ops.push({ op: 'ClipNonZero' });
  }

  replayPath(path: Path): void {
    for (const seg of path.segments) {
      switch (seg.type) {
        case 'M':
          this.moveTo(seg.x, seg.y);
          break;
        case 'L':
          this.lineTo(seg.x, seg.y);
          break;
        case 'C':
          this.curveTo(seg.x1, seg.y1, seg.x2, seg.y2, seg.x, seg.y);
          break;
        case 'Q':
          this.quadraticCurveTo(seg.x1, seg.y1, seg.x, seg.y);
          break;
        case 'Z':
          this.closePath();
          break;
      }
    }
  }

  // ── Fill & Stroke ──────────────────────────────────────────────────

  setFillColor(r: number, g: number, b: number): void {
    this._stateStack.current.fillColor = [r, g, b];
    this._ops.push({ op: 'SetFillColorRGB', r, g, b });
  }

  setStrokeColor(r: number, g: number, b: number): void {
    this._stateStack.current.strokeColor = [r, g, b];
    this._ops.push({ op: 'SetStrokeColorRGB', r, g, b });
  }

  setFillAlpha(alpha: number): void {
    this._stateStack.current.fillAlpha = alpha;
    this._ops.push({ op: 'SetFillAlpha', alpha });
  }

  setStrokeAlpha(alpha: number): void {
    this._stateStack.current.strokeAlpha = alpha;
    this._ops.push({ op: 'SetStrokeAlpha', alpha });
  }

  setLineWidth(width: number): void {
    this._stateStack.current.lineWidth = width;
    this._ops.push({ op: 'SetLineWidth', width });
  }

  setLineDash(segments: number[], phase: number): void {
    this._stateStack.current.lineDash = [...segments];
    this._stateStack.current.lineDashPhase = phase;
    this._ops.push({ op: 'SetLineDash', segments: [...segments], phase });
  }

  setLineCap(cap: 'butt' | 'round' | 'square'): void {
    this._stateStack.current.lineCap = cap;
    this._ops.push({ op: 'SetLineCap', cap: lineCapToInt(cap) });
  }

  setLineJoin(join: 'miter' | 'round' | 'bevel'): void {
    this._stateStack.current.lineJoin = join;
    this._ops.push({ op: 'SetLineJoin', join: lineJoinToInt(join) });
  }

  fill(): void {
    this._ops.push({ op: 'Fill' });
  }

  stroke(): void {
    this._ops.push({ op: 'Stroke' });
  }

  fillAndStroke(): void {
    this._ops.push({ op: 'FillAndStroke' });
  }

  // ── Text ───────────────────────────────────────────────────────────

  drawText(text: string, x: number, y: number, options: TextOptions): void {
    const state = this._stateStack.current;
    const font = state.font ?? createScaffoldFont();
    const size = state.fontSize;

    const textOps = emitDrawText(text, x, y, options, font, size, this._pageHeight);
    this._ops.push(...textOps);
  }

  drawTextRuns(runs: TextRun[], x: number, y: number, options: TextBlockOptions): void {
    const state = this._stateStack.current;
    const font = state.font ?? createScaffoldFont();
    const size = state.fontSize;

    const textOps = emitDrawTextRuns(runs, x, y, options, font, size, this._pageHeight);
    this._ops.push(...textOps);
  }

  /**
   * Synchronous text measurement using AFM scaffold metrics.
   *
   * This is the RenderBackend interface method. It always uses the local
   * AFM character width tables, which is correct for:
   * - All existing tests (MockIpcBridge)
   * - Fast approximate measurement during layout
   *
   * For real TrueType metrics from Rust, use measureTextAsync().
   */
  measureText(text: string, font: FontHandle, size: number): number {
    return measureTextWidth(text, font, size);
  }

  /**
   * Async text measurement that delegates to the Rust font pipeline
   * when real fonts are available.
   *
   * When the bridge supports real fonts (TauriFontBridge), this calls
   * into Rust's FontRegistry.measure_text() for accurate TrueType
   * glyph advances and kerning.
   *
   * When the bridge does NOT support real fonts (MockIpcBridge), this
   * falls back to the synchronous AFM scaffold metrics.
   *
   * @param text - The string to measure
   * @param font - FontHandle (from registerFont or createScaffoldFont)
   * @param size - Font size in points
   * @returns Width in points
   */
  async measureTextAsync(text: string, font: FontHandle, size: number): Promise<number> {
    if (this._bridge.supportsRealFonts) {
      return this._bridge.measureText(font, text, size);
    }
    // Fall back to synchronous AFM scaffold
    return measureTextWidth(text, font, size);
  }

  measureTextRuns(runs: TextRun[], maxWidth: number): TextMeasurement {
    const state = this._stateStack.current;
    const font = state.font ?? createScaffoldFont();
    const size = state.fontSize;
    return measureTextRunsLayout(runs, maxWidth, font, size);
  }

  // ── Images ─────────────────────────────────────────────────────────

  drawImage(
    data: Uint8Array,
    format: ImageFormat,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    this._ops.push({
      op: 'DrawImage',
      data: Array.from(data),
      format,
      x,
      y,
      w,
      h,
    });
  }

  // ── Font ───────────────────────────────────────────────────────────

  setFont(handle: FontHandle, size: number): void {
    this._stateStack.current.font = { ...handle };
    this._stateStack.current.fontSize = size;
    // Note: The actual SetFont op is emitted in text drawing operations,
    // not here, because PDF font selection is part of the text block.
  }

  // ── Private Helpers ────────────────────────────────────────────────

  /**
   * Apply a transform to the current state (multiply into the CTM).
   */
  private _applyTransformToState(m: AffineTransform): void {
    const cur = this._stateStack.current.transform;
    // Result = cur * m (m is applied in the current coordinate space)
    this._stateStack.current.transform = {
      a: cur.a * m.a + cur.c * m.b,
      b: cur.b * m.a + cur.d * m.b,
      c: cur.a * m.c + cur.c * m.d,
      d: cur.b * m.c + cur.d * m.d,
      tx: cur.a * m.tx + cur.c * m.ty + cur.tx,
      ty: cur.b * m.tx + cur.d * m.ty + cur.ty,
    };
  }
}
