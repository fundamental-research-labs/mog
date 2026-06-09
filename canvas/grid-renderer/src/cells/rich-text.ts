/**
 * Rich Text Rendering
 *
 * Per-segment formatting (font, size, color, bold, italic per run),
 * multi-line rich text layout.
 *
 * Rich text consists of multiple segments, each with independent formatting:
 * - Font family, size, bold, italic
 * - Font color
 * - Underline (single, double, accounting, double accounting)
 * - Strikethrough
 * - Superscript/subscript
 *
 * @module grid-renderer/cells/rich-text
 */

import type { TextMeasurer } from '@mog/canvas-engine';
import type { CellTextStyle } from '@mog-sdk/contracts/cell-style';
import type { CellFormat } from '@mog-sdk/contracts/core';
import type { RichTextSegment, TextFormat } from '@mog-sdk/contracts/rich-text';
import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import { buildFontFamilyWithFallbacks, getIntrinsicFontWeight } from '../shared/font-utils';
import { computeBaselineY, getCellStyle, mapHorizontalAlign, mapVerticalAlign } from './text';

// =============================================================================
// Types
// =============================================================================

/** Options for renderRichText */
export interface RenderRichTextOptions {
  /** Whether to clip text to cell bounds */
  clipText: boolean;
  /** Theme definition */
  theme: ThemeDefinition;
  /** Text measurer for width calculations */
  textMeasurer: TextMeasurer;
  /** Optional callback for tracking clipped cells (for tooltip display) */
  trackClippedCell?: (row: number, col: number, text: string) => void;
  /** CF font color override (takes priority over all segment colors) */
  fontColorOverride?: string | null;
  /** Renderer default for automatic font color. Explicit format colors remain exact. */
  defaultFontColor?: string;
}

// =============================================================================
// Segment Font Building
// =============================================================================

/**
 * Build a canvas font string for a rich text segment.
 *
 * Merges segment-level formatting with cell-level baseline styles.
 * Segment formatting takes precedence over cell formatting.
 *
 * @param segmentFormat - Segment-specific formatting
 * @param baseStyle - Cell-level baseline style
 * @returns Canvas font string (e.g., "italic bold 12px Calibri, Carlito, sans-serif")
 */
export function buildSegmentFont(
  segmentFormat: Partial<TextFormat> | undefined,
  baseStyle: CellTextStyle,
): string {
  const parts: string[] = [];
  const rawFamily = segmentFormat?.fontFamily ?? baseStyle.fontFamily;
  const primaryFont = rawFamily.split(',')[0].trim().replace(/["']/g, '');
  const intrinsicWeight = getIntrinsicFontWeight(primaryFont);

  // Italic: segment overrides base
  const isItalic = segmentFormat?.italic ?? baseStyle.fontStyle === 'italic';
  if (isItalic) {
    parts.push('italic');
  }

  // Bold: segment overrides base
  const isBold = segmentFormat?.bold ?? baseStyle.fontWeight === 'bold';
  if (intrinsicWeight != null) {
    parts.push(String(intrinsicWeight));
  } else if (isBold) {
    parts.push('bold');
  }

  // Font size: segment overrides base, with superscript/subscript scaling
  let fontSize = segmentFormat?.fontSize ?? baseStyle.fontSize;
  if (segmentFormat?.superscript || segmentFormat?.subscript) {
    fontSize = Math.round(fontSize * 0.7);
  }
  parts.push(`${fontSize}px`);

  // Font family: segment overrides base
  const fontFamily = buildFontFamilyWithFallbacks(primaryFont);
  parts.push(fontFamily);

  return parts.join(' ');
}

// =============================================================================
// Rich Text Rendering
// =============================================================================

/**
 * Render rich text content with per-segment formatting.
 *
 * 1. Calculates total width of all segments for horizontal alignment
 * 2. Positions text based on horizontal and vertical alignment
 * 3. Renders each segment with its own formatting
 * 4. Draws text decorations (underline, strikethrough) per segment
 * 5. Tracks clipped cells for tooltip support
 *
 * @param ctx - Canvas rendering context
 * @param segments - Rich text segments
 * @param row - Cell row index
 * @param col - Cell column index
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 * @param format - Cell format for baseline style
 * @param options - Rendering options
 */
export function renderRichText(
  ctx: CanvasRenderingContext2D,
  segments: readonly RichTextSegment[],
  row: number,
  col: number,
  x: number,
  y: number,
  width: number,
  height: number,
  format: CellFormat | undefined,
  options: RenderRichTextOptions,
): void {
  if (!segments || segments.length === 0) return;

  // Get baseline style from cell format. Colors are pre-resolved hex from the Rust wire;
  // automatic/default black is skin-resolved by getCellStyle.
  const baseStyle = getCellStyle(format, options.theme, options.defaultFontColor);
  const padding = baseStyle.paddingX;

  // Clip to cell bounds if requested
  ctx.save();
  if (options.clipText) {
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
  }

  // Calculate alignment
  const horizontalAlign = mapHorizontalAlign(format?.horizontalAlign, undefined);
  const verticalAlign = mapVerticalAlign(format?.verticalAlign);

  // Calculate total width of all segments for alignment
  let totalWidth = 0;
  const segmentWidths: number[] = [];

  for (const segment of segments) {
    const segmentFont = buildSegmentFont(segment.format, baseStyle);
    const segWidth = options.textMeasurer.measureText(segment.text, segmentFont).width;
    segmentWidths.push(segWidth);
    totalWidth += segWidth;
  }

  // Calculate starting x position based on horizontal alignment
  let currentX: number;
  switch (horizontalAlign) {
    case 'center':
      currentX = x + (width - totalWidth) / 2;
      break;
    case 'right':
      currentX = x + width - padding - totalWidth;
      break;
    default: // 'left' or 'justify'
      currentX = x + padding;
  }

  // Calculate y position based on vertical alignment
  let textY: number;
  let baseline: CanvasTextBaseline;
  switch (verticalAlign) {
    case 'middle':
      baseline = 'middle';
      textY = y + height / 2;
      break;
    case 'bottom':
      baseline = 'bottom';
      textY = y + height - padding;
      break;
    default:
      baseline = 'top';
      textY = y + padding;
  }
  ctx.textBaseline = baseline;

  // Render each segment with its own formatting
  ctx.textAlign = 'left'; // Position each segment manually
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentFormat = segment.format;

    // Build font for this segment
    const segmentFont = buildSegmentFont(segmentFormat, baseStyle);
    ctx.font = segmentFont;

    // Set color for this segment (CF override > segment color > base color)
    // Segment fontColor is pre-resolved hex from the Rust wire.
    if (options.fontColorOverride) {
      ctx.fillStyle = options.fontColorOverride;
    } else if (segmentFormat?.fontColor) {
      ctx.fillStyle = segmentFormat.fontColor;
    } else {
      ctx.fillStyle = baseStyle.color;
    }

    // Handle superscript/subscript vertical offset
    let adjustedY = textY;
    if (segmentFormat?.superscript) {
      adjustedY -= baseStyle.fontSize * 0.4;
    } else if (segmentFormat?.subscript) {
      adjustedY += baseStyle.fontSize * 0.3;
    }

    // Draw the segment text
    ctx.fillText(segment.text, currentX, adjustedY);

    // Draw text decorations for this segment
    if (
      (segmentFormat?.underlineType && segmentFormat.underlineType !== 'none') ||
      segmentFormat?.strikethrough
    ) {
      renderSegmentDecorations(
        ctx,
        segment.text,
        currentX,
        textY,
        baseline,
        segmentFormat,
        baseStyle,
      );
    }

    // Move to next segment position
    currentX += segmentWidths[i];
  }

  // Track as clipped if total width exceeds cell (for tooltip)
  if (totalWidth > width - padding * 2 && options.trackClippedCell) {
    const plainText = segments.map((s) => s.text).join('');
    options.trackClippedCell(row, col, plainText);
  }

  ctx.restore();
}

// =============================================================================
// Rich Text Multi-Line Rendering
// =============================================================================

/**
 * Render rich text with word wrapping across multiple lines.
 *
 * Splits rich text segments across lines based on available width,
 * preserving per-segment formatting across line breaks.
 *
 * @param ctx - Canvas rendering context
 * @param segments - Rich text segments
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 * @param format - Cell format
 * @param options - Rendering options
 */
export function renderRichTextWrapped(
  ctx: CanvasRenderingContext2D,
  segments: readonly RichTextSegment[],
  x: number,
  y: number,
  width: number,
  height: number,
  format: CellFormat | undefined,
  options: RenderRichTextOptions,
): void {
  if (!segments || segments.length === 0) return;

  // Colors are pre-resolved hex from the Rust wire; automatic/default black is
  // skin-resolved by getCellStyle.
  const baseStyle = getCellStyle(format, options.theme, options.defaultFontColor);
  const padding = baseStyle.paddingX;
  const availableWidth = width - padding * 2;
  const lineHeight = baseStyle.fontSize * 1.2;

  if (availableWidth <= 0) return;

  // Build line layout: each line is an array of { segment, startIdx, endIdx }
  const lines = layoutRichTextLines(segments, baseStyle, availableWidth, options.textMeasurer);

  const verticalAlign = mapVerticalAlign(format?.verticalAlign);
  const totalHeight = lines.length * lineHeight;
  const availableHeight = height - padding * 2;

  let startY: number;
  switch (verticalAlign) {
    case 'top':
      startY = y + padding;
      break;
    case 'middle':
      startY = y + padding + (availableHeight - totalHeight) / 2;
      break;
    case 'bottom':
      startY = y + padding + availableHeight - totalHeight;
      break;
    default:
      startY = y + padding;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineY = startY + lineIdx * lineHeight;
    if (lineY + lineHeight < y || lineY > y + height) continue;

    let lineX = x + padding;
    const lineSegments = lines[lineIdx];

    for (const lineSeg of lineSegments) {
      const segmentFont = buildSegmentFont(lineSeg.format, baseStyle);
      ctx.font = segmentFont;

      // Set color (CF override > segment color > base color)
      // Segment fontColor is pre-resolved hex from the Rust wire.
      if (options.fontColorOverride) {
        ctx.fillStyle = options.fontColorOverride;
      } else if (lineSeg.format?.fontColor) {
        ctx.fillStyle = lineSeg.format.fontColor;
      } else {
        ctx.fillStyle = baseStyle.color;
      }

      let adjustedY = lineY;
      if (lineSeg.format?.superscript) {
        adjustedY -= baseStyle.fontSize * 0.4;
      } else if (lineSeg.format?.subscript) {
        adjustedY += baseStyle.fontSize * 0.3;
      }

      ctx.fillText(lineSeg.text, lineX, adjustedY);

      if (
        (lineSeg.format?.underlineType && lineSeg.format.underlineType !== 'none') ||
        lineSeg.format?.strikethrough
      ) {
        renderSegmentDecorations(ctx, lineSeg.text, lineX, lineY, 'top', lineSeg.format, baseStyle);
      }

      lineX += options.textMeasurer.measureText(lineSeg.text, segmentFont).width;
    }
  }

  ctx.restore();
}

// =============================================================================
// Rich Text Line Layout
// =============================================================================

interface RichTextLinePiece {
  text: string;
  format: Partial<TextFormat> | undefined;
}

/**
 * Layout rich text segments into lines that fit within the available width.
 */
function layoutRichTextLines(
  segments: readonly RichTextSegment[],
  baseStyle: CellTextStyle,
  maxWidth: number,
  textMeasurer: TextMeasurer,
): RichTextLinePiece[][] {
  const lines: RichTextLinePiece[][] = [];
  let currentLine: RichTextLinePiece[] = [];
  let currentLineWidth = 0;

  for (const segment of segments) {
    const segmentFont = buildSegmentFont(segment.format, baseStyle);

    // Handle explicit newlines within segments
    const parts = segment.text.split('\n');

    for (let partIdx = 0; partIdx < parts.length; partIdx++) {
      // Start a new line for each explicit newline (except the first part)
      if (partIdx > 0) {
        lines.push(currentLine);
        currentLine = [];
        currentLineWidth = 0;
      }

      const text = parts[partIdx];
      if (!text) continue;

      const textWidth = textMeasurer.measureText(text, segmentFont).width;

      if (currentLineWidth + textWidth <= maxWidth) {
        // Fits on current line
        currentLine.push({ text, format: segment.format });
        currentLineWidth += textWidth;
      } else {
        // Need to wrap: word-break the text
        const words = text.split(/(\s+)/);
        for (const word of words) {
          if (!word) continue;
          const wordWidth = textMeasurer.measureText(word, segmentFont).width;

          if (currentLineWidth + wordWidth <= maxWidth) {
            currentLine.push({ text: word, format: segment.format });
            currentLineWidth += wordWidth;
          } else {
            // Start new line
            if (currentLine.length > 0) {
              lines.push(currentLine);
              currentLine = [];
              currentLineWidth = 0;
            }
            currentLine.push({ text: word, format: segment.format });
            currentLineWidth = wordWidth;
          }
        }
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [[]];
}

// =============================================================================
// Segment Decorations
// =============================================================================

/**
 * Render text decorations (underline, strikethrough) for a rich text segment.
 */
function renderSegmentDecorations(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  textBaseline: CanvasTextBaseline,
  segmentFormat: Partial<TextFormat> | undefined,
  baseStyle: CellTextStyle,
): void {
  if (!segmentFormat) return;

  const textWidth = ctx.measureText(text).width;
  const fontSize = segmentFormat.fontSize ?? baseStyle.fontSize;
  const alphabeticAscent = fontSize * 0.8;
  const alphabeticDescent = fontSize * 0.2;
  const baselineY = computeBaselineY(y, textBaseline, fontSize);

  ctx.strokeStyle = ctx.fillStyle as string;
  ctx.lineWidth = 1;

  if (segmentFormat.underlineType && segmentFormat.underlineType !== 'none') {
    const underlineY = baselineY + Math.max(1, alphabeticDescent * 0.3);

    ctx.beginPath();
    ctx.moveTo(x, underlineY);
    ctx.lineTo(x + textWidth, underlineY);
    ctx.stroke();

    if (
      segmentFormat.underlineType === 'double' ||
      segmentFormat.underlineType === 'doubleAccounting'
    ) {
      ctx.beginPath();
      ctx.moveTo(x, underlineY + 2);
      ctx.lineTo(x + textWidth, underlineY + 2);
      ctx.stroke();
    }
  }

  if (segmentFormat.strikethrough) {
    const strikeY = baselineY - alphabeticAscent * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, strikeY);
    ctx.lineTo(x + textWidth, strikeY);
    ctx.stroke();
  }
}
