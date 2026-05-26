/**
 * Structured Reference parsing, resolution, adjustment, and formatting.
 *
 * Heavy computation delegates to Rust/WASM via compute-core.
 *
 * Supports Excel-style structured references:
 *   Table1[Column1]              - single column data
 *   Table1[@Column1]             - this row, single column
 *   Table1[#Headers]             - entire header row
 *   Table1[#Data]                - entire data area
 *   Table1[#Totals]              - entire totals row
 *   Table1[#All]                 - entire table
 *   Table1[#This Row]            - this row of data
 *   Table1[[#Headers],[Column1]] - header cell of Column1
 *   Table1[[#Totals],[Col1]:[Col3]] - totals row, columns 1-3
 *   Table1[[Col1]:[Col3]]        - data range across columns 1-3
 */

import type { CellRange, StructuredRef, Table, TableStructureChange } from './types';

import { getWasm } from './wasm-backend';

// =============================================================================
// Parsing (delegates to WASM)
// =============================================================================

/**
 * Parse a structured reference string into a StructuredRef.
 *
 * Returns null for invalid input (never throws).
 */
export function parseStructuredRef(text: string): StructuredRef | null {
  const result = getWasm().table_parse_structured_ref(text);
  return (result ?? null) as StructuredRef | null;
}

// =============================================================================
// Resolution (delegates to WASM)
// =============================================================================

/**
 * Resolve a structured reference to concrete grid ranges.
 *
 * May produce multiple ranges for union refs (e.g., headers + column).
 * Returns empty array if the reference cannot be resolved.
 *
 * @param ref - Parsed structured reference
 * @param table - Table definition
 * @param currentRow - Current formula row for #This Row resolution (optional)
 */
export function resolveStructuredRef(
  ref: StructuredRef,
  table: Table,
  currentRow?: number,
): readonly CellRange[] {
  const result = getWasm().table_resolve_structured_ref(ref, table, currentRow ?? null);
  return result as CellRange[];
}

// =============================================================================
// Adjustment (delegates to WASM)
// =============================================================================

/**
 * Adjust a structured reference in response to a table structure change.
 *
 * Returns a new StructuredRef (or the same one if no change needed).
 */
export function adjustStructuredRef(
  ref: StructuredRef,
  change: TableStructureChange,
): StructuredRef {
  return getWasm().table_adjust_structured_ref(ref, change) as StructuredRef;
}

// =============================================================================
// Formatting (delegates to WASM)
// =============================================================================

/**
 * Format a StructuredRef back to its string representation.
 *
 * Roundtrip: parseStructuredRef(formatStructuredRef(ref)) should produce
 * an equivalent StructuredRef.
 */
export function formatStructuredRef(ref: StructuredRef): string {
  return getWasm().table_format_structured_ref(ref) as string;
}
