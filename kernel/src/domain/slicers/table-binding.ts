/**
 * Slicer Table Binding Module
 *
 * ES.5: Slicer -> Filter Bridge
 *
 * This module implements the connection between slicers and their data sources.
 * Following the Cell Identity Model, slicers use CellId references that survive
 * row/column insertions and deletions.
 *
 * Bridge pattern:
 *   User Selection -> SlicerConfig -> Slicer Bridge -> Filter System -> Row Visibility
 *
 * These functions check slicer connectivity, resolve column positions, and
 * retrieve slicer items from the underlying data source.
 *
 * @see docs/architecture/cell-identity.md
 */

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import { type CellValue, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { SlicerItem, SlicerItemState } from '@mog-sdk/contracts/slicers';
import {
  buildSlicerCache as buildSlicerCacheEngine,
  createSlicer as createSlicerEngine,
  setSlicerSelection,
  type SlicerCacheItem,
} from '@mog/table-engine';

import type { Slicer, StoredSlicer } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context/types';
import * as Filters from '../sorting/filters';
import { getDataRange, getTable } from '../tables/core';

// =============================================================================
// StoredSlicer → Slicer conversion
// =============================================================================

/**
 * Convert a StoredSlicer (persistence model) to a compute-table Slicer.
 *
 * TODO: This conversion should eventually live in Rust compute-core.
 */
export function storedSlicerToComputeSlicer(stored: StoredSlicer): Slicer {
  const { source } = stored;
  let sourceId: string;
  let sourceColumnId: string;
  if (source.type === 'table') {
    sourceId = source.tableId;
    sourceColumnId = source.columnCellId;
  } else {
    sourceId = source.pivotId;
    sourceColumnId = source.fieldName;
  }
  return {
    id: stored.id,
    name: stored.caption,
    sourceType: source.type,
    sourceId,
    sourceColumnId,
    selectedValues: stored.selectedValues,
    multiSelect: stored.multiSelect ?? true,
    showItemsWithNoData: stored.style.showItemsWithNoData,
    sortOrder: stored.style.sortOrder,
  };
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Resolve a CellId to its current position via ComputeBridge.
 * The bridge now returns sheetId in the result, so no need to iterate sheets.
 */
async function resolveCellPosition(
  ctx: DocumentContext,
  cellId: CellId,
): Promise<{ row: number; col: number; sheet: SheetId } | null> {
  // Pass any sheetId — Rust ignores it and returns the actual sheetId in the result
  const sheetIds = await ctx.computeBridge.getAllSheetIds();
  const firstSheetId = sheetIds[0];
  if (!firstSheetId) return null;

  const pos = await ctx.computeBridge.getCellPosition(toSheetId(firstSheetId), cellId);
  if (!pos) return null;

  return { row: pos.row, col: pos.col, sheet: toSheetId(pos.sheetId) };
}

// =============================================================================
// ES.5: Slicer -> Filter Bridge (Connection & Resolution)
// =============================================================================

/**
 * Check if a slicer is connected (source column exists).
 *
 * ARCHITECTURE: Uses Cell Identity Model - if the header cell's CellId
 * can be resolved to a position, the slicer is connected.
 *
 * @param ctx - Store context
 * @param slicer - Slicer configuration
 * @returns True if the slicer is connected to its data source
 */
export async function isSlicerConnected(ctx: DocumentContext, slicer: Slicer): Promise<boolean> {
  if (slicer.sourceType === 'pivot') {
    // For pivot slicers, check if pivot exists
    return true; // Assume connected for now
  }

  // For table slicers, check if the source column CellId can be resolved
  const position = await resolveCellPosition(ctx, toCellId(slicer.sourceColumnId));
  return position !== null;
}

/**
 * Resolve the current column position for a slicer.
 *
 * @param ctx - Store context
 * @param slicer - Slicer configuration
 * @returns Column position info or null if disconnected
 */
export async function resolveSlicerColumn(
  ctx: DocumentContext,
  slicer: Slicer,
): Promise<{ sheetId: SheetId; row: number; col: number } | null> {
  if (slicer.sourceType === 'pivot') {
    // Pivot slicers don't use position-based column resolution
    return null;
  }

  const position = await resolveCellPosition(ctx, toCellId(slicer.sourceColumnId));
  if (!position) return null;

  return {
    sheetId: position.sheet,
    row: position.row,
    col: position.col,
  };
}

/**
 * Get selected values for a slicer from the underlying filter.
 *
 * NOTE: This is a local helper function that duplicates the logic from selection.ts
 * to avoid circular dependencies. The selection.ts module provides the public API
 * with the same logic.
 *
 * @param ctx - Store context
 * @param slicer - Slicer configuration
 * @returns Array of selected values (empty array means all selected)
 */
async function getSelectedValuesFromFilter(
  ctx: DocumentContext,
  slicer: Slicer,
): Promise<CellValue[]> {
  if (slicer.sourceType === 'pivot') {
    // TODO: Implement pivot slicer selection
    return [];
  }

  const table = await getTable(ctx, slicer.sourceId);
  if (!table) return [];

  // Get the table's filter
  const filter = await Filters.getTableFilter(ctx, toSheetId(table.sheetId), table.id);
  if (!filter) return []; // No filter = all selected

  // Get column filter criteria using the slicer's columnCellId
  const columnFilters = filter.columnFilters as Record<CellId, { values?: CellValue[] }>;
  const criteria = columnFilters[toCellId(slicer.sourceColumnId)];

  if (!criteria || !criteria.values) return []; // No criteria = all selected

  return criteria.values;
}

/**
 * Get unique values for a slicer's column.
 *
 * This populates the slicer's item list from the underlying data source.
 * For table slicers, it reads values from the table's data range.
 *
 * @param ctx - Store context
 * @param slicer - Slicer configuration
 * @param getCellValue - Callback to get cell values
 * @returns Array of slicer items with their states
 */
export async function getSlicerItems(
  ctx: DocumentContext,
  slicer: Slicer,
  getCellValue: (sheetId: SheetId, row: number, col: number) => CellValue | undefined,
): Promise<SlicerItem[]> {
  if (slicer.sourceType === 'pivot') {
    // TODO: Implement pivot slicer items
    return [];
  }

  const table = await getTable(ctx, slicer.sourceId);
  if (!table) return [];

  // Resolve slicer column position (Cell Identity pattern)
  const colPosition = await resolveSlicerColumn(ctx, slicer);
  if (!colPosition) return []; // Slicer disconnected

  const { sheetId, col } = colPosition;

  // Get data range (excludes header and total rows)
  const dataRange = await getDataRange(ctx, table.id);

  // Collect column data for table-engine (CellId resolution stays here)
  const columnData: CellValue[] = [];
  for (let row = dataRange.startRow; row <= dataRange.endRow; row++) {
    const rawValue = getCellValue(sheetId, row, col);
    columnData.push(rawValue === undefined ? null : rawValue);
  }

  // Get current filter selection state (Single Source of Truth)
  const selectedValues = await getSelectedValuesFromFilter(ctx, slicer);

  // Create a table-engine Slicer for pure computation
  const engineSlicer = createSlicerEngine({
    id: slicer.id,
    name: slicer.name,
    sourceType: 'table',
    sourceId: slicer.sourceId,
    sourceColumnId: slicer.sourceColumnId,
    showItemsWithNoData: slicer.showItemsWithNoData,
    sortOrder: slicer.sortOrder,
  });

  // Apply current filter selection to the engine slicer
  const engineSlicerWithSelection =
    selectedValues.length > 0 ? setSlicerSelection(engineSlicer, selectedValues) : engineSlicer;

  // Delegate pure computation to table-engine
  const cache = buildSlicerCacheEngine(engineSlicerWithSelection, columnData);

  // Map table-engine SlicerCacheItem[] to contracts SlicerItem[]
  return cache.items.map(
    (item: SlicerCacheItem): SlicerItem => ({
      value: item.value,
      displayText: item.displayText,
      state: (item.selected
        ? 'selected'
        : !item.hasData
          ? 'unavailable'
          : 'available') as SlicerItemState,
      count: item.count,
    }),
  );
}
