/**
 * Slicer Module — Pure computation for slicer CRUD and selection operations.
 *
 * All functions are pure and stateless. Slicer objects are readonly.
 * Selection changes return new Slicer instances — no mutation.
 *
 * Bridge pattern: slicerToFilterCriteria() converts slicer selection into
 * a FilterCriteria, enabling composition with table filters through the same pipeline.
 *
 * Heavy computation delegates to Rust/WASM via compute-core.
 *
 * @packageDocumentation
 */

import type { CellValue, FilterCriteria, Slicer, SlicerCache } from './types';

import { getWasm } from './wasm-backend';

// ═══════════════════════════════════════════
//  SLICER CREATION (pure TS — simple object construction)
// ═══════════════════════════════════════════

/**
 * Create a new Slicer with the given configuration.
 *
 * @param config - Slicer configuration options
 * @returns A new immutable Slicer
 */
export function createSlicer(config: {
  id: string;
  name: string;
  sourceType: 'table' | 'pivot';
  sourceId: string;
  sourceColumnId: string;
  multiSelect?: boolean;
  showItemsWithNoData?: boolean;
  sortOrder?: 'ascending' | 'descending' | 'dataSourceOrder';
}): Slicer {
  return {
    id: config.id,
    name: config.name,
    sourceType: config.sourceType,
    sourceId: config.sourceId,
    sourceColumnId: config.sourceColumnId,
    selectedValues: [],
    multiSelect: config.multiSelect ?? true,
    showItemsWithNoData: config.showItemsWithNoData ?? false,
    sortOrder: config.sortOrder ?? 'ascending',
  };
}

// ═══════════════════════════════════════════
//  SLICER SELECTION OPERATIONS (delegates to WASM)
// ═══════════════════════════════════════════

/**
 * Toggle a value in the slicer's selection.
 *
 * - If multiSelect: add/remove from selectedValues
 * - If !multiSelect: set to just [value] (or clear if already the sole selection)
 *
 * @param slicer - Current slicer state
 * @param value - Value to toggle
 * @returns New Slicer with updated selection
 */
export function toggleSlicerValue(slicer: Slicer, value: CellValue): Slicer {
  return getWasm().table_toggle_slicer_value(slicer, value) as Slicer;
}

/**
 * Set the slicer's selection to the given values.
 *
 * @param slicer - Current slicer state
 * @param values - Values to select
 * @returns New Slicer with updated selection
 */
export function setSlicerSelection(slicer: Slicer, values: readonly CellValue[]): Slicer {
  return getWasm().table_select_slicer_values(slicer, values) as Slicer;
}

/**
 * Clear all slicer selection (show all data).
 *
 * @param slicer - Current slicer state
 * @returns New Slicer with empty selection
 */
export function clearSlicerSelection(slicer: Slicer): Slicer {
  return getWasm().table_clear_slicer_selection(slicer) as Slicer;
}

/**
 * Select all values available in the slicer cache.
 *
 * @param slicer - Current slicer state
 * @param cache - Current slicer cache (provides available values)
 * @returns New Slicer with all cache values selected
 */
export function selectAllSlicerValues(slicer: Slicer, cache: SlicerCache): Slicer {
  return getWasm().table_select_all_slicer_values(slicer, cache) as Slicer;
}

// ═══════════════════════════════════════════
//  SLICER → FILTER CONVERSION (delegates to WASM)
// ═══════════════════════════════════════════

/**
 * Convert slicer selection into a FilterCriteria for composition with table filters.
 *
 * This is the key bridge: slicer selection flows through the same filter pipeline
 * as explicit column filters, enabling slicer+filter composition.
 *
 * - Empty selectedValues → include everything (empty ConditionFilter that matches all rows)
 * - Non-empty selectedValues → include only those values; includeBlanks=true if null is selected
 *
 * @param slicer - Slicer with current selection
 * @returns FilterCriteria representing the slicer's selection
 */
export function slicerToFilterCriteria(slicer: Slicer): FilterCriteria {
  return getWasm().table_slicer_to_filter_criteria(slicer) as FilterCriteria;
}
