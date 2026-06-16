/**
 * Table Coordination
 *
 * Feature coordination for table auto-expansion event handling.
 * Tables automatically expand when users type in adjacent cells.
 *
 * ARCHITECTURE:
 * - Delegates to EventSubscriptionResult.setTableAutoExpansionConfig()
 * - EventSubscriptions module handles table expansion events via EventBus
 * - This is a thin wrapper that connects coordinator config to event subscriptions
 *
 * Features:
 * - Tables Calculated Columns with Auto-Fill
 * - When users type in cells adjacent to a table, the table automatically expands
 * - When new rows are added, calculated column formulas are applied automatically
 *
 * Events handled (by EventSubscriptions):
 * - cell:changed → check if adjacent to table → auto-expand + apply formulas
 *
 * @see engine/src/state/coordinator/subscriptions/event-subscriptions.ts
 */

import type { TableAutoExpansionReceipt, Workbook } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { EventSubscriptionResult } from '../../../renderer/subscriptions/event-subscriptions';
import type { CleanupManager } from '../../../shared/cleanup-manager';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for table feature coordination.
 */
export interface TableCoordinationConfig {
  /** Workbook for unified API access */
  workbook?: Workbook;
  /** Get current sheet ID */
  getCurrentSheetId: () => string;
  /** Event subscription module (already set up) */
  eventSubscriptions: EventSubscriptionResult | null;
  /**
   * Apply calculated column formulas to a newly added table row.
   * Injected from coordinator layer.
   */
  applyCalculatedFormulasToNewRow: (tableId: string, rowIndex: number) => void;
}

/**
 * Result of table coordination setup.
 */
export interface TableCoordinationResult {
  /** Cleanup function */
  cleanup: () => void;
}

function receiptExpandedTableRange(receipt: TableAutoExpansionReceipt): boolean {
  return (
    (receipt.status === 'applied' || receipt.status === 'partial') &&
    receipt.changedTableMetadata &&
    receipt.previousRange != null &&
    receipt.newRange != null &&
    receipt.previousRange !== receipt.newRange
  );
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Build table coordination feature.
 *
 * Wires table auto-expansion to EventBus events via EventSubscriptions module.
 * This is a thin wrapper that delegates to EventSubscriptionResult.setTableAutoExpansionConfig().
 *
 * When users type in cells adjacent to a table:
 * 1. TablesAutoExpansion.checkAutoExpansion() determines if expansion is needed
 * 2. TablesAutoExpansion.autoExpandTableRow() or TablesAutoExpansion.autoExpandTableColumn() expands the table
 * 3. applyCalculatedFormulasToNewRow applies formulas to new row
 *
 * IMPORTANT: Requires EventSubscriptions to be set up first.
 * If eventSubscriptions is null, this is a no-op.
 *
 * @param config - Configuration with store context and event subscriptions
 * @param cleanups - CleanupManager to register cleanup function
 * @returns Table coordination result
 */
export function buildTableCoordination(
  config: TableCoordinationConfig,
  cleanups: CleanupManager,
): TableCoordinationResult {
  const { workbook, getCurrentSheetId, eventSubscriptions } = config;

  let tableCleanup: (() => void) | null = null;

  // If event subscriptions available, set up table auto-expansion events
  if (eventSubscriptions) {
    tableCleanup = eventSubscriptions.setTableAutoExpansionConfig({
      checkAutoExpansion: async (sheetId, row, col) => {
        if (!workbook) return undefined;
        const ws = workbook.getSheetById(toSheetId(sheetId));
        // Check if the cell is immediately ADJACENT to (below or to the right of)
        // an auto-expand table. getAtCell() only finds tables the cell is inside,
        // not adjacent to — so we iterate all tables and check adjacency manually.
        const tables = await ws.tables.list();
        for (const tableInfo of tables) {
          const match = tableInfo.range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
          if (!match) continue;
          const colLetterToNum = (letters: string): number => {
            let n = 0;
            for (const ch of letters.toUpperCase()) {
              n = n * 26 + (ch.charCodeAt(0) - 65 + 1);
            }
            return n - 1;
          };
          const startCol = colLetterToNum(match[1]);
          const startRow = parseInt(match[2], 10) - 1;
          const endCol = colLetterToNum(match[3]);
          const endRow = parseInt(match[4], 10) - 1;
          // Immediately below: one row past the table's last row, within table columns
          if (row === endRow + 1 && col >= startCol && col <= endCol) {
            return { id: tableInfo.name, sheetId, name: tableInfo.name };
          }
          // Immediately to the right: one col past the table's last col, within data rows
          const dataStartRow = startRow + 1; // skip header
          if (col === endCol + 1 && row >= dataStartRow && row <= endRow) {
            return { id: tableInfo.name, sheetId, name: tableInfo.name };
          }
        }
        return undefined;
      },
      autoExpandTableRow: async (tableId) => {
        if (!workbook) return false;
        const ws = workbook.getSheetById(toSheetId(getCurrentSheetId()));
        const receipt = await ws.tables.applyAutoExpansion(tableId);
        return receiptExpandedTableRange(receipt);
      },
      autoExpandTableColumn: async (tableId, _newColumnName) => {
        if (!workbook) return false;
        const ws = workbook.getSheetById(toSheetId(getCurrentSheetId()));
        const receipt = await ws.tables.applyAutoExpansion(tableId);
        return receiptExpandedTableRange(receipt);
      },
      getCurrentSheetId,
      applyCalculatedFormulasToNewRow: (tableId, rowIndex) =>
        config.applyCalculatedFormulasToNewRow(tableId, rowIndex),
    });
  }

  const cleanup = () => {
    tableCleanup?.();
  };

  // Register cleanup with manager
  cleanups.register('tableCoordination', cleanup);

  return {
    cleanup,
  };
}
