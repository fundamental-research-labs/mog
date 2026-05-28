/**
 * A1 Notation Utility Functions
 *
 * Pure utility functions for A1 cell address parsing and formatting.
 */

import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';
import type { ParsedCellAddress, ParsedCellRange } from '@mog-sdk/contracts/utils';

import { normalizeRange } from './range';

/**
 * Convert column index to letter(s): 0 = 'A', 25 = 'Z', 26 = 'AA'
 */
export function colToLetter(col: number): string {
  if (col < 0) {
    throw new Error('Column number must be >= 0');
  }
  let result = '';
  let c = col;
  while (c >= 0) {
    result = String.fromCharCode((c % 26) + 65) + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}

/**
 * Convert column letter(s) to index: 'A' = 0, 'Z' = 25, 'AA' = 26
 */
export function letterToCol(letters: string): number {
  let result = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result - 1;
}

/**
 * Parse A1 cell address to row/col: 'A1' => { row: 0, col: 0 }
 * Throws on invalid address.
 */
export function parseA1(address: string): { row: number; col: number } {
  const match = address.match(/^\$?([A-Za-z]+)\$?(\d+)$/);
  if (!match) {
    throw new Error(`Invalid cell address: ${address}`);
  }
  return {
    row: parseInt(match[2], 10) - 1,
    col: letterToCol(match[1]),
  };
}

/**
 * Parse A1 range string to CellRange: 'A1:C3' => { startRow: 0, startCol: 0, endRow: 2, endCol: 2 }
 * Single cell 'A1' returns single-cell range.
 */
export function parseA1Range(range: string): CellRange {
  const [start, end] = range.split(':');
  const startPos = parseA1(start);

  if (!end) {
    // Single cell
    return {
      startRow: startPos.row,
      startCol: startPos.col,
      endRow: startPos.row,
      endCol: startPos.col,
    };
  }

  const endPos = parseA1(end);
  return {
    startRow: Math.min(startPos.row, endPos.row),
    startCol: Math.min(startPos.col, endPos.col),
    endRow: Math.max(startPos.row, endPos.row),
    endCol: Math.max(startPos.col, endPos.col),
  };
}

/**
 * Convert a CellRange to A1 notation.
 * Single cell: "A1", range: "A1:C3"
 */
export function cellRangeToA1(range: CellRange): string {
  const normalized = normalizeRange(range);
  const startA1 = `${colToLetter(normalized.startCol)}${normalized.startRow + 1}`;

  // Single cell
  if (normalized.startRow === normalized.endRow && normalized.startCol === normalized.endCol) {
    return startA1;
  }

  const endA1 = `${colToLetter(normalized.endCol)}${normalized.endRow + 1}`;
  return `${startA1}:${endA1}`;
}

/**
 * Convert row/col to A1 cell address: (0, 0) -> "A1"
 */
export function toA1(row: number, col: number): string {
  return `${colToLetter(col)}${row + 1}`;
}

/**
 * Quote a sheet name if it contains special characters (Excel convention).
 * Embedded single quotes are doubled: "It's" -> "'It''s'"
 */
export function quoteSheetName(name: string): string {
  if (/[^A-Za-z0-9_]/.test(name) || /^\d/.test(name)) {
    return `'${name.replace(/'/g, "''")}'`;
  }
  return name;
}

/**
 * Format a cell position as SheetName!A1 (cross-sheet reference).
 * The sheet name is quoted if it contains special characters.
 */
export function toSheetA1(row: number, col: number, sheetName: string): string {
  return `${quoteSheetName(sheetName)}!${colToLetter(col)}${row + 1}`;
}

/**
 * Format a CellRange as SheetName!A1 or SheetName!A1:B3 (cross-sheet reference).
 * The sheet name is quoted if it contains special characters.
 */
export function cellRangeToSheetA1(range: CellRange, sheetName: string): string {
  return `${quoteSheetName(sheetName)}!${cellRangeToA1(range)}`;
}

// =============================================================================
// Sheet-name-aware parsing (richer than parseA1/parseA1Range)
// =============================================================================

/** Regex for cell addresses, optionally with sheet name: A1, Sheet1!A1, 'Sheet Name'!A1 */
const SHEET_NAME_PATTERN = "'((?:[^']|'')*)'|([^!]+)";
const COLUMN_REF_PATTERN = '\\$?([A-Z]+)';
const ROW_REF_PATTERN = '\\$?(\\d+)';
const CELL_REF_PATTERN = '\\$?([A-Z]+)\\$?(\\d+)';

const CELL_ADDRESS_REGEX = new RegExp(`^(?:(?:${SHEET_NAME_PATTERN})!)?${CELL_REF_PATTERN}$`, 'i');

/** Regex for cell ranges, optionally with sheet name: A1:B2, Sheet1!A1:B2 */
const CELL_RANGE_REGEX = new RegExp(
  `^(?:(?:${SHEET_NAME_PATTERN})!)?${CELL_REF_PATTERN}:${CELL_REF_PATTERN}$`,
  'i',
);

const WHOLE_COLUMN_RANGE_REGEX = new RegExp(
  `^(?:(?:${SHEET_NAME_PATTERN})!)?${COLUMN_REF_PATTERN}:${COLUMN_REF_PATTERN}$`,
  'i',
);

const WHOLE_ROW_RANGE_REGEX = new RegExp(
  `^(?:(?:${SHEET_NAME_PATTERN})!)?${ROW_REF_PATTERN}:${ROW_REF_PATTERN}$`,
  'i',
);

function parsedSheetName(quoted: string | undefined, unquoted: string | undefined): string | null {
  if (quoted != null) return quoted.replace(/''/g, "'");
  return unquoted || null;
}

function parseColumnIndex(letters: string): number | null {
  const col = letterToCol(letters);
  return col >= 0 && col < MAX_COLS ? col : null;
}

function parseRowIndex(rowNumber: string): number | null {
  const row = parseInt(rowNumber, 10) - 1;
  return row >= 0 && row < MAX_ROWS ? row : null;
}

export type { ParsedCellAddress, ParsedCellRange } from '@mog-sdk/contracts/utils';

/**
 * Parse a cell address with optional sheet name prefix.
 * Returns null on invalid input (unlike parseA1 which throws).
 *
 * @example
 * parseCellAddress("A1")          // { row: 0, col: 0 }
 * parseCellAddress("Sheet1!B2")   // { row: 1, col: 1, sheetName: "Sheet1" }
 * parseCellAddress("'My Sheet'!C3") // { row: 2, col: 2, sheetName: "My Sheet" }
 * parseCellAddress("invalid")     // null
 */
export function parseCellAddress(ref: string): ParsedCellAddress | null {
  const match = ref.match(CELL_ADDRESS_REGEX);
  if (!match) return null;

  const sheetName = parsedSheetName(match[1], match[2]);
  return {
    row: parseInt(match[4], 10) - 1,
    col: letterToCol(match[3]),
    ...(sheetName ? { sheetName } : {}),
  };
}

/**
 * Parse a cell range with optional sheet name prefix.
 * Accepts both range notation ("A1:B2") and single-cell notation ("A1").
 * A single cell is treated as a 1×1 range (startRow === endRow, startCol === endCol).
 * Returns null on invalid input (unlike parseA1Range which throws).
 *
 * @example
 * parseCellRange("A1:B2")          // { startRow: 0, startCol: 0, endRow: 1, endCol: 1 }
 * parseCellRange("A:C")            // { startRow: 0, startCol: 0, endRow: MAX_ROWS - 1, endCol: 2, isFullColumn: true }
 * parseCellRange("2:10")           // { startRow: 1, startCol: 0, endRow: 9, endCol: MAX_COLS - 1, isFullRow: true }
 * parseCellRange("A1")             // { startRow: 0, startCol: 0, endRow: 0, endCol: 0 }
 * parseCellRange("Sheet1!A1:C10")  // { ..., sheetName: "Sheet1" }
 * parseCellRange("Sheet1!A1")      // { startRow: 0, startCol: 0, ..., sheetName: "Sheet1" }
 * parseCellRange("invalid")        // null
 */
export function parseCellRange(ref: string): ParsedCellRange | null {
  const wholeColumnMatch = ref.match(WHOLE_COLUMN_RANGE_REGEX);
  if (wholeColumnMatch) {
    const startCol = parseColumnIndex(wholeColumnMatch[3]);
    const endCol = parseColumnIndex(wholeColumnMatch[4]);
    if (startCol == null || endCol == null) return null;

    const sheetName = parsedSheetName(wholeColumnMatch[1], wholeColumnMatch[2]);
    return {
      startRow: 0,
      startCol,
      endRow: MAX_ROWS - 1,
      endCol,
      isFullColumn: true,
      ...(sheetName ? { sheetName } : {}),
    };
  }

  const wholeRowMatch = ref.match(WHOLE_ROW_RANGE_REGEX);
  if (wholeRowMatch) {
    const startRow = parseRowIndex(wholeRowMatch[3]);
    const endRow = parseRowIndex(wholeRowMatch[4]);
    if (startRow == null || endRow == null) return null;

    const sheetName = parsedSheetName(wholeRowMatch[1], wholeRowMatch[2]);
    return {
      startRow,
      startCol: 0,
      endRow,
      endCol: MAX_COLS - 1,
      isFullRow: true,
      ...(sheetName ? { sheetName } : {}),
    };
  }

  const rangeMatch = ref.match(CELL_RANGE_REGEX);
  if (rangeMatch) {
    const sheetName = parsedSheetName(rangeMatch[1], rangeMatch[2]);
    return {
      startRow: parseInt(rangeMatch[4], 10) - 1,
      startCol: letterToCol(rangeMatch[3]),
      endRow: parseInt(rangeMatch[6], 10) - 1,
      endCol: letterToCol(rangeMatch[5]),
      ...(sheetName ? { sheetName } : {}),
    };
  }

  // Fall back to single-cell address → 1×1 range
  const cellMatch = ref.match(CELL_ADDRESS_REGEX);
  if (cellMatch) {
    const sheetName = parsedSheetName(cellMatch[1], cellMatch[2]);
    const row = parseInt(cellMatch[4], 10) - 1;
    const col = letterToCol(cellMatch[3]);
    return {
      startRow: row,
      startCol: col,
      endRow: row,
      endCol: col,
      ...(sheetName ? { sheetName } : {}),
    };
  }

  return null;
}

// =============================================================================
// Validation helpers
// =============================================================================

/** Check if a cell address is valid (non-negative integer coordinates). */
export function isValidAddress(row: number, col: number): boolean {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0;
}

/** Check if a range is valid (start <= end, non-negative coordinates). */
export function isValidCellRange(range: CellRange): boolean {
  return (
    isValidAddress(range.startRow, range.startCol) &&
    isValidAddress(range.endRow, range.endCol) &&
    range.startRow <= range.endRow &&
    range.startCol <= range.endCol
  );
}

/** Get the dimensions (rows x cols) of a range. */
export function getRangeDimensions(range: CellRange): { rows: number; cols: number } {
  const n = normalizeRange(range);
  return { rows: n.endRow - n.startRow + 1, cols: n.endCol - n.startCol + 1 };
}

/** Create a CellRange from start coordinates and dimensions. */
export function createRange(
  startRow: number,
  startCol: number,
  rows: number,
  cols: number,
  sheetId?: string,
): CellRange {
  return {
    startRow,
    startCol,
    endRow: startRow + rows - 1,
    endCol: startCol + cols - 1,
    sheetId,
  };
}
