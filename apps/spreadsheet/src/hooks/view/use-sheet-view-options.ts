/**
 * useSheetViewOptions Hook
 *
 * Provides reactive sheet view options (gridlines, headers visibility).
 * Subscribes to EventBus for real-time updates when view options change.
 *
 * Freeze Panes & View Options
 *
 * Architecture:
 * - Reads: sync from `wb.mirror.getViewOptions(sheetId)` (kernel state mirror)
 * - Writes: Worksheet API setGridlines(), setHeadings() (fire-and-forget)
 */

import { useCallback, useEffect, useState } from 'react';

import type { SheetViewOptions, SheetId } from '@mog-sdk/contracts/core';
import { useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface UseSheetViewOptionsReturn {
  /** Current view options state */
  viewOptions: SheetViewOptions;
  /** Toggle gridlines visibility */
  toggleGridlines: () => void;
  /** Toggle headings (row/column headers) visibility */
  toggleHeadings: () => void;
  /** Toggle formula display mode */
  toggleShowFormulas: () => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing sheet view options with reactive EventBus subscription.
 *
 * - Sync init from `wb.mirror.getViewOptions(sheetId)` — first paint is correct.
 * - Live updates via the `view:options-changed` worksheet event.
 * - ToolbarContainer calls Worksheet API setters (Sheets.toggleGridlines, etc.).
 *
 * @param sheetId - The sheet ID to get/set view options for
 * @returns View options state and toggle functions
 */
export function useSheetViewOptions(sheetId: SheetId): UseSheetViewOptionsReturn {
  const wb = useWorkbook();

  // Sync init from kernel state mirror.
  const [viewOptions, setViewOptions] = useState<SheetViewOptions>(() =>
    wb.mirror.getViewOptions(sheetId),
  );

  // Subscribe to ws.on for view option changes.
  // Note: depend on [wb, sheetId] not [ws] — useWorksheet() returns a new instance
  // every render (wb.getSheetById() creates new WorksheetImpl), which would cause an
  // infinite re-render loop.
  useEffect(() => {
    const ws = wb.getSheetById(sheetId);
    // Re-sync from mirror on sheet change.
    setViewOptions(wb.mirror.getViewOptions(sheetId));

    // Subscribe to view:options-changed events.
    // Re-derive the full snapshot from the mirror — the event payload only
    // exposes a subset of keys, but the dispatcher re-emits this event for
    // any of the 7 VIEW_OPTION_KEYS. Reading the mirror keeps all fields
    // (including rightToLeft / showFormulas / showZeros / zoomScale) in sync.
    const unsubscribe = ws.on('view:options-changed', () => {
      setViewOptions(wb.mirror.getViewOptions(sheetId));
    });

    return unsubscribe;
  }, [wb, sheetId]);

  // Toggle handlers that call Worksheet API (fire-and-forget)
  const toggleGridlines = useCallback(() => {
    const ws = wb.getSheetById(sheetId);
    void ws.view.setGridlines(!viewOptions.showGridlines);
  }, [wb, sheetId, viewOptions.showGridlines]);

  const toggleHeadings = useCallback(() => {
    const newValue = !(viewOptions.showRowHeaders && viewOptions.showColumnHeaders);
    const ws = wb.getSheetById(sheetId);
    void ws.view.setHeadings(newValue);
  }, [wb, sheetId, viewOptions.showRowHeaders, viewOptions.showColumnHeaders]);

  const toggleShowFormulas = useCallback(() => {
    const ws = wb.getSheetById(sheetId);
    void ws.view.setShowFormulas(!viewOptions.showFormulas);
  }, [wb, sheetId, viewOptions.showFormulas]);

  return {
    viewOptions,
    toggleGridlines,
    toggleHeadings,
    toggleShowFormulas,
  };
}
