/**
 * SCAFFOLD: Base-14 AFM font metrics for Helvetica.
 *
 * This is temporary scaffold code that provides character-width tables for
 * text measurement using the PDF base-14 fonts. These will be replaced by
 * real TrueType metrics from the Rust font pipeline.
 *
 * SCAFFOLD: Will be replaced by the Rust TrueType font pipeline.
 */

import type { FontHandle } from '../types';

// ── Helvetica Character Widths ────────────────────────────────────────────
// Width values in 1/1000 of a unit (standard AFM convention).
// Covers Latin-1 (0x20-0xFF). Characters outside this range get a default width.

// SCAFFOLD: Placeholder.
const HELVETICA_WIDTHS: Record<number, number> = {
  32: 278,
  33: 278,
  34: 355,
  35: 556,
  36: 556,
  37: 889,
  38: 667,
  39: 191,
  40: 333,
  41: 333,
  42: 389,
  43: 584,
  44: 278,
  45: 333,
  46: 278,
  47: 278,
  48: 556,
  49: 556,
  50: 556,
  51: 556,
  52: 556,
  53: 556,
  54: 556,
  55: 556,
  56: 556,
  57: 556,
  58: 278,
  59: 278,
  60: 584,
  61: 584,
  62: 584,
  63: 556,
  64: 1015,
  65: 667,
  66: 667,
  67: 722,
  68: 722,
  69: 667,
  70: 611,
  71: 778,
  72: 722,
  73: 278,
  74: 500,
  75: 667,
  76: 556,
  77: 833,
  78: 722,
  79: 778,
  80: 667,
  81: 778,
  82: 722,
  83: 667,
  84: 611,
  85: 722,
  86: 667,
  87: 944,
  88: 667,
  89: 667,
  90: 611,
  91: 278,
  92: 278,
  93: 278,
  94: 469,
  95: 556,
  96: 333,
  97: 556,
  98: 556,
  99: 500,
  100: 556,
  101: 556,
  102: 278,
  103: 556,
  104: 556,
  105: 222,
  106: 222,
  107: 500,
  108: 222,
  109: 833,
  110: 556,
  111: 556,
  112: 556,
  113: 556,
  114: 333,
  115: 500,
  116: 278,
  117: 556,
  118: 500,
  119: 722,
  120: 500,
  121: 500,
  122: 500,
  123: 334,
  124: 260,
  125: 334,
  126: 584,
};

// SCAFFOLD: Placeholder.
const HELVETICA_BOLD_WIDTHS: Record<number, number> = {
  32: 278,
  33: 333,
  34: 474,
  35: 556,
  36: 556,
  37: 889,
  38: 722,
  39: 238,
  40: 333,
  41: 333,
  42: 389,
  43: 584,
  44: 278,
  45: 333,
  46: 278,
  47: 278,
  48: 556,
  49: 556,
  50: 556,
  51: 556,
  52: 556,
  53: 556,
  54: 556,
  55: 556,
  56: 556,
  57: 556,
  58: 333,
  59: 333,
  60: 584,
  61: 584,
  62: 584,
  63: 611,
  64: 975,
  65: 722,
  66: 722,
  67: 722,
  68: 722,
  69: 667,
  70: 611,
  71: 778,
  72: 722,
  73: 278,
  74: 556,
  75: 722,
  76: 611,
  77: 833,
  78: 722,
  79: 778,
  80: 667,
  81: 778,
  82: 722,
  83: 667,
  84: 611,
  85: 722,
  86: 667,
  87: 944,
  88: 667,
  89: 667,
  90: 611,
  91: 333,
  92: 278,
  93: 333,
  94: 584,
  95: 556,
  96: 333,
  97: 556,
  98: 611,
  99: 556,
  100: 611,
  101: 556,
  102: 333,
  103: 611,
  104: 611,
  105: 278,
  106: 278,
  107: 556,
  108: 278,
  109: 889,
  110: 611,
  111: 611,
  112: 611,
  113: 611,
  114: 389,
  115: 556,
  116: 333,
  117: 611,
  118: 556,
  119: 778,
  120: 556,
  121: 556,
  122: 500,
  123: 389,
  124: 280,
  125: 389,
  126: 584,
};

/** Default character width when a glyph is not found in the table. */
const DEFAULT_WIDTH = 556;

/**
 * SCAFFOLD: Font metrics constants for base-14 fonts.
 * Values are in 1/1000 of a unit (standard AFM convention).
 *
 * SCAFFOLD: Placeholder.
 */
export const FONT_METRICS = {
  /** Ascender height (distance from baseline to top of tallest glyph). */
  ascender: 718,
  /** Descender depth (distance from baseline to bottom of lowest glyph, negative). */
  descender: -207,
  /** Cap height (height of capital letters). */
  capHeight: 718,
  /** x-height (height of lowercase 'x'). */
  xHeight: 523,
  /** Line gap for multi-line text (additional space between lines). */
  lineGap: 0,
} as const;

/**
 * SCAFFOLD: Get the width table for the given font handle.
 *
 * Currently only has tables for Helvetica (normal) and Helvetica-Bold.
 * All other fonts fall back to Helvetica widths.
 *
 * SCAFFOLD: Placeholder.
 */
function getWidthTable(font: FontHandle): Record<number, number> {
  if (font.weight === 'bold') {
    return HELVETICA_BOLD_WIDTHS;
  }
  return HELVETICA_WIDTHS;
}

/**
 * SCAFFOLD: Measure the width of a text string using AFM metrics.
 *
 * @param text - The string to measure
 * @param font - Font handle (used to select weight variant)
 * @param size - Font size in points
 * @returns Width in points
 *
 * SCAFFOLD: Placeholder.
 */
export function measureTextWidth(text: string, font: FontHandle, size: number): number {
  const widths = getWidthTable(font);
  let totalWidth = 0;

  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const charWidth = widths[charCode] ?? DEFAULT_WIDTH;
    totalWidth += charWidth;
  }

  // Convert from 1/1000 units to points
  return (totalWidth / 1000) * size;
}

/**
 * SCAFFOLD: Get the PDF base-14 font name for a given FontHandle.
 *
 * Maps the (family, weight, style) triple to the standard PDF font name.
 * Falls back to Helvetica for unknown families.
 *
 * SCAFFOLD: Placeholder.
 */
export function getBase14FontName(font: FontHandle): string {
  const family = font.family.toLowerCase();

  if (
    family === 'times' ||
    family === 'times-roman' ||
    family === 'times new roman' ||
    family === 'serif'
  ) {
    if (font.weight === 'bold' && font.style === 'italic') return 'Times-BoldItalic';
    if (font.weight === 'bold') return 'Times-Bold';
    if (font.style === 'italic') return 'Times-Italic';
    return 'Times-Roman';
  }

  if (family === 'courier' || family === 'courier new' || family === 'monospace') {
    if (font.weight === 'bold' && font.style === 'italic') return 'Courier-BoldOblique';
    if (font.weight === 'bold') return 'Courier-Bold';
    if (font.style === 'italic') return 'Courier-Oblique';
    return 'Courier';
  }

  // Default: Helvetica family
  if (font.weight === 'bold' && font.style === 'italic') return 'Helvetica-BoldOblique';
  if (font.weight === 'bold') return 'Helvetica-Bold';
  if (font.style === 'italic') return 'Helvetica-Oblique';
  return 'Helvetica';
}

/**
 * SCAFFOLD: Create a default FontHandle for the given base-14 family.
 *
 * SCAFFOLD: Placeholder.
 */
export function createScaffoldFont(
  family: 'helvetica' | 'times' | 'courier' = 'helvetica',
  weight: 'normal' | 'bold' = 'normal',
  style: 'normal' | 'italic' = 'normal',
): FontHandle {
  return {
    id: `scaffold-${family}-${weight}-${style}`,
    family,
    weight,
    style,
  };
}

/**
 * SCAFFOLD: Resolve a TextRun's bold/italic to the appropriate FontHandle.
 *
 * If the run specifies a font, uses it. Otherwise, falls back to the
 * base font with bold/italic applied.
 *
 * SCAFFOLD: Placeholder.
 */
export function resolveFontForRun(
  run: { font?: FontHandle; bold?: boolean; italic?: boolean },
  baseFont: FontHandle,
): FontHandle {
  if (run.font) return run.font;

  const weight = run.bold ? 'bold' : baseFont.weight;
  const style = run.italic ? 'italic' : baseFont.style;

  if (weight === baseFont.weight && style === baseFont.style) {
    return baseFont;
  }

  return {
    id: `scaffold-${baseFont.family}-${weight}-${style}`,
    family: baseFont.family,
    weight,
    style,
  };
}
