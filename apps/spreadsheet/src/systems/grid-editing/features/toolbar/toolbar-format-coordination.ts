/**
 * Toolbar Format Coordination
 *
 * Subscribes to EventBus and UIStore to keep UIStore.activeCellFormat
 * and UIStore.toolbarRanges up to date.
 *
 * This is NOT a React component - it's a coordinator-level subscription that
 * populates Zustand directly from the sources of truth.
 *
 * Subscription sources:
 * 1. cell:format-changed EventBus event - for format changes
 * 2. UIStore.activeSheetId Zustand subscription - for sheet switches
 * 3. External callbacks (onActiveCellChanged/onSelectionRangesChanged) -
 * triggered by builder's SelectionActor subscription
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 7 (EventBus), Section 14 (Render Isolation)
 */

import type { Worksheet } from '@mog-sdk/contracts/api';
import type { IEventBus } from '@mog-sdk/contracts/events';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellFormatChangedEvent } from '@mog-sdk/contracts/events';
import type { StoreApi } from 'zustand';
import type { GridEditingUIStore } from '../../types';

export interface ToolbarFormatCoordinationConfig {
  /** Worksheet for viewport reads (active cell format) */
  ws: Worksheet;
  /** UI Store API for subscribing and updating state */
  uiStoreApi: StoreApi<GridEditingUIStore>;
  /** Function to get current active cell from selection */
  getActiveCell: () => { row: number; col: number };
  /** Function to get current selection ranges */
  getSelectionRanges: () => CellRange[];
  /** Per-document event bus for coordination events */
  eventBus: IEventBus;
}

/**
 * Interface for external selection change notifications.
 * Used by the coordinator to notify toolbar coordination when selection changes.
 */
export interface ToolbarFormatCoordinationHandle {
  /** Call when active cell changes */
  onActiveCellChanged: () => void;
  /** Call when selection ranges change */
  onSelectionRangesChanged: () => void;
  /** Cleanup function */
  cleanup: () => void;
}

/**
 * Create toolbar format coordination with selection change handlers.
 *
 * This function creates subscriptions to keep UIStore toolbar state in sync
 * with the underlying data sources. The returned handle provides callbacks
 * for selection changes (called by the builder's SelectionActor subscription)
 * and a cleanup function.
 *
 * @param config Configuration with dependencies
 * @returns Handle with update methods and cleanup
 */
export function createToolbarFormatCoordination(
  config: ToolbarFormatCoordinationConfig,
): ToolbarFormatCoordinationHandle {
  const { ws, uiStoreApi, getActiveCell, getSelectionRanges, eventBus } = config;
  const cleanupFns: Array<() => void> = [];

  /**
   * Read current format from ws.viewport and update UIStore.
   */
  const updateActiveCellFormat = () => {
    const sheetId = uiStoreApi.getState().activeSheetId;
    if (!sheetId) return;

    const activeCellData = ws.viewport.getActiveCellData();
    const format = activeCellData?.format ?? null;
    uiStoreApi.getState().setActiveCellFormat(format);
  };

  /**
   * Read current ranges and update UIStore.
   */
  const updateToolbarRanges = () => {
    const ranges = getSelectionRanges();
    const normalized = ranges.map((r) => ({
      startRow: Math.min(r.startRow, r.endRow),
      endRow: Math.max(r.startRow, r.endRow),
      startCol: Math.min(r.startCol, r.endCol),
      endCol: Math.max(r.startCol, r.endCol),
      isFullRow: r.isFullRow,
      isFullColumn: r.isFullColumn,
    }));
    uiStoreApi.getState().setToolbarRanges(normalized);
  };

  // ==========================================================================
  // 1. Subscribe to cell:format-changed EventBus event
  // ==========================================================================
  const unsubFormatChanged = eventBus.on<CellFormatChangedEvent>('cell:format-changed', (event) => {
    const sheetId = uiStoreApi.getState().activeSheetId;
    if (!sheetId) return;

    const { row, col } = getActiveCell();
    if (event.sheetId === sheetId && event.row === row && event.col === col) {
      updateActiveCellFormat();
    }
  });
  cleanupFns.push(unsubFormatChanged);

  // ==========================================================================
  // 2. Subscribe to UIStore.activeSheetId (Zustand subscription)
  // PERFORMANCE: Use selector-based subscription via subscribeWithSelector middleware.
  // This ensures the callback only fires when activeSheetId changes, not on every
  // UIStore update (which was causing 89 commits for simple cell interactions).
  // @see docs/ARCHITECTURE-CHECKLIST.md - Section 15 (Render Isolation)
  // ==========================================================================
  const unsubSheetSwitch = uiStoreApi.subscribe(
    (state: GridEditingUIStore) => state.activeSheetId,
    // @ts-ignore subscribeWithSelector middleware enables 2-arg subscribe
    () => {
      updateActiveCellFormat();
      updateToolbarRanges();
    },
  );
  cleanupFns.push(unsubSheetSwitch);

  // ==========================================================================
  // Initial population
  // ==========================================================================
  updateActiveCellFormat();
  updateToolbarRanges();

  // ==========================================================================
  // Return handle for external selection change notifications
  // ==========================================================================
  // NOTE: The builder (toolbar-coordination-builder.ts) performs full transition
  // detection before calling these callbacks. These callbacks are thin wrappers
  // that directly trigger updates - no redundant checking needed here.
  return {
    onActiveCellChanged: updateActiveCellFormat,
    onSelectionRangesChanged: updateToolbarRanges,
    cleanup: () => {
      for (const cleanup of cleanupFns) {
        cleanup();
      }
    },
  };
}
