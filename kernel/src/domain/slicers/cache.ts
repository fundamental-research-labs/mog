/**
 * Slicer Cache Module
 *
 * Delegates all data access to ComputeBridge (Rust compute-core).
 *
 * Architecture:
 * - Cache building: delegates to CB for slicer state
 * - Cache invalidation: emits events via EventBus (Rust handles invalidation)
 * - Subscriptions: handled by MutationResultHandler (no CRDT observers)
 * - Table/pivot integration: delegates to CB for slicer lookups
 *
 * @see compute-core/src/storage/slicers.rs - Rust implementation
 */

import { type CellValue, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  SlicerCacheInvalidatedEvent,
  SlicerDisconnectedEvent,
} from '@mog-sdk/contracts/events';
import type { SlicerCache } from '@mog-sdk/contracts/slicers';

import type { StoredSlicer } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context/types';
import { getSlicersInSheet } from './crud';
import { getSlicerItems, isSlicerConnected, storedSlicerToComputeSlicer } from './table-binding';

// =============================================================================
// ES.6: Slicer Cache (computed values)
// =============================================================================

/**
 * Build the slicer cache for a slicer.
 *
 * The cache contains computed values that are expensive to recalculate:
 * - Unique items from the data source
 * - Selection state derived from filter
 * - Sort order applied
 *
 * @param ctx - Store context
 * @param slicer - Slicer configuration
 * @param getCellValue - Callback to get cell values
 * @returns Slicer cache
 */
export async function buildSlicerCache(
  ctx: DocumentContext,
  slicer: StoredSlicer,
  getCellValue: (sheetId: SheetId, row: number, col: number) => CellValue | undefined,
): Promise<SlicerCache> {
  const computeSlicer = storedSlicerToComputeSlicer(slicer);
  const items = await getSlicerItems(ctx, computeSlicer, getCellValue);
  const connected = await isSlicerConnected(ctx, computeSlicer);

  return {
    slicerId: slicer.id,
    items,
    isStale: !connected,
    lastRefresh: Date.now(),
  };
}

/**
 * Mark slicer cache as needing invalidation.
 *
 * Called when data changes that could affect slicer items.
 * The UI layer should re-fetch the cache on next render.
 *
 * @param ctx - Store context
 * @param _sheetId - Sheet containing the slicer (unused, kept for API consistency)
 * @param slicerId - Slicer ID
 * @param reason - Reason for invalidation
 */
export function invalidateSlicerCache(
  ctx: DocumentContext,
  _sheetId: SheetId,
  slicerId: string,
  reason: 'data-changed' | 'filter-changed' | 'structure-changed',
): void {
  const contractReason = mapInvalidationReason(reason);
  const event: SlicerCacheInvalidatedEvent = {
    type: 'slicer:cacheInvalidated',
    timestamp: Date.now(),
    slicerId,
    reason: contractReason,
  };
  ctx.eventBus.emit(event);
}

/**
 * Map internal reason codes to contract event reason codes.
 */
function mapInvalidationReason(
  reason: 'data-changed' | 'filter-changed' | 'structure-changed',
): 'cellsChanged' | 'filterApplied' | 'tableStructureChanged' | 'pivotUpdated' {
  switch (reason) {
    case 'data-changed':
      return 'cellsChanged';
    case 'filter-changed':
      return 'filterApplied';
    case 'structure-changed':
      return 'tableStructureChanged';
  }
}

/**
 * Emit disconnected event when slicer loses its data source.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID
 * @param reason - Reason for disconnection
 */
export function emitSlicerDisconnected(
  ctx: DocumentContext,
  sheetId: SheetId,
  slicerId: string,
  reason: 'column-deleted' | 'table-deleted' | 'pivot-deleted',
): void {
  const contractReason = mapDisconnectedReason(reason);
  const event: SlicerDisconnectedEvent = {
    type: 'slicer:disconnected',
    timestamp: Date.now(),
    sheetId,
    slicerId,
    reason: contractReason,
  };
  ctx.eventBus.emit(event);
}

/**
 * Map internal disconnection reason codes to contract event reason codes.
 */
function mapDisconnectedReason(
  reason: 'column-deleted' | 'table-deleted' | 'pivot-deleted',
): 'columnDeleted' | 'tableDeleted' | 'pivotDeleted' {
  switch (reason) {
    case 'column-deleted':
      return 'columnDeleted';
    case 'table-deleted':
      return 'tableDeleted';
    case 'pivot-deleted':
      return 'pivotDeleted';
  }
}

// =============================================================================
// Slicer Subscriptions
// =============================================================================

/**
 * Subscribe to slicer changes for a specific sheet.
 *
 * In the ComputeBridge architecture, slicer change notifications come
 * through MutationResult events, not CRDT observe. This is a compatibility stub.
 *
 * @param _ctx - Store context
 * @param _sheetId - Sheet ID
 * @param _callback - Called when slicers change
 * @returns Unsubscribe function (no-op)
 */
export function subscribeToSlicers(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _callback: (slicers: StoredSlicer[]) => void,
): () => void {
  // In the ComputeBridge architecture, slicer change notifications come
  // through MutationResult events, not CRDT observe. This is a compatibility stub.
  return () => {};
}

// =============================================================================
// Table/Pivot Integration
// =============================================================================

/**
 * Handle table deletion - disconnect related slicers.
 *
 * Called when a table is deleted. Slicers remain but show disconnected state.
 *
 * @param ctx - Store context
 * @param tableId - Deleted table ID
 */
export function handleTableDeleted(ctx: DocumentContext, tableId: string): void {
  void (async () => {
    const sheetIds = await ctx.computeBridge.getAllSheetIds();
    for (const rawId of sheetIds) {
      const sid = toSheetId(rawId);
      const slicers = await getSlicersInSheet(ctx, sid);
      for (const slicer of slicers) {
        if (slicer.source.type === 'table' && slicer.source.tableId === tableId) {
          emitSlicerDisconnected(ctx, sid, slicer.id, 'table-deleted');
        }
      }
    }
  })();
}

/**
 * Handle column deletion - check if slicer source was deleted.
 *
 * Called after column structure changes to detect disconnected slicers.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet where columns were deleted
 */
export function checkSlicerConnections(ctx: DocumentContext, sheetId: SheetId): void {
  void (async () => {
    const slicers = await getSlicersInSheet(ctx, sheetId);
    for (const slicer of slicers) {
      if (!(await isSlicerConnected(ctx, storedSlicerToComputeSlicer(slicer)))) {
        emitSlicerDisconnected(ctx, sheetId, slicer.id, 'column-deleted');
      }
    }
  })();
}
