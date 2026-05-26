/**
 * Slicer Cache Module — Pure computation for building slicer cache data.
 *
 * The cache contains unique values from a column, their counts, selection state,
 * and whether they have visible data (accounting for other filters).
 *
 * Heavy computation delegates to Rust/WASM via compute-core.
 *
 * @packageDocumentation
 */

import type { CellValue, Slicer, SlicerCache } from './types';

import { getWasm } from './wasm-backend';

// =============================================================================
// CACHE BUILDING (delegates to WASM)
// =============================================================================

/**
 * Build a SlicerCache from column data and slicer selection state.
 *
 * @param slicer - Slicer configuration (provides selectedValues, sortOrder, showItemsWithNoData)
 * @param columnData - Raw column data (one value per data row, row-indexed)
 * @param rowVisibility - Optional bitmap from other filters (1=visible, 0=hidden).
 *   When provided, items whose values only appear in hidden rows get hasData=false.
 * @returns Computed SlicerCache
 */
export function buildSlicerCache(
  slicer: Slicer,
  columnData: readonly CellValue[],
  rowVisibility?: Uint8Array,
): SlicerCache {
  const result = getWasm().table_build_slicer_cache(slicer, columnData, rowVisibility ?? null);
  return result as SlicerCache;
}
