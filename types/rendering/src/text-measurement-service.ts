/**
 * Text Measurement Service Interface
 *
 * This interface defines the contract for text measurement operations needed by autofit.
 * Canvas provides the implementation; state/coordinator uses it via dependency injection.
 *
 * ARCHITECTURAL NOTE (per Issue 9 in plan):
 * TextMeasurementService is a STATELESS SERVICE, NOT a Bridge.
 * Unlike Calculator/Pivot bridges which listen to EventBus triggers and cache computations,
 * TextMeasurementService is synchronous with no lifecycle management needed.
 *
 * @module @mog-sdk/contracts/rendering/text-measurement-service
 */

import type { CellFormat, CellValue } from '@mog/types-core';
import type { CultureInfo } from '@mog/types-culture/types';
import type { ThemeDefinition } from '@mog/types-formatting/formatting/theme';

/**
 * Minimal interface for text measurement — satisfied by both
 * CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D.
 */
export interface TextMeasurementContext {
  font: string;
  measureText(text: string): { width: number };
}

/**
 * Bounds of data in a sheet (used to limit autofit iteration).
 */
export interface SheetBounds {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/**
 * Result of text position computation for WYSIWYG rendering.
 * Both canvas and DOM editors use these exact coordinates.
 */
export interface TextPosition {
  /** Exact x position where text starts (after alignment) */
  x: number;
  /** Exact y position (baseline or top, depending on verticalAlign) */
  y: number;
  /** Width of the text content */
  textWidth: number;
  /** Height of the text content (single line or multi-line) */
  textHeight: number;
  /** For multi-line: each line's position */
  lines: Array<{ text: string; x: number; y: number }>;
  /** Baseline offset from top (for cursor positioning) */
  baselineOffset: number;
  /** Zoom-scaled font size (fontSize * zoom) for DOM editors */
  scaledFontSize: number;
  /** Full CSS font string with zoom-scaled size for DOM editors */
  scaledFont: string;
}

/**
 * Input for text position computation.
 */
export interface TextPositionInput {
  /** Display text (after formatting) */
  text: string;
  /** Cell value (for alignment determination - numbers right-align, etc.) */
  value: CellValue | undefined;
  /** Cell format */
  format: CellFormat | undefined;
  /** Cell bounds in pixels */
  cellBounds: { x: number; y: number; width: number; height: number };
  /** Theme for font resolution */
  theme?: ThemeDefinition;
  /** Zoom level for scaling visual properties (1.0 = 100%, default: 1.0) */
  zoom?: number;
}

/**
 * Service interface for text measurement operations.
 *
 * This service provides all the measurement functionality needed by autofit
 * without exposing canvas internals to the state layer.
 */
export interface TextMeasurementService {
  /**
   * Measure required width for a single cell's content.
   * Applies number formatting and includes padding/indent.
   *
   * @param value - Cell value (raw, will be formatted for display)
   * @param format - Cell format (numberFormat, fontSize, fontFamily, indent, etc.)
   * @param culture - Culture for localized number formatting
   * @returns Required width in pixels
   */
  measureCellWidth(
    value: CellValue,
    format: CellFormat | undefined,
    culture: CultureInfo,
    preFormatted?: string,
  ): number;

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
  ): number;

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
  ): { width: number; height: number };

  /**
   * Get the CSS font string for a cell.
   * Includes CJK fallback fonts when cell content contains CJK characters.
   *
   * @param format - Cell format
   * @param theme - Theme for resolving theme font references (optional)
   * @param cellContent - Optional cell content for CJK detection
   * @returns CSS font string (e.g., "bold 14px Arial, SimSun, ...")
   */
  getCellFont(
    format: CellFormat | undefined,
    theme?: ThemeDefinition,
    cellContent?: string,
  ): string;

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
    format: CellFormat | undefined,
    culture: CultureInfo,
    preFormatted?: string,
  ): string;

  /**
   * Wrap text into lines that fit within maxWidth.
   * Uses word-wrap algorithm similar to CSS word-wrap: break-word.
   *
   * @param text - Text to wrap
   * @param font - Font string for measurement
   * @param maxWidth - Maximum width per line
   * @returns Array of line strings
   */
  wrapTextToLines(text: string, font: string, maxWidth: number): string[];

  /**
   * Get the canvas rendering context used for measurement.
   * Returns a singleton offscreen context to avoid modifying visible canvas.
   *
   * @returns Canvas rendering context
   */
  getMeasurementContext(): TextMeasurementContext;

  /**
   * Reset the measurement cache (useful for testing).
   * Optional - may not be implemented by all implementations.
   */
  resetCache?(): void;

  /**
   * Get cache statistics (useful for debugging/monitoring).
   * Optional - may not be implemented by all implementations.
   */
  getCacheStats?(): { hits: number; misses: number; hitRate: number; size: number };

  /**
   * Compute exact text position for WYSIWYG rendering.
   * Canvas draws at these coordinates. DOM overlays at these coordinates.
   * Single source of truth guarantees visual match.
   *
   * @param input - Text position input containing text, format, cell bounds, etc.
   * @returns Computed text position with exact coordinates for rendering
   */
  computeTextPosition(input: TextPositionInput): TextPosition;
}

/**
 * Compute the bounds of data in a sheet.
 * Used to limit iteration to only cells with content.
 *
 * This is a pure function (no canvas dependency) that can be used by both
 * canvas and state layers.
 *
 * @param forEachFn - Function to iterate cells (from Cells.forEach)
 * @returns Bounds or null if sheet is empty
 */
