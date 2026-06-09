/**
 * Shrink-to-Fit
 *
 * Progressively reduces font size to fit all text within the cell width.
 * This matches Excel's "Shrink to fit" alignment option.
 *
 * When shrinkToFit is enabled:
 * - Text is never clipped or wrapped
 * - Font size is reduced until all text fits within the cell width
 * - Minimum font size is clamped to prevent illegible text
 * - Mutually exclusive with wrapText in Excel behavior
 *
 * @module grid-renderer/cells/shrink-to-fit
 */

import type { TextMeasurer } from '@mog/canvas-engine';
import type { CellFormat } from '@mog-sdk/contracts/core';
import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import {
  buildCellFont,
  clipTextVertically,
  getCellStyle,
  hasExplicitFontColor,
  mapHorizontalAlign,
  mapVerticalAlign,
  renderTextDecorations,
} from './text';
import type { CellRenderInfo } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Minimum font size when shrinking (prevents illegible text) */
const MIN_SHRINK_FONT_SIZE = 1;

/** Maximum iterations for binary search shrink */
const MAX_SHRINK_ITERATIONS = 20;

// =============================================================================
// Shrink-to-Fit Rendering
// =============================================================================

/** Options for renderShrinkToFit */
export interface RenderShrinkToFitOptions {
  /** Whether the cell has a hyperlink */
  hasHyperlink: boolean;
  /** Whether this is a cut cell */
  isCutCell: boolean;
  /** Theme definition */
  theme: ThemeDefinition;
  /** Text measurer for width calculations */
  textMeasurer: TextMeasurer;
  /** CF font color override (takes priority over all other color sources) */
  fontColorOverride?: string | null;
  /** Renderer default for automatic font color. Explicit format colors remain exact. */
  defaultFontColor?: string;
}

/**
 * Calculate the font size needed to fit text within the cell width.
 *
 * Uses binary search between MIN_SHRINK_FONT_SIZE and the original font size
 * to find the largest font size that still fits.
 *
 * @param text - Text to measure
 * @param originalFontSize - Starting font size
 * @param format - Cell format (for font family, bold, italic)
 * @param theme - Theme for font resolution
 * @param availableWidth - Available width in pixels
 * @param textMeasurer - Text measurer
 * @returns The computed font size that fits
 */
export function calculateShrunkFontSize(
  text: string,
  originalFontSize: number,
  format: CellFormat | undefined,
  theme: ThemeDefinition,
  availableWidth: number,
  textMeasurer: TextMeasurer,
): number {
  if (availableWidth <= 0) return MIN_SHRINK_FONT_SIZE;

  // Check if original size fits
  const originalFont = buildCellFont(format, theme, text);
  const originalWidth = textMeasurer.measureText(text, originalFont).width;
  if (originalWidth <= availableWidth) {
    return originalFontSize;
  }

  // Quick estimate: scale proportionally as starting point
  const estimatedSize = Math.max(
    MIN_SHRINK_FONT_SIZE,
    Math.floor(originalFontSize * (availableWidth / originalWidth)),
  );

  // Binary search for the largest font size that fits
  let low = MIN_SHRINK_FONT_SIZE;
  let high = Math.min(estimatedSize + 2, originalFontSize);

  for (let i = 0; i < MAX_SHRINK_ITERATIONS && low < high; i++) {
    const mid = Math.ceil((low + high) / 2);

    // Build a format with the test font size
    const testFormat: CellFormat = { ...format, fontSize: mid };
    const testFont = buildCellFont(testFormat, theme, text);
    const testWidth = textMeasurer.measureText(text, testFont).width;

    if (testWidth <= availableWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return Math.max(MIN_SHRINK_FONT_SIZE, low);
}

/**
 * Render text with shrink-to-fit enabled.
 *
 * Calculates the optimal font size to fit all text within the cell width,
 * then renders with that reduced font size.
 *
 * @param ctx - Canvas rendering context
 * @param cellInfo - Per-cell computed render data
 * @param format - Cell format
 * @param options - Rendering options
 */
export function renderShrinkToFit(
  ctx: CanvasRenderingContext2D,
  cellInfo: CellRenderInfo,
  format: CellFormat | undefined,
  options: RenderShrinkToFitOptions,
): void {
  const { displayText, x, y, width, height, value } = cellInfo;
  if (!displayText) return;

  const style = getCellStyle(format, options.theme, options.defaultFontColor);
  const basePadding = style.paddingX;
  const indentPixels = (format?.indent ?? 0) * 8;
  const paddingX = basePadding + indentPixels;
  const paddingY = basePadding;
  const availableWidth = width - paddingX * 2;

  const horizontalAlign = mapHorizontalAlign(format?.horizontalAlign, value);
  const verticalAlign = mapVerticalAlign(format?.verticalAlign);

  // Calculate shrunk font size
  const shrunkSize = calculateShrunkFontSize(
    displayText,
    style.fontSize,
    format,
    options.theme,
    availableWidth,
    options.textMeasurer,
  );

  // Build font with shrunk size
  const shrunkFormat: CellFormat = { ...format, fontSize: shrunkSize };
  const font = buildCellFont(shrunkFormat, options.theme, displayText);
  ctx.font = font;

  const lineHeight = shrunkSize * 1.2;

  // Calculate text position
  let textX: number;
  ctx.textAlign = horizontalAlign === 'justify' ? 'left' : horizontalAlign;
  switch (horizontalAlign) {
    case 'center':
      textX = x + width / 2;
      break;
    case 'right':
      textX = x + width - paddingX;
      break;
    default:
      textX = x + paddingX;
  }

  let textY: number;
  switch (verticalAlign) {
    case 'top':
      ctx.textBaseline = 'top';
      textY = y + paddingY;
      break;
    case 'middle':
      ctx.textBaseline = 'middle';
      textY = y + height / 2;
      break;
    case 'bottom':
    default:
      ctx.textBaseline = 'alphabetic';
      textY = y + paddingY + (height - paddingY * 2 - lineHeight) / 2 + shrunkSize;
  }

  // Set fill color (CF override > hyperlink blue > resolved font color)
  if (options.fontColorOverride) {
    ctx.fillStyle = options.fontColorOverride;
  } else if (options.hasHyperlink && !hasExplicitFontColor(format)) {
    ctx.fillStyle = '#0563C1';
  } else {
    ctx.fillStyle = style.color;
  }

  ctx.save();
  clipTextVertically(ctx, x, y, width, height);

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

  // Render text
  if (format?.fontOutline) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1;
    ctx.strokeText(displayText, textX, textY);
    ctx.fillText(displayText, textX, textY);
  } else {
    ctx.fillText(displayText, textX, textY);
  }

  // Clear shadow
  if (format?.fontShadow) {
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 0;
  }

  // Text decorations
  renderTextDecorations(
    ctx,
    displayText,
    textX,
    textY,
    ctx.textBaseline,
    shrunkSize,
    format,
    options.hasHyperlink,
    style,
  );

  ctx.restore();
}
