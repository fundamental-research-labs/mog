/**
 * Format Utilities for External API
 *
 * Provides LLM-optimized formatting utilities for cell data:
 * - getStyleHints / buildStyleHintsFromFormat: concise style hints for cells
 * - analyzeFormulas / normalizeFormula: formula pattern detection and abbreviation
 * - generateFormulaDocumentation: formula definition output with A1 examples
 */

import type { CellFormat, SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../context';
import { getFormat } from '../../domain/cells/cell-properties';
import { colToLetter } from './utils';

// =============================================================================
// Constants
// =============================================================================

/** Max non-empty cells in a describeRange call (counts actual data, not bounding box) */
export const MAX_RANGE_CELLS = 10_000;

/** Hard cap on bounding-box area to prevent absurdly large queryRange calls */
export const MAX_RANGE_BOUNDING_BOX = 500_000;

/** Max output size in characters before truncation (~50KB) */
export const MAX_DESCRIBE_OUTPUT_CHARS = 50_000;

/** Max named ranges to display in summarize() output */
export const MAX_SUMMARY_NAMED_RANGES = 20;

// =============================================================================
// Style Hints
// =============================================================================

/**
 * Get concise style hints for a cell.
 * Returns notable formatting attributes as a comma-separated string.
 *
 * Only includes styling that is "notable" - i.e., different from default.
 * This helps LLMs understand the visual context of cells without verbose output.
 *
 * @example
 * getStyleHints(ctx, sheetId, 0, 0) // "bold" or "bold,bg:#FFFF00" or null
 */
export async function getStyleHints(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string | null> {
  const format = await getFormat(ctx, sheetId, row, col);
  if (!format) return null;

  const hints = buildStyleHintsFromFormat(format);
  return hints.length > 0 ? hints.join(',') : null;
}

/**
 * Build style hints from a CellFormat object.
 */
export function buildStyleHintsFromFormat(format: CellFormat): string[] {
  const hints: string[] = [];

  if (format.bold) hints.push('bold');
  if (format.italic) hints.push('italic');
  if (format.underlineType && format.underlineType !== 'none') hints.push('underline');
  if (format.strikethrough) hints.push('strikethrough');

  if (format.backgroundColor && !isDefaultBackground(format.backgroundColor)) {
    hints.push(`bg:${format.backgroundColor}`);
  }
  if (format.fontColor && !isDefaultFontColor(format.fontColor)) {
    hints.push(`color:${format.fontColor}`);
  }
  if (format.numberFormat && format.numberFormat !== 'General') {
    hints.push(`fmt:${format.numberFormat}`);
  }

  return hints;
}

function isDefaultBackground(color: string): boolean {
  const n = color.toLowerCase();
  return n === '#ffffff' || n === '#fff' || n === 'white' || n === 'transparent' || n === '';
}

function isDefaultFontColor(color: string): boolean {
  const n = color.toLowerCase();
  return n === '#000000' || n === '#000' || n === 'black';
}

// =============================================================================
// Tint & Shade Accessor
// =============================================================================

/**
 * Extract the tint/shade value for a color property.
 *
 * For theme colors (string contains "theme:"): extracts the tint from the third
 * segment of the color string, e.g., "theme:accent1:0.4" returns 0.4.
 *
 * For non-theme colors: returns the dedicated tint field value from CellFormat
 * (fontColorTint, backgroundColorTint, patternForegroundColorTint).
 *
 * @param colorValue - The color string (e.g., "#FF0000" or "theme:accent1:0.4")
 * @param tintField - The dedicated tint field value from CellFormat (e.g., format.fontColorTint)
 * @returns A number (-1.0 to +1.0) or null if no tint is set
 */
export function extractTintAndShade(
  colorValue: string | undefined | null,
  tintField: number | undefined | null,
): number | null {
  // Theme colors may embed tint in the string: "theme:slot:tint"
  if (colorValue && colorValue.startsWith('theme:')) {
    const parts = colorValue.split(':');
    if (parts.length >= 3) {
      const tint = parseFloat(parts[2]);
      if (!isNaN(tint)) return tint;
    }
  }

  // Fall back to the dedicated tint field
  if (tintField != null && tintField !== 0) {
    return tintField;
  }

  return null;
}

/**
 * Get the tint/shade value for a cell's font color.
 * @returns A number (-1.0 to +1.0) or null if no tint is applied.
 */
export function getFontTintAndShade(format: CellFormat): number | null {
  return extractTintAndShade(format.fontColor, format.fontColorTint);
}

/**
 * Get the tint/shade value for a cell's background color.
 * @returns A number (-1.0 to +1.0) or null if no tint is applied.
 */
export function getBackgroundTintAndShade(format: CellFormat): number | null {
  return extractTintAndShade(format.backgroundColor, format.backgroundColorTint);
}

/**
 * Get the tint/shade value for a cell's pattern foreground color.
 * @returns A number (-1.0 to +1.0) or null if no tint is applied.
 */
export function getPatternForegroundTintAndShade(format: CellFormat): number | null {
  return extractTintAndShade(format.patternForegroundColor, format.patternForegroundColorTint);
}

// =============================================================================
// Formula Analysis for Abbreviations
// =============================================================================

export interface FormulaPatternInfo {
  /** Unique ID like F1, F2, etc. */
  id: string;
  /** Normalized pattern with relative references */
  pattern: string;
  /** Cells using this pattern */
  cells: Array<{ row: number; col: number; formula: string; value: unknown }>;
}

export interface FormulaAnalysis {
  /** Map of normalized pattern to info */
  patterns: Map<string, FormulaPatternInfo>;
  /** Map of "row,col" to pattern ID (for abbreviation lookup) */
  formulaToId: Map<string, string>;
  /** Minimum cells for a pattern to get an abbreviation */
  minCellsForAbbreviation: number;
}

/**
 * Analyze formulas in a range to identify common patterns.
 * Patterns that appear >= minCellsForAbbreviation times get abbreviated as F1, F2, etc.
 *
 * @param cells - Array of cells with formulas to analyze
 * @param minCellsForAbbreviation - Abbreviation threshold (default: 10)
 */
export function analyzeFormulas(
  cells: Array<{ row: number; col: number; formula: string; value: unknown }>,
  minCellsForAbbreviation: number = 10,
): FormulaAnalysis {
  const patterns = new Map<string, FormulaPatternInfo>();
  const formulaToId = new Map<string, string>();
  let patternCounter = 1;

  for (const cell of cells) {
    if (!cell.formula) continue;
    const pattern = normalizeFormula(cell.formula, cell.row, cell.col);

    if (!patterns.has(pattern)) {
      patterns.set(pattern, { id: `F${patternCounter++}`, pattern, cells: [] });
    }
    patterns.get(pattern)!.cells.push(cell);
  }

  for (const [_pattern, info] of patterns) {
    if (info.cells.length >= minCellsForAbbreviation) {
      for (const cell of info.cells) {
        formulaToId.set(`${cell.row},${cell.col}`, info.id);
      }
    }
  }

  return { patterns, formulaToId, minCellsForAbbreviation };
}

/**
 * Normalize a formula by converting cell references to relative position indicators.
 *
 * @example
 * normalizeFormula("A5+A4", 4, 1) // "=[C-1][R]+[C-1][R-1]"
 * normalizeFormula("SUM(A1:A10)", 2, 2) // "=SUM([C-2][R-2]:[C-2][R+7])"
 */
export function normalizeFormula(formula: string, currentRow: number, currentCol: number): string {
  return formula.replace(/(?:(?:'[^']+'|[^\s!]+)!)?\$?[A-Z]+\$?\d+/gi, (match) => {
    let sheetPrefix = '';
    let cellPart = match;

    if (match.includes('!')) {
      const parts = match.split('!');
      sheetPrefix = parts[0] + '!';
      cellPart = parts[1];
    }

    // Don't regularize references with absolute markers
    if (cellPart.includes('$')) return match;

    const parsed = parseCellRef(cellPart);
    if (!parsed) return match;

    const rowOffset = parsed.row - currentRow;
    const colOffset = parsed.col - currentCol;

    const colPart =
      colOffset === 0 ? '[C]' : colOffset > 0 ? `[C+${colOffset}]` : `[C${colOffset}]`;
    const rowPart =
      rowOffset === 0 ? '[R]' : rowOffset > 0 ? `[R+${rowOffset}]` : `[R${rowOffset}]`;

    return sheetPrefix + colPart + rowPart;
  });
}

function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;

  const colLetters = match[1].toUpperCase();
  const rowNum = parseInt(match[2], 10);

  let col = 0;
  for (let i = 0; i < colLetters.length; i++) {
    col = col * 26 + (colLetters.charCodeAt(i) - 64);
  }
  col -= 1;

  return { row: rowNum - 1, col };
}

/**
 * Generate formula documentation section for LLM output.
 * Format: =F1 -> pattern  (e.g. A11: =SUM(A1:A10), A12: =SUM(A2:A11))
 */
export function generateFormulaDocumentation(analysis: FormulaAnalysis): string[] {
  const significantPatterns = Array.from(analysis.patterns.values())
    .filter((info) => info.cells.length >= analysis.minCellsForAbbreviation)
    .sort((a, b) => parseInt(a.id.substring(1)) - parseInt(b.id.substring(1)));

  if (significantPatterns.length === 0) return [];

  const lines: string[] = [''];

  for (const info of significantPatterns) {
    const examples = info.cells.slice(0, 2).map((cell) => {
      const addr = `${colToLetter(cell.col)}${cell.row + 1}`;
      return `${addr}: =${cell.formula}`;
    });
    const exampleStr = examples.length > 0 ? `  (e.g. ${examples.join(', ')})` : '';
    lines.push(`=F${info.id.substring(1)} -> ${info.pattern}${exampleStr}`);
  }

  return lines;
}
