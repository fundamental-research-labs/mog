/**
 * useSlicers Hook
 *
 * Slicers Implementation
 *
 * Manages slicer state for the spreadsheet with Yjs collaboration support.
 *
 * State architecture:
 * - Yjs: Slicer configs (persistent, collaborative)
 * - Filter state: Source of truth for selection (slicers derive from filters)
 * - UI Store: Hover state, active slicer (ephemeral)
 *
 * Architecture:
 * - Reads: Worksheet API listSlicers(), getSlicerState() (async)
 * - Writes: Worksheet API updateSlicerConfig(), clearSlicerSelection(),
 * setSlicerSelection, removeSlicer (async)
 *
 * @module hooks/use-slicers
 */

import { useCallback, useEffect, useState } from 'react';

import type { Slicer as ApiSlicer, Workbook } from '@mog-sdk/contracts/api';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';

import type {
  SlicerDefinition,
  SlicerPositionRect,
  SlicerRenderConfig,
  SlicerRenderItem,
} from '../../adapters/slicers/slicer-render-types';
import { useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface UseSlicersOptions {
  /** Current sheet ID */
  sheetId: SheetId;
}

const DEFAULT_SLICER_STYLE: SlicerRenderConfig['style'] = {
  columnCount: 1,
  buttonHeight: 30,
  showSelectionIndicator: true,
  crossFilter: 'showItemsWithDataAtTop',
  customListSort: true,
  showItemsWithNoData: true,
  sortOrder: 'ascending',
};

export interface UseSlicersReturn {
  /** Slicers for the current sheet (with resolved items) */
  slicers: SlicerDefinition[];

  /** Currently selected slicer ID (for UI focus) */
  selectedSlicerId: string | null;

  /** Select a slicer */
  selectSlicer: (slicerId: string | null) => void;

  /** Handle single item click (exclusive selection) */
  handleItemClick: (slicerId: string, value: CellValue) => void;

  /** Handle item toggle (multi-select with Ctrl/Cmd) */
  handleItemToggle: (slicerId: string, value: CellValue) => void;

  /** Clear all selections for a slicer (show all) */
  clearSelection: (slicerId: string) => void;

  /** Update slicer position */
  updateSlicerPosition: (slicerId: string, position: Partial<SlicerPositionRect>) => void;

  /** Update slicer style */
  updateSlicerStyle: (slicerId: string, style: Partial<SlicerRenderConfig['style']>) => void;

  /** Delete a slicer */
  deleteSlicer: (slicerId: string) => void;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert Worksheet API slicer data into the app render model.
 *
 * The Worksheet API intentionally exposes pixel-space slicer DTOs. The app must
 * not reconstruct persisted data/slicers SlicerConfig here; persistence anchoring
 * remains owned by kernel/compute.
 */
async function apiSlicerToDefinitionAsync(
  wb: Workbook,
  sheetId: SheetId,
  slicer: ApiSlicer,
): Promise<SlicerDefinition> {
  const ws = wb.getSheetById(sheetId);
  const state = await ws.slicers.getState(slicer.id);

  const items: SlicerRenderItem[] = (state?.items ?? []).map((apiItem) => ({
    value: apiItem.value,
    displayText: String(apiItem.value ?? ''),
    state: apiItem.selected ? 'selected' : 'available',
    count: apiItem.count ?? 0,
  }));
  const isConnected: boolean = state?.isConnected ?? true;
  const hasActiveFilter: boolean = state?.selectedValues?.length > 0 || false;

  return {
    config: {
      id: slicer.id,
      name: slicer.name,
      caption: slicer.caption,
      tableName: slicer.tableName,
      columnName: slicer.columnName,
      position: slicer.position,
      style: DEFAULT_SLICER_STYLE,
      zIndex: 0,
      locked: false,
      multiSelect: true,
      showHeader: true,
    },
    items,
    isConnected,
    hasActiveFilter,
  };
}

async function loadSlicerDefinitions(wb: Workbook, sheetId: SheetId): Promise<SlicerDefinition[]> {
  const ws = wb.getSheetById(sheetId);
  const summaries = await ws.slicers.list();

  const definitions = await Promise.all(
    summaries.map(async (summary) => {
      const full = await ws.slicers.get(summary.id);
      if (!full) return null;

      return apiSlicerToDefinitionAsync(wb, sheetId, full);
    }),
  );

  return definitions.filter((definition): definition is SlicerDefinition => definition !== null);
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing slicers in the spreadsheet with Yjs collaboration.
 *
 * All reads/writes go through Worksheet API (async).
 */
export function useSlicers({ sheetId }: UseSlicersOptions): UseSlicersReturn {
  const wb = useWorkbook();

  // Load slicers via Worksheet API (async)
  const [slicerDefs, setSlicerDefs] = useState<SlicerDefinition[]>([]);

  // Version counter to trigger re-render when filter/data changes
  const [dataVersion, setDataVersion] = useState(0);

  // Selected slicer for UI focus
  const [selectedSlicerId, setSelectedSlicerId] = useState<string | null>(null);

  // Load slicers asynchronously via Worksheet API
  useEffect(() => {
    let cancelled = false;

    async function loadSlicers() {
      const defs = await loadSlicerDefinitions(wb, sheetId);
      if (cancelled) return;

      setSlicerDefs(defs);
    }

    void loadSlicers();

    return () => {
      cancelled = true;
    };
  }, [sheetId, wb, dataVersion]);

  // Subscribe to filter/data change events for re-rendering slicer items
  useEffect(() => {
    const ws = wb.getSheetById(sheetId);
    const handler = () => setDataVersion((v) => v + 1);

    const unsubscribers: Array<() => void> = [];

    // Re-render when filters change (affects slicer item states)
    unsubscribers.push(ws.on('filter:applied', handler));
    unsubscribers.push(ws.on('filter:cleared', handler));

    // Re-render when slicer cache is invalidated
    unsubscribers.push(ws.on('slicer:cacheInvalidated', handler));

    // Re-render when slicer objects are created/updated/deleted
    unsubscribers.push(ws.on('slicer:created', handler));
    unsubscribers.push(ws.on('slicer:updated', handler));
    unsubscribers.push(ws.on('slicer:deleted', handler));
    unsubscribers.push(ws.on('slicer:changed', handler));

    // Re-render when slicer selection changes
    unsubscribers.push(ws.on('slicer:selectionChanged', handler));

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [wb, sheetId]);

  // Select a slicer
  const selectSlicer = useCallback((slicerId: string | null) => {
    setSelectedSlicerId(slicerId);
  }, []);

  // Worksheet API: Handle single item click (exclusive selection)
  // Clear selection then set the single clicked item as the only selection.
  const handleItemClick = useCallback(
    (slicerId: string, value: CellValue) => {
      void (async () => {
        const ws = wb.getSheetById(sheetId);
        await ws.slicers.clearSelection(slicerId);
        await ws.slicers.setSelection(slicerId, [value]);
        setDataVersion((v) => v + 1);
      })();
    },
    [wb, sheetId],
  );

  // Worksheet API: Handle item toggle (multi-select)
  // Get current items, compute new selection, call setSlicerSelection.
  const handleItemToggle = useCallback(
    (slicerId: string, value: CellValue) => {
      void (async () => {
        const ws = wb.getSheetById(sheetId);
        const items = await ws.slicers.getItems(slicerId);
        const currentSelected = items.filter((i) => i.selected).map((i) => i.value);
        const valueKey = value === null ? '__NULL__' : String(value);
        const isSelected = currentSelected.some(
          (v) => (v === null ? '__NULL__' : String(v)) === valueKey,
        );
        const newSelection = isSelected
          ? currentSelected.filter((v) => (v === null ? '__NULL__' : String(v)) !== valueKey)
          : [...currentSelected, value];
        await ws.slicers.setSelection(slicerId, newSelection);
        setDataVersion((v) => v + 1);
      })();
    },
    [wb, sheetId],
  );

  // Worksheet API: Clear selection (show all)
  const clearSelection = useCallback(
    (slicerId: string) => {
      void (async () => {
        const ws = wb.getSheetById(sheetId);
        await ws.slicers.clearSelection(slicerId);
        setDataVersion((v) => v + 1);
      })();
    },
    [wb, sheetId],
  );

  // Update slicer position via Worksheet API
  const updateSlicerPosition = useCallback(
    (slicerId: string, position: Partial<SlicerPositionRect>) => {
      void (async () => {
        const ws = wb.getSheetById(sheetId);
        const slicer = await ws.slicers.get(slicerId);
        if (!slicer) return;

        await ws.slicers.update(slicerId, {
          position: { ...slicer.position, ...position },
        });
        setDataVersion((v) => v + 1);
      })();
    },
    [wb, sheetId],
  );

  // Update slicer style via Worksheet API
  const updateSlicerStyle = useCallback(
    (slicerId: string, style: Partial<SlicerRenderConfig['style']>) => {
      void (async () => {
        const ws = wb.getSheetById(sheetId);
        await ws.slicers.update(slicerId, {
          style: { ...DEFAULT_SLICER_STYLE, ...style },
        });
        setDataVersion((v) => v + 1);
      })();
    },
    [wb, sheetId],
  );

  // Worksheet API: Delete slicer
  const deleteSlicer = useCallback(
    (slicerId: string) => {
      void (async () => {
        const ws = wb.getSheetById(sheetId);
        await ws.slicers.remove(slicerId);
        setDataVersion((v) => v + 1);

        // Clear selection if deleted slicer was selected
        if (selectedSlicerId === slicerId) {
          setSelectedSlicerId(null);
        }
      })();
    },
    [wb, sheetId, selectedSlicerId],
  );

  return {
    slicers: slicerDefs,
    selectedSlicerId,
    selectSlicer,
    handleItemClick,
    handleItemToggle,
    clearSelection,
    updateSlicerPosition,
    updateSlicerStyle,
    deleteSlicer,
  };
}

// Re-export types for convenience
export type {
  SlicerDefinition,
  SlicerPositionRect,
  SlicerRenderConfig as SlicerConfig,
  SlicerRenderItem as SlicerItem,
};
