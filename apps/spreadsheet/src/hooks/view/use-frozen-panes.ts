/**
 * useFrozenPanes Hook
 *
 * Provides reactive frozen panes state with EventBus subscription.
 * Subscribes to 'freeze:changed' events for real-time updates when panes change.
 *
 * Architecture:
 * - Reads: sync from `wb.mirror.getFrozenPanes(sheetId)` (kernel state mirror)
 * - Writes: Action handlers remain in ToolbarContainer (need coordinator.getSelectionSnapshot())
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import { useEffect, useState } from 'react';

import { useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

/**
 * Frozen panes state returned by the hook.
 */
export interface FrozenPanes {
  /** Number of frozen rows (0 = none) */
  rows: number;
  /** Number of frozen cols (0 = none) */
  cols: number;
}

export interface UseFrozenPanesReturn {
  /** Current frozen panes state */
  frozenPanes: FrozenPanes;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for reactive frozen panes state with EventBus subscription.
 *
 * - Sync init from `wb.mirror.getFrozenPanes(sheetId)` — first paint is correct.
 * - Live updates via the `freeze:changed` worksheet event.
 *
 * @param sheetId - The sheet ID to get frozen panes for
 * @returns Frozen panes state
 */
export function useFrozenPanes(sheetId: SheetId): UseFrozenPanesReturn {
  const wb = useWorkbook();

  // Sync init from kernel state mirror — no async fetch needed.
  const [frozenPanes, setFrozenPanes] = useState<FrozenPanes>(() =>
    wb.mirror.getFrozenPanes(sheetId),
  );

  // Subscribe to freeze:changed events for runtime updates.
  useEffect(() => {
    const ws = wb.getSheetById(sheetId);
    // Re-sync from mirror on sheet change (covers `sheetId` swap mid-mount).
    setFrozenPanes(wb.mirror.getFrozenPanes(sheetId));

    const unsubscribe = ws.on('freeze:changed', (event) => {
      setFrozenPanes({
        rows: event.newFrozenRows,
        cols: event.newFrozenCols,
      });
    });

    return unsubscribe;
  }, [wb, sheetId]);

  // Return reactive state only - action handlers stay in ToolbarContainer
  return { frozenPanes };
}
