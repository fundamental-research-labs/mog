/**
 * useSparklineCFIntegration Effect Hook
 *
 * Wires up SparklineManager and ConditionalFormatCache to respond to cell changes.
 * When cells in a sparkline's data range or CF rule range change,
 * the render data is invalidated and the renderer re-renders.
 *
 * Contains two effects:
 * 1. Sparkline event integration - Sparkline data change handling
 * 2. CF event integration - Conditional formatting cache invalidation
 *
 * ARCHITECTURE:
 * - Uses coordinator.getEventSubscriptions() to access event subscription module
 * - Registers event handlers directly with eventSubscriptions.setSparklineConfig/setCFConfig
 * - Also sets sparklineManager on coordinator for sheet-switch invalidation
 * - Manages cleanup in useEffect return function
 *
 * @see (Data Change Integration)
 * @see CF Rendering Integration - (Cache Invalidation)
 * @see 09-SPREADSHEET-GRID-DECOMPOSITION.md
 * @see 07-SHEET-COORDINATOR-DECOMPOSITION.md
 */

import { useEffect } from 'react';

import type { ConditionalFormatCache } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type { SheetCoordinator } from '../../../coordinator/sheet-coordinator';
import type { SparklineManager } from '../../../coordinator/sparklines/sparkline-manager';
import { setupSparklineSelectionCoordination } from '../../../systems/renderer/coordination';
import { CleanupManager } from '../../../systems/shared/cleanup-manager';

/**
 * Options for the useSparklineCFIntegration hook.
 */
export interface UseSparklineCFIntegrationOptions {
  /** The sheet coordinator instance */
  coordinator: SheetCoordinator;
  /** Sparkline manager instance (Sparklines) */
  sparklineManager: SparklineManager;
  /** Conditional formatting manager */
  cfManager: ConditionalFormatCache;
  /** The active sheet ID */
  activeSheetId: SheetId;
}

/**
 * Sets up sparkline and conditional formatting integration for the coordinator.
 *
 * This hook wires up:
 * 1. SparklineManager to respond to cell changes in sparkline data ranges
 * 2. ConditionalFormatCache to respond to cell changes in CF rule ranges
 *
 * Both integrations ensure that visual updates are triggered when
 * underlying data changes.
 *
 * @param options - Configuration options
 */
export function useSparklineCFIntegration(options: UseSparklineCFIntegrationOptions): void {
  const { coordinator, sparklineManager, cfManager, activeSheetId } = options;

  // Effect 1: Set Sparkline Event Integration
  // (Data Change Integration)
  // When cells in a sparkline's data range change, the sparkline's render data
  // is invalidated and the renderer re-renders the affected cells.
  useEffect(() => {
    // Set sparkline manager on coordinator for sheet-switch invalidation
    coordinator.renderer.setSparklineManager(sparklineManager);
    const selectionCleanups = new CleanupManager();
    const sparklineSelection =
      coordinator.uiStore == null
        ? null
        : setupSparklineSelectionCoordination(
            {
              actors: { selection: coordinator.grid.access.actors.selection as any },
              sparklineManager,
              uiStoreApi: coordinator.uiStore,
              getActiveSheetId: () => activeSheetId,
            },
            selectionCleanups,
          );

    // Register sparkline event handlers via eventSubscriptions
    const eventSubscriptions = coordinator.renderer.getEventSubscriptions();
    if (!eventSubscriptions) {
      return () => selectionCleanups.dispose();
    }

    let disposed = false;
    const cleanup = eventSubscriptions.setSparklineConfig({
      sparklineManager,
      getCurrentSheetId: () => activeSheetId,
      onSparklineTopologyChanged: (event) => {
        if (event.type === 'sparkline:changed') {
          const refreshFromWorkbook =
            event.position != null
              ? sparklineManager.refreshSparklineAtCell(
                  toSheetId(event.sheetId),
                  event.position.row,
                  event.position.col,
                )
              : sparklineManager.hydrateSheet(toSheetId(event.sheetId));
          void refreshFromWorkbook
            .catch(() => undefined)
            .then(() => {
              if (!disposed) {
                sparklineSelection?.refresh();
              }
            });
          return;
        }

        sparklineSelection?.refresh();
      },
    });

    void sparklineManager
      .hydrateSheet(toSheetId(activeSheetId))
      .catch(() => 0)
      .then((hydratedCount) => {
        if (disposed) return;
        sparklineSelection?.refresh();
        if (hydratedCount > 0) {
          coordinator.renderer.invalidate('sparklines hydrated');
        }
      });

    return () => {
      disposed = true;
      cleanup();
      selectionCleanups.dispose();
    };
  }, [coordinator, sparklineManager, activeSheetId]);

  // Effect 2: Set CF Event Integration
  // CF Rendering Integration - (Cache Invalidation)
  // When cells in a CF range change, the CF results are invalidated and
  // the renderer re-renders the affected cells with updated CF styling.
  useEffect(() => {
    const eventSubscriptions = coordinator.renderer.getEventSubscriptions();
    if (!eventSubscriptions) {
      return;
    }

    const cleanup = eventSubscriptions.setCFConfig({
      cfManager,
      getCurrentSheetId: () => activeSheetId,
    });

    return cleanup;
  }, [coordinator, cfManager, activeSheetId]);

  // Effect 3: Table Auto-Expansion Integration
  // When a user types into a cell immediately below (or to the right of) a table,
  // the table auto-expands to include that row (Excel behavior).
  useEffect(() => {
    const eventSubscriptions = coordinator.renderer.getEventSubscriptions();
    const workbook = coordinator.workbook;
    if (!eventSubscriptions || !workbook) {
      return;
    }

    const colLetterToNum = (letters: string): number => {
      let n = 0;
      for (const ch of letters.toUpperCase()) {
        n = n * 26 + (ch.charCodeAt(0) - 65 + 1);
      }
      return n - 1;
    };

    const cleanup = eventSubscriptions.setTableAutoExpansionConfig({
      checkAutoExpansion: async (sheetId, row, col) => {
        try {
          const ws = workbook.getSheetById(sheetId as any);
          const tables = await ws.tables.list();
          for (const tableInfo of tables) {
            const match = tableInfo.range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
            if (!match) continue;
            const startCol = colLetterToNum(match[1]);
            const startRow = parseInt(match[2], 10) - 1;
            const endCol = colLetterToNum(match[3]);
            const endRow = parseInt(match[4], 10) - 1;
            // Immediately below: one row past the last row, within table columns
            if (row === endRow + 1 && col >= startCol && col <= endCol) {
              return { id: tableInfo.name, sheetId, name: tableInfo.name };
            }
            // Immediately to the right: one col past the last col, within data rows
            const dataStartRow = startRow + 1; // skip header row
            if (col === endCol + 1 && row >= dataStartRow && row <= endRow) {
              return { id: tableInfo.name, sheetId, name: tableInfo.name };
            }
          }
        } catch {
          // best-effort
        }
        return undefined;
      },
      autoExpandTableRow: async (tableId) => {
        try {
          const ws = workbook.getSheetById(activeSheetId as any);
          const tableInfo = await ws.tables.get(tableId);
          if (!tableInfo) return false;
          const match = tableInfo.range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
          if (!match) return false;
          const newRange = `${match[1]}${match[2]}:${match[3]}${parseInt(match[4], 10) + 1}`;
          await ws.tables.resize(tableId, newRange);
          return true;
        } catch {
          return false;
        }
      },
      autoExpandTableColumn: async (tableId) => {
        try {
          const ws = workbook.getSheetById(activeSheetId as any);
          const tableInfo = await ws.tables.get(tableId);
          if (!tableInfo) return false;
          const match = tableInfo.range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
          if (!match) return false;
          const endColLetter = String.fromCharCode(match[3].charCodeAt(0) + 1);
          const newRange = `${match[1]}${match[2]}:${endColLetter}${match[4]}`;
          await ws.tables.resize(tableId, newRange);
          return true;
        } catch {
          return false;
        }
      },
      getCurrentSheetId: () => activeSheetId,
    });

    return cleanup;
  }, [coordinator, activeSheetId]);
}
