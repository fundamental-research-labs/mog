/**
 * Formula Range Parser
 *
 * Parses cell references from formula strings with position tracking.
 * Used for:
 * - C.2: Highlighting range boxes in grid when cursor is on a reference in formula bar
 * - C.3/H.3: Range box dragging to edit formula references
 *
 * Features:
 * - Extracts all cell references and ranges from formulas
 * - Tracks character positions of each reference in the formula string
 * - Assigns colors from the formula range color palette
 * - Supports simple refs (A1), absolute refs ($A$1), and ranges (A1:B10)
 *
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import { FORMULA_RANGE_COLORS } from '@mog-sdk/contracts/machines';

// =============================================================================
// TYPES
// =============================================================================

/**
 * A parsed cell reference from a formula.
 * Contains both the range coordinates and the position in the formula string.
 */
export interface FormulaRangeReference {
  /** The cell range (start/end coordinates) */
  range: CellRange;
  /** Color for highlighting this range */
  color: string;
  /** Start position in the formula string (0-indexed) */
  startPos: number;
  /** End position in the formula string (exclusive) */
  endPos: number;
  /** The original text of the reference (e.g., "$A$1:B10") */
  text: string;
  /** Index of this reference in the formula (for identification) */
  index: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Regex to match cell references in formulas.
 * Matches:
 * - Simple refs: A1, B2, AA100
 * - Absolute refs: $A$1, A$1, $A1
 * - Ranges: A1:B10, $A$1:$B$10
 * - Sheet refs: Sheet1!A1, 'Sheet Name'!A1:B10
 *
 * Groups:
 * - Full match is the entire reference
 *
 * NOTE: This pattern intentionally does NOT match structured references (Table[Column])
 * or named ranges, as those require different handling.
 */
const CELL_REFERENCE_PATTERN =
  /(?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)!)?\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?/gi;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert a column letter(s) to a 0-indexed column number.
 * A=0, B=1, ..., Z=25, AA=26, etc.
 */
function colLetterToNumber(letters: string): number {
  let col = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    col = col * 26 + (upper.charCodeAt(i) - 64);
  }
  return col - 1; // Convert to 0-indexed
}

/**
 * Parse a single cell reference (without range) into row/col coordinates.
 * Handles absolute ($) markers.
 *
 * @param ref Reference like "A1", "$A$1", "AA100"
 * @returns {row, col} or null if invalid
 */
function parseSingleRef(ref: string): { row: number; col: number } | null {
  // Remove sheet prefix if present
  const bangIndex = ref.lastIndexOf('!');
  const cellPart = bangIndex >= 0 ? ref.slice(bangIndex + 1) : ref;

  // Pattern: optional $, letters, optional $, digits
  const match = cellPart.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/i);
  if (!match) return null;

  const [, , colLetters, , rowDigits] = match;
  const col = colLetterToNumber(colLetters);
  const row = parseInt(rowDigits, 10) - 1; // Convert to 0-indexed

  // Validate bounds (Excel max: XFD = 16383, row 1048576)
  if (col < 0 || col > 16383 || row < 0 || row > 1048575) {
    return null;
  }

  return { row, col };
}

/**
 * Parse a cell reference or range into a CellRange.
 *
 * @param ref Reference like "A1", "$A$1:$B$10", "Sheet1!A1"
 * @returns CellRange or null if invalid
 */
function parseRefToRange(ref: string): CellRange | null {
  // Check if it's a range (contains :)
  const colonIndex = ref.indexOf(':');

  if (colonIndex === -1) {
    // Single cell reference
    const parsed = parseSingleRef(ref);
    if (!parsed) return null;

    return {
      startRow: parsed.row,
      startCol: parsed.col,
      endRow: parsed.row,
      endCol: parsed.col,
    };
  }

  // Range reference (A1:B10)
  const startPart = ref.slice(0, colonIndex);
  const endPart = ref.slice(colonIndex + 1);

  const start = parseSingleRef(startPart);
  const end = parseSingleRef(endPart);

  if (!start || !end) return null;

  // Normalize (start <= end)
  return {
    startRow: Math.min(start.row, end.row),
    startCol: Math.min(start.col, end.col),
    endRow: Math.max(start.row, end.row),
    endCol: Math.max(start.col, end.col),
  };
}

// =============================================================================
// MAIN PARSER
// =============================================================================

/**
 * Extract all cell references from a formula string.
 *
 * @param formula The formula string (including leading =)
 * @returns Array of FormulaRangeReference objects with positions and ranges
 */
export function extractFormulaRanges(formula: string): FormulaRangeReference[] {
  const references: FormulaRangeReference[] = [];

  if (!formula || formula.length === 0) {
    return references;
  }

  // Reset regex lastIndex for global pattern
  CELL_REFERENCE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  let colorIndex = 0;

  while ((match = CELL_REFERENCE_PATTERN.exec(formula)) !== null) {
    const text = match[0];
    const startPos = match.index;
    const endPos = startPos + text.length;

    // Parse the reference to a range
    const range = parseRefToRange(text);
    if (!range) continue;

    // Assign color from palette (cycle through colors)
    const color = FORMULA_RANGE_COLORS[colorIndex % FORMULA_RANGE_COLORS.length];

    references.push({
      range,
      color,
      startPos,
      endPos,
      text,
      index: references.length,
    });

    colorIndex++;
  }

  return references;
}

/**
 * Find which reference the cursor is currently positioned in or adjacent to.
 * Returns the index of the active reference, or -1 if cursor is not in any reference.
 *
 * @param references Array of parsed references
 * @param cursorPosition Current cursor position in the formula
 * @returns Index of the active reference, or -1
 */
export function findActiveReferenceIndex(
  references: FormulaRangeReference[],
  cursorPosition: number,
): number {
  // Find reference where cursor is within the text bounds
  for (const ref of references) {
    // Cursor is within this reference (inclusive of boundaries)
    if (cursorPosition >= ref.startPos && cursorPosition <= ref.endPos) {
      return ref.index;
    }
  }

  // Also check if cursor is immediately adjacent to a reference
  // This helps when cursor is right after typing a reference
  for (const ref of references) {
    if (cursorPosition === ref.endPos) {
      return ref.index;
    }
  }

  return -1;
}

/**
 * Update a formula by replacing a reference with a new range.
 * Used for C.3/H.3: Range box dragging to edit formula.
 *
 * @param formula The original formula string
 * @param reference The reference to replace
 * @param newRange The new range coordinates
 * @param preserveAbsolute Whether to preserve $ markers from original reference
 * @returns Updated formula string and new cursor position
 */
export function updateFormulaReference(
  formula: string,
  reference: FormulaRangeReference,
  newRange: CellRange,
  preserveAbsolute = true,
): { newFormula: string; newCursorPosition: number } {
  // Build the new reference text
  const newRefText = buildReferenceText(reference.text, newRange, preserveAbsolute);

  // Replace in formula
  const before = formula.slice(0, reference.startPos);
  const after = formula.slice(reference.endPos);
  const newFormula = before + newRefText + after;

  // Cursor position at end of new reference
  const newCursorPosition = reference.startPos + newRefText.length;

  return { newFormula, newCursorPosition };
}

/**
 * Build reference text for a range, optionally preserving absolute markers.
 */
function buildReferenceText(
  originalText: string,
  range: CellRange,
  preserveAbsolute: boolean,
): string {
  // Extract sheet prefix if present
  const bangIndex = originalText.lastIndexOf('!');
  const sheetPrefix = bangIndex >= 0 ? originalText.slice(0, bangIndex + 1) : '';
  const refPart = bangIndex >= 0 ? originalText.slice(bangIndex + 1) : originalText;

  // Check for absolute markers in original
  const colonIndex = refPart.indexOf(':');
  const startRef = colonIndex >= 0 ? refPart.slice(0, colonIndex) : refPart;
  const endRef = colonIndex >= 0 ? refPart.slice(colonIndex + 1) : null;

  // Parse absolute markers
  const startColAbsolute = startRef.includes('$') && startRef.match(/^\$[A-Z]/i);
  const startRowAbsolute = startRef.match(/\$\d/);

  let endColAbsolute = false;
  let endRowAbsolute = false;
  if (endRef) {
    endColAbsolute = endRef.includes('$') && !!endRef.match(/^\$?[A-Z]*\$[A-Z]/i);
    endRowAbsolute = !!endRef.match(/\$\d/);
    // Re-check for column absolute at start
    endColAbsolute = endRef.startsWith('$') || endRef.match(/^\$[A-Z]/i) !== null;
  }

  // Build new reference
  const newStartRef = buildCellRef(
    range.startRow,
    range.startCol,
    preserveAbsolute && !!startColAbsolute,
    preserveAbsolute && !!startRowAbsolute,
  );

  // Check if it's a range (more than one cell)
  const isSingleCell = range.startRow === range.endRow && range.startCol === range.endCol;

  if (isSingleCell) {
    return sheetPrefix + newStartRef;
  }

  const newEndRef = buildCellRef(
    range.endRow,
    range.endCol,
    preserveAbsolute && endColAbsolute,
    preserveAbsolute && endRowAbsolute,
  );

  return sheetPrefix + newStartRef + ':' + newEndRef;
}

/**
 * Build a cell reference string from coordinates.
 */
function buildCellRef(
  row: number,
  col: number,
  colAbsolute: boolean,
  rowAbsolute: boolean,
): string {
  const colLetter = numberToColLetter(col);
  const rowNum = row + 1; // Convert to 1-indexed

  return (colAbsolute ? '$' : '') + colLetter + (rowAbsolute ? '$' : '') + rowNum;
}

/**
 * Convert a 0-indexed column number to letter(s).
 * 0=A, 1=B, ..., 25=Z, 26=AA, etc.
 */
function numberToColLetter(col: number): string {
  let result = '';
  let n = col + 1; // Convert to 1-indexed for calculation

  while (n > 0) {
    n--;
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26);
  }

  return result;
}
