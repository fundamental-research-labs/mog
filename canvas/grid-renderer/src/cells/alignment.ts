/**
 * Special Alignment Renderers
 *
 * Handles Excel's special alignment modes:
 * - Fill: Repeat text to fill cell width
 * - CenterContinuous: Center across empty adjacent cells
 * - Distributed horizontal: Spread characters evenly across cell width
 * - Justify vertical: Spread lines evenly across cell height
 * - Distributed vertical: Like justify, with spacing above/below
 * - Accounting: Left-aligned currency symbol, right-aligned number
 *
 * @module grid-renderer/cells/alignment
 */

import type { CellFormat } from '@mog-sdk/contracts/core';
import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import {
  buildCellFont,
  getCellStyle,
  mapVerticalAlign,
  renderTextDecorations,
  type CanvasVAlign,
} from './text';

// =============================================================================
// Fill Alignment
// =============================================================================

/**
 * Render text with 'fill' alignment.
 * Repeats text pattern until cell width is filled.
 *
 * @param ctx - Canvas rendering context
 * @param text - Text to render
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 * @param format - Cell format
 * @param theme - Theme definition
 */
export function renderFillAlignmentText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  format: CellFormat | undefined,
  theme: ThemeDefinition,
  fontColorOverride?: string | null,
  defaultFontColor?: string,
): void {
  if (!text || text.length === 0) return;

  const style = getCellStyle(format, theme, defaultFontColor);
  const font = buildCellFont(format, theme, text);
  ctx.font = font;

  const paddingX = style.paddingX + (format?.indent ?? 0) * 8;
  const paddingY = style.paddingX;
  const verticalAlign = mapVerticalAlign(format?.verticalAlign);

  // Measure single instance of text
  const textWidth = ctx.measureText(text).width;
  if (textWidth <= 0) return;

  // Calculate available width
  const availableWidth = width - paddingX * 2;
  if (availableWidth <= 0) return;

  // Calculate how many repetitions fit
  const repetitions = Math.ceil(availableWidth / textWidth);
  if (repetitions <= 0) return;
  const repeatedText = text.repeat(repetitions);

  // Calculate vertical position
  let textY: number;
  ctx.textBaseline =
    verticalAlign === 'middle' ? 'middle' : verticalAlign === 'bottom' ? 'bottom' : 'top';

  switch (verticalAlign) {
    case 'middle':
      textY = y + height / 2;
      break;
    case 'bottom':
      textY = y + height - paddingY;
      break;
    default:
      textY = y + paddingY;
  }

  // Clip to cell bounds and render
  ctx.save();
  ctx.fillStyle = fontColorOverride || style.color;
  ctx.beginPath();
  ctx.rect(x + paddingX, y, availableWidth, height);
  ctx.clip();

  ctx.textAlign = 'left';
  ctx.fillText(repeatedText, x + paddingX, textY);

  ctx.restore();
}

// =============================================================================
// Center Continuous Alignment
// =============================================================================

/** Context needed to check adjacent cells for centerContinuous alignment */
export interface CenterContinuousContext {
  /** Position index for column widths */
  positionIndex: ViewportPositionIndex;
  /** Total number of columns */
  totalCols: number;
  /** Check if a cell at (row, col) is empty (null/empty value or out of viewport) */
  isCellEmpty: (row: number, col: number) => boolean;
  /** Peek at the format of a cell at (row, col) without moving the cursor */
  peekFormat: (row: number, col: number) => CellFormat | undefined;
}

/**
 * Render text with 'centerContinuous' alignment.
 * Centers text across cell and adjacent empty cells that also have
 * centerContinuous alignment.
 *
 * @param ctx - Canvas rendering context
 * @param text - Text to render
 * @param row - Cell row index
 * @param col - Cell column index
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 * @param format - Cell format
 * @param theme - Theme definition
 * @param context - Adjacent cell lookup context
 */
export function renderCenterContinuousText(
  ctx: CanvasRenderingContext2D,
  text: string,
  row: number,
  col: number,
  x: number,
  y: number,
  width: number,
  height: number,
  format: CellFormat | undefined,
  theme: ThemeDefinition,
  context: CenterContinuousContext,
  fontColorOverride?: string | null,
  defaultFontColor?: string,
): { extendedStartCol: number; extendedEndCol: number } | undefined {
  if (!text || text.length === 0) return undefined;

  const style = getCellStyle(format, theme, defaultFontColor);
  const font = buildCellFont(format, theme, text);
  ctx.font = font;

  const paddingY = style.paddingX;
  const verticalAlign = mapVerticalAlign(format?.verticalAlign);

  // Leading blank cells belong to the first non-empty source in a contiguous
  // centerContinuous run. Interior blanks between two sources belong to the
  // source on their left, so a later source must not claim them.
  let leftExtension = 0;
  let startCol = col;
  let c = col - 1;
  let blockedByLeftSource = false;
  while (c >= 0) {
    const adjacentFormat = context.peekFormat(row, c);
    if (adjacentFormat?.horizontalAlign !== 'centerContinuous') break;
    if (!context.isCellEmpty(row, c)) {
      blockedByLeftSource = true;
      break;
    }
    leftExtension += context.positionIndex.getColWidth(c);
    startCol = c;
    c--;
  }
  if (blockedByLeftSource) {
    leftExtension = 0;
    startCol = col;
  }

  // Find empty cells to the right with centerContinuous alignment
  let rightExtension = 0;
  let endCol = col;
  c = col + 1;
  while (c < context.totalCols) {
    const adjacentFormat = context.peekFormat(row, c);
    if (adjacentFormat?.horizontalAlign !== 'centerContinuous') break;
    if (!context.isCellEmpty(row, c)) break;
    rightExtension += context.positionIndex.getColWidth(c);
    endCol = c;
    c++;
  }

  // Calculate extended bounds
  const extendedX = x - leftExtension;
  const extendedWidth = width + leftExtension + rightExtension;

  // Calculate vertical position
  let textY: number;
  ctx.textBaseline =
    verticalAlign === 'middle' ? 'middle' : verticalAlign === 'bottom' ? 'bottom' : 'top';

  switch (verticalAlign) {
    case 'middle':
      textY = y + height / 2;
      break;
    case 'bottom':
      textY = y + height - paddingY;
      break;
    default:
      textY = y + paddingY;
  }

  // Center text in extended width
  ctx.textAlign = 'center';
  ctx.fillStyle = fontColorOverride || style.color;
  const textX = extendedX + extendedWidth / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(extendedX, y, extendedWidth, height);
  ctx.clip();
  ctx.fillText(text, textX, textY);
  ctx.restore();

  // Return column extent if extension happened
  if (startCol === col && endCol === col) {
    return undefined;
  }
  return { extendedStartCol: startCol, extendedEndCol: endCol };
}

// =============================================================================
// Distributed Horizontal Alignment
// =============================================================================

/**
 * Render text with 'distributed' horizontal alignment.
 * Spreads characters evenly across cell width.
 *
 * @param ctx - Canvas rendering context
 * @param text - Text to render
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 * @param format - Cell format
 * @param theme - Theme definition
 */
export function renderDistributedHorizontalText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  format: CellFormat | undefined,
  theme: ThemeDefinition,
  fontColorOverride?: string | null,
  defaultFontColor?: string,
): void {
  if (!text || text.length === 0) return;

  const style = getCellStyle(format, theme, defaultFontColor);
  const font = buildCellFont(format, theme, text);
  ctx.font = font;

  const paddingX = style.paddingX + (format?.indent ?? 0) * 8;
  const paddingY = style.paddingX;
  const verticalAlign = mapVerticalAlign(format?.verticalAlign);

  const chars = [...text]; // Handle Unicode correctly
  if (chars.length === 0) return;

  const availableWidth = width - paddingX * 2;
  if (availableWidth <= 0) return;

  // Calculate vertical position
  let textY: number;
  ctx.textBaseline =
    verticalAlign === 'middle' ? 'middle' : verticalAlign === 'bottom' ? 'bottom' : 'top';

  switch (verticalAlign) {
    case 'middle':
      textY = y + height / 2;
      break;
    case 'bottom':
      textY = y + height - paddingY;
      break;
    default:
      textY = y + paddingY;
  }

  ctx.fillStyle = fontColorOverride || style.color;

  // For single character, just center it
  if (chars.length === 1) {
    ctx.textAlign = 'center';
    ctx.fillText(chars[0], x + width / 2, textY);
    return;
  }

  // Calculate spacing between characters
  const totalTextWidth = ctx.measureText(text).width;
  const extraSpace = availableWidth - totalTextWidth;
  const spacingPerGap = extraSpace / (chars.length - 1);

  // Render each character
  ctx.textAlign = 'left';
  let currentX = x + paddingX;

  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], currentX, textY);
    const charWidth = ctx.measureText(chars[i]).width;
    currentX += charWidth + (i < chars.length - 1 ? spacingPerGap : 0);
  }
}

// =============================================================================
// Justify/Distributed Vertical Alignment
// =============================================================================

/**
 * Render lines with 'justify' vertical alignment.
 * Spreads lines evenly across cell height.
 *
 * @param ctx - Canvas rendering context
 * @param lines - Array of text lines
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 * @param paddingX - Horizontal padding (includes indent)
 * @param paddingY - Vertical padding
 * @param horizontalAlign - Horizontal alignment
 * @param fontSize - Font size
 */
export function renderJustifyVerticalText(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
  horizontalAlign: 'left' | 'center' | 'right' | 'justify',
  fontSize: number,
): void {
  if (lines.length === 0) return;

  const availableHeight = height - paddingY * 2;
  if (availableHeight <= 0) return;

  // Single line: render centered
  if (lines.length === 1) {
    ctx.textBaseline = 'middle';
    const textY = y + height / 2;
    renderAlignedLine(ctx, lines[0], x, textY, width, paddingX, horizontalAlign);
    return;
  }

  // Calculate line spacing for justify
  const lineHeight = fontSize * 1.2;
  const totalLineHeight = lines.length * lineHeight;
  const extraSpace = availableHeight - totalLineHeight;
  const spacingPerGap = extraSpace / (lines.length - 1);

  ctx.textBaseline = 'top';

  for (let i = 0; i < lines.length; i++) {
    const lineY = y + paddingY + i * (lineHeight + spacingPerGap);
    renderAlignedLine(ctx, lines[i], x, lineY, width, paddingX, horizontalAlign);
  }
}

/**
 * Render lines with 'distributed' vertical alignment.
 * Like justify but adds extra spacing above and below.
 *
 * @param ctx - Canvas rendering context
 * @param lines - Array of text lines
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 * @param paddingX - Horizontal padding (includes indent)
 * @param paddingY - Vertical padding
 * @param horizontalAlign - Horizontal alignment
 * @param fontSize - Font size
 */
export function renderDistributedVerticalText(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
  horizontalAlign: 'left' | 'center' | 'right' | 'justify',
  fontSize: number,
): void {
  if (lines.length === 0) return;

  const availableHeight = height - paddingY * 2;
  if (availableHeight <= 0) return;

  const lineHeight = fontSize * 1.2;

  // Single line: render centered
  if (lines.length === 1) {
    ctx.textBaseline = 'middle';
    const textY = y + height / 2;
    renderAlignedLine(ctx, lines[0], x, textY, width, paddingX, horizontalAlign);
    return;
  }

  // Distributed: n+1 gaps for n lines (includes gap before first and after last)
  const totalLineHeight = lines.length * lineHeight;
  const extraSpace = availableHeight - totalLineHeight;
  const spacingPerGap = extraSpace / (lines.length + 1);

  ctx.textBaseline = 'top';

  for (let i = 0; i < lines.length; i++) {
    const lineY = y + paddingY + spacingPerGap + i * (lineHeight + spacingPerGap);
    renderAlignedLine(ctx, lines[i], x, lineY, width, paddingX, horizontalAlign);
  }
}

// =============================================================================
// Accounting Format
// =============================================================================

/**
 * Currency symbols to detect in accounting format strings.
 * Ordered by length (longest first) for greedy matching.
 */
const CURRENCY_SYMBOLS = [
  'Mex$',
  'CA$',
  'A$',
  'HK$',
  'NT$',
  'S$',
  'R$',
  'CHF',
  'AED',
  'SAR',
  '$',
  '\u20AC',
  '\u00A3',
  '\u00A5',
  '\u20B9',
  '\u20A9',
  '\u20BD',
  '\u20BA',
  '\u0E3F',
  '\u20B1',
];

/**
 * Parse an accounting-formatted string into its components.
 *
 * Accounting format produces strings like:
 * - " $ 1,234.50 " for positive
 * - " $ (1,234.50)" for negative
 * - " $     -    " for zero
 */
export function parseAccountingText(text: string): {
  currencySymbol: string;
  number: string;
  isNegative: boolean;
} {
  let currencySymbol = '';
  let currencyIndex = -1;

  for (const symbol of CURRENCY_SYMBOLS) {
    const idx = text.indexOf(symbol);
    if (idx !== -1) {
      currencySymbol = symbol;
      currencyIndex = idx;
      break;
    }
  }

  const isNegative = text.includes('(') && text.includes(')');

  let number = '';
  if (currencyIndex !== -1) {
    number = text.slice(currencyIndex + currencySymbol.length).trim();
  } else {
    number = text.trim();
  }

  return { currencySymbol, number, isNegative };
}

/**
 * Render text in Accounting format with left-aligned currency and right-aligned number.
 *
 * @param ctx - Canvas rendering context
 * @param text - Formatted accounting text
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 * @param format - Cell format
 * @param hasHyperlink - Whether cell has hyperlink
 * @param theme - Theme definition
 */
export function renderAccountingText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  format: CellFormat | undefined,
  hasHyperlink: boolean,
  theme: ThemeDefinition,
  fontColorOverride?: string | null,
  defaultFontColor?: string,
): void {
  const { currencySymbol, number } = parseAccountingText(text);

  const style = getCellStyle(format, theme, defaultFontColor);
  const font = buildCellFont(format, theme, text);
  ctx.font = font;

  const paddingX = style.paddingX;
  const paddingY = style.paddingX;
  const fontSize = style.fontSize;
  const lineHeight = fontSize * 1.2;
  const textY = y + paddingY + (height - paddingY * 2 - lineHeight) / 2 + fontSize;

  ctx.fillStyle = fontColorOverride || style.color;
  ctx.textBaseline = 'alphabetic';

  // Font shadow
  if (format?.fontShadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.shadowBlur = 1;
  }

  // Draw currency symbol at left edge
  if (currencySymbol) {
    ctx.textAlign = 'left';
    const currencyX = x + paddingX;

    if (format?.fontOutline) {
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 1;
      ctx.strokeText(currencySymbol, currencyX, textY);
    }
    ctx.fillText(currencySymbol, currencyX, textY);
  }

  // Draw number at right edge
  if (number) {
    ctx.textAlign = 'right';
    const numberX = x + width - paddingX;

    if (format?.fontOutline) {
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 1;
      ctx.strokeText(number, numberX, textY);
    }
    ctx.fillText(number, numberX, textY);

    // Draw text decorations for the number part
    if (
      hasHyperlink ||
      (format?.underlineType && format.underlineType !== 'none') ||
      format?.strikethrough
    ) {
      const numberWidth = ctx.measureText(number).width;
      renderTextDecorations(
        ctx,
        number,
        numberX - numberWidth,
        textY,
        ctx.textBaseline,
        fontSize,
        format,
        hasHyperlink,
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
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Render a single line with horizontal alignment.
 */
function renderAlignedLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  padding: number,
  horizontalAlign: 'left' | 'center' | 'right' | 'justify',
): void {
  let textX: number;
  ctx.textAlign =
    horizontalAlign === 'center' ? 'center' : horizontalAlign === 'right' ? 'right' : 'left';

  switch (horizontalAlign) {
    case 'center':
      textX = x + width / 2;
      break;
    case 'right':
      textX = x + width - padding;
      break;
    default:
      textX = x + padding;
  }

  ctx.fillText(text, textX, y);
}
