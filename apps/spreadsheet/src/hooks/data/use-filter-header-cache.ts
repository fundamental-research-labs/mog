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
import { toCellId } from '@mog-sdk/contracts/cell-identity';

import { useWorkbook } from '../../infra/context';

interface UseFilterHeaderCacheOptions {
  activeSheetId: SheetId;
  /** Optional callback invoked when cache data updates (e.g. to invalidate the renderer). */
  onCacheUpdate?: () => void;
}

/**
 * Hook to create and manage a filter header info cache.
 *
 * Pre-fetches filter details (with resolved numeric ranges) from the
 * Worksheet API and serves sync lookups for the canvas render loop.
 */
export function useFilterHeaderCache({
  activeSheetId,
  onCacheUpdate,
}: UseFilterHeaderCacheOptions) {
  const wb = useWorkbook();

  // Cache: Map<"row,col", FilterHeaderInfo> for O(1) sync lookups
  const cacheRef = useRef(new Map<string, FilterHeaderInfo>());

  // Refresh cache: fetch filter details via ONE API, build lookup map
  const refresh = useCallback(async () => {
    const newCache = new Map<string, FilterHeaderInfo>();

    if (!activeSheetId) {
      cacheRef.current = newCache;
      onCacheUpdate?.();
      return;
    }

    try {
      const ws = wb.getSheetById(activeSheetId);
      const filterDetails = await ws.filters.list();

      if (filterDetails.length === 0) {
        cacheRef.current = newCache;
        onCacheUpdate?.();
        return;
      }

      for (const detail of filterDetails) {
        if (detail.filterKind === 'advancedFilter') continue;

        const headerRow = detail.range.startRow;
        const startCol = detail.range.startCol;
        const endCol = detail.range.endCol;

        for (let col = startCol; col <= endCol; col++) {
          const cellId = await ws._internal.getCellIdAt(headerRow, col);
          if (!cellId) continue;
          const headerCellId = toCellId(cellId);

          const hasActiveFilter = Object.prototype.hasOwnProperty.call(
            detail.columnFilters,
            headerCellId,
          );

          newCache.set(`${headerRow},${col}`, {
            filterId: detail.id,
            headerCellId,
            hasActiveFilter,
          });
        }
      }
    } catch {
      // Silently fail — filter buttons just won't appear
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

    const unsubscribers: Array<() => void> = [];
    unsubscribers.push(ws.on('filter:created', handler));
    unsubscribers.push(ws.on('filter:updated', handler));
    unsubscribers.push(ws.on('filter:deleted', handler));
    unsubscribers.push(ws.on('filter:cleared', handler));
    unsubscribers.push(ws.on('filter:applied', handler));

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
