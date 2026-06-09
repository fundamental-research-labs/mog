/**
 * Normal Text Rendering
 *
 * Single-line text rendering with alignment, decorations, and overflow handling.
 * Performance critical: These functions run in a 60fps render loop.
 * Avoid per-call allocations where possible.
 *
 * @module grid-renderer/cells/text
 */

import type { TextMeasurer } from '@mog/canvas-engine';
import type { CellTextStyle } from '@mog-sdk/contracts/cell-style';
import {
  isAutomaticDefaultFontColor,
  resolveCellTextStyle,
} from '@mog/spreadsheet-utils/cells/cell-style';
import type { CellFormat } from '@mog-sdk/contracts/core';
import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import { resolveThemeFonts } from '@mog/spreadsheet-utils/formatting/theme';
import {
  buildFontFamilyWithFallbacks,
  getCachedCJKInfo,
  getCJKFallbackChain,
  getIntrinsicFontWeight,
} from '../shared/font-utils';
import { OFFICE_THEME } from '../shared/theme-constants';
import type { CellRenderInfo } from './types';

// =============================================================================
// Types
// =============================================================================

/** Horizontal alignment for canvas rendering */
export type CanvasHAlign = 'left' | 'center' | 'right' | 'justify';

/** Vertical alignment for canvas rendering */
export type CanvasVAlign = 'top' | 'middle' | 'bottom';

/** Options for renderNormalText */
export interface RenderTextOptions {
  /** Whether the cell has a hyperlink */
  hasHyperlink: boolean;
  /** Whether this is a cut cell (renders at 50% opacity) */
  isCutCell: boolean;
  /** Theme definition for font and color resolution */
  theme: ThemeDefinition;
  /** Text measurer for width calculations */
  textMeasurer: TextMeasurer;
  /** Overflow result from text overflow calculation */
  overflowResult: OverflowResult | null;
  /** CF font color override (takes priority over all other color sources) */
  fontColorOverride?: string | null;
  /** Renderer default for automatic font color. Explicit format colors remain exact. */
  defaultFontColor?: string;
}

/** Result of text overflow calculation */
export interface OverflowResult {
  /** X position to start rendering (may differ from cell x for overflow) */
  renderX: number;
  /** Total width available for rendering (cell + overflow space) */
  renderWidth: number;
  /** Whether overflow was blocked (text will be clipped with ellipsis) */
  isClipped: boolean;
  /** Start column of overflow range (only set when overflow extends beyond the cell) */
  overflowStartCol?: number;
  /** End column of overflow range (only set when overflow extends beyond the cell) */
  overflowEndCol?: number;
}

// =============================================================================
// Font String Cache
// =============================================================================

/**
 * Cache key for font strings to avoid per-cell string allocation.
 * Key is a composite of the properties that affect the font string.
 */
const fontStringCache = new Map<string, string>();
const MAX_FONT_CACHE_SIZE = 5000;
const VERTICAL_CLIP_HORIZONTAL_MARGIN = 1_000_000;

/**
 * Clip text paint to the row's vertical interior while leaving horizontal
 * spreadsheet overflow intact.
 */
export function clipTextVertically(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.beginPath();
  ctx.rect(
    x - VERTICAL_CLIP_HORIZONTAL_MARGIN,
    y,
    width + VERTICAL_CLIP_HORIZONTAL_MARGIN * 2,
    height,
  );
  ctx.clip();
}

/** Clip text paint to the cell rectangle for paths that intentionally wrap. */
export function clipTextToCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
}

function buildFontCacheKey(
  fontFamily: string,
  fontSize: number,
  bold: boolean,
  italic: boolean,
  superscript: boolean,
  subscript: boolean,
  cellContent?: string,
): string {
  // CJK info only affects font family fallback, so include lang detection
  let cjkKey = '';
  if (cellContent) {
    const { hasCJK, lang } = getCachedCJKInfo(cellContent);
    if (hasCJK && lang) {
      cjkKey = lang;
    }
  }
  return `${fontFamily}|${fontSize}|${bold ? 1 : 0}|${italic ? 1 : 0}|${superscript ? 1 : 0}|${subscript ? 1 : 0}|${cjkKey}`;
}

/**
 * Build a canvas font string from cell format with caching.
 *
 * Follows CSS font shorthand order: [font-style] [font-weight] font-size font-family
 *
 * @param format - Cell format (or undefined for defaults)
 * @param theme - Theme for resolving theme font references
 * @param cellContent - Optional cell content for CJK detection
 * @returns Canvas font string (e.g., "bold 14px Calibri, Carlito, sans-serif")
 */
export function buildCellFont(
  format: CellFormat | undefined,
  theme: ThemeDefinition = OFFICE_THEME,
  cellContent?: string,
): string {
  // Only resolve theme fonts (e.g. fontTheme: 'major'/'minor' → actual font family).
  // Theme colors are already resolved to hex by the Rust viewport wire.
  const resolvedFormat = resolveThemeFonts(format, theme);
  const style = resolveCellTextStyle(resolvedFormat);

  const fontFamily = style.fontFamily.split(',')[0].trim().replace(/["']/g, '');
  const cacheKey = buildFontCacheKey(
    fontFamily,
    style.fontSize,
    style.fontWeight === 'bold',
    style.fontStyle === 'italic',
    format?.superscript ?? false,
    format?.subscript ?? false,
    cellContent,
  );

  const cached = fontStringCache.get(cacheKey);
  if (cached) return cached;

  const parts: string[] = [];
  const intrinsicWeight = getIntrinsicFontWeight(fontFamily);

  if (style.fontStyle === 'italic') {
    parts.push('italic');
  }
  if (intrinsicWeight != null) {
    parts.push(String(intrinsicWeight));
  } else if (style.fontWeight === 'bold') {
    parts.push('bold');
  }

  // Superscript/subscript render at 70% font size
  let fontSize = style.fontSize;
  if (format?.superscript || format?.subscript) {
    fontSize = Math.round(fontSize * 0.7);
  }
  parts.push(`${fontSize}px`);

  // Build font family with metric-compatible fallbacks
  let fontFamilyStr = buildFontFamilyWithFallbacks(fontFamily);

  // Add CJK fallback chain if needed
  if (cellContent) {
    const { hasCJK, lang } = getCachedCJKInfo(cellContent);
    if (hasCJK && lang) {
      const cjkFallback = getCJKFallbackChain(lang);
      fontFamilyStr = fontFamilyStr.replace(/, sans-serif$/, `, ${cjkFallback}`);
    }
  }
  parts.push(fontFamilyStr);

  const result = parts.join(' ');

  // Evict cache if too large
  if (fontStringCache.size >= MAX_FONT_CACHE_SIZE) {
    fontStringCache.clear();
  }
  fontStringCache.set(cacheKey, result);

  return result;
}

/** Clear the font string cache (for testing or theme changes). */
export function clearFontCache(): void {
  fontStringCache.clear();
}

// =============================================================================
// Resolved Style Helper
// =============================================================================

/**
 * Get the resolved cell text style with theme colors applied.
 *
 * @param format - Cell format (or undefined for defaults)
 * @param theme - Theme for resolving theme color references
 * @returns Complete resolved style
 */
export function getCellStyle(
  format: CellFormat | undefined,
  theme: ThemeDefinition = OFFICE_THEME,
  defaultFontColor?: string,
): CellTextStyle {
  // Only resolve theme fonts — colors are pre-resolved hex from the Rust wire.
  const resolvedFormat = resolveThemeFonts(format, theme);
  return resolveCellTextStyle(resolvedFormat, undefined, defaultFontColor);
}

export function hasExplicitFontColor(format: Pick<CellFormat, 'fontColor'> | undefined): boolean {
  return !!format?.fontColor && !isAutomaticDefaultFontColor(format.fontColor);
}

// =============================================================================
// Alignment Helpers
// =============================================================================

/**
 * Get default alignment based on value type.
 * Numbers align right, booleans center, text aligns left (Excel behavior).
 */
export function getDefaultAlignment(value: unknown): 'left' | 'center' | 'right' {
  if (typeof value === 'number') return 'right';
  if (typeof value === 'boolean') return 'center';
  return 'left';
}

/**
 * Map CellFormat horizontalAlign to canvas-compatible alignment.
 * 'general' resolves based on value type (right for numbers, left for text).
 */
export function mapHorizontalAlign(
  align: CellFormat['horizontalAlign'] | undefined,
  value: unknown,
): CanvasHAlign {
  if (!align || align === 'general') {
    return getDefaultAlignment(value);
  }
  switch (align) {
    case 'fill':
      return 'left';
    case 'centerContinuous':
      return 'center';
    case 'distributed':
      return 'justify';
    case 'left':
    case 'center':
    case 'right':
    case 'justify':
      return align;
  }
  return 'left';
}

/**
 * Map canonical verticalAlign to canvas-compatible alignment.
 */
export function mapVerticalAlign(align: CellFormat['verticalAlign'] | undefined): CanvasVAlign {
  switch (align) {
    case 'top':
      return 'top';
    case 'middle':
      return 'middle';
    case 'justify':
    case 'distributed':
      return 'top'; // justify/distributed handle their own positioning
    case 'bottom':
      return 'bottom';
    default:
      return 'bottom'; // Excel default is bottom
  }
}

// =============================================================================
// Normal Text Rendering
// =============================================================================

/** Hyperlink color (Excel standard blue) */
const HYPERLINK_COLOR = '#0563C1';

/**
 * Render normal (non-rotated) text in a cell.
 *
 * Handles:
 * - Single-line text rendering
 * - Horizontal alignment (left/center/right/general)
 * - Vertical alignment (top/middle/bottom)
 * - Padding and indent
 * - Text decorations: underline, strikethrough
 * - Superscript/subscript vertical shift
 * - Hyperlink styling (blue, underline)
 * - Cut cell dimming (50% opacity)
 * - Font shadow and outline effects
 *
 * @param ctx - Canvas rendering context
 * @param cellInfo - Per-cell computed render data
 * @param format - Cell format
 * @param textMeasurer - Text measurer for width calculations
 * @param options - Additional rendering options
 */
export function renderNormalText(
  ctx: CanvasRenderingContext2D,
  cellInfo: CellRenderInfo,
  format: CellFormat | undefined,
  textMeasurer: TextMeasurer,
  options: RenderTextOptions,
): void {
  const { displayText, x, y, width, height, value } = cellInfo;
  if (!displayText) return;

  const style = getCellStyle(format, options.theme, options.defaultFontColor);
  const font = buildCellFont(format, options.theme, displayText);
  ctx.font = font;

  const horizontalAlign = mapHorizontalAlign(format?.horizontalAlign, value);
  const verticalAlign = mapVerticalAlign(format?.verticalAlign);

  // Calculate padding (indent adds to paddingX)
  const basePadding = style.paddingX;
  const indentPixels = (format?.indent ?? 0) * 8;
  const paddingX = basePadding + indentPixels;
  const paddingY = basePadding;

  const fontSize =
    format?.superscript || format?.subscript ? Math.round(style.fontSize * 0.7) : style.fontSize;

  // Determine render text and bounds based on overflow
  let renderText = displayText;
  let effectiveWidth = width;
  let effectiveX = x;

  if (options.overflowResult?.isClipped) {
    const availableWidth = width - paddingX * 2;
    const ellipsis = '\u2026';
    const ellipsisWidth = textMeasurer.measureText(ellipsis, font).width;
    renderText =
      truncateTextToFit(textMeasurer, font, displayText, availableWidth - ellipsisWidth) + ellipsis;
  } else if (options.overflowResult && !options.overflowResult.isClipped) {
    effectiveX = options.overflowResult.renderX;
    effectiveWidth = options.overflowResult.renderWidth;
  }

  // Calculate text position
  const textX = computeTextX(effectiveX, effectiveWidth, paddingX, horizontalAlign);
  let textY = computeTextY(y, height, paddingY, fontSize, verticalAlign);

  // Set canvas properties
  ctx.textAlign = horizontalAlign === 'justify' ? 'left' : horizontalAlign;
  ctx.textBaseline =
    verticalAlign === 'middle' ? 'middle' : verticalAlign === 'bottom' ? 'alphabetic' : 'top';

  // Superscript/subscript vertical shift
  if (format?.superscript) {
    textY -= style.fontSize * 0.4;
  } else if (format?.subscript) {
    textY += style.fontSize * 0.3;
  }

  // Set fill color (CF override > hyperlink blue > resolved font color)
  if (options.fontColorOverride) {
    ctx.fillStyle = options.fontColorOverride;
  } else if (options.hasHyperlink && !hasExplicitFontColor(format)) {
    ctx.fillStyle = HYPERLINK_COLOR;
  } else {
    ctx.fillStyle = style.color;
  }

  ctx.save();
  clipTextVertically(ctx, effectiveX, y, effectiveWidth, height);

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

  // Font outline
  if (format?.fontOutline) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1;
    ctx.strokeText(renderText, textX, textY);
    ctx.fillText(renderText, textX, textY);
  } else {
    ctx.fillText(renderText, textX, textY);
  }

  // Clear shadow
  if (format?.fontShadow) {
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 0;
  }

  // Text decorations (underline, strikethrough)
  renderTextDecorations(
    ctx,
    renderText,
    textX,
    textY,
    ctx.textBaseline,
    fontSize,
    format,
    options.hasHyperlink,
    style,
  );

  ctx.restore();
}

// =============================================================================
// Text Position Calculation
// =============================================================================

/**
 * Compute text X position based on horizontal alignment.
 */
function computeTextX(
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

/**
 * Compute text Y position based on vertical alignment.
 */
function computeTextY(
  cellY: number,
  cellHeight: number,
  paddingY: number,
  fontSize: number,
  align: CanvasVAlign,
): number {
  const lineHeight = fontSize * 1.2;
  switch (align) {
    case 'top':
      return cellY + paddingY;
    case 'middle':
      return cellY + cellHeight / 2;
    case 'bottom':
      return cellY + cellHeight - paddingY;
    default:
      // Default bottom (Excel default) - position at baseline
      return cellY + paddingY + (cellHeight - paddingY * 2 - lineHeight) / 2 + fontSize;
  }
}

// =============================================================================
// Text Truncation
// =============================================================================

/**
 * Truncate text to fit within a given width using binary search.
 *
 * @param measurer - Text measurer
 * @param font - Canvas font string
 * @param text - Text to truncate
 * @param maxWidth - Maximum width in pixels
 * @returns Truncated text
 */
export function truncateTextToFit(
  measurer: TextMeasurer,
  font: string,
  text: string,
  maxWidth: number,
): string {
  if (measurer.measureText(text, font).width <= maxWidth) return text;
  if (maxWidth <= 0) return '';

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measurer.measureText(text.slice(0, mid), font).width <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low);
}

// =============================================================================
// Text Decorations
// =============================================================================

/**
 * Compute the baseline Y position from textY and textBaseline setting.
 *
 * Uses fixed font proportions (80% ascent, 20% descent) for consistent
 * decoration positioning across different textBaseline settings.
 */
export function computeBaselineY(
  textY: number,
  textBaseline: CanvasTextBaseline,
  fontSize: number,
): number {
  const alphabeticAscent = fontSize * 0.8;
  const alphabeticDescent = fontSize * 0.2;

  switch (textBaseline) {
    case 'top':
      return textY + alphabeticAscent;
    case 'middle':
      return textY + (alphabeticAscent - alphabeticDescent) / 2;
    case 'bottom':
      return textY - alphabeticDescent;
    case 'alphabetic':
    case 'ideographic':
    case 'hanging':
    default:
      return textY;
  }
}

/**
 * Render text decorations (underline, strikethrough).
 *
 * @param ctx - Canvas rendering context
 * @param text - Text (used for width calculation)
 * @param textX - Text x position
 * @param textY - Text y position
 * @param textBaseline - Current canvas textBaseline setting
 * @param fontSize - Font size
 * @param format - Cell format
 * @param hasHyperlink - Whether cell has hyperlink
 * @param style - Resolved cell style
 */
export function renderTextDecorations(
  ctx: CanvasRenderingContext2D,
  text: string,
  textX: number,
  textY: number,
  textBaseline: CanvasTextBaseline,
  fontSize: number,
  format: CellFormat | undefined,
  hasHyperlink: boolean,
  style: CellTextStyle,
): void {
  const shouldUnderline =
    hasHyperlink || (format?.underlineType && format.underlineType !== 'none');
  if (!shouldUnderline && !format?.strikethrough) {
    return;
  }

  const textWidth = ctx.measureText(text).width;
  const alphabeticAscent = fontSize * 0.8;
  const alphabeticDescent = fontSize * 0.2;
  const baselineY = computeBaselineY(textY, textBaseline, fontSize);

  // Compute decoration start X based on text alignment
  let decorationX = textX;
  const currentAlign = ctx.textAlign;
  if (currentAlign === 'center') {
    decorationX = textX - textWidth / 2;
  } else if (currentAlign === 'right') {
    decorationX = textX - textWidth;
  }

  // Use hyperlink color for decoration if applicable
  if (hasHyperlink && !hasExplicitFontColor(format)) {
    ctx.strokeStyle = HYPERLINK_COLOR;
  } else {
    ctx.strokeStyle = style.color;
  }
  ctx.lineWidth = 1;

  if (shouldUnderline) {
    const underlineY = baselineY + Math.max(1, alphabeticDescent * 0.3);
    const underlineType = format?.underlineType;

    ctx.beginPath();
    ctx.moveTo(decorationX, underlineY);
    ctx.lineTo(decorationX + textWidth, underlineY);
    ctx.stroke();

    // Double underline (2px below first line)
    if (underlineType === 'double' || underlineType === 'doubleAccounting') {
      ctx.beginPath();
      ctx.moveTo(decorationX, underlineY + 2);
      ctx.lineTo(decorationX + textWidth, underlineY + 2);
      ctx.stroke();
    }
  }

  if (format?.strikethrough) {
    const strikeY = baselineY - alphabeticAscent * 0.4;
    ctx.beginPath();
    ctx.moveTo(decorationX, strikeY);
    ctx.lineTo(decorationX + textWidth, strikeY);
    ctx.stroke();
  }
}
