/**
 * Filter Dropdown — Build data for filter dropdown UI.
 *
 * Heavy computation delegates to Rust/WASM via compute-core.
 */

import type { CellValue, FilterCriteria, FilterDropdownData } from './types';

import { getWasm } from './wasm-backend';

// =============================================================================
// buildFilterDropdownData (delegates to WASM)
// =============================================================================

/**
 * Build the data needed to render a filter dropdown for a column.
 *
 * Returns unique values with counts, sorted by Excel ordering,
 * along with blank stats and selection state from currentFilter.
 *
 * @param columnData - All CellValues in the column (one per data row)
 * @param currentFilter - Currently applied filter (or null if none)
 * @param rowVisibility - Optional bitmap from OTHER columns' filters.
 *   When provided, only visible rows (bitmap[i] === 1) are counted.
 *   All unique values still appear in the dropdown (like Excel), but
 *   counts reflect only the visible rows.
 */
export function buildFilterDropdownData(
  columnData: readonly CellValue[],
  currentFilter: FilterCriteria | null,
  rowVisibility?: Uint8Array,
): FilterDropdownData {
  return getWasm().table_build_filter_dropdown(
    columnData,
    currentFilter ?? null,
    rowVisibility ?? null,
  ) as FilterDropdownData;
}
