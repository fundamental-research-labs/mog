/**
 * Minimal error display utility for number formatting.
 *
 * Inlined from @mog/spreadsheet-utils/errors to avoid
 * circular dependency between number-formats and spreadsheet-utils.
 */

import type { ErrorVariant } from '@mog-sdk/contracts/core';

/**
 * Map from machine-friendly variant names to Excel display strings.
 */
const ERROR_DISPLAY_MAP: Record<ErrorVariant, string> = {
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
 */
export function errorDisplayString(variant: ErrorVariant): string {
  return ERROR_DISPLAY_MAP[variant] ?? '#CALC!';
}
