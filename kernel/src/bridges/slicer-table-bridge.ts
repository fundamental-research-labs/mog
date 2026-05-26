/**
 * Slicer → Table Bridge
 *
 * Slicer-Table bridge (ES.8)
 *
 * Connects slicers to table filters. This bridge:
 * 1. When slicer selection changes → updates table's column filter
 * 2. When table filter changes externally → syncs slicer visual state
 * 3. Computes slicer item states from table data
 *
 * ARCHITECTURE:
 *   User clicks slicer item
 *   → Coordinator intercepts and calls bridge.handleItemClick()
 *   → Bridge calls Slicers.setSlicerSelection()
 *   → Slicers module calls Filters.setColumnFilter()
 *   → Filter state change triggers row visibility update
 *   → EventBus emits filter:applied
 *   → Slicer cache invalidation → UI re-renders
 *
 * Single Source of Truth:
 *   The table's filter state (store/domains/filters.ts) is the source of truth.
 *   Slicer's selectedValues is derived from filter state, not stored separately.
 *   This ensures slicers and filter dropdowns stay in sync automatically.
 *
 * @see docs/architecture/cell-identity.md
 */

import type { SlicerActor } from '@mog-sdk/contracts/actors';
import { SlicerEvents } from '../selectors';
import { type CellValue, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { SlicerItem, SlicerItemState } from '@mog-sdk/contracts/slicers';
import {
  buildSlicerCache,
  createSlicer as createSlicerEngine,
  setSlicerSelection as setSlicerSelectionEngine,
  type Slicer as EngineSlicer,
  type SlicerCacheItem,
} from '@mog/table-engine';
import * as Slicers from '../domain/slicers';
import * as TablesCore from '../domain/tables/core';
import type { Slicer } from './compute/compute-types.gen';

import type { DocumentContext } from '../context/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for setting up the slicer-table bridge.
 */
export interface SlicerTableBridgeConfig {
  /** Store context for data access */
  ctx: DocumentContext;
  /** Slicer state machine actor */
  slicerActor: SlicerActor;
  /** Callback to get cell values */
  getCellValue: (sheetId: SheetId, row: number, col: number) => CellValue | undefined;
}

/**
 * Slicer-table bridge instance.
 * Manages the connection between slicer interactions and table filters.
 */
export interface SlicerTableBridge {
  /**
   * Handle slicer item selection.
   * Updates the underlying table filter based on slicer selection.
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   * @param selectedValues - Array of selected values (empty = clear filter)
   */
  handleSlicerSelection(
    sheetId: SheetId,
    slicerId: string,
    selectedValues: CellValue[],
  ): Promise<void>;

  /**
   * Handle single item click (exclusive selection).
   * Clears other selections and selects only this value.
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   * @param value - Value to select exclusively
   */
  handleItemClick(sheetId: SheetId, slicerId: string, value: CellValue): Promise<void>;

  /**
   * Handle item toggle (add/remove from multi-select).
   * Used when Ctrl+click or similar modifier is used.
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   * @param value - Value to toggle
   */
  handleItemToggle(sheetId: SheetId, slicerId: string, value: CellValue): Promise<void>;

  /**
   * Handle clear all selection.
   * Shows all values (removes filter).
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   */
  handleClearAll(sheetId: SheetId, slicerId: string): Promise<void>;

  /**
   * Get slicer items with current state.
   * Computes items from table data and current filter state.
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   * @returns Array of slicer items with states
   */
  getSlicerItems(sheetId: SheetId, slicerId: string): Promise<SlicerItem[]>;

  /**
   * Check if slicer is connected to its table source.
   * Returns false if the source column was deleted.
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   * @returns True if connected
   */
  isConnected(sheetId: SheetId, slicerId: string): Promise<boolean>;

  /**
   * Sync slicer state with current filter.
   * Call this when filter changes externally (e.g., via filter dropdown).
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   */
  syncWithFilter(sheetId: SheetId, slicerId: string): Promise<void>;

  /**
   * Clean up bridge resources.
   */
  destroy(): void;
}

// =============================================================================
// Table-Engine Helpers
// =============================================================================

/**
 * Extract column data from the sheet for a given column and row range.
 * Returns one CellValue per data row, suitable for buildSlicerCache.
 */
function extractColumnData(
  sheetId: SheetId,
  col: number,
  startRow: number,
  endRow: number,
  getCellValue: (sheetId: SheetId, row: number, col: number) => CellValue | undefined,
): CellValue[] {
  const data: CellValue[] = [];
  for (let row = startRow; row <= endRow; row++) {
    const v = getCellValue(sheetId, row, col);
    data.push(v === undefined ? null : v);
  }
  return data;
}

/**
 * Convert a compute-table Slicer → table-engine EngineSlicer.
 * Passes through to table-engine EngineSlicer.
 */
function toEngineSlicer(slicer: Slicer): EngineSlicer {
  return createSlicerEngine({
    id: slicer.id,
    name: slicer.name,
    sourceType: 'table',
    sourceId: slicer.sourceId,
    sourceColumnId: slicer.sourceColumnId,
    multiSelect: slicer.multiSelect,
    showItemsWithNoData: slicer.showItemsWithNoData,
    sortOrder: slicer.sortOrder,
  });
}

/**
 * Map a table-engine SlicerCacheItem to a contracts SlicerItem.
 */
function cacheItemToSlicerItem(item: SlicerCacheItem): SlicerItem {
  let state: SlicerItemState;
  if (item.selected) {
    state = 'selected';
  } else if (!item.hasData) {
    state = 'unavailable';
  } else {
    state = 'available';
  }
  return {
    value: item.value,
    displayText: item.displayText,
    state,
    count: item.count,
  };
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a slicer-table bridge.
 *
 * The bridge connects slicer interactions to table filter operations.
 * It also subscribes to filter events to keep slicers in sync when
 * filters change externally (e.g., via AutoFilter dropdown).
 *
 * @param config - Bridge configuration
 * @returns Slicer-table bridge instance
 */
export function createSlicerTableBridge(config: SlicerTableBridgeConfig): SlicerTableBridge {
  const { ctx, slicerActor, getCellValue } = config;
  const unsubscribers: Array<() => void> = [];

  // =========================================================================
  // Event Subscriptions
  // =========================================================================

  // Subscribe to filter events to sync slicers when filter changes externally
  const filterAppliedUnsubscribe = ctx.eventBus.on('filter:applied', (event) => {
    const { sheetId: rawSheetId } = event;
    if (!rawSheetId) return;
    const sid = toSheetId(rawSheetId);

    void (async () => {
      // Find all table slicers in this sheet
      const slicers = await Slicers.getSlicersInSheet(ctx, sid);
      for (const slicer of slicers) {
        if (slicer.source.type !== 'table') continue;

        // Notify slicer machine of filter change
        const selectedValues = await Slicers.getSlicerSelectedValues(
          ctx,
          Slicers.storedSlicerToComputeSlicer(slicer),
        );
        slicerActor.send(SlicerEvents.filterChanged(slicer.id, selectedValues));
      }
    })();
  });
  unsubscribers.push(filterAppliedUnsubscribe);

  const filterClearedUnsubscribe = ctx.eventBus.on('filter:cleared', (event) => {
    const { sheetId: rawSheetId } = event;
    if (!rawSheetId) return;
    const sid = toSheetId(rawSheetId);

    void (async () => {
      const slicers = await Slicers.getSlicersInSheet(ctx, sid);
      for (const slicer of slicers) {
        if (slicer.source.type !== 'table') continue;

        // Filter cleared = all values selected
        slicerActor.send(SlicerEvents.filterChanged(slicer.id, []));
      }
    })();
  });
  unsubscribers.push(filterClearedUnsubscribe);

  // Subscribe to table deletion to disconnect slicers
  const tableDeletedUnsubscribe = ctx.eventBus.on('table:deleted', (event) => {
    const tableDeletedEvent = event as { type: string; tableId: string };

    void (async () => {
      const affectedSlicers = await Slicers.getSlicersForTable(ctx, tableDeletedEvent.tableId);
      for (const slicer of affectedSlicers) {
        slicerActor.send(SlicerEvents.disconnected(slicer.id, 'tableDeleted'));
      }
    })();
  });
  unsubscribers.push(tableDeletedUnsubscribe);

  // Subscribe to column deletion to check slicer connections
  const columnsDeletedUnsubscribe = ctx.eventBus.on('columns:deleted', (event) => {
    const { sheetId: rawSheetId } = event;
    if (!rawSheetId) return;
    const sid = toSheetId(rawSheetId as string);

    void (async () => {
      const slicers = await Slicers.getSlicersInSheet(ctx, sid);
      for (const slicer of slicers) {
        if (slicer.source.type !== 'table') continue;

        if (!(await Slicers.isSlicerConnected(ctx, Slicers.storedSlicerToComputeSlicer(slicer)))) {
          slicerActor.send(SlicerEvents.disconnected(slicer.id, 'columnDeleted'));
        }
      }
    })();
  });
  unsubscribers.push(columnsDeletedUnsubscribe);

  // =========================================================================
  // Bridge Methods
  // =========================================================================

  async function handleSlicerSelection(
    sheetId: SheetId,
    slicerId: string,
    selectedValues: CellValue[],
  ): Promise<void> {
    await Slicers.setSlicerSelection(ctx, sheetId, slicerId, selectedValues);
  }

  async function handleItemClick(
    sheetId: SheetId,
    slicerId: string,
    value: CellValue,
  ): Promise<void> {
    await Slicers.selectSlicerItemExclusive(ctx, sheetId, slicerId, value);
  }

  async function handleItemToggle(
    sheetId: SheetId,
    slicerId: string,
    value: CellValue,
  ): Promise<void> {
    await Slicers.toggleSlicerItem(ctx, sheetId, slicerId, value);
  }

  async function handleClearAll(sheetId: SheetId, slicerId: string): Promise<void> {
    await Slicers.clearSlicerSelection(ctx, sheetId, slicerId);
  }

  async function getSlicerItems(sheetId: SheetId, slicerId: string): Promise<SlicerItem[]> {
    const storedSlicer = await Slicers.getSlicer(ctx, sheetId, slicerId);
    if (!storedSlicer) return [];
    if (storedSlicer.source.type !== 'table') return [];

    const computeSlicer = Slicers.storedSlicerToComputeSlicer(storedSlicer);

    // Resolve CellId → grid position via spreadsheet-model
    const colPosition = await Slicers.resolveSlicerColumn(ctx, computeSlicer);
    if (!colPosition) return []; // Slicer disconnected

    // Get table data range (excludes header and total rows)
    const table = await TablesCore.getTable(ctx, computeSlicer.sourceId);
    if (!table) return [];
    const dataRange = await TablesCore.getDataRange(ctx, table.id);

    // Extract raw column data for the engine
    const columnData = extractColumnData(
      colPosition.sheetId,
      colPosition.col,
      dataRange.startRow,
      dataRange.endRow,
      getCellValue,
    );

    // Build engine slicer with current filter selection state
    let engineSlicer = toEngineSlicer(computeSlicer);
    const selectedValues = await Slicers.getSlicerSelectedValues(ctx, computeSlicer);
    if (selectedValues.length > 0) {
      engineSlicer = setSlicerSelectionEngine(engineSlicer, selectedValues);
    }

    // Pure computation: build slicer cache via table-engine
    const cache = buildSlicerCache(engineSlicer, columnData);

    // Map table-engine SlicerCacheItem[] → contracts SlicerItem[]
    return cache.items.map(cacheItemToSlicerItem);
  }

  async function isConnected(sheetId: SheetId, slicerId: string): Promise<boolean> {
    const storedSlicer = await Slicers.getSlicer(ctx, sheetId, slicerId);
    if (!storedSlicer) return false;

    return await Slicers.isSlicerConnected(ctx, Slicers.storedSlicerToComputeSlicer(storedSlicer));
  }

  async function syncWithFilter(sheetId: SheetId, slicerId: string): Promise<void> {
    const storedSlicer = await Slicers.getSlicer(ctx, sheetId, slicerId);
    if (!storedSlicer) return;

    const computeSlicer = Slicers.storedSlicerToComputeSlicer(storedSlicer);
    const selectedValues = await Slicers.getSlicerSelectedValues(ctx, computeSlicer);
    slicerActor.send(SlicerEvents.filterChanged(storedSlicer.id, selectedValues));
  }

  function destroy(): void {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
    unsubscribers.length = 0;
  }

  return {
    handleSlicerSelection,
    handleItemClick,
    handleItemToggle,
    handleClearAll,
    getSlicerItems,
    isConnected,
    syncWithFilter,
    destroy,
  };
}
