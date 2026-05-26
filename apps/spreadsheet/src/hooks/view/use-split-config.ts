/**
 * useSplitConfig Hook
 *
 * Provides reactive split-view state from the kernel state mirror.
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { SplitViewportConfig } from '@mog-sdk/contracts/viewport-config';
import { useEffect, useState } from 'react';

import { useWorkbook } from '../../infra/context';

function readSplitConfig(
  wb: ReturnType<typeof useWorkbook>,
  sheetId: SheetId,
): SplitViewportConfig | null {
  const cfg = wb.mirror.getSplitConfig(sheetId);
  if (!cfg) return null;
  return {
    type: 'split',
    direction: cfg.direction,
    horizontalPosition: cfg.horizontalPosition,
    verticalPosition: cfg.verticalPosition,
  };
}

export interface UseSplitConfigReturn {
  splitConfig: SplitViewportConfig | null;
  isSplit: boolean;
}

/**
 * Hook for reactive split-view state.
 *
 * - Sync init from `wb.mirror.getSplitConfig(sheetId)` for correct first paint.
 * - Live updates via split config events emitted after mirror application.
 */
export function useSplitConfig(sheetId: SheetId): UseSplitConfigReturn {
  const wb = useWorkbook();
  const [splitConfig, setSplitConfig] = useState<SplitViewportConfig | null>(() =>
    readSplitConfig(wb, sheetId),
  );

  useEffect(() => {
    setSplitConfig(readSplitConfig(wb, sheetId));

    const syncForSheet = (changedSheetId: string) => {
      if (changedSheetId === sheetId) {
        setSplitConfig(readSplitConfig(wb, sheetId));
      }
    };

    const unsubCreated = wb.on('split:created', (event) => syncForSheet(event.sheetId));
    const unsubRemoved = wb.on('split:removed', (event) => syncForSheet(event.sheetId));
    const unsubPositionChanged = wb.on('split:position-changed', (event) =>
      syncForSheet(event.sheetId),
    );

    return () => {
      unsubCreated();
      unsubRemoved();
      unsubPositionChanged();
    };
  }, [wb, sheetId]);

  return { splitConfig, isSplit: splitConfig !== null };
}
