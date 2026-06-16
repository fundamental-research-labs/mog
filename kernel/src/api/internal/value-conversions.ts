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

import { RangeValueType } from '@mog-sdk/contracts/api';
import type { CellValue, CellValuePrimitive } from '@mog-sdk/contracts/core';
import { ERROR_DISPLAY_MAP, isCellError, errorDisplayString } from '@mog/spreadsheet-utils/errors';

const ERROR_DISPLAY_STRINGS = new Set<string>(Object.values(ERROR_DISPLAY_MAP));

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

/**
 * Classify an effective cell value into the public range value-type enum.
 */
export function classifyRangeValueType(value: CellValue | null | undefined): RangeValueType {
  if (value == null) return RangeValueType.Empty;
  if (typeof value === 'number') return RangeValueType.Double;
  if (typeof value === 'boolean') return RangeValueType.Boolean;
  if (typeof value === 'string') {
    return ERROR_DISPLAY_STRINGS.has(value) ? RangeValueType.Error : RangeValueType.String;
  }
  if (isCellError(value)) return RangeValueType.Error;
  return RangeValueType.Empty;
}
