/**
 * Slicer Selection Module
 *
 * ES.5: Slicer Selection State Management
 *
 * This module implements slicer selection operations that bridge to the filter system.
 * Following Section 7 of ARCHITECTURE-CHECKLIST.md, selection changes emit
 * 'slicer:selectionChanged' events via the EventBus.
 *
 * ARCHITECTURE: Selection state is derived from filter state - not stored separately.
 * This ensures single source of truth for what values are filtered.
 *
 * Bridge pattern (Section 8):
 *   Slicer Selection -> Filter System -> Row Visibility -> Render
 *
 * @see docs/architecture/cell-identity.md
 * @see docs/ARCHITECTURE-CHECKLIST.md (Section 7: EventBus integration)
 * @see docs/ARCHITECTURE-CHECKLIST.md (Section 8: Bridge pattern)
 */

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import { type CellValue, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { StructureChangeSource } from '@mog-sdk/contracts/event-base';
import type { SlicerSelectionChangedEvent } from '@mog-sdk/contracts/events';

import type { Slicer } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context/types';
import * as Filters from '../sorting/filters';
import { getTable } from '../tables/core';
import { getSlicer, updateSlicer } from './crud';
import { storedSlicerToComputeSlicer } from './table-binding';

// =============================================================================
// ES.5: Slicer Selection State (Single Source of Truth from Filters)
// =============================================================================

/**
 * Get currently selected values for a slicer from the underlying filter.
 *
 * ARCHITECTURE: Selection state is derived from filter state - not stored separately.
 * This ensures single source of truth for what values are filtered.
 *
 * @param ctx - Store context
 * @param slicer - Slicer configuration
 * @returns Array of selected values (empty array means all selected)
 */
export async function getSlicerSelectedValues(
  ctx: DocumentContext,
  slicer: Slicer,
): Promise<CellValue[]> {
  if (slicer.sourceType === 'pivot') {
    // Pivot slicer selection is stored on the slicer itself (not derived from table filters)
    return slicer.selectedValues ?? [];
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
 * Set slicer selection (applies filter to underlying data).
 *
 * ARCHITECTURE: Selection changes flow through the filter system.
 * Slicer -> Filter -> Row Visibility -> Render
 *
 * EventBus integration (Section 7): Emits 'slicer:selectionChanged' event
 * after applying selection to trigger slicer-table-bridge updates.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID
 * @param selectedValues - Values to select (empty array clears selection)
 * @param origin - Origin of the change (default: 'user')
 */
export async function setSlicerSelection(
  ctx: DocumentContext,
  sheetId: SheetId,
  slicerId: string,
  selectedValues: CellValue[],
  origin: StructureChangeSource = 'user',
): Promise<void> {
  const storedSlicer = await getSlicer(ctx, sheetId, slicerId);
  if (!storedSlicer) return;

  if (storedSlicer.source.type === 'pivot') {
    // Pivot slicer selection: store selectedValues on the slicer itself,
    // then emit the event. The slicer-pivot-bridge handles the actual
    // pivot field filter update via setPivotFieldFilter.
    await updateSlicer(ctx, sheetId, slicerId, { selectedValues });

    const now = Date.now();
    const changeType = selectedValues.length === 0 ? 'clear' : 'select';
    const event: SlicerSelectionChangedEvent = {
      type: 'slicer:selectionChanged',
      timestamp: now,
      sheetId,
      slicerId,
      selectedValues,
      changeType,
    };
    ctx.eventBus.emit(event);
    return;
  }

  const tableId = storedSlicer.source.tableId;
  const table = await getTable(ctx, tableId);
  if (!table) return;

  // Get or create filter for the table
  let filter = await Filters.getTableFilter(ctx, toSheetId(table.sheetId), table.id);
  if (!filter) {
    // Create filter if it doesn't exist
    filter = await Filters.createFilter(
      ctx,
      toSheetId(table.sheetId),
      table.range,
      'tableFilter',
      origin,
      table.id,
    );
  }

  const columnCellId = toCellId(storedSlicer.source.columnCellId);
  const now = Date.now();

  if (selectedValues.length === 0) {
    // Clear filter (show all)
    await Filters.clearColumnFilter(ctx, toSheetId(table.sheetId), filter.id, columnCellId, origin);
  } else {
    // Set filter to show only selected values
    await Filters.setColumnFilter(
      ctx,
      toSheetId(table.sheetId),
      filter.id,
      columnCellId,
      { type: 'value', values: selectedValues },
      origin,
    );
  }

  // Emit slicer selection changed event (Section 7: EventBus integration)
  // This event triggers slicer-table-bridge to update related components
  const changeType = selectedValues.length === 0 ? 'clear' : 'select';
  const event: SlicerSelectionChangedEvent = {
    type: 'slicer:selectionChanged',
    timestamp: now,
    sheetId,
    slicerId,
    selectedValues,
    changeType,
  };
  ctx.eventBus.emit(event);
}

/**
 * Clear slicer selection (show all values).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID
 * @param origin - Origin of the change (default: 'user')
 */
export async function clearSlicerSelection(
  ctx: DocumentContext,
  sheetId: SheetId,
  slicerId: string,
  origin: StructureChangeSource = 'user',
): Promise<void> {
  await setSlicerSelection(ctx, sheetId, slicerId, [], origin);
}

/**
 * Toggle a single item's selection in the slicer.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID
 * @param value - Value to toggle
 * @param origin - Origin of the change (default: 'user')
 */
export async function toggleSlicerItem(
  ctx: DocumentContext,
  sheetId: SheetId,
  slicerId: string,
  value: CellValue,
  origin: StructureChangeSource = 'user',
): Promise<void> {
  const storedSlicer = await getSlicer(ctx, sheetId, slicerId);
  if (!storedSlicer) return;

  const currentSelection = await getSlicerSelectedValues(
    ctx,
    storedSlicerToComputeSlicer(storedSlicer),
  );
  const valueKey = value === null ? '__NULL__' : String(value);
  const currentKeys = new Set(currentSelection.map((v) => (v === null ? '__NULL__' : String(v))));

  let newSelection: CellValue[];

  if (currentKeys.has(valueKey)) {
    // Remove from selection
    newSelection = currentSelection.filter((v) => {
      const k = v === null ? '__NULL__' : String(v);
      return k !== valueKey;
    });
  } else {
    // Add to selection
    newSelection = [...currentSelection, value];
  }

  // If all values are being deselected, clear the filter instead
  if (newSelection.length === 0) {
    await clearSlicerSelection(ctx, sheetId, slicerId, origin);
  } else {
    await setSlicerSelection(ctx, sheetId, slicerId, newSelection, origin);
  }
}

/**
 * Select a single item exclusively (clear others).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID
 * @param value - Value to select exclusively
 * @param origin - Origin of the change (default: 'user')
 */
export async function selectSlicerItemExclusive(
  ctx: DocumentContext,
  sheetId: SheetId,
  slicerId: string,
  value: CellValue,
  origin: StructureChangeSource = 'user',
): Promise<void> {
  await setSlicerSelection(ctx, sheetId, slicerId, [value], origin);
}
