/**
 * Core types for the pdf-graphics package.
 *
 * These types define the font, text, and image abstractions used by
 * the RenderBackend interface. They are format-agnostic — nothing here
 * is PDF-specific.
 */

/**
 * Opaque handle to a registered font.
 * The RenderBackend uses FontHandle instead of font name strings so that
 * the underlying font pipeline can be swapped without changing calling code.
 */
export interface FontHandle {
  id: string;
  family: string;
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
}

/**
 * Options for single-string text rendering via drawText().
 */
export interface TextOptions {
  halign?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  color?: [number, number, number];
  underline?: boolean;
  strikethrough?: boolean;
  rotation?: number; // degrees
}

/**
 * A run of text with uniform formatting.
 * Used for rich text rendering via drawTextRuns().
 */
export interface TextRun {
  text: string;
  font?: FontHandle;
  size?: number;
  color?: [number, number, number];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  superscript?: boolean;
  subscript?: boolean;
}

/**
 * Options for multi-run text block rendering via drawTextRuns().
 */
export interface TextBlockOptions {
  maxWidth: number;
  lineHeight: number;
  halign?: 'left' | 'center' | 'right' | 'justify' | 'distributed';
  valign?: 'top' | 'middle' | 'bottom';
}

/**
 * Result of measuring a block of text runs.
 * Contains total dimensions and per-line breakdown.
 */
export interface TextMeasurement {
  width: number;
  height: number;
  lines: { width: number; runs: TextRun[] }[];
}

/**
 * Supported image formats for drawImage().
 */
export type ImageFormat = 'jpeg' | 'png';
