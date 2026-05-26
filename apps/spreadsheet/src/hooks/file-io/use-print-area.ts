/**
 * usePrintArea Hook
 *
 * Read-only reactive hook for the active worksheet's print area.
 *
 * - Sync init from `wb.mirror.getPrintArea(sheetId)` — the mirror returns a
 * structured `PrintRange | null` directly; no A1 parse needed.
 * - Subscribes to the `print:area-changed` worksheet event so the UI
 * updates after `dispatch('SET_PRINT_AREA' | 'CLEAR_PRINT_AREA')`.
 *
 * Page Layout dispatch: dispatch-compliance for ribbon page-layout group.
 */
import type { PrintRange } from '@mog-sdk/contracts/events';
import type { SheetId } from '@mog-sdk/contracts/core';
import { useEffect, useState } from 'react';

import { useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface UsePrintAreaReturn {
  /** Current print area for the sheet, or null if none is set. */
  printArea: PrintRange | null;
  /** Whether a print area is currently set. Convenience derived flag. */
  hasPrintArea: boolean;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Read-only print-area state for the given sheet, with reactive updates.
 *
 * Initial value comes synchronously from the kernel state mirror as a
 * structured `PrintRange | null`. The `print:area-changed` event payload
 * carries the same shape, so live updates are a direct setter call.
 */
export function usePrintArea(sheetId: SheetId): UsePrintAreaReturn {
  const wb = useWorkbook();
  const [printArea, setPrintArea] = useState<PrintRange | null>(() =>
    wb.mirror.getPrintArea(sheetId),
  );

  useEffect(() => {
    const ws = wb.getSheetById(sheetId);
    // Re-sync from mirror on sheet change.
    setPrintArea(wb.mirror.getPrintArea(sheetId));

    // Live updates via event payload (already a structured PrintRange).
    const unsubscribe = ws.on('print:area-changed', (event) => {
      setPrintArea(event.printArea);
    });

    return unsubscribe;
  }, [wb, sheetId]);

  return {
    printArea,
    hasPrintArea: printArea !== null,
  };
}
