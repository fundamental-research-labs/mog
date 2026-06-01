/**
 * SubtotalDialogContainer
 *
 * Migrated to Worksheet API (ws.outline.subtotal).
 * Column headers from ViewportBuffer (sync).
 *
 * Container component that wires SubtotalDialog to the selection and store.
 * Must be rendered inside SpreadsheetCoordinatorProvider to access coordinator hooks.
 *
 * @see STREAM-O-GROUPING.md
 */

import type { SubtotalConfig } from '@mog-sdk/contracts/api';
import { useCallback, useMemo } from 'react';
import { displayStringOrNull } from '@mog-sdk/contracts/core';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';
import { SubtotalDialog } from '../data/SubtotalDialog';

export function SubtotalDialogContainer() {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);
  const subtotalDialog = useUIStore((s) => s.subtotalDialog);
  const range = subtotalDialog.range;

  // Column headers from ViewportBuffer (sync) for first row of range
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

  // Worksheet API: apply subtotals via ws.outline.subtotal(config)
  const handleApply = useCallback(
    async (options: import('@mog-sdk/contracts/grouping').SubtotalOptions) => {
      if (!range) {
        return { groupsCreated: 0, subtotalRowsInserted: 0, affectedRange: range! };
      }
      const ws = wb.getSheetById(activeSheetId);
      // Map SubtotalOptions to SubtotalConfig
      const fnMap: Record<string, SubtotalConfig['aggregation']> = {
        SUM: 'sum',
        COUNT: 'count',
        AVERAGE: 'average',
        MAX: 'max',
        MIN: 'min',
        sum: 'sum',
        count: 'count',
        average: 'average',
        max: 'max',
        min: 'min',
      };
      const config: SubtotalConfig = {
        range,
        hasHeaders: subtotalDialog.hasHeaders,
        groupByColumn: options.groupByColumn,
        subtotalColumns: options.subtotalColumns,
        aggregation: fnMap[options.function] ?? 'sum',
        replace: options.replaceExisting,
        summaryBelowData: options.summaryBelowData,
      };
      return await ws.outline.subtotal(config);
    },
    [wb, activeSheetId, range, subtotalDialog.hasHeaders],
  );

  // Worksheet API: remove subtotals via ws.outline.removeSubtotals
  const handleRemoveAll = useCallback(async () => {
    if (!range) return;
    const ws = wb.getSheetById(activeSheetId);
    await ws.outline.removeSubtotals(range);
  }, [wb, activeSheetId, range]);

  return (
    <SubtotalDialog
      onApply={handleApply}
      onRemoveAll={handleRemoveAll}
      range={range}
      columnHeaders={columnHeaders}
    />
  );
}

// =============================================================================
// Wrapper Component for Conditional Mounting
// =============================================================================

/**
 * Wrapper that only mounts SubtotalDialogContainer when the dialog is open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 *
 */
export function SubtotalDialogContainerWrapper() {
  const isOpen = useUIStore((s) => s.subtotalDialog.isOpen);
  if (!isOpen) return null;
  return <SubtotalDialogContainer />;
}
