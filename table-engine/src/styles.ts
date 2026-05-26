/**
 * Table Styles — Pure computation for table cell format resolution.
 *
 * Every function delegates to Rust/WASM via compute-core.
 * Built-in styles are cached after first retrieval since they never change.
 *
 * Contains all 67 built-in Excel table style definitions (28 Light, 28 Medium, 11 Dark).
 */

import type { Table, TableCellFormat, TableStyleDef } from './types';

import { getWasm } from './wasm-backend';

// =============================================================================
// Public API (delegates to WASM)
// =============================================================================

/**
 * Return all 67 built-in Excel table style definitions.
 * Cached after first retrieval since built-in styles never change.
 */
let cachedStyles: Record<string, TableStyleDef> | null = null;

export function getBuiltInTableStyles(): Record<string, TableStyleDef> {
  if (!cachedStyles) {
    cachedStyles = getWasm().table_get_built_in_styles() as Record<string, TableStyleDef>;
  }
  return cachedStyles;
}

/**
 * Resolve the cell format for a given grid position within a table.
 *
 * Pure function: Table + (row, col) -> TableCellFormat | null.
 *
 * Returns null if (row, col) is outside the table range.
 *
 * Resolution priority (highest to lowest):
 *   1. Header row
 *   2. Totals row
 *   3. First column emphasis
 *   4. Last column emphasis
 *   5. Column banding
 *   6. Row banding
 */
export function resolveTableCellFormat(
  table: Table,
  row: number,
  col: number,
): TableCellFormat | null {
  const result = getWasm().table_resolve_cell_format(table, row, col);
  return (result ?? null) as TableCellFormat | null;
}
