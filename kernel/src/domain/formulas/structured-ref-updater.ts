/**
 * Formula Structured Reference Updater
 *
 * Storage-level formula updates are now handled by Rust compute-core in the
 * engine layer (see compute-core/src/storage/engine/tables.rs). When a table
 * or column is renamed/deleted through the engine API, Rust calls the
 * structured_ref_updater module (compute-core/src/storage/structured_ref_updater.rs)
 * to walk all formula templates and rewrite or #REF!-ify structured references.
 *
 * The stub functions below (updateFormulasForTableRename, etc.) are retained
 * because TS code paths may still call them, but they are intentional no-ops —
 * Rust handles the actual work when the corresponding engine mutation fires.
 *
 * Pure computation helpers (AST traversal, string replacement) have been removed —
 * Rust compute-core is the single source of truth for all formula rewriting.
 *
 * @see compute-core/src/storage/structured_ref_updater.rs - Rust formula rewriting
 * @see compute-core/src/storage/engine/tables.rs - Wiring into table mutations
 */

import type { CellRange } from '@mog-sdk/contracts/core';

import type { IDomainContext } from '@mog-sdk/contracts/kernel';

// =============================================================================
// Formula Update Operations — CB Delegation
// =============================================================================

/**
 * Update formulas after a table rename.
 *
 * No-op stub — Rust compute-core handles this in `rename_table` via
 * `structured_ref_updater::update_formulas_for_table_rename`.
 *
 * @returns Always 0 (actual updates performed by Rust engine layer)
 */
export function updateFormulasForTableRename(
  _ctx: IDomainContext,
  _oldTableName: string,
  _newTableName: string,
): number {
  // Rust compute-core handles formula reference updates internally
  // during table rename operations.
  return 0;
}

/**
 * Update formulas after a column rename within a table.
 *
 * No-op stub — Rust compute-core has `structured_ref_updater::update_formulas_for_column_rename`
 * ready to wire once a column rename path is added to the engine layer.
 *
 * @returns Always 0 (actual updates will be performed by Rust engine layer)
 */
export function updateFormulasForColumnRename(
  _ctx: IDomainContext,
  _tableName: string,
  _oldColumnName: string,
  _newColumnName: string,
): number {
  // Rust compute-core handles formula reference updates internally
  // during column rename operations.
  return 0;
}

/**
 * Update formulas to #REF! after a table column is deleted.
 *
 * No-op stub — Rust compute-core handles this in `remove_table_column` via
 * `structured_ref_updater::propagate_ref_error_for_column_delete`.
 *
 * @returns Always 0 (actual updates performed by Rust engine layer)
 */
export function propagateRefErrorForColumnDelete(
  _ctx: IDomainContext,
  _tableName: string,
  _deletedColumnName: string,
): number {
  // Rust compute-core handles #REF! propagation internally
  // during column delete operations.
  return 0;
}

/**
 * Update formulas to #REF! after a table is deleted/converted to range.
 *
 * No-op stub — Rust compute-core handles this in `delete_table` and
 * `remove_table_def` via `structured_ref_updater::propagate_ref_error_for_table_delete`.
 *
 * @returns Always 0 (actual updates performed by Rust engine layer)
 */
export function propagateRefErrorForTableDelete(
  _ctx: IDomainContext,
  _deletedTableName: string,
): number {
  // Rust compute-core handles #REF! propagation internally
  // during table delete operations.
  return 0;
}

/**
 * Table information needed for structured reference resolution.
 * Used during Convert to Range operation.
 */
export interface TableRangeInfo {
  name: string;
  range: CellRange;
  columns: { name: string; index: number }[];
  hasHeaderRow: boolean;
  hasTotalRow: boolean;
}

/**
 * Convert all structured references to a table into A1 references.
 *
 * No-op stub — Rust compute-core has `structured_ref_updater::convert_structured_refs_to_a1`
 * ready to wire once a Convert to Range path is added to the engine layer.
 *
 * @returns Always 0 (actual conversion will be performed by Rust engine layer)
 */
export function convertStructuredRefsToA1(
  _ctx: IDomainContext,
  _tableInfo: TableRangeInfo,
): number {
  // Rust compute-core handles structured reference conversion internally
  // during Convert to Range operations.
  return 0;
}
