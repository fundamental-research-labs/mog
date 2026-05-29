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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore, useWorkbook } from '../../../infra/context';
import type { UIState } from '../../../ui-store/types';

interface UseTraceArrowsForRenderOptions {
  activeSheetId: SheetId;
}

interface UseTraceArrowsForRenderReturn {
  /** Get trace arrows for the active sheet */
  getTraceArrows: () => TraceArrow[];
  /** Resolve CellId to position for rendering arrows */
  getCellPosition: (cellId: string) => { row: number; col: number; sheet: string } | null;
}

type TraceCellPosition = { row: number; col: number; sheet: string };

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
  const positionCacheRef = useRef<Map<string, TraceCellPosition>>(new Map());
  const [positionVersion, setPositionVersion] = useState(0);

  // Get trace arrows for the active sheet from UIStore
  const traceArrowsBySheet = useUIStore((s: UIState) => s.traceArrows);

  /**
   * Get trace arrows for the active sheet.
   */
  const getTraceArrows = useCallback((): TraceArrow[] => {
    return traceArrowsBySheet[activeSheetId] ?? [];
  }, [traceArrowsBySheet, activeSheetId]);

  useEffect(() => {
    const arrows: TraceArrow[] = traceArrowsBySheet[activeSheetId] ?? [];
    const cellIds = Array.from(
      new Set<string>(arrows.flatMap((arrow) => [arrow.fromCellId, arrow.toCellId])),
    );

    if (cellIds.length === 0) {
      if (positionCacheRef.current.size > 0) {
        positionCacheRef.current = new Map();
        setPositionVersion((version) => version + 1);
      }
      return;
    }

    let cancelled = false;
    const ws = wb.getSheetById(activeSheetId);

    void ws._internal
      .batchGetCellPositions(cellIds)
      .then((positions) => {
        if (cancelled) return;

        const nextCache = new Map<string, TraceCellPosition>();
        for (const cellId of cellIds) {
          const position = positions.get(cellId);
          if (position) {
            nextCache.set(cellId, {
              row: position.row,
              col: position.col,
              sheet: activeSheetId,
            });
          }
        }

        positionCacheRef.current = nextCache;
        setPositionVersion((version) => version + 1);
      })
      .catch(() => {
        if (cancelled) return;
        positionCacheRef.current = new Map();
        setPositionVersion((version) => version + 1);
      });

    return () => {
      cancelled = true;
    };
  }, [traceArrowsBySheet, wb, activeSheetId]);

  /**
   * Resolve CellId to current position.
   * Used by TraceArrowsLayer to render arrows at correct cell locations.
   */
  const getCellPosition = useCallback(
    (cellId: string): TraceCellPosition | null => {
      return positionCacheRef.current.get(cellId) ?? null;
    },
    [positionVersion],
  );

  return {
    getTraceArrows,
    getCellPosition,
  };
}
