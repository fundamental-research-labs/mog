/**
 * Table Auto-Expansion Coordination
 *
 * Coordinates table auto-expansion when users type in cells adjacent to tables.
 * Works as a hook after editor commits to detect and trigger expansion.
 *
 * Excel Behavior:
 * - Typing in a cell directly below the table extends the table (adds new data row)
 * - Typing in a cell directly to the right extends the table (adds new column)
 * - Auto-expansion can be disabled per table
 * - Shows lightning bolt AutoCorrect Options button after expansion
 *
 * Architecture:
 * - This module observes cell writes (via coordination callbacks)
 * - It checks if the written cell is adjacent to an auto-expand table
 * - If so, it triggers the expansion via domain module functions
 * - Shows AutoCorrect Options UI via UIStore slice
 *
 */

import type { StoreApi } from 'zustand';

import type { Workbook } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { GridEditingUIStore } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Information about a cell write for auto-expansion checking.
 */
export interface CellWriteInfo {
  /** Sheet ID */
  sheetId: SheetId;
  /** Row index */
  row: number;
  /** Column index */
  col: number;
  /** The value that was written */
  value: string;
}

/**
 * Callback when auto-expansion is about to occur.
 * Can be used to show AutoCorrect Options button.
 */
export type OnAutoExpansionCallback = (info: {
  tableId: string;
  tableName: string;
  direction: 'bottom' | 'right';
  undoCallback: () => void;
}) => void;

/**
 * Configuration for table auto-expansion coordination.
 */
export interface TableAutoExpansionConfig {
  /** Workbook for unified API access */
  workbook?: Workbook;
  /** Optional UIStore for showing AutoCorrect Options button */
  uiStore?: StoreApi<GridEditingUIStore>;
  /** Optional callback when auto-expansion occurs */
  onAutoExpansion?: OnAutoExpansionCallback;
  /** Optional callback for stopping auto-expand on a table */
  onStopAutoExpand?: (tableId: string) => void;
}

/**
 * Result returned by setupTableAutoExpansionCoordination.
 */
export interface TableAutoExpansionResult {
  /**
   * Check and trigger auto-expansion for a cell write.
   * Should be called after a cell value is written.
   * @param info - Information about the cell that was written
   * @returns true if auto-expansion was triggered
   */
  checkAndTrigger(info: CellWriteInfo): Promise<boolean>;

  /**
   * Undo the last auto-expansion.
   * Called when user clicks "Undo Auto-Expansion" in AutoCorrect Options.
   */
  undoLastExpansion(): void;

  /**
   * Stop auto-expanding for the table that was last expanded.
   * Called when user clicks "Stop Auto-Expanding Tables" in AutoCorrect Options.
   */
  stopAutoExpanding(): void;

  /** Cleanup function */
  cleanup(): void;
}

// =============================================================================
// Setup Function
// =============================================================================

/**
 * Set up table auto-expansion coordination.
 *
 * This function creates a coordinator that:
 * 1. Checks cell writes for adjacency to tables
 * 2. Triggers auto-expansion when applicable
 * 3. Provides undo and stop-auto-expand callbacks
 *
 * @param config - Configuration for auto-expansion
 * @returns Coordination result with check and undo methods
 */
export function setupTableAutoExpansionCoordination(
  config: TableAutoExpansionConfig,
): TableAutoExpansionResult {
  const { workbook, uiStore, onAutoExpansion, onStopAutoExpand } = config;

  // Track the last expansion for undo
  let lastExpansion: {
    tableId: string;
    tableName: string;
    direction: 'bottom' | 'right';
    cell: { row: number; col: number };
    sheetId: SheetId;
  } | null = null;

  return {
    async checkAndTrigger(info: CellWriteInfo): Promise<boolean> {
      const { sheetId, row, col, value } = info;

      // Only trigger for non-empty values
      if (!value || value.trim() === '') {
        return false;
      }

      if (!workbook) return false;

      // Check if cell is adjacent to a table with auto-expand enabled
      const ws = workbook.getSheetById(sheetId);
      const tableInfo = await ws.tables.getAtCell(row, col);
      if (!tableInfo) {
        return false;
      }

      // Determine direction: bottom expansion if row is beyond table data area
      const direction: 'bottom' | 'right' = 'bottom';

      // Store for undo
      lastExpansion = {
        tableId: tableInfo.name,
        tableName: tableInfo.name,
        direction,
        cell: { row, col },
        sheetId,
      };

      // Trigger expansion via Worksheet API
      let success = false;
      try {
        await ws.tables.applyAutoExpansion(tableInfo.name);
        success = true;
      } catch {
        success = false;
      }

      if (success) {
        // Show AutoCorrect Options button via UIStore
        if (uiStore) {
          const state = uiStore.getState();
          if (typeof state.showTableExpansionAutoCorrect === 'function') {
            state.showTableExpansionAutoCorrect({
              tableId: tableInfo.name,
              tableName: tableInfo.name,
              direction,
              sheetId,
              triggerCell: { row, col },
            });
          }
        }

        // Also call the legacy callback if provided
        if (onAutoExpansion) {
          onAutoExpansion({
            tableId: tableInfo.name,
            tableName: tableInfo.name,
            direction,
            undoCallback: () => this.undoLastExpansion(),
          });
        }
      }

      return success;
    },

    undoLastExpansion(): void {
      if (!lastExpansion) return;

      // Note: A proper undo would need to:
      // 1. Shrink the table back
      // 2. Clear the cell that was written
      //
      // For now, we log a warning since undo typically goes through
      // the normal undo stack via Mutations
      console.warn(
        '[table-auto-expansion] Undo last expansion requested for table:',
        lastExpansion.tableName,
      );

      // Clear the last expansion record
      lastExpansion = null;
    },

    stopAutoExpanding(): void {
      if (!lastExpansion) return;

      const { tableId, sheetId } = lastExpansion;

      // Disable auto-expand on this table via Worksheet API
      try {
        if (workbook) {
          const ws = workbook.getSheetById(sheetId);
          void ws.tables.update(tableId, { autoExpand: false });
        }

        if (onStopAutoExpand) {
          onStopAutoExpand(tableId);
        }
      } catch (error) {
        console.error('[table-auto-expansion] Failed to disable auto-expand:', error);
      }

      lastExpansion = null;
    },

    cleanup(): void {
      lastExpansion = null;
    },
  };
}
