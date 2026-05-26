/**
 * Value conversion utilities for mapping CellValue to display strings
 * and normalising nullable CellValue results.
 *
 * CellValue is now a primitive-based union:
 *   string | number | boolean | null | CellError
 * where CellError = { type: 'error'; value: ErrorVariant; message?: string }.
 *
 * These are pure type-conversion functions with no side effects.
 */

import type { CellValue, CellValuePrimitive } from '@mog-sdk/contracts/core';
import { isCellError, errorDisplayString } from '@mog/spreadsheet-utils/errors';

/**
 * Normalize a CellValue for consumer-facing APIs.
 * Converts CellError objects to their Excel-style display string (#DIV/0!, #REF!, etc.).
 * Returns primitives unchanged.
 */
export function normalizeCellValue(cv: CellValue): CellValuePrimitive {
  if (cv !== null && isCellError(cv)) return errorDisplayString(cv.value);
  return cv as CellValuePrimitive;
}

/**
 * Convert a CellValue to a display string.
 */
export function cellValueToString(cv: CellValue): string {
  if (cv === null || cv === undefined) return '';
  if (typeof cv === 'string') return cv;
  if (typeof cv === 'number') return String(cv);
  if (typeof cv === 'boolean') return cv ? 'TRUE' : 'FALSE';
  if (isCellError(cv)) return errorDisplayString(cv.value);
  return '';
}
