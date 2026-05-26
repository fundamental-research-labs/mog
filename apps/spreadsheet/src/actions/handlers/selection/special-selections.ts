/**
 * Special Selection Utilities
 *
 * Functions to find cells matching specific criteria for "Go To Special" functionality.
 * Returns arrays of CellCoord that can be passed to selection machine's SET_SELECTION.
 *
 * These are pure functions that operate on provided data accessors,
 * keeping the selection machine pure and enabling easy testing.
 *
 */

import type { CellError, CellRange, CellValue } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { CellValueGetter } from '../../../infra/utils';

// =============================================================================
// Types
// =============================================================================

/**
 * Types of special selections supported.
 * Maps to Excel's "Go To Special" dialog options.
 */
export type SpecialSelectionType =
  | 'blanks' // Empty cells
  | 'constants' // Cells with literal values (not formulas)
  | 'formulas' // Cells with formulas
  | 'numbers' // Numeric constants (not formula results)
  | 'text' // Text constants (not formula results)
  | 'logicals' // Boolean constants (TRUE/FALSE)
  | 'errors'; // Cells with error values

// Re-use CellValueGetter from navigation-utils - same signature
export type { CellValueGetter };

/**
 * Function type for getting cell formulas.
 * Returns the formula string if the cell has one, undefined otherwise.
 */
export type CellFormulaGetter = (row: number, col: number) => string | undefined;

/**
 * Options for findSpecialCells.
 */
export interface FindSpecialCellsOptions {
  /** The range to search within */
  range: CellRange;
  /** The type of special cells to find */
  type: SpecialSelectionType;
  /** Function to get cell values */
  getCellValue: CellValueGetter;
  /** Function to get cell formulas */
  getCellFormula: CellFormulaGetter;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is a CellError.
 */
function isCellError(value: CellValue | undefined): value is CellError {
  return value !== null && typeof value === 'object' && 'type' in value && value.type === 'error';
}

/**
 * Check if a value represents an error string (legacy format).
 * Some systems store errors as strings like "#DIV/0!".
 */
function isErrorString(value: CellValue | undefined): boolean {
  if (typeof value !== 'string') return false;
  const errorVariants = [
    'Null',
    'Div0',
    'Value',
    'Ref',
    'Name',
    'Num',
    'Na',
    'GettingData',
    'Spill',
    'Calc',
  ];
  return errorVariants.includes(value);
}

// =============================================================================
// Cell Matching Logic
// =============================================================================

/**
 * Check if a cell is empty/blank.
 */
function isBlank(value: CellValue | undefined): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Check if a cell value is a constant (not from a formula).
 */
function isConstant(value: CellValue | undefined, formula: string | undefined): boolean {
  // If it has a formula, it's not a constant
  if (formula && formula.length > 0) return false;
  // If it's blank, it's not a constant
  if (isBlank(value)) return false;
  return true;
}

/**
 * Check if a cell has a formula.
 */
function hasFormula(formula: string | undefined): boolean {
  return formula !== undefined && formula.length > 0;
}

/**
 * Check if a value is a number constant (not from a formula).
 */
function isNumberConstant(value: CellValue | undefined, formula: string | undefined): boolean {
  if (formula && formula.length > 0) return false;
  return typeof value === 'number';
}

/**
 * Check if a value is a text constant (not from a formula).
 */
function isTextConstant(value: CellValue | undefined, formula: string | undefined): boolean {
  if (formula && formula.length > 0) return false;
  return typeof value === 'string' && value !== '' && !isErrorString(value);
}

/**
 * Check if a value is a boolean/logical constant (not from a formula).
 */
function isLogicalConstant(value: CellValue | undefined, formula: string | undefined): boolean {
  if (formula && formula.length > 0) return false;
  return typeof value === 'boolean';
}

/**
 * Check if a value is an error (either as CellError object or string).
 */
function isError(value: CellValue | undefined): boolean {
  return isCellError(value) || isErrorString(value);
}

/**
 * Check if a cell matches the specified criteria.
 */
function matchesCriteria(
  type: SpecialSelectionType,
  value: CellValue | undefined,
  formula: string | undefined,
): boolean {
  switch (type) {
    case 'blanks':
      return isBlank(value);

    case 'constants':
      return isConstant(value, formula);

    case 'formulas':
      return hasFormula(formula);

    case 'numbers':
      return isNumberConstant(value, formula);

    case 'text':
      return isTextConstant(value, formula);

    case 'logicals':
      return isLogicalConstant(value, formula);

    case 'errors':
      return isError(value);

    default:
      return false;
  }
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Find all cells in a range matching the specified criteria.
 *
 * This is the main entry point for special selections.
 * Returns an array of CellCoord that can be converted to ranges
 * for the selection machine.
 *
 * @example
 * ```typescript
 * const blanks = findSpecialCells({
 * range: { startRow: 0, startCol: 0, endRow: 99, endCol: 9 },
 * type: 'blanks',
 * getCellValue: (r, c) => store.getCellValue(sheetId, r, c),
 * getCellFormula: (r, c) => store.getCellFormula(sheetId, r, c)
 * });
 *
 * // Convert to ranges for selection
 * const ranges = cellCoordsToRanges(blanks);
 * selectionActor.send({ type: 'SET_SELECTION', ranges, activeCell: blanks[0] });
 * ```
 */
export function findSpecialCells(options: FindSpecialCellsOptions): CellCoord[] {
  const { range, type, getCellValue, getCellFormula } = options;
  const results: CellCoord[] = [];

  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      const value = getCellValue(row, col);
      const formula = getCellFormula(row, col);

      if (matchesCriteria(type, value, formula)) {
        results.push({ row, col });
      }
    }
  }

  return results;
}

/**
 * Convert an array of cell coordinates to single-cell ranges.
 *
 * Each cell becomes its own range. This is the format expected
 * by the selection machine's SET_SELECTION event for multi-selection.
 *
 * For contiguous optimization, see cellCoordsToOptimizedRanges.
 */
export function cellCoordsToRanges(cells: CellCoord[]): CellRange[] {
  return cells.map((cell) => ({
    startRow: cell.row,
    startCol: cell.col,
    endRow: cell.row,
    endCol: cell.col,
  }));
}

/**
 * Convert an array of cell coordinates to optimized ranges.
 *
 * Merges adjacent cells into larger ranges where possible.
 * This reduces the number of ranges for better performance
 * and cleaner visual representation.
 *
 * Algorithm: Row-major scan, merging horizontally adjacent cells.
 * TODO: Could be extended to merge vertically as well.
 */
export function cellCoordsToOptimizedRanges(cells: CellCoord[]): CellRange[] {
  if (cells.length === 0) return [];

  // Sort by row, then by column
  const sorted = [...cells].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  const ranges: CellRange[] = [];
  let currentRange: CellRange | null = null;

  for (const cell of sorted) {
    if (currentRange === null) {
      // Start new range
      currentRange = {
        startRow: cell.row,
        startCol: cell.col,
        endRow: cell.row,
        endCol: cell.col,
      };
    } else if (cell.row === currentRange.endRow && cell.col === currentRange.endCol + 1) {
      // Extend current range horizontally
      currentRange.endCol = cell.col;
    } else {
      // Save current range and start new one
      ranges.push(currentRange);
      currentRange = {
        startRow: cell.row,
        startCol: cell.col,
        endRow: cell.row,
        endCol: cell.col,
      };
    }
  }

  // Don't forget the last range
  if (currentRange !== null) {
    ranges.push(currentRange);
  }

  return ranges;
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Find all blank cells in a range.
 */
export function findBlanks(range: CellRange, getCellValue: CellValueGetter): CellCoord[] {
  return findSpecialCells({
    range,
    type: 'blanks',
    getCellValue,
    getCellFormula: () => undefined, // Blanks don't need formula check
  });
}

/**
 * Find all formula cells in a range.
 */
export function findFormulas(range: CellRange, getCellFormula: CellFormulaGetter): CellCoord[] {
  return findSpecialCells({
    range,
    type: 'formulas',
    getCellValue: () => undefined, // Formulas don't need value check
    getCellFormula,
  });
}

/**
 * Find all cells with errors in a range.
 */
export function findErrors(range: CellRange, getCellValue: CellValueGetter): CellCoord[] {
  return findSpecialCells({
    range,
    type: 'errors',
    getCellValue,
    getCellFormula: () => undefined, // Errors don't need formula check
  });
}

/**
 * Find all constant cells (non-formula, non-empty) in a range.
 */
export function findConstants(
  range: CellRange,
  getCellValue: CellValueGetter,
  getCellFormula: CellFormulaGetter,
): CellCoord[] {
  return findSpecialCells({
    range,
    type: 'constants',
    getCellValue,
    getCellFormula,
  });
}

/**
 * Find all numeric constant cells in a range.
 */
export function findNumbers(
  range: CellRange,
  getCellValue: CellValueGetter,
  getCellFormula: CellFormulaGetter,
): CellCoord[] {
  return findSpecialCells({
    range,
    type: 'numbers',
    getCellValue,
    getCellFormula,
  });
}

/**
 * Find all text constant cells in a range.
 */
export function findText(
  range: CellRange,
  getCellValue: CellValueGetter,
  getCellFormula: CellFormulaGetter,
): CellCoord[] {
  return findSpecialCells({
    range,
    type: 'text',
    getCellValue,
    getCellFormula,
  });
}
