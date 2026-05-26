/**
 * Tables Range Resolution Domain Module
 *
 * Range resolution for tables. In the ComputeBridge world, Rust compute-core
 * owns table range data. The table config already contains the resolved range,
 * so resolution is a simple field access.
 *
 * Legacy CellIdRange/migration functions are no-ops (Rust handles this).
 */

import type { CellIdRange } from '@mog-sdk/contracts/cell-identity';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { TableConfig } from '@mog-sdk/contracts/tables';

import type { DocumentContext } from '../../context/types';

// =============================================================================
// Exported Range Resolution Functions
// =============================================================================

/**
 * Resolve a table's range to a position-based CellRange.
 *
 * In the ComputeBridge world, the table config already contains the resolved
 * range — no CellId lookup needed.
 *
 * @param _ctx - Store context (unused, kept for API compat)
 * @param table - Table configuration
 * @returns Position-based CellRange, or null if range is missing
 */
export function resolveTableRange(_ctx: DocumentContext, table: TableConfig): CellRange | null {
  return table.range ?? null;
}

/**
 * Create a CellIdRange from position coordinates.
 *
 * In the ComputeBridge world, CellId management is handled by Rust.
 * Returns a placeholder CellIdRange.
 *
 * @param _ctx - Store context (unused)
 * @param _sheetId - Sheet ID
 * @param _startRow - Start row (top)
 * @param _startCol - Start column (left)
 * @param _endRow - End row (bottom)
 * @param _endCol - End column (right)
 * @returns Placeholder CellIdRange
 */
export function createTableCellIdRange(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _startRow: number,
  _startCol: number,
  _endRow: number,
  _endCol: number,
): CellIdRange {
  // Rust compute-core manages cell identity; return placeholder
  return { topLeftCellId: '', bottomRightCellId: '' };
}

// =============================================================================
// Migration Helpers — No-ops in ComputeBridge world
// =============================================================================

/**
 * Check if a table needs migration to Cell Identity Model.
 * In ComputeBridge world, Rust handles all migration — always returns false.
 */
export function needsMigration(_table: TableConfig): boolean {
  return false;
}

/**
 * Migrate a table to Cell Identity Model.
 * No-op in ComputeBridge world — returns table unchanged.
 */
export function migrateLegacyTable(_ctx: DocumentContext, table: TableConfig): TableConfig {
  return table;
}
