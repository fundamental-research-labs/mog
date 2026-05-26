/**
 * Use Sparkline Manager Hook
 *
 * Provides access to the SparklineManager for sparkline operations.
 * The manager is created once and memoized for the lifetime of the component.
 *
 * B1e: Rewired to ViewportReader for cell reads.
 * - Viewport cells use ws.viewport.getCellData() (sync)
 * - Off-viewport cells return null (sparklines only render for visible cells)
 *
 * Sparklines
 */

import { useCallback, useEffect, useMemo } from 'react';

import type { SheetId } from '@mog-sdk/contracts/core';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { SparklineRenderData } from '@mog-sdk/contracts/sparklines';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { IEventBus, SparklineChangedEvent } from '@mog-sdk/contracts/events';
import { SparklineManager, createSparklineManager } from '../../coordinator/sparklines';

import { useActiveSheetId, useEventBus, useWorkbook } from '../../infra/context';

const managerByWorkbook = new WeakMap<Workbook, WeakMap<IEventBus, SparklineManager>>();

function getSharedSparklineManager(workbook: Workbook, eventBus: IEventBus): SparklineManager {
  let managersByEventBus = managerByWorkbook.get(workbook);
  if (!managersByEventBus) {
    managersByEventBus = new WeakMap<IEventBus, SparklineManager>();
    managerByWorkbook.set(workbook, managersByEventBus);
  }

  let manager = managersByEventBus.get(eventBus);
  if (!manager) {
    manager = createSparklineManager({
      workbook,
      eventBus,
      getCellValue: (sheetId: string, row: number, col: number) => {
        const ws = workbook.getSheetById(sheetId as SheetId);
        const vpCell = ws.viewport.getCellData(row, col);
        if (vpCell?.value != null) {
          return vpCell.value;
        }
        return vpCell?.displayText ?? null;
      },
    });
    eventBus.on<SparklineChangedEvent>('sparkline:changed', (event) => {
      void (async () => {
        const sheetId = toSheetId(event.sheetId);
        if (event.position) {
          await manager!.refreshSparklineAtCell(sheetId, event.position.row, event.position.col);
        } else {
          await manager!.hydrateSheet(sheetId);
        }
      })();
    })();
    managersByEventBus.set(eventBus, manager);
  }

  return manager;
}

/**
 * Hook to create and manage a SparklineManager instance.
 *
 * @returns SparklineManager instance and helper methods
 *
 * @example
 * ```tsx
 * const { sparklineManager, getSparklineRenderData } = useSparklineManager();
 *
 * // Pass to coordinator
 * coordinator.setRenderContextConfig({
 * // ... other config
 * getSparklineRenderData,
 * });
 * ```
 */
export function useSparklineManager() {
  const wb = useWorkbook();
  const eventBus = useEventBus();
  const activeSheetId = useActiveSheetId();

  // The grid, dialogs, contextual toolbar, and edit dialog must share one
  // manager per document so writes hydrate the same render cache the grid uses.
  const sparklineManager = useMemo(() => {
    return getSharedSparklineManager(wb, eventBus);
  }, [wb, eventBus]);

  useEffect(() => {
    void sparklineManager.hydrateSheet(activeSheetId);
  }, [sparklineManager, activeSheetId]);

  // Create callback for getting render data at a cell
  // This is what gets passed to the render context
  // Note: This returns undefined because the actual getter needs sheetId
  // which must be curried in the component using createSparklineRenderDataGetter
  const getSparklineRenderData = useCallback(
    (_cell: CellCoord): SparklineRenderData | undefined => {
      // This is a placeholder - use createSparklineRenderDataGetter in the component
      return undefined;
    },
    [sparklineManager],
  );

  return {
    sparklineManager,
    getSparklineRenderData,
  };
}

/**
 * Create a sparkline render data getter for a specific sheet.
 * This is the function that should be passed to the coordinator.
 */
export function createSparklineRenderDataGetter(
  sparklineManager: SparklineManager,
  sheetId: SheetId,
): (cell: CellCoord) => SparklineRenderData | undefined {
  return (cell: CellCoord) => {
    return sparklineManager.getRenderDataAtCell(sheetId, cell.row, cell.col);
  };
}
