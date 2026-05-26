/**
 * Use Table Layout Cache Hook
 *
 * Provides sync lookups for table layout data (TableConfig at a given cell)
 * during the canvas render loop.
 *
 * Architecture (mirrors use-filter-header-cache.ts pattern):
 * - Async pre-fetches all tables via Worksheet tables.list() on mount
 * - Parses A1 ranges into numeric CellRange for sync hit-testing
 * - Subscribes to table EventBus events for cache refresh
 * - Returns a sync getTableAtCell callback matching CellDataSource signature
 *
 * This eliminates ~3,872 per-frame Rust bridge calls from getTableAtCell
 * by batch-fetching once and serving from an in-memory cache.
 *
 * @see use-filter-header-cache.ts - Same architectural pattern for filter headers
 */

import { useCallback, useEffect, useRef } from 'react';

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { TableConfig } from '@mog-sdk/contracts/tables';
import { parseA1Range } from '@mog/spreadsheet-utils/a1';

import { useWorkbook } from '../../infra/context';

interface UseTableLayoutCacheOptions {
  activeSheetId: SheetId;
  /** Optional callback invoked when cache data updates (e.g. to invalidate the renderer). */
  onCacheUpdate?: () => void;
}

/**
 * Hook to create and manage a table layout cache.
 *
 * Pre-fetches table info (with resolved numeric ranges) from the
 * Worksheet API and serves sync lookups for the canvas render loop.
 */
export function useTableLayoutCache({ activeSheetId, onCacheUpdate }: UseTableLayoutCacheOptions) {
  const wb = useWorkbook();

  // Cache: array of table configs with resolved numeric ranges for linear scan
  const cacheRef = useRef<Array<{ config: TableConfig; range: CellRange }>>([]);

  // Refresh cache: fetch table list via ONE API, parse ranges, build lookup array
  const refresh = useCallback(async () => {
    const newCache: Array<{ config: TableConfig; range: CellRange }> = [];

    if (!activeSheetId) {
      cacheRef.current = newCache;
      onCacheUpdate?.();
      return;
    }

    try {
      const ws = wb.getSheetById(activeSheetId);
      const tables = await ws.tables.list();

      if (tables.length === 0) {
        cacheRef.current = newCache;
        onCacheUpdate?.();
        return;
      }

      for (const tableInfo of tables) {
        const parsedRange = parseA1Range(tableInfo.range);

        const config: TableConfig = {
          id: tableInfo.name,
          name: tableInfo.name,
          sheetId: activeSheetId,
          range: parsedRange,
          hasHeaderRow: tableInfo.hasHeaderRow,
          hasTotalRow: tableInfo.hasTotalsRow,
          columns: tableInfo.columns.map((col) => ({
            id: col.id,
            name: col.name,
            index: col.index,
            totalFunction: col.totalsFunction ?? undefined,
            calculatedFormula: col.calculatedFormula,
          })),
          style: { preset: tableInfo.style as any },
          autoExpand: tableInfo.autoExpand,
          autoCalculatedColumns: tableInfo.autoCalculatedColumns,
          showFilterButtons: tableInfo.showFilterButtons,
        };

        newCache.push({ config, range: parsedRange });
      }
    } catch {
      // Silently fail — table styling just won't appear
    }

    cacheRef.current = newCache;
    onCacheUpdate?.();
  }, [wb, activeSheetId, onCacheUpdate]);

  // Fetch on mount and when sheetId changes
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Subscribe to table events for cache refresh
  useEffect(() => {
    if (!activeSheetId) return;

    const ws = wb.getSheetById(activeSheetId);
    const handler = () => void refresh();

    const unsubscribers: Array<() => void> = [];
    unsubscribers.push(ws.on('table:created', handler));
    unsubscribers.push(ws.on('table:updated', handler));
    unsubscribers.push(ws.on('table:deleted', handler));
    unsubscribers.push(ws.on('table:resized', handler));
    unsubscribers.push(ws.on('table:converted-to-range', handler));
    unsubscribers.push(ws.on('table:column-deleted', handler));
    unsubscribers.push(ws.on('table:total-row-changed', handler));

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [wb, activeSheetId, refresh]);

  // Sync lookup callback matching CellDataSource.getTableAtCell signature
  const getTableAtCell = useCallback(
    (sheetId: SheetId, cell: CellCoord): TableConfig | undefined => {
      if (sheetId !== activeSheetId) return undefined;
      const cached = cacheRef.current;
      for (const entry of cached) {
        const r = entry.range;
        if (
          cell.row >= r.startRow &&
          cell.row <= r.endRow &&
          cell.col >= r.startCol &&
          cell.col <= r.endCol
        ) {
          return entry.config;
        }
      }
      return undefined;
    },
    [activeSheetId],
  );

  return { getTableAtCell };
}
