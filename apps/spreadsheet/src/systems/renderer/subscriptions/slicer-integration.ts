/**
 * Slicer Integration Module
 *
 * Slicers Implementation
 *
 * Provides cache invalidation subscriptions for slicers.
 * Slicers need to update their item lists when:
 * - Cell values change in the source column
 * - Filter state changes (affects selection state)
 * - Table structure changes (columns inserted/deleted)
 * - Table is deleted (slicer becomes disconnected)
 *
 * ARCHITECTURE:
 * EventBus Events -> Observer -> Cache Invalidation -> UI Re-render
 *
 * The slicer cache is NOT stored in Yjs. It is computed on-demand and
 * invalidated via events. This keeps the persistent state minimal while
 * enabling reactive UI updates.
 *
 * Migrated to unified Worksheet API (ws.listSlicers, ws.getSlicer, ws.getSlicerState).
 * Cache invalidation is done by emitting slicer:cache-invalidated events
 * on the EventBus, which UI components subscribe to for re-fetching.
 *
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';

/**
 * Slicer cache entry (items + metadata).
 * Replaces the old Slicers.SlicerCache type from kernel/store.
 */
export interface SlicerCacheEntry {
  slicerId: string;
  items: Array<{ value: string; selected: boolean; visible: boolean }>;
  connected: boolean;
}

/**
 * Invalidate all slicer caches in a sheet by emitting events.
 * UI components listen for slicer:cache-invalidated to re-fetch slicer state.
 */
type SlicerCacheInvalidationReason =
  | 'cellsChanged'
  | 'filterApplied'
  | 'tableStructureChanged'
  | 'pivotUpdated';

function invalidateSlicerCachesInSheet(
  sheetId: SheetId,
  wb: Workbook,
  reason: SlicerCacheInvalidationReason,
): void {
  void (async () => {
    const ws = wb.getSheetById(sheetId);
    const slicers = await ws.slicers.list();
    for (const slicer of slicers) {
      wb.emit({
        type: 'slicer:cacheInvalidated',
        slicerId: slicer.id,
        reason,
        timestamp: Date.now(),
      });
    }
  })();
}

/**
 * Set up Workbook event subscriptions for slicer cache invalidation.
 *
 * Subscribes to events that could affect slicer data:
 * - CELLS_CHANGED: Data in source column may have changed
 * - FILTER_APPLIED/CLEARED: Selection state changes
 * - TABLE_DELETED: Slicer becomes disconnected
 * - COLUMNS_DELETED/INSERTED: Source column may have moved or been deleted
 *
 * @param _getCellValue - Callback to get cell values (reserved for future cache rebuilding)
 * @param wb - Workbook for unified API access
 * @returns Cleanup function to unsubscribe all observers
 */
export function setupSlicerEventSubscriptions(
  _getCellValue: (sheetId: SheetId, row: number, col: number) => CellValue | undefined,
  wb: Workbook,
): () => void {
  const unsubscribers: Array<() => void> = [];

  // ==========================================================================
  // Cell Changes -> Invalidate slicer caches for affected tables
  // ==========================================================================

  const cellsChangedUnsubscribe = wb.on('cells:batch-changed', (event) => {
    const sheetId = event.sheetId;
    if (!sheetId) return;
    invalidateSlicerCachesInSheet(sheetId as SheetId, wb, 'cellsChanged');
  });
  unsubscribers.push(cellsChangedUnsubscribe);

  // ==========================================================================
  // Filter Changes -> Update slicer selection state
  // ==========================================================================

  const filterAppliedUnsubscribe = wb.on('filter:applied', (event) => {
    const sheetId = event.sheetId;
    if (!sheetId) return;
    invalidateSlicerCachesInSheet(sheetId as SheetId, wb, 'filterApplied');
  });
  unsubscribers.push(filterAppliedUnsubscribe);

  const filterClearedUnsubscribe = wb.on('filter:cleared', (event) => {
    const sheetId = event.sheetId;
    if (!sheetId) return;
    invalidateSlicerCachesInSheet(sheetId as SheetId, wb, 'filterApplied');
  });
  unsubscribers.push(filterClearedUnsubscribe);

  const filterUpdatedUnsubscribe = wb.on('filter:updated', (event) => {
    const sheetId = event.sheetId;
    if (!sheetId) return;
    invalidateSlicerCachesInSheet(sheetId as SheetId, wb, 'filterApplied');
  });
  unsubscribers.push(filterUpdatedUnsubscribe);

  // ==========================================================================
  // Table Changes -> Check slicer connections
  // ==========================================================================

  const tableDeletedUnsubscribe = wb.on('table:deleted', (event) => {
    // When a table is deleted, slicers connected to it become disconnected.
    // Invalidate all slicer caches in the sheet so UI can re-fetch slicer state.
    const { sheetId } = event;
    if (sheetId) {
      invalidateSlicerCachesInSheet(sheetId as SheetId, wb, 'tableStructureChanged');
    }
  });
  unsubscribers.push(tableDeletedUnsubscribe);

  const tableResizedUnsubscribe = wb.on('table:resized', (event) => {
    const { sheetId } = event;
    invalidateSlicerCachesInSheet(sheetId as SheetId, wb, 'tableStructureChanged');
  });
  unsubscribers.push(tableResizedUnsubscribe);

  // ==========================================================================
  // Structure Changes -> Check slicer column connections
  // ==========================================================================

  const columnsDeletedUnsubscribe = wb.on('columns:deleted', (event) => {
    const sheetId = event.sheetId;
    if (!sheetId) return;
    invalidateSlicerCachesInSheet(sheetId as SheetId, wb, 'tableStructureChanged');
  });
  unsubscribers.push(columnsDeletedUnsubscribe);

  const columnsInsertedUnsubscribe = wb.on('columns:inserted', (event) => {
    const sheetId = event.sheetId;
    if (!sheetId) return;
    invalidateSlicerCachesInSheet(sheetId as SheetId, wb, 'tableStructureChanged');
  });
  unsubscribers.push(columnsInsertedUnsubscribe);

  const rowsDeletedUnsubscribe = wb.on('rows:deleted', (event) => {
    const sheetId = event.sheetId;
    if (!sheetId) return;
    invalidateSlicerCachesInSheet(sheetId as SheetId, wb, 'cellsChanged');
  });
  unsubscribers.push(rowsDeletedUnsubscribe);

  const rowsInsertedUnsubscribe = wb.on('rows:inserted', (event) => {
    const sheetId = event.sheetId;
    if (!sheetId) return;
    invalidateSlicerCachesInSheet(sheetId as SheetId, wb, 'cellsChanged');
  });
  unsubscribers.push(rowsInsertedUnsubscribe);

  // ==========================================================================
  // Pivot Changes -> Update pivot slicers (placeholder for future)
  // ==========================================================================

  // TODO: Add pivot:updated, pivot:deleted event handlers when pivot module exists

  // Return cleanup function
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

/**
 * Rebuild all slicer caches in a sheet.
 *
 * Used when switching to a sheet or after major data changes.
 * Returns a map of slicerId -> SlicerCacheEntry.
 *
 * Uses Worksheet API listSlicers() and getSlicerItems() for cache building.
 *
 * @param sheetId - Sheet to rebuild caches for
 * @param wb - Workbook for unified API access
 * @returns Map of slicer ID to cache
 */
export async function rebuildAllSlicerCaches(
  sheetId: SheetId,
  wb: Workbook,
): Promise<Map<string, SlicerCacheEntry>> {
  const caches = new Map<string, SlicerCacheEntry>();

  const ws = wb.getSheetById(sheetId);
  const slicers = await ws.slicers.list();
  for (const slicer of slicers) {
    const items = await ws.slicers.getItems(slicer.id);
    const cache: SlicerCacheEntry = {
      slicerId: slicer.id,
      items: items.map((item) => ({
        value: String(item.value ?? ''),
        selected: item.selected ?? false,
        visible: true,
      })),
      connected: true,
    };
    caches.set(slicer.id, cache);
  }

  return caches;
}

/**
 * Get slicer cache for a specific slicer.
 *
 * Convenience function that builds the cache on-demand.
 * Consider caching the result in the UI layer and invalidating
 * based on slicer:cache-invalidated events.
 *
 * Uses Worksheet API getSlicer() and getSlicerItems() for cache building.
 *
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID
 * @param wb - Workbook for unified API access
 * @returns Slicer cache or null if slicer not found
 */
export async function getSlicerCache(
  sheetId: SheetId,
  slicerId: string,
  wb: Workbook,
): Promise<SlicerCacheEntry | null> {
  const ws = wb.getSheetById(sheetId);
  const slicer = await ws.slicers.get(slicerId);
  if (!slicer) return null;

  const items = await ws.slicers.getItems(slicerId);
  return {
    slicerId,
    items: items.map((item) => ({
      value: String(item.value ?? ''),
      selected: item.selected ?? false,
      visible: true,
    })),
    connected: true,
  };
}
