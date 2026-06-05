/**
 * Use Filter Header Cache Hook
 *
 * Provides sync lookups for filter header info (AutoFilter dropdown buttons)
 * during the canvas render loop.
 *
 * Architecture (mirrors use-cf-manager.ts / use-cell-metadata-cache.ts pattern):
 * - Async pre-fetches filter data via Worksheet ONE API on mount
 * - Builds a Map<"row,col", FilterHeaderInfo> for O(1) sync lookups
 * - Subscribes to filter EventBus events for cache refresh
 * - Returns a sync getFilterHeaderInfo callback matching CellDataSource signature
 *
 * @see use-cf-manager.ts - Same architectural pattern for conditional formatting
 * @see use-cell-metadata-cache.ts - Same pattern for spill/validation data
 */

import { useCallback, useEffect, useRef } from 'react';

import type { FilterHeaderInfo } from '@mog-sdk/contracts/filter';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { SheetId } from '@mog-sdk/contracts/core';

import { recordFilterReadinessError } from '../../infra/diagnostics/filter-readiness-errors';
import { useWorkbook } from '../../infra/context';

interface UseFilterHeaderCacheOptions {
  activeSheetId: SheetId;
  /** Optional callback invoked when cache data updates (e.g. to invalidate the renderer). */
  onCacheUpdate?: () => void;
}

/**
 * Hook to create and manage a filter header info cache.
 *
 * Pre-fetches renderer-ready header DTOs from the Worksheet API and serves
 * sync lookups for the canvas render loop.
 */
export function useFilterHeaderCache({
  activeSheetId,
  onCacheUpdate,
}: UseFilterHeaderCacheOptions) {
  const wb = useWorkbook();

  // Cache: Map<"row,col", FilterHeaderInfo> for O(1) sync lookups
  const cacheRef = useRef(new Map<string, FilterHeaderInfo>());

  // Refresh cache: fetch filter header DTOs via ONE API, build lookup map
  const refresh = useCallback(async () => {
    const newCache = new Map<string, FilterHeaderInfo>();

    if (!activeSheetId) {
      cacheRef.current = newCache;
      onCacheUpdate?.();
      return;
    }

    try {
      const ws = wb.getSheetById(activeSheetId);
      const filterHeaderInfo = await ws.filters.listHeaderInfo();

      if (filterHeaderInfo.length === 0) {
        cacheRef.current = newCache;
        onCacheUpdate?.();
        return;
      }

      for (const entry of filterHeaderInfo) {
        if (entry.buttonVisible === false) {
          continue;
        }
        newCache.set(`${entry.row},${entry.col}`, entry);
      }
    } catch (error) {
      recordFilterReadinessError({
        source: 'headerCache',
        sheetId: activeSheetId,
        operation: 'filters.listHeaderInfo',
        error,
      });
    }

    cacheRef.current = newCache;
    onCacheUpdate?.();
  }, [wb, activeSheetId, onCacheUpdate]);

  // Fetch on mount and when sheetId changes
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Subscribe to filter events for cache refresh
  useEffect(() => {
    if (!activeSheetId) return;

    const ws = wb.getSheetById(activeSheetId);
    const handler = () => {
      void refresh();
    };
    const tableUpdatedHandler = () => void refresh();

    const unsubscribers: Array<() => void> = [];
    unsubscribers.push(ws.on('filter:created', handler));
    unsubscribers.push(ws.on('filter:updated', handler));
    unsubscribers.push(ws.on('filter:deleted', handler));
    unsubscribers.push(ws.on('filter:cleared', handler));
    unsubscribers.push(ws.on('filter:applied', handler));
    unsubscribers.push(ws.on('table:created', handler));
    unsubscribers.push(ws.on('table:updated', tableUpdatedHandler));
    unsubscribers.push(ws.on('table:deleted', handler));
    unsubscribers.push(ws.on('table:resized', handler));
    unsubscribers.push(ws.on('table:column-deleted', handler));
    unsubscribers.push(ws.on('table:total-row-changed', handler));
    unsubscribers.push(ws.on('table:converted-to-range', handler));

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [wb, activeSheetId, refresh]);

  // Sync lookup callback matching CellDataSource.getFilterHeaderInfo signature
  const getFilterHeaderInfo = useCallback(
    (sheetId: SheetId, cell: CellCoord): FilterHeaderInfo | undefined => {
      if (sheetId !== activeSheetId) return undefined;
      return cacheRef.current.get(`${cell.row},${cell.col}`);
    },
    [activeSheetId],
  );

  return { getFilterHeaderInfo };
}
