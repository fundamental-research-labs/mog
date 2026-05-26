/**
 * Shared types for mutation modules.
 *
 * This file contains type definitions that are shared across multiple mutation modules.
 * It avoids circular dependencies by keeping types separate from implementations.
 */

import type { SheetId } from '@mog-sdk/contracts/core';

/**
 * Result of checking protection for a range.
 * Used for partial protection handling in paste operations.
 */
export interface RangeProtectionInfo {
  /** Whether the sheet has protection enabled */
  sheetProtected: boolean;
  /** Number of cells in the range that are protected (locked) */
  protectedCount: number;
  /** Number of cells in the range that are unprotected (unlocked) */
  unprotectedCount: number;
  /** Total number of cells in the range */
  totalCount: number;
  /** Set of protected cell keys in format "row,col" */
  protectedCells: Set<string>;
}

/**
 * Result of a replace operation.
 */
export interface ReplaceResult {
  success: boolean;
  error?: string;
}

/**
 * Batch replace result with statistics.
 */
export interface BatchReplaceResult {
  replacedCount: number;
  skippedCount: number;
  errors: string[];
}

/**
 * Information for calculated column auto-fill.
 */
export interface CalculatedColumnAutoFillInfo {
  tableId: string;
  columnIndex: number;
  isFormula: boolean;
}

/**
 * Search options used by find & replace.
 */
export interface SearchReplaceOptions {
  searchIn: 'values' | 'formulas' | 'both';
  useRegex: boolean;
  caseSensitive: boolean;
  matchEntireCell: boolean;
}

/**
 * Cell reference used for recalculation tracking.
 */
export interface CellRef {
  sheetId: SheetId;
  row: number;
  col: number;
}
