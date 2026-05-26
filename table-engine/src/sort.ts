/**
 * Sort Engine — Pure computation for table sort order.
 *
 * Computes a permutation array mapping new positions to original row indices.
 * Does NOT modify data — the bridge applies the permutation to Yjs.
 *
 * Heavy computation delegates to Rust/WASM via compute-core.
 *
 * @packageDocumentation
 */

import type { CellValue, SortSpec } from './types';

import { getWasm } from './wasm-backend';

// =============================================================================
// SORT PERMUTATION (delegates to WASM)
// =============================================================================

/**
 * Compute a sort permutation for table data rows.
 *
 * Returns an array where `result[newPosition] = originalRowIndex`.
 * The bridge applies this permutation to reorder rows in Yjs.
 *
 * @param specs - Sort specifications (first spec = primary key, etc.)
 * @param data - Column-major data: data[colIndex][rowIndex]
 * @returns Permutation array mapping new positions to original row indices
 */
export function computeSortOrder(
  specs: readonly SortSpec[],
  data: readonly (readonly CellValue[])[],
): readonly number[] {
  const totalRows = data.length > 0 ? data[0].length : 0;
  const result = getWasm().table_compute_sort_order(specs, data, totalRows);
  return result as number[];
}
