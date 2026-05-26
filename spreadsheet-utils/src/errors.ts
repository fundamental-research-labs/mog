/**
 * Error Utility Functions
 *
 * Runtime functions for CellError handling: display strings, type guards.
 */

import type { CellError, CellValue, ErrorVariant } from '@mog-sdk/contracts/core';

/**
 * Map from machine-friendly variant names to Excel display strings.
 */
export const ERROR_DISPLAY_MAP: Record<ErrorVariant, string> = {
  Null: '#NULL!',
  Div0: '#DIV/0!',
  Value: '#VALUE!',
  Ref: '#REF!',
  Name: '#NAME?',
  Num: '#NUM!',
  Na: '#N/A',
  GettingData: '#GETTING_DATA',
  Spill: '#SPILL!',
  Calc: '#CALC!',
  Circ: '#REF!',
};

/**
 * Convert an ErrorVariant to its Excel display string.
 *
 * @example
 * errorDisplayString('Div0') // '#DIV/0!'
 * errorDisplayString('Na')   // '#N/A'
 */
export function errorDisplayString(variant: ErrorVariant): string {
  return ERROR_DISPLAY_MAP[variant] ?? '#CALC!';
}

/**
 * Type guard: checks whether a CellValue is a CellError object.
 */
export function isCellError(value: CellValue): value is CellError {
  return value !== null && typeof value === 'object' && (value as CellError).type === 'error';
}
