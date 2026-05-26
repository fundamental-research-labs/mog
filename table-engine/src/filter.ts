/**
 * Filter Engine — Pure computation for filter state and evaluation.
 *
 * Stateless. Immutable. No DOM, no Yjs, no React.
 *
 * Core primitive: per-column bitmap (Uint8Array), one byte per data row.
 *   1 = visible, 0 = hidden.
 *
 * Bridge caches per-column bitmaps and composes them (AND across columns).
 *
 * Filter state CRUD stays in TypeScript (simple object construction).
 * Heavy evaluation delegates to Rust/WASM via compute-core.
 */

import type { CellValue, FilterCriteria, FilterState } from './types';

import { getWasm } from './wasm-backend';

// =============================================================================
// FilterState CRUD (all return new FilterState)
// =============================================================================

/**
 * Create an empty FilterState with no column filters.
 */
export function createFilterState(): FilterState {
  return { filters: new Map() };
}

/**
 * Set (or replace) a column's filter criteria. Returns a new FilterState.
 */
export function setColumnFilter(
  state: FilterState,
  columnId: string,
  criteria: FilterCriteria,
): FilterState {
  const next = new Map(state.filters);
  next.set(columnId, criteria);
  return { filters: next };
}

/**
 * Clear a single column's filter. Returns a new FilterState.
 */
export function clearColumnFilter(state: FilterState, columnId: string): FilterState {
  const next = new Map(state.filters);
  next.delete(columnId);
  return { filters: next };
}

/**
 * Clear all column filters. Returns a new empty FilterState.
 */
export function clearAllFilters(state: FilterState): FilterState {
  return { ...state, filters: new Map() };
}

// =============================================================================
// Per-column evaluation -> bitmap (delegates to WASM)
// =============================================================================

/**
 * Evaluate a FilterCriteria against a column of data.
 *
 * Returns Uint8Array: one byte per data row, 1 = visible, 0 = hidden.
 *
 * For TopBottom and Dynamic filters, internally resolves them to a
 * concrete ValueFilter or ConditionFilter first, then evaluates.
 *
 * @param criteria - The filter criteria to evaluate
 * @param columnData - One CellValue per data row
 * @param _now - Current date (for DynamicFilter date rules); handled by WASM.
 */
export function evaluateColumnFilter(
  criteria: FilterCriteria,
  columnData: readonly CellValue[],
  _now?: Date,
): Uint8Array {
  const result = getWasm().table_evaluate_column_filter(criteria, columnData);
  // WASM returns Vec<u8> serialized as a regular array — convert to Uint8Array
  return new Uint8Array(result as ArrayLike<number>);
}
