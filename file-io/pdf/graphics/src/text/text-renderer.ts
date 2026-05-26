/**
 * Text rendering helpers — emit ContentOp sequences for text operations.
 *
 * These functions generate the PDF content stream operators for text rendering.
 * They are used by PdfCanvas.drawText() and PdfCanvas.drawTextRuns().
 */

import type { ContentOp } from '../content-ops';
import type { FontHandle, TextBlockOptions, TextOptions, TextRun } from '../types';
import { getBase14FontName, measureTextWidth, resolveFontForRun } from './afm-metrics';
import { computeAlignmentX, getAscender, getXHeight, measureTextRuns } from './text-layout';

/**
 * Encode a string as an array of byte values for the ShowText op.
 * Uses Latin-1 encoding (matching PDF base-14 font encoding).
 *
 * SCAFFOLD: Will be replaced with proper CID encoding.
 */
export function encodeText(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Clamp to Latin-1 range for base-14 fonts
    bytes.push(code <= 255 ? code : 63); // 63 = '?'
  }
  return bytes;
}

/**
 * Emit ContentOps for drawing a single text string.
 *
 * @param text - The string to draw
 * @param x - X position (in top-left-origin coordinates)
 * @param y - Y position (in top-left-origin coordinates)
 * @param options - Text options (alignment, color, decorations)
 * @param currentFont - The currently active font
 * @param currentFontSize - The currently active font size
 * @param pageHeight - Current page height (for Y-flip compensation in Tm)
 * @returns Array of ContentOp to append to the buffer
 */
export function emitDrawText(
  text: string,
  x: number,
  y: number,
  options: TextOptions,
  currentFont: FontHandle,
  currentFontSize: number,
  pageHeight: number,
): ContentOp[] {
  if (text.length === 0) return [];

  const ops: ContentOp[] = [];
  const font = currentFont;
  const size = currentFontSize;
  const fontName = getBase14FontName(font);

  // Compute text width for alignment
  const textWidth = measureTextWidth(text, font, size);

  // Adjust x for horizontal alignment
  let adjustedX = x;
  if (options.halign === 'center') {
    adjustedX -= textWidth / 2;
  } else if (options.halign === 'right') {
    adjustedX -= textWidth;
  }

  // The ascender offset: in top-left-origin, y is the top of the text area.
  // Baseline = y + ascender.
  const ascender = getAscender(size);
  const baselineY = y + ascender;

  // Text color (independent of fill color)
  const color = options.color;

  // Handle rotation
  if (options.rotation && options.rotation !== 0) {
    const angleRad = (options.rotation * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    ops.push({ op: 'BeginText' });
    if (color) {
      ops.push({ op: 'SetTextFillColor', r: color[0], g: color[1], b: color[2] });
    }
    ops.push({ op: 'SetFont', name: fontName, size });
    // Tm matrix: rotation + Y-flip compensation + position
    // In PDF coordinates (after page Y-flip), y increases downward.
    // We use Tm to place text at the correct position with rotation.
    // The page Y-flip is: 1 0 0 -1 0 pageHeight
    // Text Tm must compensate by negating d component.
    ops.push({
      op: 'TextMatrix',
      a: cos,
      b: -sin, // negated because of Y-flip
      c: sin,
      d: -cos, // negated because of Y-flip
      tx: adjustedX,
      ty: pageHeight - baselineY,
    });
    ops.push({ op: 'ShowText', bytes: encodeText(text) });
    ops.push({ op: 'EndText' });
  } else {
    ops.push({ op: 'BeginText' });
    if (color) {
      ops.push({ op: 'SetTextFillColor', r: color[0], g: color[1], b: color[2] });
    }
    ops.push({ op: 'SetFont', name: fontName, size });
    // Tm with Y-flip compensation: a=1, b=0, c=0, d=-1 (negate y-scale)
    ops.push({
      op: 'TextMatrix',
      a: 1,
      b: 0,
      c: 0,
      d: -1,
      tx: adjustedX,
      ty: pageHeight - baselineY,
    });
    ops.push({ op: 'ShowText', bytes: encodeText(text) });
    ops.push({ op: 'EndText' });
  }

  // Text decorations
  if (options.underline) {
    const underlineOps = emitUnderline(adjustedX, baselineY, textWidth, size, color, pageHeight);
    ops.push(...underlineOps);
  }

  if (options.strikethrough) {
    const strikeOps = emitStrikethrough(adjustedX, baselineY, textWidth, size, color, pageHeight);
    ops.push(...strikeOps);
  }

  return ops;
}

/**
 * Emit ContentOps for an underline decoration.
 * Drawn as a thin line below the baseline.
 */
export function emitUnderline(
  x: number,
  baselineY: number,
  width: number,
  fontSize: number,
  color: [number, number, number] | undefined,
  _pageHeight: number,
): ContentOp[] {
  const ops: ContentOp[] = [];
  // Underline position: slightly below baseline
  const underlineOffset = fontSize * 0.1;
  const underlineThickness = Math.max(fontSize * 0.05, 0.5);
  const lineY = baselineY + underlineOffset;

  ops.push({ op: 'SaveState' });
  if (color) {
    ops.push({ op: 'SetStrokeColorRGB', r: color[0], g: color[1], b: color[2] });
  }
  ops.push({ op: 'SetLineWidth', width: underlineThickness });
  ops.push({ op: 'MoveTo', x, y: lineY });
  ops.push({ op: 'LineTo', x: x + width, y: lineY });
  ops.push({ op: 'Stroke' });
  ops.push({ op: 'RestoreState' });

  return ops;
}

/**
 * Emit ContentOps for a strikethrough decoration.
 * Drawn as a line at the x-height (middle of lowercase characters).
 */
export function emitStrikethrough(
  x: number,
  baselineY: number,
  width: number,
  fontSize: number,
  color: [number, number, number] | undefined,
  _pageHeight: number,
): ContentOp[] {
  const ops: ContentOp[] = [];
  // Strikethrough at approximately x-height / 2 above baseline
  const xHeight = getXHeight(fontSize);
  const strikeY = baselineY - xHeight * 0.5;
  const strikeThickness = Math.max(fontSize * 0.05, 0.5);

  ops.push({ op: 'SaveState' });
  if (color) {
    ops.push({ op: 'SetStrokeColorRGB', r: color[0], g: color[1], b: color[2] });
  }
  ops.push({ op: 'SetLineWidth', width: strikeThickness });
  ops.push({ op: 'MoveTo', x, y: strikeY });
  ops.push({ op: 'LineTo', x: x + width, y: strikeY });
  ops.push({ op: 'Stroke' });
  ops.push({ op: 'RestoreState' });

  return ops;
}

/**
 * Emit ContentOps for drawing rich text (multiple TextRuns).
 *
 * Handles per-run font switching, color changes, superscript/subscript,
 * and text decorations. Performs word wrapping via measureTextRuns.
 */
export function emitDrawTextRuns(
  runs: TextRun[],
  x: number,
  y: number,
  options: TextBlockOptions,
  currentFont: FontHandle,
  currentFontSize: number,
  pageHeight: number,
): ContentOp[] {
  if (runs.length === 0) return [];

  const ops: ContentOp[] = [];
  const baseFont = currentFont;
  const baseSize = currentFontSize;

  // Measure and layout
  const measurement = measureTextRuns(runs, options.maxWidth, baseFont, baseSize);
  const lineHeight = options.lineHeight;

  for (let lineIdx = 0; lineIdx < measurement.lines.length; lineIdx++) {
    const line = measurement.lines[lineIdx];
    const lineY = y + lineIdx * lineHeight;

    // Compute X alignment offset
    const alignX = computeAlignmentX(line.width, options.maxWidth, options.halign ?? 'left');

    let cursorX = x + alignX;

    for (const run of line.runs) {
      if (run.text.length === 0) continue;

      const font = resolveFontForRun(run, baseFont);
      let size = run.size ?? baseSize;

      // Superscript/subscript sizing
      const isSuperscript = run.superscript === true;
      const isSubscript = run.subscript === true;
      if (isSuperscript || isSubscript) {
        size = size * 0.7;
      }

      const fontName = getBase14FontName(font);
      let baselineY = lineY + getAscender(baseSize); // Use base size for consistent baseline

      // Superscript/subscript baseline shift
      if (isSuperscript) {
        baselineY -= baseSize * 0.33;
      } else if (isSubscript) {
        baselineY += baseSize * 0.2;
      }

      const textWidth = measureTextWidth(run.text, font, size);
      const color = run.color;

      // Emit text
      ops.push({ op: 'BeginText' });
      if (color) {
        ops.push({ op: 'SetTextFillColor', r: color[0], g: color[1], b: color[2] });
      }
      ops.push({ op: 'SetFont', name: fontName, size });
      ops.push({
        op: 'TextMatrix',
        a: 1,
        b: 0,
        c: 0,
        d: -1,
        tx: cursorX,
        ty: pageHeight - baselineY,
      });
      ops.push({ op: 'ShowText', bytes: encodeText(run.text) });
      ops.push({ op: 'EndText' });

      // Text decorations for this run
      if (run.underline) {
        const underlineOps = emitUnderline(cursorX, baselineY, textWidth, size, color, pageHeight);
        ops.push(...underlineOps);
      }
      if (run.strikethrough) {
        const strikeOps = emitStrikethrough(cursorX, baselineY, textWidth, size, color, pageHeight);
        ops.push(...strikeOps);
      }

      cursorX += textWidth;
    }
  }

  return ops;
}
