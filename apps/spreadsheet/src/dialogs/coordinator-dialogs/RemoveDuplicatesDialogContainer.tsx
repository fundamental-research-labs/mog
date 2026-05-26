/**
 * RemoveDuplicatesDialogContainer
 *
 * Migrated to Worksheet API (ws.removeDuplicates).
 * Column headers and header detection from ViewportBuffer (sync).
 *
 * Container component that wires RemoveDuplicatesDialog to the selection and store.
 * Must be rendered inside SpreadsheetCoordinatorProvider to access coordinator hooks.
 *
 * @see Stream-K-DATA-TOOLS.md
 */

import { useCallback, useMemo } from 'react';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';
import { displayStringOrNull } from '@mog-sdk/contracts/core';
import type { RemoveDuplicatesOptions } from '../data/RemoveDuplicatesDialog';
import { RemoveDuplicatesDialog } from '../data/RemoveDuplicatesDialog';

export function RemoveDuplicatesDialogContainer() {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);
  const target = useUIStore((s) => s.removeDuplicatesDialogTarget);
  const range = target?.range ?? null;

  // Column headers from ViewportBuffer (sync)
  const columnHeaders = useMemo(() => {
    if (!range) return [];
    const headers: Array<{ col: number; header: string }> = [];
    for (let col = range.startCol; col <= range.endCol; col++) {
      const cell = ws.viewport.getCellData(range.startRow, col);
      headers.push({
        col,
        header: displayStringOrNull(cell?.displayText ?? null) ?? `Column ${col + 1}`,
      });
    }
    return headers;
  }, [ws.viewport, range]);

  const detectedHeaders = target?.hasHeaders ?? false;

  // Worksheet API: removeDuplicates via ws.removeDuplicates (async)
  const handleRemove = useCallback(
    async (options: RemoveDuplicatesOptions) => {
      if (!range) {
        return { duplicatesFound: 0, duplicatesRemoved: 0, uniqueValuesRemaining: 0 };
      }
      const ws = wb.getSheetById(activeSheetId);
      const { colToLetter } = await import('@mog/spreadsheet-utils/a1');
      const rangeA1 = `${colToLetter(range.startCol)}${range.startRow + 1}:${colToLetter(range.endCol)}${range.endRow + 1}`;
      const result = await ws.structure.removeDuplicates(
        rangeA1,
        options.columnsToCompare,
        options.hasHeaders,
      );
      return {
        duplicatesFound: result.removedCount,
        duplicatesRemoved: result.removedCount,
        uniqueValuesRemaining: result.remainingCount,
      };
    },
    [wb, activeSheetId, range],
  );

  return (
    <RemoveDuplicatesDialog
      onRemove={handleRemove}
      range={range}
      columnHeaders={columnHeaders}
      detectedHeaders={detectedHeaders}
    />
  );
}

// =============================================================================
// Wrapper Component for Conditional Mounting
// =============================================================================

/**
 * Wrapper that only mounts RemoveDuplicatesDialogContainer when the dialog is open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 *
 */
export function RemoveDuplicatesDialogContainerWrapper() {
  const isOpen = useUIStore((s) => s.removeDuplicatesDialogOpen);
  if (!isOpen) return null;
  return <RemoveDuplicatesDialogContainer />;
}
