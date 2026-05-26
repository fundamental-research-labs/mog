/**
 * useSheetSelection Hook
 *
 * Provides access to multi-sheet selection state and actions.
 * Used by TabStrip for Ctrl+click and Shift+click behavior.
 *
 * Editor & Protection
 */

import { useCallback, useEffect, useState } from 'react';

import type { SheetId } from '@mog-sdk/contracts/core';
import { useActiveSheetId, useWorkbook } from '../../infra/context';

/**
 * Resolve the effective selectedSheetIds from the mirror, falling back to the
 * active sheet when the workbook hasn't recorded an explicit multi-selection.
 */
function resolveSelectedSheetIds(
  selectedFromMirror: readonly SheetId[],
  activeSheetId: SheetId,
): SheetId[] {
  if (!selectedFromMirror || selectedFromMirror.length === 0) {
    return [activeSheetId];
  }
  return [...selectedFromMirror];
}

/**
 * Hook for managing multi-sheet selection state.
 *
 * @returns Object with selection state and actions
 */
export function useSheetSelection() {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();

  // Sync init from kernel state mirror.
  const [selectedSheetIds, setSelectedSheetIds] = useState<SheetId[]>(() =>
    resolveSelectedSheetIds(wb.mirror.getSelectedSheetIds(), activeSheetId),
  );

  useEffect(() => {
    // Re-sync from mirror — covers active-sheet change and remount.
    setSelectedSheetIds(resolveSelectedSheetIds(wb.mirror.getSelectedSheetIds(), activeSheetId));

    // Subscribe to wb.on for workbook settings changes
    const unsubscribe = wb.on('workbook:settings-changed', () => {
      setSelectedSheetIds(resolveSelectedSheetIds(wb.mirror.getSelectedSheetIds(), activeSheetId));
    });

    return unsubscribe;
  }, [wb, activeSheetId]);

  /**
   * Select a single sheet (clear multi-selection).
   * Used for regular (non-Ctrl, non-Shift) click.
   */
  const selectSheet = useCallback(
    (sheetId: SheetId) => {
      void wb.sheets.setSelectedIds([sheetId]);
    },
    [wb],
  );

  /**
   * Toggle a sheet's selection (add or remove from selection).
   * Used for Ctrl+click behavior.
   */
  const toggleSheet = useCallback(
    (sheetId: SheetId) => {
      const current = resolveSelectedSheetIds(wb.mirror.getSelectedSheetIds(), activeSheetId);
      if (current.includes(sheetId)) {
        // Remove from selection (keep at least one)
        if (current.length > 1) {
          void wb.sheets.setSelectedIds(current.filter((id) => id !== sheetId));
        }
      } else {
        // Add to selection
        void wb.sheets.setSelectedIds([...current, sheetId]);
      }
    },
    [wb, activeSheetId],
  );

  /**
   * Select a range of sheets.
   * Used for Shift+click behavior.
   */
  const selectRange = useCallback(
    (fromId: SheetId, toId: SheetId) => {
      // Build ordered sheet ID list synchronously from the mirror.
      const orderedIds = wb.mirror.getSheetIds();

      const fromIndex = orderedIds.indexOf(fromId);
      const toIndex = orderedIds.indexOf(toId);

      if (fromIndex === -1 || toIndex === -1) return;

      const startIndex = Math.min(fromIndex, toIndex);
      const endIndex = Math.max(fromIndex, toIndex);
      const rangeIds = orderedIds.slice(startIndex, endIndex + 1);
      void wb.sheets.setSelectedIds([...rangeIds]);
    },
    [wb],
  );

  /**
   * Check if a sheet is selected.
   */
  const isSheetSelected = useCallback(
    (sheetId: SheetId) => selectedSheetIds.includes(sheetId),
    [selectedSheetIds],
  );

  /**
   * Check if multiple sheets are selected.
   */
  const hasMultipleSelection = selectedSheetIds.length > 1;

  return {
    selectedSheetIds,
    selectSheet,
    toggleSheet,
    selectRange,
    isSheetSelected,
    hasMultipleSelection,
    activeSheetId,
  };
}
