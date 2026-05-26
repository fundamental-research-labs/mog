/**
 * Shared comparison and value identity utilities for the Table Engine.
 *
 * Type guards (isCellError, getCellErrorValue, isBlank) stay in TypeScript
 * for compile-time type narrowing. All computation delegates to Rust/WASM.
 *
 * @packageDocumentation
 */

import type { CellValue } from './types';
import { getWasm } from './wasm-backend';

/**
 * A cell error value: `{ type: 'error', value: <error-string> }`.
 */
export type CellError = {
  type: 'error';
  value:
    | 'Null'
    | 'Div0'
    | 'Value'
    | 'Ref'
    | 'Name'
    | 'Num'
    | 'Na'
    | 'GettingData'
    | 'Spill'
    | 'Calc'
    | 'Circ';
  message?: string;
};

// =============================================================================
// Type guards — stay in TypeScript for compile-time narrowing
// =============================================================================

export function isCellError(v: CellValue): v is CellError {
  return (
    typeof v === 'object' && v !== null && 'type' in v && (v as { type: string }).type === 'error'
  );
}

export function getCellErrorValue(v: CellValue): string | null {
  if (isCellError(v)) {
    return v.value;
  }
  return null;
}

export function isBlank(v: CellValue): boolean {
  return v === null || v === undefined;
}

/**
 * Assign a numeric rank for type-based ordering.
 *   0 = number, 1 = string, 2 = boolean, 3 = error, 4 = blank
 */
export function typeRank(v: CellValue): number {
  if (v === null || v === undefined) return 4;
  if (isCellError(v)) return 3;
  if (typeof v === 'boolean') return 2;
  if (typeof v === 'string') return 1;
  return 0;
}

// =============================================================================
// Computation functions — delegate to Rust/WASM
// =============================================================================

export function compareValues(a: CellValue, b: CellValue): number {
  return getWasm().table_compare_values(a, b) as number;
}

export function cellValueKey(value: CellValue): string {
  return getWasm().table_cell_value_key(value) as string;
}

export function cellValuesEqual(a: CellValue, b: CellValue): boolean {
  return getWasm().table_cell_values_equal(a, b) as boolean;
}

export function valueInList(value: CellValue, list: readonly CellValue[]): boolean {
  return getWasm().table_value_in_list(value, list) as boolean;
}

export function formatCellDisplay(value: CellValue): string {
  return getWasm().table_format_cell_display(value) as string;
}
