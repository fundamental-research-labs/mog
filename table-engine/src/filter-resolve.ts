/**
 * Filter Resolve — Convert data-dependent filter types to concrete form.
 *
 * TopBottomFilter and DynamicFilter depend on the actual column data:
 * - TopBottom needs to compute thresholds (top N items, top N%, top by sum)
 * - Dynamic needs to compute averages or resolve date ranges
 *
 * Heavy computation delegates to Rust/WASM via compute-core.
 */

import type {
  CellValue,
  ConditionFilter,
  DynamicFilterRule,
  TopBottomFilter,
  ValueFilter,
} from './types';

import { getWasm } from './wasm-backend';

// =============================================================================
// resolveDynamicFilter (delegates to WASM)
// =============================================================================

/**
 * Resolve a DynamicFilterRule to a concrete ConditionFilter or ValueFilter.
 *
 * - aboveAverage / belowAverage: computes column average, returns ConditionFilter
 * - date rules (today, thisMonth, etc.): computes date range, returns ConditionFilter with between
 */
export function resolveDynamicFilter(
  rule: DynamicFilterRule,
  columnData: readonly CellValue[],
  _now?: Date,
  _weekStartDay?: number,
): ConditionFilter | ValueFilter {
  const result = getWasm().table_resolve_dynamic_filter(rule, columnData);
  return result as ConditionFilter | ValueFilter;
}

// =============================================================================
// evaluateTopBottomDirect (delegates to WASM)
// =============================================================================

/**
 * Evaluate a TopBottomFilter directly to a bitmap using index-based selection.
 * This avoids the tie-breaking problem of resolving to ValueFilter.
 *
 * When resolving to a ValueFilter, duplicate values at the boundary cause ALL
 * matching rows to be included (e.g., data [10, 10, 50] with "top 2 items"
 * would resolve to included: [50, 10], matching ALL THREE rows). This function
 * instead selects exactly the right number of rows by their sorted index.
 */
export function evaluateTopBottomDirect(
  spec: TopBottomFilter,
  columnData: readonly CellValue[],
): Uint8Array {
  const result = getWasm().table_evaluate_top_bottom(spec, columnData);
  // WASM returns Vec<u8> serialized as a regular array — convert to Uint8Array
  return new Uint8Array(result as ArrayLike<number>);
}
