/**
 * CanvasTextMeasurer — Text Measurement via Offscreen Canvas
 *
 * Implements the TextMeasurer interface using an offscreen canvas
 * for measurement. Caches font string assignments for performance.
 *
 * @module @mog/canvas-engine/utils
 */

import type { CanvasTextMetrics, TextMeasurer, WrappedTextMetrics } from '../core/types';

/**
 * Text measurer using an offscreen canvas.
 *
 * Font string cache avoids repeated ctx.font assignment in tight loops
 * (font string construction/parsing is expensive in canvas).
 */
export class CanvasTextMeasurer implements TextMeasurer {
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private currentFont = '';

  constructor() {
    // Prefer OffscreenCanvas if available (not attached to DOM)
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(1, 1);
      this.ctx = this.canvas.getContext('2d')!;
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1;
      this.canvas.height = 1;
      this.ctx = this.canvas.getContext('2d')!;
    }
  }

  measureText(text: string, font: string): CanvasTextMetrics {
    this.setFont(font);
    const metrics = this.ctx.measureText(text);
    return {
      width: metrics.width,
      actualBoundingBoxAscent: metrics.actualBoundingBoxAscent ?? 0,
      actualBoundingBoxDescent: metrics.actualBoundingBoxDescent ?? 0,
    };
  }

  measureWrappedText(text: string, font: string, maxWidth: number): WrappedTextMetrics {
    this.setFont(font);

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
        continue;
      }

      const testLine = currentLine + ' ' + word;
      const testWidth = this.ctx.measureText(testLine).width;

      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    // Handle empty text
    if (lines.length === 0) {
      lines.push('');
    }

    // Compute line height from font metrics
    const sampleMetrics = this.ctx.measureText('Mg');
    const lineHeight =
      (sampleMetrics.actualBoundingBoxAscent ?? 0) +
      (sampleMetrics.actualBoundingBoxDescent ?? 0) +
      2; // 2px line spacing

    return {
      lines,
      lineHeight,
      totalHeight: lines.length * lineHeight,
    };
  }

  private setFont(font: string): void {
    if (font !== this.currentFont) {
      this.currentFont = font;
      this.ctx.font = font;
    }
  }
}
