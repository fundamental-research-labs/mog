/**
 * usePageBreaks Hook
 *
 * Read-only reactive hook for page-break state.
 *
 * Page Layout dispatch: pruned the mutating `insertHorizontalPageBreak`,
 * `removeHorizontalPageBreak`, `insertVerticalPageBreak`,
 * `removeVerticalPageBreak`, `clearAllPageBreaks` methods. These now
 * route through dispatch:
 * - `INSERT_HORIZONTAL_PAGE_BREAK`
 * - `REMOVE_HORIZONTAL_PAGE_BREAK`
 * - `INSERT_VERTICAL_PAGE_BREAK`
 * - `REMOVE_VERTICAL_PAGE_BREAK`
 * - `RESET_PAGE_BREAKS`
 *
 * The Unified Action System owns the writes; this hook owns the reads.
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import { useEffect, useState } from 'react';

import { useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface PageBreakEntry {
  id: number;
  min: number;
  max: number;
  manual: boolean;
  pt: boolean;
}

export interface PageBreaks {
  rowBreaks: PageBreakEntry[];
  colBreaks: PageBreakEntry[];
}

export interface UsePageBreaksReturn {
  /** Current page breaks state */
  pageBreaks: PageBreaks;
  /** Whether any page breaks exist */
  hasPageBreaks: boolean;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for reading page-break state with reactive EventBus subscription.
 *
 * - Sync init from `wb.mirror.getPageBreaks(sheetId)` — first paint is correct.
 * - Reactive updates via `print:page-breaks-changed` events.
 *
 * Mutations: dispatch `INSERT_HORIZONTAL_PAGE_BREAK`, etc. —
 * never call writers directly from the UI.
 *
 * @param sheetId - The sheet ID to read page breaks for
 * @returns Read-only page breaks state
 */
export function usePageBreaks(sheetId: SheetId): UsePageBreaksReturn {
  const wb = useWorkbook();

  // Sync init from kernel state mirror.
  const [pageBreaks, setPageBreaks] = useState<PageBreaks>(() => wb.mirror.getPageBreaks(sheetId));

  // Subscribe to ws.on for page break changes
  useEffect(() => {
    const ws = wb.getSheetById(sheetId);
    // Re-sync from mirror on sheet change.
    setPageBreaks(wb.mirror.getPageBreaks(sheetId));

    // Subscribe to print:page-breaks-changed events
    const unsubscribe = ws.on('print:page-breaks-changed', (event) => {
      setPageBreaks({
        rowBreaks: event.rowBreaks,
        colBreaks: event.colBreaks,
      });
    });

    return unsubscribe;
  }, [wb, sheetId]);

  return {
    pageBreaks,
    hasPageBreaks: pageBreaks.rowBreaks.length > 0 || pageBreaks.colBreaks.length > 0,
  };
}
