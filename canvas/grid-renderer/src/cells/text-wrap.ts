/**
 * Text Wrapping
 *
 * Word wrap multi-line layout for cells with wrapText enabled.
 * Splits text into lines that fit within the cell width, then renders
 * each line with proper vertical spacing and alignment.
 *
 * @module grid-renderer/cells/text-wrap
 */

import type { TextMeasurer } from '@mog/canvas-engine';
import type { CellFormat } from '@mog-sdk/contracts/core';
import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import {
  buildCellFont,
  getCellStyle,
  hasExplicitFontColor,
  mapHorizontalAlign,
  mapVerticalAlign,
  clipTextToCell,
  renderTextDecorations,
  type CanvasHAlign,
  type CanvasVAlign,
} from './text';
import type { CellRenderInfo } from './types';

// =============================================================================
// Text Wrapping
// =============================================================================

/**
 * Split text into lines that fit within the given max width.
 *
 * Handles both explicit newlines (\n from Alt+Enter) and word wrapping.
 * Words that are longer than maxWidth are broken at character level.
 *
 * @param text - Text to wrap
 * @param font - Canvas font string for measurement
 * @param maxWidth - Maximum width in pixels
 * @param textMeasurer - Text measurer for width calculations
 * @returns Array of lines that fit within maxWidth
 */
export function wrapTextToLines(
  text: string,
  font: string,
  maxWidth: number,
  textMeasurer: TextMeasurer,
): string[] {
  if (maxWidth <= 0) return [text];

  const lines: string[] = [];

  // First split by explicit newlines
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }

    // Check if the whole paragraph fits
    if (textMeasurer.measureText(paragraph, font).width <= maxWidth) {
      lines.push(paragraph);
      continue;
    }

    // Word wrap this paragraph
    const words = paragraph.split(/(\s+)/); // Keep whitespace as separate tokens
    let currentLine = '';

    for (const word of words) {
      if (!word) continue;

      const testLine = currentLine + word;
      const testWidth = textMeasurer.measureText(testLine, font).width;

      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        // Current line is full
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }

        // Check if the word itself fits
        if (textMeasurer.measureText(word, font).width <= maxWidth) {
          currentLine = word;
        } else {
          // Word is too long - break at character level
          const charLines = breakWordToFit(word, font, maxWidth, textMeasurer);
          for (let i = 0; i < charLines.length - 1; i++) {
            lines.push(charLines[i]);
          }
          currentLine = charLines[charLines.length - 1] ?? '';
        }
      }
    }

    // Push remaining text
    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * Break a single word into lines at character boundaries to fit maxWidth.
 */
function breakWordToFit(
  word: string,
  font: string,
  maxWidth: number,
  textMeasurer: TextMeasurer,
): string[] {
  const lines: string[] = [];
  let current = '';

  for (const char of word) {
    const test = current + char;
    if (textMeasurer.measureText(test, font).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = char;
    }
  }

  if (current) lines.push(current);
  return lines;
}

// =============================================================================
// Multi-Line Text Rendering
// =============================================================================

/** Options for renderWrappedText */
export interface RenderWrappedTextOptions {
  /** Whether the cell has a hyperlink */
  hasHyperlink: boolean;
  /** Whether this is a cut cell (renders at 50% opacity) */
  isCutCell: boolean;
  /** Theme definition for font and color resolution */
  theme: ThemeDefinition;
  /** Text measurer for width calculations */
  textMeasurer: TextMeasurer;
  /** CF font color override (takes priority over all other color sources) */
  fontColorOverride?: string | null;
  /** Renderer default for automatic font color. Explicit format colors remain exact. */
  defaultFontColor?: string;
}

/**
 * Render wrapped (multi-line) text in a cell.
 *
 * When wrapText is enabled, text that exceeds the cell width is wrapped
 * to multiple lines. Also handles explicit newlines (\n from Alt+Enter).
 *
 * @param ctx - Canvas rendering context
 * @param cellInfo - Per-cell computed render data
 * @param format - Cell format
 * @param options - Rendering options
 */
export function renderWrappedText(
  ctx: CanvasRenderingContext2D,
  cellInfo: CellRenderInfo,
  format: CellFormat | undefined,
  options: RenderWrappedTextOptions,
): void {
  const { displayText, x, y, width, height, value } = cellInfo;
  if (!displayText) return;

  const style = getCellStyle(format, options.theme, options.defaultFontColor);
  const font = buildCellFont(format, options.theme, displayText);
  ctx.font = font;

  const horizontalAlign = mapHorizontalAlign(format?.horizontalAlign, value);
  const verticalAlign = mapVerticalAlign(format?.verticalAlign);
  const basePadding = style.paddingX;
  const indentPixels = (format?.indent ?? 0) * 8;
  const paddingX = basePadding + indentPixels;
  const paddingY = basePadding;
  const fontSize = style.fontSize;
  const lineHeight = fontSize * 1.2;

  // Calculate available width and wrap text
  const availableWidth = width - paddingX * 2;
  const lines = wrapTextToLines(displayText, font, availableWidth, options.textMeasurer);

  // Calculate vertical starting position
  const totalTextHeight = lines.length * lineHeight;
  const startY = computeMultiLineStartY(
    y,
    height,
    paddingY,
    totalTextHeight,
    lineHeight,
    verticalAlign,
  );

  // Set canvas properties
  ctx.textAlign = horizontalAlign === 'justify' ? 'left' : horizontalAlign;
  ctx.textBaseline = 'top';

  // Set fill color (CF override > hyperlink blue > resolved font color)
  if (options.fontColorOverride) {
    ctx.fillStyle = options.fontColorOverride;
  } else if (options.hasHyperlink && !hasExplicitFontColor(format)) {
    ctx.fillStyle = '#0563C1';
  } else {
    ctx.fillStyle = style.color;
  }

  ctx.save();
  clipTextToCell(ctx, x, y, width, height);

  // Cut cell dimming
  if (options.isCutCell) {
    ctx.globalAlpha = 0.5;
  }

  // Font shadow
  if (format?.fontShadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.shadowBlur = 1;
  }

  // Render each line
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineY = startY + i * lineHeight;

    // Skip lines outside cell bounds (clipping)
    if (lineY + lineHeight < y || lineY > y + height) {
      continue;
    }

    const lineX = computeLineX(x, width, paddingX, horizontalAlign);

    // Font outline
    if (format?.fontOutline) {
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 1;
      ctx.strokeText(lineText, lineX, lineY);
      ctx.fillText(lineText, lineX, lineY);
    } else {
      ctx.fillText(lineText, lineX, lineY);
    }

    // Text decorations for each line
    if (
      options.hasHyperlink ||
      (format?.underlineType && format.underlineType !== 'none') ||
      format?.strikethrough
    ) {
      renderTextDecorations(
        ctx,
        lineText,
        lineX,
        lineY,
        ctx.textBaseline,
        fontSize,
        format,
        options.hasHyperlink,
        style,
      );
    }
  }

  // Clear shadow
  if (format?.fontShadow) {
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

// =============================================================================
// Position Helpers
// =============================================================================

/**
 * Compute the starting Y position for multi-line text.
 */
function computeMultiLineStartY(
  cellY: number,
  cellHeight: number,
  paddingY: number,
  totalTextHeight: number,
  _lineHeight: number,
  verticalAlign: CanvasVAlign,
): number {
  const availableHeight = cellHeight - paddingY * 2;
  switch (verticalAlign) {
    case 'top':
      return cellY + paddingY;
    case 'middle':
      return cellY + paddingY + (availableHeight - totalTextHeight) / 2;
    case 'bottom':
      return cellY + paddingY + availableHeight - totalTextHeight;
    default:
      return cellY + paddingY;
  }
}

/**
 * Compute the X position for a line based on horizontal alignment.
 */
function computeLineX(
  cellX: number,
  cellWidth: number,
  paddingX: number,
  align: CanvasHAlign,
): number {
  switch (align) {
    case 'center':
      return cellX + cellWidth / 2;
    case 'right':
      return cellX + cellWidth - paddingX;
    case 'left':
    case 'justify':
    default:
      return cellX + paddingX;
  }
}
