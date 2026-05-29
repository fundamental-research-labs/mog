/**
 * Slicers CRUD Module
 *
 * Delegates all data access to ComputeBridge (Rust compute-core).
 *
 * Architecture:
 * - Write operations: fire-and-forget via ctx.computeBridge
 * - Read operations: async via ctx.computeBridge
 * - Events: handled by MutationResultHandler from Rust MutationResult
 *
 * @see compute-core/src/storage/slicers.rs - Rust implementation
 */

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { StructureChangeSource } from '@mog-sdk/contracts/event-base';
import type { ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import type {
  CreateSlicerOptions,
  SlicerPivotSource,
  SlicerStyle,
  SlicerTableSource,
} from '@mog-sdk/contracts/slicers';
import { DEFAULT_SLICER_STYLE, objectPositionToAnchor } from './slicer-utils';
import type { StoredSlicer, StoredSlicerUpdate } from '../../bridges/compute/compute-types.gen';

import type { DocumentContext } from '../../context/types';

import { generateSlicerId } from './types';

// =============================================================================
// ES.4: Slicer CRUD Operations
// =============================================================================

/**
 * Create a new slicer for a table column.
 *
 * Delegates to ComputeBridge.createSlicer. Events emitted via MutationResultHandler.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet to create slicer in
 * @param tableId - Table to connect to
 * @param columnCellId - CellId of the column header (Cell Identity Model)
 * @param options - Optional slicer configuration
 * @param _origin - Origin of the change (handled by Rust)
 */
export function createTableSlicer(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableId: string,
  columnCellId: CellId,
  options?: CreateSlicerOptions,
  _origin: StructureChangeSource = 'user',
): void {
  const source: SlicerTableSource = {
    type: 'table',
    tableId,
    columnCellId,
  };

  // TODO: When no explicit style.preset is provided, read the
  // workbook default via ctx.computeBridge.getDefaultSlicerStyle() instead
  // of using the hardcoded DEFAULT_SLICER_STYLE. Requires making this
  // function async or pre-fetching the default.
  const style: SlicerStyle = {
    ...DEFAULT_SLICER_STYLE,
    ...options?.style,
  };

  const position: ObjectPosition = {
    anchorType: 'absolute',
    from: {
      cellId: columnCellId,
      xOffset: 0,
      yOffset: 0,
    },
    x: 100,
    y: 100,
    width: 200,
    height: 300,
    ...options?.position,
  };

  const config: StoredSlicer = {
    id: generateSlicerId(),
    sheetId,
    source,
    caption: options?.caption ?? 'Column',
    name: options?.name,
    style,
    position: objectPositionToAnchor(position),
    level: 0,
    zIndex: 0,
    locked: false,
    showHeader: options?.showHeader ?? true,
    multiSelect: true,
    selectedValues: [],
  };

  void ctx.computeBridge.createSlicer(sheetId, config);
}

/**
 * Create a new slicer for a pivot table field.
 *
 * Delegates to ComputeBridge.createSlicer. Events emitted via MutationResultHandler.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet to create slicer in
 * @param pivotId - Pivot table to connect to
 * @param fieldName - Field name in the pivot
 * @param fieldArea - Which area the field is in
 * @param options - Optional slicer configuration
 * @param _origin - Origin of the change (handled by Rust)
 */
export function createPivotSlicer(
  ctx: DocumentContext,
  sheetId: SheetId,
  pivotId: string,
  fieldName: string,
  fieldArea: 'row' | 'column' | 'filter',
  options?: CreateSlicerOptions,
  _origin: StructureChangeSource = 'user',
): void {
  const source: SlicerPivotSource = {
    type: 'pivot',
    pivotId,
    fieldName,
    fieldArea,
  };

  // TODO: When no explicit style.preset is provided, read the
  // workbook default via ctx.computeBridge.getDefaultSlicerStyle() instead
  // of using the hardcoded DEFAULT_SLICER_STYLE. Requires making this
  // function async or pre-fetching the default.
  const style: SlicerStyle = {
    ...DEFAULT_SLICER_STYLE,
    ...options?.style,
  };

  const position: ObjectPosition = {
    anchorType: 'absolute',
    from: {
      cellId: toCellId(''),
      xOffset: 0,
      yOffset: 0,
    },
    x: 100,
    y: 100,
    width: 200,
    height: 300,
    ...options?.position,
  };

  const config: StoredSlicer = {
    id: generateSlicerId(),
    sheetId,
    source,
    caption: options?.caption ?? fieldName,
    name: options?.name,
    style,
    position: objectPositionToAnchor(position),
    level: 0,
    zIndex: 0,
    locked: false,
    showHeader: options?.showHeader ?? true,
    multiSelect: true,
    selectedValues: [],
  };

  void ctx.computeBridge.createSlicer(sheetId, config);
}

/**
 * Get a slicer by ID.
 *
 * Delegates to ComputeBridge.getSlicerState.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID
 * @returns Promise of slicer configuration or undefined if not found
 */
export async function getSlicer(
  ctx: DocumentContext,
  sheetId: SheetId,
  slicerId: string,
): Promise<StoredSlicer | undefined> {
  const state = (await ctx.computeBridge.getSlicerState(sheetId, slicerId)) as StoredSlicer | null;
  return state ?? undefined;
}

/**
 * Get all slicers in a sheet.
 *
 * Delegates to ComputeBridge.getAllSlicers.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet to get slicers from
 * @returns Promise of array of slicer configurations
 */
export async function getSlicersInSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<StoredSlicer[]> {
  return ctx.computeBridge.getAllSlicers(sheetId);
}

/**
 * Get all slicers connected to a specific table.
 *
 * Fetches all slicers across all sheets and filters for table source match.
 *
 * @param ctx - Store context
 * @param tableId - Table ID
 * @returns Promise of array of slicer configurations connected to this table
 */
export async function getSlicersForTable(
  ctx: DocumentContext,
  tableId: string,
): Promise<StoredSlicer[]> {
  const result: StoredSlicer[] = [];
  const sheetIds = await ctx.computeBridge.getAllSheetIds();

  for (const rawId of sheetIds) {
    const slicers = await getSlicersInSheet(ctx, toSheetId(rawId));
    for (const slicer of slicers) {
      if (slicer.source.type === 'table' && slicer.source.tableId === tableId) {
        result.push(slicer);
      }
    }
  }

  return result;
}

/**
 * Get all slicers connected to a specific pivot table.
 *
 * Fetches all slicers across all sheets and filters for pivot source match.
 *
 * @param ctx - Store context
 * @param pivotId - Pivot table ID
 * @returns Promise of array of slicer configurations connected to this pivot
 */
export async function getSlicersForPivot(
  ctx: DocumentContext,
  pivotId: string,
): Promise<StoredSlicer[]> {
  const result: StoredSlicer[] = [];
  const sheetIds = await ctx.computeBridge.getAllSheetIds();

  for (const rawId of sheetIds) {
    const slicers = await getSlicersInSheet(ctx, toSheetId(rawId));
    for (const slicer of slicers) {
      if (slicer.source.type === 'pivot' && slicer.source.pivotId === pivotId) {
        result.push(slicer);
      }
    }
  }

  return result;
}

/**
 * Update slicer configuration.
 *
 * Delegates to ComputeBridge.updateSlicer. Events emitted via MutationResultHandler.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID
 * @param updates - Partial configuration to merge
 * @param _origin - Origin of the change (handled by Rust)
 */
export function updateSlicer(
  ctx: DocumentContext,
  sheetId: SheetId,
  slicerId: string,
  updates: Partial<Omit<StoredSlicer, 'id' | 'sheetId' | 'source'>>,
  _origin: StructureChangeSource = 'user',
): Promise<void> {
  const slicerUpdate: StoredSlicerUpdate = {
    ...(updates.caption !== undefined && { caption: updates.caption }),
    ...(updates.name !== undefined && { name: updates.name }),
    ...(updates.style !== undefined && { style: updates.style }),
    ...(updates.position !== undefined && { position: updates.position }),
    ...(updates.zIndex !== undefined && { zIndex: updates.zIndex }),
    ...(updates.locked !== undefined && { locked: updates.locked }),
    ...(updates.showHeader !== undefined && { showHeader: updates.showHeader }),
    ...(updates.startItem !== undefined && { startItem: updates.startItem }),
    ...(updates.selectedValues !== undefined && { selectedValues: updates.selectedValues }),
  };
  return ctx.computeBridge
    .updateSlicerConfig(sheetId, slicerId, slicerUpdate)
    .then(() => undefined);
}

/**
 * Delete a slicer.
 *
 * Delegates to ComputeBridge.deleteSlicer. Events emitted via MutationResultHandler.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID to delete
 * @param _origin - Origin of the change (handled by Rust)
 */
export function deleteSlicer(
  ctx: DocumentContext,
  sheetId: SheetId,
  slicerId: string,
  _origin: StructureChangeSource = 'user',
): void {
  void ctx.computeBridge.deleteSlicer(sheetId, slicerId);
}
