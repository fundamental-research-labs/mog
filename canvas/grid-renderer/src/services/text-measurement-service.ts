/**
 * Unified Text Measurement Service
 *
 * Consolidated text measurement and layout service for canvas rendering.
 * Combines functionality from:
 * - autofit/text-measurement.ts (measurement functions)
 * - rendering/text-measurement-service-impl.ts (service wrapper)
 * - services/text-layout-service.ts (layout for shapes)
 * - optimization/text-measurement-cache.ts (LRU cache)
 *
 *
 * @module canvas/services/text-measurement-service
 */

import { DEFAULT_CELL_STYLE, resolveCellTextStyle } from '@mog/spreadsheet-utils/cells/cell-style';
import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import type { CultureInfo } from '@mog-sdk/contracts/culture';
import type {
  TextMeasurementContext,
  TextMeasurementService,
  TextPosition,
  TextPositionInput,
} from '@mog-sdk/contracts/rendering';
import type { ThemeDefinition } from '@mog-sdk/contracts/theme';

import { buildCellFont } from '../cells/text';
import { MIN_COL_WIDTH, MIN_ROW_HEIGHT } from '../shared/constants';

/** Cell padding - use DEFAULT_CELL_STYLE.padding as the single source of truth */
const CELL_PADDING = DEFAULT_CELL_STYLE.padding;

// =============================================================================
// Constants
// =============================================================================

/** Pixels per indent level (matches Excel) */
const INDENT_WIDTH = 8;

/** Line height multiplier for font size (standard typography) */
const DEFAULT_LINE_HEIGHT_FACTOR = 1.2;

/** Additional horizontal padding for column auto-fit (prevents clipping). */
const COLUMN_AUTOFIT_PADDING = 4;

/** Additional vertical padding for row auto-fit (prevents clipping). */
const ROW_AUTOFIT_PADDING = 2;

/** Maximum number of cached text measurements */
const MAX_TEXT_CACHE_SIZE = 10000;

/** Maximum number of cached character widths per font */
const MAX_CHAR_CACHE_SIZE = 256;

/** Maximum number of cached text layout results */
const MAX_LAYOUT_CACHE_SIZE = 1000;

// =============================================================================
// LRU Text Measurement Cache (integrated)
// =============================================================================

/**
 * LRU-based text measurement cache.
 * Caches text width measurements to avoid expensive measureText() calls.
 */
class TextMeasurementCache {
  /** Cache of text width measurements, keyed by "font|text" */
  private readonly textCache: Map<string, number> = new Map();

  /** Cache of character widths per font, keyed by font string */
  private readonly charWidthCache: Map<string, Map<string, number>> = new Map();

  /** Access order for LRU eviction */
  private readonly accessOrder: string[] = [];

  /** Stats */
  private hits = 0;
  private misses = 0;

  /**
   * Get cached width for text.
   */
  getWidth(text: string, font: string): number | undefined {
    const key = this.makeKey(text, font);
    const cached = this.textCache.get(key);

    if (cached !== undefined) {
      this.hits++;
      this.touchKey(key);
      return cached;
    }

    return undefined;
  }

  /**
   * Measure text and cache result.
   * Uses character-width caching for single characters and short strings.
   */
  measure(ctx: TextMeasurementContext, text: string, font: string): number {
    // Check cache first
    const cached = this.getWidth(text, font);
    if (cached !== undefined) {
      return cached;
    }

    this.misses++;

    // Ensure font is set
    if (ctx.font !== font) {
      ctx.font = font;
    }

    let width: number;

    // For short strings, try to use character-width cache
    if (text.length <= 20) {
      const charWidths = this.getOrCreateCharWidthCache(font);
      let canUseCharCache = true;
      let estimatedWidth = 0;

      for (const char of text) {
        const charWidth = charWidths.get(char);
        if (charWidth !== undefined) {
          estimatedWidth += charWidth;
        } else {
          canUseCharCache = false;
          break;
        }
      }

      if (canUseCharCache) {
        width = estimatedWidth;
      } else {
        // Measure and cache individual character widths
        width = this.measureAndCacheCharacters(ctx, text, font);
      }
    } else {
      // For longer strings, just measure directly
      width = ctx.measureText(text).width;
    }

    // Cache the result
    this.cacheWidth(text, font, width);

    return width;
  }

  /**
   * Clear all cached data.
   */
  clear(): void {
    this.textCache.clear();
    this.charWidthCache.clear();
    this.accessOrder.length = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache size (number of entries).
   */
  size(): number {
    return this.textCache.size;
  }

  /**
   * Get cache statistics.
   */
  getStats(): { hits: number; misses: number; hitRate: number; size: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.textCache.size,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private makeKey(text: string, font: string): string {
    return `${font}|${text}`;
  }

  private touchKey(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx > -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  private cacheWidth(text: string, font: string, width: number): void {
    const key = this.makeKey(text, font);

    // Evict if necessary
    while (this.textCache.size >= MAX_TEXT_CACHE_SIZE && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift()!;
      this.textCache.delete(oldest);
    }

    this.textCache.set(key, width);
    this.accessOrder.push(key);
  }

  private getOrCreateCharWidthCache(font: string): Map<string, number> {
    let cache = this.charWidthCache.get(font);
    if (!cache) {
      cache = new Map();
      this.charWidthCache.set(font, cache);
    }
    return cache;
  }

  private measureAndCacheCharacters(
    ctx: TextMeasurementContext,
    text: string,
    font: string,
  ): number {
    const charCache = this.getOrCreateCharWidthCache(font);
    let totalWidth = 0;

    for (const char of text) {
      let charWidth = charCache.get(char);

      if (charWidth === undefined) {
        // Measure and cache character width
        charWidth = ctx.measureText(char).width;

        // Only cache if we haven't exceeded the limit
        if (charCache.size < MAX_CHAR_CACHE_SIZE) {
          charCache.set(char, charWidth);
        }
      }

      totalWidth += charWidth;
    }

    return totalWidth;
  }
}

// =============================================================================
// Text Layout Cache (integrated)
// =============================================================================

/**
 * Result of text layout computation.
 * Contains wrapped lines and their dimensions.
 */
export interface TextLayoutResult {
  /** Array of wrapped text lines */
  lines: string[];
  /** Total height of all lines (including line spacing) */
  totalHeight: number;
  /** Maximum width among all lines */
  maxLineWidth: number;
  /** Height of a single line (font size * line height factor) */
  lineHeight: number;
}

/**
 * Options for text layout computation.
 */
export interface TextLayoutOptions {
  /** CSS font string (e.g., "normal 13px Inter") */
  font: string;
  /** Maximum width for text wrapping (in pixels) */
  maxWidth: number;
  /** Line height multiplier (default: 1.2) */
  lineHeightFactor?: number;
  /** Font size in pixels (required for height calculation) */
  fontSize: number;
}

/**
 * LRU cache for text layout results.
 */
class TextLayoutCache {
  private cache = new Map<string, TextLayoutResult>();
  private accessOrder: string[] = [];

  /**
   * Generate cache key from layout parameters.
   */
  private makeKey(text: string, font: string, maxWidth: number): string {
    // Round maxWidth to avoid cache fragmentation from floating point values
    const roundedMaxWidth = Math.round(maxWidth);
    return `${font}|${roundedMaxWidth}|${text}`;
  }

  /**
   * Get cached layout result.
   */
  get(text: string, font: string, maxWidth: number): TextLayoutResult | undefined {
    const key = this.makeKey(text, font, maxWidth);
    const cached = this.cache.get(key);

    if (cached) {
      // Move to end of access order (most recently used)
      this.touch(key);
      return cached;
    }

    return undefined;
  }

  /**
   * Store layout result in cache.
   */
  set(text: string, font: string, maxWidth: number, result: TextLayoutResult): void {
    const key = this.makeKey(text, font, maxWidth);

    // Evict oldest entries if at capacity
    while (this.cache.size >= MAX_LAYOUT_CACHE_SIZE && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift()!;
      this.cache.delete(oldest);
    }

    this.cache.set(key, result);
    this.accessOrder.push(key);
  }

  /**
   * Move key to end of access order.
   */
  private touch(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx > -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder.length = 0;
  }

  /**
   * Get number of cached entries.
   */
  size(): number {
    return this.cache.size;
  }
}

// =============================================================================
// Sheet Bounds Utility
// =============================================================================

/**
 * Result of getSheetBounds - min/max row/col of data.
 */
export interface SheetBounds {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/**
 * Get the bounds of data in a sheet.
 * Used to limit iteration to only cells with content.
 *
 * @param forEachFn - Function to iterate cells (from Cells.forEach)
 * @returns Bounds or null if sheet is empty
 */
export function computeSheetBounds(
  forEachFn: (callback: (row: number, col: number) => void) => void,
): SheetBounds | null {
  let minRow = Infinity;
  let maxRow = -1;
  let minCol = Infinity;
  let maxCol = -1;

  forEachFn((row, col) => {
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
  });

  if (maxRow < 0) {
    return null;
  }

  return { minRow, maxRow, minCol, maxCol };
}

// =============================================================================
// Unified Text Measurement Service
// =============================================================================

/**
 * Unified Text Measurement Service Implementation.
 *
 * Provides all text measurement, wrapping, and layout functionality.
 * Combines the functionality of:
 * - Text measurement (cell width/height calculation)
 * - Text layout (word wrapping for shapes/textboxes)
 * - LRU caching (for performance optimization)
 */
export class TextMeasurementServiceImpl implements TextMeasurementService {
  /** Singleton offscreen canvas for text measurement */
  private measurementCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private measurementCtx: TextMeasurementContext | null = null;

  /** Integrated text measurement cache */
  private textCache = new TextMeasurementCache();

  /** Integrated layout cache */
  private layoutCache = new TextLayoutCache();

  /**
   * Override the measurement context with a custom one.
   * Used by TextMeasurementServiceWithContext for testing environments.
   */
  setMeasurementContext(ctx: TextMeasurementContext): void {
    this.measurementCtx = ctx;
  }

  /**
   * Get or create an offscreen canvas context for text measurement.
   * This avoids modifying the visible canvas and is more efficient.
   *
   * @returns Canvas rendering context for measurement
   */
  getMeasurementContext(): TextMeasurementContext {
    if (this.measurementCtx) {
      return this.measurementCtx;
    }

    // Try OffscreenCanvas first (better performance, doesn't affect DOM)
    if (typeof OffscreenCanvas !== 'undefined') {
      this.measurementCanvas = new OffscreenCanvas(1, 1);
      this.measurementCtx = this.measurementCanvas.getContext('2d');
    } else {
      // Fallback to regular canvas for older browsers/environments
      this.measurementCanvas = document.createElement('canvas');
      this.measurementCanvas.width = 1;
      this.measurementCanvas.height = 1;
      this.measurementCtx = this.measurementCanvas.getContext('2d');
    }

    if (!this.measurementCtx) {
      throw new Error(
        'Canvas API unavailable — TextMeasurementService requires a browser environment',
      );
    }

    return this.measurementCtx;
  }

  /**
   * Get the display text for a cell value.
   * Applies number formatting to get what the user sees.
   *
   * @param value - Raw cell value
   * @param format - Cell format (may include numberFormat)
   * @param culture - Culture for localized formatting
   * @returns Display text string
   */
  getDisplayText(
    value: CellValue,
    _format: CellFormat | undefined,
    _culture: CultureInfo,
    preFormatted?: string,
  ): string {
    // Use pre-computed formatted string from Rust when available
    if (preFormatted !== undefined) return preFormatted;

    if (value === null || value === undefined || value === '') {
      return '';
    }

    // Fallback: Rust pre-formats in the normal rendering/autofit paths.
    // This fallback is only reached for edge cases (tests, etc.).
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value);
  }

  /**
   * Measure required width for a single cell's content.
   *
   * @param value - Cell value
   * @param format - Cell format
   * @param culture - Culture for formatting
   * @returns Required width in pixels
   */
  measureCellWidth(
    value: CellValue,
    format: CellFormat | undefined,
    culture: CultureInfo,
    preFormatted?: string,
  ): number {
    const ctx = this.getMeasurementContext();

    if (value === null || value === undefined || value === '') {
      return MIN_COL_WIDTH;
    }

    // Get display text (formatted value)
    const displayText = this.getDisplayText(value, format, culture, preFormatted);
    if (!displayText) {
      return MIN_COL_WIDTH;
    }

    // Get font matching the renderer (Issue 11 fix: pass displayText for CJK fallback)
    const font = buildCellFont(format, undefined, displayText);

    // Measure using cached measurement
    const textWidth = this.textCache.measure(ctx, displayText, font);

    // Add padding and indent
    const indent = (format?.indent ?? 0) * INDENT_WIDTH;
    const totalWidth = textWidth + CELL_PADDING * 2 + indent + COLUMN_AUTOFIT_PADDING;

    return Math.max(totalWidth, MIN_COL_WIDTH);
  }

  /**
   * Measure required height for a single cell's content.
   * Considers wrapText for multi-line calculation.
   *
   * @param value - Cell value
   * @param format - Cell format
   * @param culture - Culture for formatting
   * @param availableWidth - Column width for wrap text calculation
   * @returns Required height in pixels
   */
  measureCellHeight(
    value: CellValue,
    format: CellFormat | undefined,
    culture: CultureInfo,
    availableWidth: number,
    preFormatted?: string,
  ): number {
    if (value === null || value === undefined || value === '') {
      return MIN_ROW_HEIGHT;
    }

    const displayText = this.getDisplayText(value, format, culture, preFormatted);
    if (!displayText) {
      return MIN_ROW_HEIGHT;
    }

    // Issue 11 fix: pass displayText for CJK fallback font resolution
    const font = buildCellFont(format, undefined, displayText);
    const fontSize = format?.fontSize ?? 11;
    const lineHeight = fontSize * DEFAULT_LINE_HEIGHT_FACTOR;

    if (format?.wrapText && availableWidth > CELL_PADDING * 2) {
      // Calculate wrapped lines
      const usableWidth = availableWidth - CELL_PADDING * 2;
      const lines = this.wrapTextToLines(displayText, font, usableWidth);
      const totalHeight = lines.length * lineHeight + CELL_PADDING * 2 + ROW_AUTOFIT_PADDING;
      return Math.max(totalHeight, MIN_ROW_HEIGHT);
    }

    // Single line height
    return Math.max(lineHeight + CELL_PADDING * 2 + ROW_AUTOFIT_PADDING, MIN_ROW_HEIGHT);
  }

  /**
   * Calculate required dimensions for rotated text.
   * Uses trigonometry to compute the bounding box after rotation.
   *
   * @param value - Cell value
   * @param format - Cell format (should have textRotation set)
   * @param culture - Culture for formatting
   * @returns Required width and height in pixels
   */
  measureRotatedCell(
    value: CellValue,
    format: CellFormat | undefined,
    culture: CultureInfo,
    preFormatted?: string,
  ): { width: number; height: number } {
    const ctx = this.getMeasurementContext();

    if (value === null || value === undefined || value === '') {
      return { width: MIN_COL_WIDTH, height: MIN_ROW_HEIGHT };
    }

    const displayText = this.getDisplayText(value, format, culture, preFormatted);
    if (!displayText) {
      return { width: MIN_COL_WIDTH, height: MIN_ROW_HEIGHT };
    }

    // Issue 11 fix: pass displayText for CJK fallback font resolution
    const font = buildCellFont(format, undefined, displayText);
    const fontSize = format?.fontSize ?? 11;

    // Measure unrotated text dimensions
    const textWidth = this.textCache.measure(ctx, displayText, font);
    const textHeight = fontSize * DEFAULT_LINE_HEIGHT_FACTOR;

    // Get rotation angle (Excel uses degrees, 0-180 range)
    const rotation = format?.textRotation ?? 0;
    if (rotation === 0) {
      return {
        width: Math.max(textWidth + CELL_PADDING * 2 + COLUMN_AUTOFIT_PADDING, MIN_COL_WIDTH),
        height: Math.max(textHeight + CELL_PADDING * 2 + ROW_AUTOFIT_PADDING, MIN_ROW_HEIGHT),
      };
    }

    // Convert rotation to radians
    // Excel text rotation: 0-90 = counterclockwise up, 91-180 = clockwise down
    // We normalize to standard math angle
    let radians: number;
    if (rotation <= 90) {
      radians = (rotation * Math.PI) / 180;
    } else {
      // 91-180 maps to -1 to -90 degrees
      radians = ((rotation - 180) * Math.PI) / 180;
    }

    // Calculate rotated bounding box
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));

    const rotatedWidth = textWidth * cos + textHeight * sin;
    const rotatedHeight = textWidth * sin + textHeight * cos;

    return {
      width: Math.max(rotatedWidth + CELL_PADDING * 2 + COLUMN_AUTOFIT_PADDING, MIN_COL_WIDTH),
      height: Math.max(rotatedHeight + CELL_PADDING * 2 + ROW_AUTOFIT_PADDING, MIN_ROW_HEIGHT),
    };
  }

  /**
   * Get the CSS font string for a cell.
   */
  getCellFont(
    format: CellFormat | undefined,
    theme?: ThemeDefinition,
    cellContent?: string,
  ): string {
    return buildCellFont(format, theme, cellContent);
  }

  /**
   * Wrap text into lines that fit within maxWidth.
   * Uses word-wrap algorithm similar to CSS word-wrap: break-word.
   *
   * @param text - Text to wrap
   * @param font - Font string for measurement
   * @param maxWidth - Maximum width per line
   * @returns Array of line strings
   */
  wrapTextToLines(text: string, font: string, maxWidth: number): string[] {
    const ctx = this.getMeasurementContext();

    if (!text || maxWidth <= 0) {
      return [text || ''];
    }

    // Handle explicit line breaks first
    const paragraphs = text.split(/\r?\n/);
    const allLines: string[] = [];

    for (const paragraph of paragraphs) {
      if (!paragraph) {
        allLines.push('');
        continue;
      }

      // Split by words
      const words = paragraph.split(/\s+/);
      let currentLine = '';

      for (const word of words) {
        if (!word) continue;

        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = this.textCache.measure(ctx, testLine, font);

        if (testWidth <= maxWidth) {
          currentLine = testLine;
        } else {
          // Line would exceed max width
          if (currentLine) {
            allLines.push(currentLine);
          }

          // Check if word itself exceeds max width (needs breaking)
          const wordWidth = this.textCache.measure(ctx, word, font);
          if (wordWidth > maxWidth) {
            // Break long word character by character
            const brokenLines = this.breakLongWord(ctx, word, font, maxWidth);
            allLines.push(...brokenLines.slice(0, -1));
            currentLine = brokenLines[brokenLines.length - 1] || '';
          } else {
            currentLine = word;
          }
        }
      }

      // Don't forget the last line
      if (currentLine) {
        allLines.push(currentLine);
      }
    }

    return allLines.length > 0 ? allLines : [''];
  }

  /**
   * Compute text layout with caching.
   * Returns wrapped lines and their dimensions.
   *
   * @param ctx - Canvas context for text measurement
   * @param text - Text content to layout
   * @param options - Layout options (font, maxWidth, fontSize)
   * @returns Layout result with lines and dimensions
   */
  computeLayout(
    ctx: TextMeasurementContext,
    text: string,
    options: TextLayoutOptions,
  ): TextLayoutResult {
    const { font, maxWidth, fontSize, lineHeightFactor = 1.2 } = options;

    // Check cache first
    const cached = this.layoutCache.get(text, font, maxWidth);
    if (cached) {
      return cached;
    }

    // Compute layout using wrapTextToLines
    const lines = this.wrapTextToLines(text, font, maxWidth);
    const lineHeight = fontSize * lineHeightFactor;
    const totalHeight = lines.length * lineHeight;

    // Compute max line width
    let maxLineWidth = 0;

    // Ensure font is set for measurement
    if (ctx.font !== font) {
      ctx.font = font;
    }

    for (const line of lines) {
      const lineWidth = this.textCache.measure(ctx, line, font);
      maxLineWidth = Math.max(maxLineWidth, lineWidth);
    }

    const result: TextLayoutResult = {
      lines,
      totalHeight,
      maxLineWidth,
      lineHeight,
    };

    // Cache the result
    this.layoutCache.set(text, font, maxWidth, result);

    return result;
  }

  /**
   * Compute layout for a single line (no wrapping).
   * Useful when wrapping is disabled.
   */
  computeSingleLineLayout(
    ctx: TextMeasurementContext,
    text: string,
    options: Pick<TextLayoutOptions, 'font' | 'fontSize' | 'lineHeightFactor'>,
  ): TextLayoutResult {
    const { font, fontSize, lineHeightFactor = 1.2 } = options;
    const lineHeight = fontSize * lineHeightFactor;

    // Ensure font is set
    if (ctx.font !== font) {
      ctx.font = font;
    }

    const maxLineWidth = this.textCache.measure(ctx, text, font);

    return {
      lines: [text],
      totalHeight: lineHeight,
      maxLineWidth,
      lineHeight,
    };
  }

  /**
   * Reset the measurement cache and context (for testing).
   */
  resetCache(): void {
    this.measurementCanvas = null;
    this.measurementCtx = null;
    this.textCache.clear();
    this.layoutCache.clear();
  }

  /**
   * Get cache statistics for debugging/monitoring.
   */
  getCacheStats(): { hits: number; misses: number; hitRate: number; size: number } {
    return this.textCache.getStats();
  }

  /**
   * Get layout cache size for debugging/monitoring.
   */
  getLayoutCacheSize(): number {
    return this.layoutCache.size();
  }

  /**
   * Clear the layout cache.
   * Call this when font metrics might have changed (e.g., zoom level change).
   */
  clearLayoutCache(): void {
    this.layoutCache.clear();
  }

  /**
   * Compute exact text position for WYSIWYG rendering.
   * Canvas draws at these coordinates. DOM overlays at these coordinates.
   * Single source of truth guarantees visual match.
   *
   * @param input - Text position input containing text, format, cell bounds, etc.
   * @returns Computed text position with exact coordinates for rendering
   */
  computeTextPosition(input: TextPositionInput): TextPosition {
    const { text, value, format, cellBounds, theme, zoom = 1.0 } = input;
    const ctx = this.getMeasurementContext();

    // Get resolved style from the canonical source of truth
    const style = resolveCellTextStyle(format, value);

    // Get font for measurement (pass text for CJK detection)
    const font = buildCellFont(format, theme, text);
    const fontSize = style.fontSize;
    const lineHeightFactor = DEFAULT_LINE_HEIGHT_FACTOR;
    const lineHeight = fontSize * lineHeightFactor;
    const padding = style.paddingX;
    const indent = (format?.indent ?? 0) * INDENT_WIDTH;

    // Compute zoom-scaled font properties for DOM editors
    // Canvas uses ctx.scale(zoom) which scales everything uniformly.
    // DOM editors need explicit font size scaling to match.
    const scaledFontSize = fontSize * zoom;
    // Build scaled font string by replacing the font size in the CSS font string
    // Font format is: "[italic] [bold] {size}px {family...}"
    const scaledFont = font.replace(`${fontSize}px`, `${scaledFontSize}px`);

    // Handle multi-line text (explicit newlines or wrapText)
    const hasExplicitNewlines = text.includes('\n');
    const shouldWrap = format?.wrapText ?? false;
    const availableWidth = cellBounds.width - padding * 2 - indent;

    let lines: string[];
    if (hasExplicitNewlines || shouldWrap) {
      lines = this.wrapTextToLines(text, font, availableWidth);
    } else {
      lines = [text];
    }

    // Measure text dimensions
    if (ctx.font !== font) {
      ctx.font = font;
    }

    // Calculate max line width and total height
    let maxLineWidth = 0;
    for (const line of lines) {
      const lineWidth = this.textCache.measure(ctx, line, font);
      maxLineWidth = Math.max(maxLineWidth, lineWidth);
    }
    const totalTextHeight = lines.length * lineHeight;

    // Calculate baseline offset (distance from top of text to baseline)
    // For canvas with textBaseline='top', baseline is approximately at fontSize * 0.8
    const baselineOffset = fontSize * 0.8;

    // Calculate Y position for the text block based on vertical alignment
    let blockY: number;
    switch (style.verticalAlign) {
      case 'top':
        blockY = cellBounds.y + padding;
        break;
      case 'middle':
        blockY = cellBounds.y + (cellBounds.height - totalTextHeight) / 2;
        break;
      case 'bottom':
        blockY = cellBounds.y + cellBounds.height - totalTextHeight - padding;
        break;
    }

    // Build line positions
    const linePositions: Array<{ text: string; x: number; y: number }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineWidth = this.textCache.measure(ctx, line, font);
      const lineY = blockY + i * lineHeight;

      // Calculate X position based on horizontal alignment
      let lineX: number;
      switch (style.textAlign) {
        case 'left':
        case 'justify': // Justify starts from left
          lineX = cellBounds.x + padding + indent;
          break;
        case 'center':
          lineX = cellBounds.x + (cellBounds.width - lineWidth) / 2;
          break;
        case 'right':
          lineX = cellBounds.x + cellBounds.width - lineWidth - padding;
          break;
      }

      linePositions.push({ text: line, x: lineX, y: lineY });
    }

    // The primary x/y are for the first line (or single line)
    const primaryX =
      linePositions.length > 0 ? linePositions[0].x : cellBounds.x + padding + indent;
    const primaryY = linePositions.length > 0 ? linePositions[0].y : blockY;

    return {
      x: primaryX,
      y: primaryY,
      textWidth: maxLineWidth,
      textHeight: totalTextHeight,
      lines: linePositions,
      baselineOffset,
      scaledFontSize,
      scaledFont,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Break a long word that exceeds maxWidth into multiple lines.
   * Uses character-by-character breaking.
   */
  private breakLongWord(
    ctx: TextMeasurementContext,
    word: string,
    font: string,
    maxWidth: number,
  ): string[] {
    const lines: string[] = [];
    let currentLine = '';

    for (const char of word) {
      const testLine = currentLine + char;
      const testWidth = this.textCache.measure(ctx, testLine, font);

      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = char;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
  }
}

/**
 * Text measurement service implementation that uses a custom canvas context.
 * Useful for testing where JSDOM doesn't provide real canvas support.
 */
export class TextMeasurementServiceWithContext implements TextMeasurementService {
  private service: TextMeasurementServiceImpl;

  constructor(private ctx: TextMeasurementContext) {
    this.service = new TextMeasurementServiceImpl();
    // Override the measurement context to use the provided one
    this.service.setMeasurementContext(ctx);
  }

  measureCellWidth(
    value: CellValue,
    format: CellFormat | undefined,
    culture: CultureInfo,
    preFormatted?: string,
  ): number {
    return this.service.measureCellWidth(value, format, culture, preFormatted);
  }

  measureCellHeight(
    value: CellValue,
    format: CellFormat | undefined,
    culture: CultureInfo,
    availableWidth: number,
    preFormatted?: string,
  ): number {
    return this.service.measureCellHeight(value, format, culture, availableWidth, preFormatted);
  }

  measureRotatedCell(
    value: CellValue,
    format: CellFormat | undefined,
    culture: CultureInfo,
    preFormatted?: string,
  ): { width: number; height: number } {
    return this.service.measureRotatedCell(value, format, culture, preFormatted);
  }

  getCellFont(
    format: CellFormat | undefined,
    theme?: ThemeDefinition,
    cellContent?: string,
  ): string {
    return this.service.getCellFont(format, theme, cellContent);
  }

  getDisplayText(
    value: CellValue,
    format: CellFormat | undefined,
    culture: CultureInfo,
    preFormatted?: string,
  ): string {
    return this.service.getDisplayText(value, format, culture, preFormatted);
  }

  wrapTextToLines(text: string, font: string, maxWidth: number): string[] {
    return this.service.wrapTextToLines(text, font, maxWidth);
  }

  getMeasurementContext(): TextMeasurementContext {
    return this.ctx;
  }

  computeTextPosition(input: TextPositionInput): TextPosition {
    return (this.service as TextMeasurementServiceImpl).computeTextPosition(input);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: TextMeasurementServiceImpl | null = null;

/**
 * Get the singleton TextMeasurementService instance.
 * Creates the instance on first call (lazy initialization).
 */
export function getTextMeasurementService(): TextMeasurementService {
  if (!instance) {
    instance = new TextMeasurementServiceImpl();
  }
  return instance;
}

/**
 * Reset the singleton instance (useful for testing).
 */
export function resetTextMeasurementService(): void {
  if (instance) {
    instance.resetCache();
  }
  instance = null;
}

/**
 * Create a TextMeasurementService with a custom canvas context.
 * Useful for testing where JSDOM doesn't provide real canvas support.
 *
 * @param ctx - Canvas rendering context to use for measurements
 */
export function createTextMeasurementService(ctx: TextMeasurementContext): TextMeasurementService {
  return new TextMeasurementServiceWithContext(ctx);
}
