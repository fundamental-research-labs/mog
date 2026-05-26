/**
 * Trace Arrows Hook for Rendering
 *
 * Provides trace arrows and CellId position lookup for canvas rendering.
 * Bridges the UIStore trace arrow state to the render context.
 *
 * ARCHITECTURE (Cell Identity):
 * - UIStore stores arrows with CellIds (stable identity)
 * - This hook provides a getCellPosition callback for render-time resolution
 * - Canvas layer receives row/col via getCellPosition (doesn't know about CellId)
 *
 * Formula Auditing
 */

import type { TraceArrow } from '@mog-sdk/contracts/trace-arrows';
import type { SheetId } from '@mog-sdk/contracts/core';
import { useCallback } from 'react';
import { useUIStore, useWorkbook } from '../../../infra/context';

interface UseTraceArrowsForRenderOptions {
  activeSheetId: SheetId;
}

interface UseTraceArrowsForRenderReturn {
  /** Get trace arrows for the active sheet */
  getTraceArrows: () => TraceArrow[];
  /** Resolve CellId to position for rendering arrows */
  getCellPosition: (cellId: string) => Promise<{ row: number; col: number; sheet: string } | null>;
}

/**
 * Hook to provide trace arrows and position lookup for canvas rendering.
 *
 * The getCellPosition function resolves CellId-based arrow endpoints to
 * positions using ComputeBridge.resolveCellPositions(), which handles
 * row/column insertions/deletions gracefully.
 */
export function useTraceArrowsForRender(
  options: UseTraceArrowsForRenderOptions,
): UseTraceArrowsForRenderReturn {
  const { activeSheetId } = options;
  const wb = useWorkbook();

  // Get trace arrows for the active sheet from UIStore
  const traceArrowsBySheet = useUIStore((s) => s.traceArrows);

  /**
   * Get trace arrows for the active sheet.
   */
  const getTraceArrows = useCallback((): TraceArrow[] => {
    return traceArrowsBySheet[activeSheetId] ?? [];
  }, [traceArrowsBySheet, activeSheetId]);

  /**
   * Resolve CellId to current position.
   * Used by TraceArrowsLayer to render arrows at correct cell locations.
   */
  const getCellPosition = useCallback(
    async (cellId: string): Promise<{ row: number; col: number; sheet: string } | null> => {
      const ws = wb.getSheetById(activeSheetId);
      const positions = await ws._internal.batchGetCellPositions([cellId]);
      const position = positions.get(cellId);
      if (!position) {
        return null;
      }
      return {
        row: position.row,
        col: position.col,
        sheet: activeSheetId,
      };
    },
    [wb, activeSheetId],
  );

  return {
    getTraceArrows,
    getCellPosition,
  };
}
