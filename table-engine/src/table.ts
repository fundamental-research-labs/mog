/**
 * Table Engine — Pure computation model for Excel-style tables.
 *
 * All computation delegates to Rust/WASM via compute-core.
 */

import type { CellRange, Table, TableColumn, TableStyleId, TotalsFunction } from './types';
import { getWasm } from './wasm-backend';

// =============================================================================
// Table Creation
// =============================================================================

export function createTable(config: {
  id: string;
  name: string;
  sheetId: string;
  range: CellRange;
  headerValues: readonly string[];
  style?: TableStyleId;
}): Table {
  return getWasm().table_create_table(
    config.name,
    config.sheetId,
    config.range,
    config.headerValues,
    config.id,
    config.style ?? null,
  ) as Table;
}

// =============================================================================
// Table Mutation (returns new Table)
// =============================================================================

export function resizeTable(table: Table, newRange: CellRange): Table {
  return getWasm().table_resize_table(table, newRange) as Table;
}

export function addColumn(
  table: Table,
  config: { id: string; name: string; position: number },
): Table {
  // Note: Rust addColumn generates column IDs internally, but the TS API
  // provides an explicit id. The WASM call uses name + position; the caller
  // should update the column id after creation if needed.
  return getWasm().table_add_column(table, config.name, config.position) as Table;
}

export function removeColumn(table: Table, columnId: string): Table {
  return getWasm().table_remove_column(table, columnId) as Table;
}

export function renameColumn(table: Table, columnId: string, newName: string): Table {
  return getWasm().table_rename_column(table, columnId, newName) as Table;
}

export function setTotalsFunction(
  table: Table,
  columnId: string,
  fn: TotalsFunction | null,
): Table {
  return getWasm().table_set_totals_function(table, columnId, fn ?? 'none') as Table;
}

export function setTableOption(
  table: Table,
  option:
    | 'bandedRows'
    | 'bandedColumns'
    | 'emphasizeFirstColumn'
    | 'emphasizeLastColumn'
    | 'hasTotalsRow'
    | 'showFilterButtons',
  value: boolean,
): Table {
  return getWasm().table_set_table_option(table, option, value) as Table;
}

// =============================================================================
// Range Queries
// =============================================================================

export function getDataRange(table: Table): CellRange {
  return getWasm().table_get_data_range(table) as CellRange;
}

export function getHeaderRange(table: Table): CellRange | null {
  return getWasm().table_get_header_range(table) as CellRange | null;
}

export function getTotalsRange(table: Table): CellRange | null {
  return getWasm().table_get_totals_range(table) as CellRange | null;
}

export function getColumnDataRange(table: Table, columnId: string): CellRange {
  return getWasm().table_get_column_data_range(table, columnId) as CellRange;
}

// =============================================================================
// Column Lookup
// =============================================================================

export function getColumnByName(table: Table, name: string): TableColumn | null {
  return getWasm().table_get_column_by_name(table, name) as TableColumn | null;
}

export function getColumnById(table: Table, id: string): TableColumn | null {
  return getWasm().table_get_column_by_id(table, id) as TableColumn | null;
}

export function getColumnAtGridCol(table: Table, gridCol: number): TableColumn | null {
  return getWasm().table_get_column_at_grid_col(table, gridCol) as TableColumn | null;
}

// =============================================================================
// Hit Testing
// =============================================================================

export function isInTable(table: Table, row: number, col: number): boolean {
  return getWasm().table_is_in_table(table, row, col) as boolean;
}

export function isInHeaderRow(table: Table, row: number): boolean {
  return getWasm().table_is_in_header_row(table, row) as boolean;
}

export function isInTotalsRow(table: Table, row: number): boolean {
  return getWasm().table_is_in_totals_row(table, row) as boolean;
}

export function isInDataRange(table: Table, row: number, col: number): boolean {
  return getWasm().table_is_in_data_range(table, row, col) as boolean;
}

// =============================================================================
// Validation
// =============================================================================

export function validateTableName(
  name: string,
  existingNames: readonly string[],
): { valid: true } | { valid: false; reason: string } {
  const result = getWasm().table_validate_table_name(name, existingNames) as {
    valid: boolean;
    reason?: string;
  };
  if (result.valid) return { valid: true };
  return { valid: false, reason: result.reason ?? 'Invalid table name' };
}

export function generateTableName(existingNames: readonly string[]): string {
  return getWasm().table_generate_table_name(existingNames) as string;
}

export function tablesOverlap(a: CellRange, b: CellRange): boolean {
  return getWasm().table_ranges_overlap(a, b) as boolean;
}

// =============================================================================
// Totals Formula Generation
// =============================================================================

export function getTotalsFormula(fn: TotalsFunction, columnName: string): string {
  return getWasm().table_get_totals_formula(fn, columnName) as string;
}

// =============================================================================
// Totals Row Toggle
// =============================================================================

export function toggleTotalsRow(table: Table): Table {
  return getWasm().table_toggle_totals_row(table) as Table;
}
