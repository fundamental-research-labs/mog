/**
 * Slicer → Pivot Bridge
 *
 * Slicer-Pivot bridge (ES.9)
 *
 * Connects slicers to pivot table filters. This bridge:
 * 1. When slicer selection changes → updates pivot field filter
 * 2. When pivot field filter changes externally → syncs slicer visual state
 * 3. Computes slicer items from pivot field values
 *
 * ARCHITECTURE:
 *   User clicks slicer item
 *   → Coordinator intercepts and calls bridge.handleItemClick()
 *   → Bridge calls PivotBridge.updatePivot() to set filter
 *   → Pivot recalculates with filter applied
 *   → EventBus emits pivot:updated
 *   → Slicer cache invalidation → UI re-renders
 *
 * Key Differences from Table Bridge:
 * - Pivot slicers reference fields by name (not CellId)
 * - Field can be in row, column, value, or filter area
 * - Items come from pivot source data unique values
 * - Filter state is stored in PivotTableConfig.filters
 *
 */

import type { SlicerActor } from '@mog-sdk/contracts/actors';
import { SlicerEvents } from '../selectors';
import { type CellValue, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { SlicerItem, SlicerItemState } from '@mog-sdk/contracts/slicers';
import { compareValues } from '@mog/table-engine';
import * as Slicers from '../domain/slicers';

import type { DocumentContext } from '../context';
import { storedSlicerToComputeSlicer } from '../domain/slicers/table-binding';
import type { Slicer } from './compute/compute-types.gen';
import type { PivotBridge } from './pivot-bridge';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for setting up the slicer-pivot bridge.
 */
export interface SlicerPivotBridgeConfig {
  /** Store context for data access */
  ctx: DocumentContext;
  /** Slicer state machine actor */
  slicerActor: SlicerActor;
  /** Pivot bridge for computation and CRUD */
  pivotBridge: PivotBridge;
}

/**
 * Pivot field filter criteria.
 * Internal representation for slicer selection.
 */
export interface PivotFieldFilter {
  /** Filter type */
  type: 'include' | 'exclude';
  /** Values to include/exclude */
  values?: CellValue[];
}

/**
 * Slicer-pivot bridge instance.
 * Manages the connection between slicer interactions and pivot field filters.
 */
export interface SlicerPivotBridgeInstance {
  /**
   * Handle slicer item selection.
   * Updates the underlying pivot field filter.
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
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   * @param value - Value to select exclusively
   */
  handleItemClick(sheetId: SheetId, slicerId: string, value: CellValue): Promise<void>;

  /**
   * Handle item toggle (add/remove from multi-select).
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   * @param value - Value to toggle
   */
  handleItemToggle(sheetId: SheetId, slicerId: string, value: CellValue): Promise<void>;

  /**
   * Handle clear all selection.
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   */
  handleClearAll(sheetId: SheetId, slicerId: string): Promise<void>;

  /**
   * Get slicer items with current state.
   * Computes items from pivot field values and current filter state.
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   * @returns Array of slicer items with states
   */
  getSlicerItems(sheetId: SheetId, slicerId: string): Promise<SlicerItem[]>;

  /**
   * Check if slicer is connected to its pivot source.
   *
   * @param sheetId - Sheet containing the slicer
   * @param slicerId - Slicer ID
   * @returns True if connected
   */
  isConnected(sheetId: SheetId, slicerId: string): Promise<boolean>;

  /**
   * Sync slicer state with current pivot field filter.
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
// Implementation
// =============================================================================

/**
 * Create a slicer-pivot bridge.
 *
 * The bridge connects slicer interactions to pivot field filter operations.
 * It also subscribes to pivot events to keep slicers in sync when
 * pivot filters change externally.
 *
 * @param config - Bridge configuration
 * @returns Slicer-pivot bridge instance
 */
export function createSlicerPivotBridge(
  config: SlicerPivotBridgeConfig,
): SlicerPivotBridgeInstance {
  const { ctx, slicerActor, pivotBridge } = config;

  /** Create a typed string key for CellValue deduplication (avoids cross-type collisions). */
  function cellValueKey(value: CellValue): string {
    if (value === null || value === undefined) return '__NULL__';
    if (typeof value === 'boolean') return `__BOOL__:${value}`;
    if (typeof value === 'number') return `__NUM__:${value}`;
    return `__STR__:${value}`;
  }

  const unsubscribers: Array<() => void> = [];

  // =========================================================================
  // Helper Functions
  // =========================================================================

  /**
   * Get field ID for a slicer's source field.
   * The slicer stores the field name in sourceColumnId but the pivot config uses fieldId.
   */
  async function getFieldId(sheetId: SheetId, slicer: Slicer): Promise<string | undefined> {
    if (slicer.sourceType !== 'pivot') return undefined;

    const pivotConfig = await pivotBridge.getPivot(sheetId, slicer.sourceId);
    if (!pivotConfig) return undefined;

    // Find field by name (sourceColumnId stores the field name for pivot slicers)
    const field = pivotConfig.fields.find((f) => f.name === slicer.sourceColumnId);
    return field?.id;
  }

  /**
   * Get currently selected values from pivot field filter.
   */
  async function getSelectedValues(sheetId: SheetId, slicer: Slicer): Promise<CellValue[]> {
    if (slicer.sourceType !== 'pivot') return [];

    const pivotConfig = await pivotBridge.getPivot(sheetId, slicer.sourceId);
    if (!pivotConfig) return [];

    // Get field ID from field name
    const fieldId = await getFieldId(sheetId, slicer);
    if (!fieldId) return [];

    // Find filter by fieldId
    const filter = pivotConfig.filters.find((f) => f.fieldId === fieldId);
    if (!filter) return [];

    // Return includeValues if set
    return filter.includeValues ?? [];
  }

  /**
   * Set pivot field filter for a slicer.
   */
  async function setPivotFieldFilter(
    sheetId: SheetId,
    slicer: Slicer,
    filter: PivotFieldFilter | undefined,
  ): Promise<void> {
    if (slicer.sourceType !== 'pivot') return;

    const fieldId = await getFieldId(sheetId, slicer);
    if (!fieldId) return;

    if (!filter || !filter.values || filter.values.length === 0) {
      // Remove filter — use pivotBridge to read config, remove filter, write back
      const pivotConfig = await pivotBridge.getPivot(sheetId, slicer.sourceId);
      if (!pivotConfig) return;
      const filters = pivotConfig.filters.filter((f) => f.fieldId !== fieldId);
      await pivotBridge.updatePivot(
        sheetId,
        slicer.sourceId,
        { filters },
        { reason: 'slicerFilterChanged', refreshPolicy: 'refreshAndMaterialize' },
      );
    } else {
      // Set filter to include only selected values — read-modify-write via bridge
      const pivotConfig = await pivotBridge.getPivot(sheetId, slicer.sourceId);
      if (!pivotConfig) return;
      const filters = pivotConfig.filters.filter((f) => f.fieldId !== fieldId);
      filters.push({ fieldId, includeValues: filter.values });
      await pivotBridge.updatePivot(
        sheetId,
        slicer.sourceId,
        { filters },
        { reason: 'slicerFilterChanged', refreshPolicy: 'refreshAndMaterialize' },
      );
    }
  }

  /**
   * Get unique values for a pivot field from the pivot computation engine.
   *
   * Uses pivotBridge.getAllPivotItems() to retrieve items for the field
   * matching the slicer's sourceColumnId (field name), then maps
   * PivotItemInfo.value to CellValue[].
   */
  async function getPivotFieldValues(sheetId: SheetId, slicer: Slicer): Promise<CellValue[]> {
    if (slicer.sourceType !== 'pivot') return [];

    const allFieldItems = await pivotBridge.getAllPivotItems(sheetId, slicer.sourceId);

    // Find the field matching the slicer's source field name
    const fieldItems = allFieldItems.find((fi) => fi.fieldName === slicer.sourceColumnId);
    if (!fieldItems) return [];

    // Map PivotItemInfo values to CellValue[], excluding subtotal/grand total rows
    return fieldItems.items
      .filter((item) => !item.isSubtotal && !item.isGrandTotal)
      .map((item) => item.value);
  }

  // =========================================================================
  // Event Subscriptions
  // =========================================================================

  // Subscribe to pivot updates to sync slicers
  const pivotUpdatedUnsubscribe = ctx.eventBus.on('pivot:updated', (event) => {
    const pivotUpdatedEvent = event as { type: string; sheetId: string; pivotId: string };
    const { sheetId: eventSheetId, pivotId } = pivotUpdatedEvent;

    // Find slicers connected to this pivot
    void (async () => {
      const slicers = await Slicers.getSlicersForPivot(ctx, pivotId);
      for (const storedSlicer of slicers) {
        const computeSlicer = storedSlicerToComputeSlicer(storedSlicer);
        const selectedValues = await getSelectedValues(toSheetId(eventSheetId), computeSlicer);
        slicerActor.send(SlicerEvents.filterChanged(storedSlicer.id, selectedValues));
        slicerActor.send(SlicerEvents.cacheRefreshed(storedSlicer.id));
      }
    })();
  });
  unsubscribers.push(pivotUpdatedUnsubscribe);

  // Subscribe to pivot deletion
  const pivotDeletedUnsubscribe = ctx.eventBus.on('pivot:deleted', (event) => {
    const pivotDeletedEvent = event as { type: string; pivotId: string };

    void (async () => {
      const affectedSlicers = await Slicers.getSlicersForPivot(ctx, pivotDeletedEvent.pivotId);
      for (const slicer of affectedSlicers) {
        slicerActor.send(SlicerEvents.disconnected(slicer.id, 'pivotDeleted'));
      }
    })();
  });
  unsubscribers.push(pivotDeletedUnsubscribe);

  // =========================================================================
  // Bridge Methods
  // =========================================================================

  async function handleSlicerSelection(
    sheetId: SheetId,
    slicerId: string,
    selectedValues: CellValue[],
  ): Promise<void> {
    const storedSlicer = await Slicers.getSlicer(ctx, sheetId, slicerId);
    if (!storedSlicer || storedSlicer.source.type !== 'pivot') return;
    const slicer = storedSlicerToComputeSlicer(storedSlicer);

    if (selectedValues.length === 0) {
      // Clear filter (show all)
      await setPivotFieldFilter(sheetId, slicer, undefined);
    } else {
      // Set filter to include only selected values
      await setPivotFieldFilter(sheetId, slicer, { type: 'include', values: selectedValues });
    }
  }

  async function handleItemClick(
    sheetId: SheetId,
    slicerId: string,
    value: CellValue,
  ): Promise<void> {
    await handleSlicerSelection(sheetId, slicerId, [value]);
  }

  async function handleItemToggle(
    sheetId: SheetId,
    slicerId: string,
    value: CellValue,
  ): Promise<void> {
    const storedSlicer = await Slicers.getSlicer(ctx, sheetId, slicerId);
    if (!storedSlicer || storedSlicer.source.type !== 'pivot') return;
    const slicer = storedSlicerToComputeSlicer(storedSlicer);

    const currentSelection = await getSelectedValues(sheetId, slicer);
    const valueKey = cellValueKey(value);
    const currentKeys = new Set(currentSelection.map(cellValueKey));

    let newSelection: CellValue[];

    if (currentKeys.has(valueKey)) {
      // Remove from selection
      newSelection = currentSelection.filter((v) => {
        const k = cellValueKey(v);
        return k !== valueKey;
      });
    } else {
      // Add to selection
      newSelection = [...currentSelection, value];
    }

    // If all values deselected, clear the filter
    if (newSelection.length === 0) {
      await setPivotFieldFilter(sheetId, slicer, undefined);
    } else {
      await setPivotFieldFilter(sheetId, slicer, { type: 'include', values: newSelection });
    }
  }

  async function handleClearAll(sheetId: SheetId, slicerId: string): Promise<void> {
    const storedSlicer = await Slicers.getSlicer(ctx, sheetId, slicerId);
    if (!storedSlicer || storedSlicer.source.type !== 'pivot') return;
    const slicer = storedSlicerToComputeSlicer(storedSlicer);

    await setPivotFieldFilter(sheetId, slicer, undefined);
  }

  async function getSlicerItems(sheetId: SheetId, slicerId: string): Promise<SlicerItem[]> {
    const storedSlicer = await Slicers.getSlicer(ctx, sheetId, slicerId);
    if (!storedSlicer || storedSlicer.source.type !== 'pivot') return [];
    const slicer = storedSlicerToComputeSlicer(storedSlicer);

    const allValues = await getPivotFieldValues(sheetId, slicer);
    const selectedValues = await getSelectedValues(sheetId, slicer);
    const selectedSet = new Set(selectedValues.map(cellValueKey));
    const hasSelection = selectedSet.size > 0;

    // Build slicer items
    const items: SlicerItem[] = allValues.map((value) => {
      const valueKey = cellValueKey(value);
      const isSelected = hasSelection ? selectedSet.has(valueKey) : true;
      const state: SlicerItemState = isSelected ? 'selected' : 'available';

      return {
        value,
        displayText: value === null ? '(Blank)' : String(value),
        state,
      };
    });

    // Sort items based on slicer sort order
    const sortOrder = slicer.sortOrder;
    if (sortOrder !== 'dataSourceOrder') {
      items.sort((a, b) => {
        const cmp = compareValues(a.value, b.value);
        return sortOrder === 'ascending' ? cmp : -cmp;
      });
    }

    return items;
  }

  async function isConnected(sheetId: SheetId, slicerId: string): Promise<boolean> {
    const storedSlicer = await Slicers.getSlicer(ctx, sheetId, slicerId);
    if (!storedSlicer || storedSlicer.source.type !== 'pivot') return false;
    const slicer = storedSlicerToComputeSlicer(storedSlicer);

    const pivotConfig = await pivotBridge.getPivot(sheetId, slicer.sourceId);
    if (!pivotConfig) return false;

    // Check if the field still exists in the pivot
    return pivotConfig.fields.some((f) => f.name === slicer.sourceColumnId);
  }

  async function syncWithFilter(sheetId: SheetId, slicerId: string): Promise<void> {
    const storedSlicer = await Slicers.getSlicer(ctx, sheetId, slicerId);
    if (!storedSlicer || storedSlicer.source.type !== 'pivot') return;
    const slicer = storedSlicerToComputeSlicer(storedSlicer);

    const selectedValues = await getSelectedValues(sheetId, slicer);
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
