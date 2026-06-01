/**
 * Trace Arrows Hook
 *
 * Provides formula auditing functionality - trace precedents and dependents.
 * Bridges the UI (FormulasRibbon) with the state layer (UIStore, Worksheet API).
 *
 * ARCHITECTURE
 * - Uses CellId-based arrows (stable across structure changes)
 * - Positions resolved at render time via grid index
 * - Arrows stored in Zustand UIStore (ephemeral, not persisted)
 *
 * getCellId helper uses ws._internal.getCellIdAt() (unified Worksheet API) with
 * ephemeral UUID fallback via crypto.randomUUID() for display-only IDs.
 *
 */

import { useCallback } from 'react';

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { TraceArrow } from '@mog-sdk/contracts/trace-arrows';
import { parseA1 } from '@mog/spreadsheet-utils/a1';

import { useActiveSheetId, useUIStore, useWorkbook } from '../../infra/context';
import { getTracePrecedentSources } from '../../utils/formula-auditing';
// PERFORMANCE: Use useActiveCell instead of useSelection to avoid re-renders on
// every selection change. This hook only needs activeCell, not the full selection state.
import { useActiveCell } from '../selection/use-active-cell';

// =============================================================================
// Types
// =============================================================================

export interface UseTraceArrowsReturn {
  /** Trace precedents for the current selection */
  tracePrecedents: () => void;

  /** Trace dependents for the current selection */
  traceDependents: () => void;

  /** Remove all trace arrows */
  removeAllArrows: () => void;

  /** Remove only precedent arrows */
  removePrecedentArrows: () => void;

  /** Remove only dependent arrows */
  removeDependentArrows: () => void;

  /** Check if there are any trace arrows displayed */
  hasArrows: boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useTraceArrows(): UseTraceArrowsReturn {
  const { activeCell } = useActiveCell();
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();

  // UIStore actions for trace arrows
  const addPrecedentArrows = useUIStore((s) => s.addPrecedentArrows);
  const addDependentArrows = useUIStore((s) => s.addDependentArrows);
  const clearAllTraceArrows = useUIStore((s) => s.clearAllTraceArrows);
  const removePrecedentArrowsAction = useUIStore((s) => s.removePrecedentArrows);
  const removeDependentArrowsAction = useUIStore((s) => s.removeDependentArrows);
  const hasArrows = useUIStore((s) => Object.keys(s.traceArrows).length > 0);

  /**
   * Get or create CellId for a cell position.
   * Uses ws._internal.getCellIdAt() (unified Worksheet API) with ephemeral UUID fallback.
   */
  const getCellId = useCallback(
    async (sheetId: SheetId, row: number, col: number): Promise<CellId> => {
      try {
        const ws = wb.getSheetById(sheetId);
        const existingId = await ws._internal.getCellIdAt(row, col);
        if (existingId) return toCellId(existingId);
      } catch {
        // Fallback on error
      }

      // Generate a temporary ID for display purposes
      // The cell doesn't have data, but we still want to show arrows
      return toCellId(crypto.randomUUID());
    },
    [wb],
  );

  /**
   * Trace precedents for the active cell.
   * Shows arrows from cells that this cell references.
   * Async due to ws._internal.getCellIdAt().
   */
  const tracePrecedents = useCallback(() => {
    void (async () => {
      const { row, col } = activeCell;

      // Get the CellId for the target cell (async)
      const targetCellId = await getCellId(activeSheetId, row, col);

      const ws = wb.getSheetById(activeSheetId);
      const precedents = await getTracePrecedentSources(ws, row, col);

      if (precedents.length === 0) {
        // No precedents - cell doesn't have a formula or formula has no cell refs
        return;
      }

      // Convert A1 strings to TraceArrow format (resolve all CellIds in parallel)
      const arrows: TraceArrow[] = await Promise.all(
        precedents.map(async (precedent, index) => {
          const { row: precRow, col: precCol } = precedent;
          const fromCellId = await getCellId(activeSheetId, precRow, precCol);

          return {
            id: `prec-${targetCellId}-${fromCellId}-${index}`,
            fromCellId,
            toCellId: targetCellId,
            type: 'precedent' as const,
            crossSheet: false,
            fromSheetId: activeSheetId,
            toSheetId: activeSheetId,
            level: 1,
            // Store positions as fallback for rendering when CellId lookup fails
            fromPosition: { sheetId: activeSheetId, row: precRow, col: precCol },
            toPosition: { sheetId: activeSheetId, row, col },
          };
        }),
      );

      // Add arrows to UIStore
      addPrecedentArrows(activeSheetId, targetCellId, arrows);
    })();
  }, [activeCell, activeSheetId, wb, getCellId, addPrecedentArrows]);

  /**
   * Trace dependents for the active cell.
   * Shows arrows to cells that reference this cell.
   * Async due to ws._internal.getCellIdAt().
   */
  const traceDependents = useCallback(() => {
    void (async () => {
      const { row, col } = activeCell;

      // Get the CellId for the source cell (async)
      const sourceCellId = await getCellId(activeSheetId, row, col);

      // Use Worksheet API to get dependent cells
      const ws = wb.getSheetById(activeSheetId);
      const dependents = await ws.getDependents(row, col);

      if (dependents.length === 0) {
        // No dependents - no formulas reference this cell
        return;
      }

      // Convert A1 strings to TraceArrow format (resolve all CellIds in parallel)
      const arrows: TraceArrow[] = await Promise.all(
        dependents.map(async (depAddr, index) => {
          // getDependents returns A1 strings (same-sheet only)
          const { row: depRow, col: depCol } = parseA1(depAddr);
          const toCellId = await getCellId(activeSheetId, depRow, depCol);

          return {
            id: `dep-${sourceCellId}-${toCellId}-${index}`,
            fromCellId: sourceCellId,
            toCellId,
            type: 'dependent' as const,
            crossSheet: false,
            fromSheetId: activeSheetId,
            toSheetId: activeSheetId,
            level: 1,
            // Store positions as fallback for rendering when CellId lookup fails
            fromPosition: { sheetId: activeSheetId, row, col },
            toPosition: { sheetId: activeSheetId, row: depRow, col: depCol },
          };
        }),
      );

      // Add arrows to UIStore
      addDependentArrows(activeSheetId, sourceCellId, arrows);
    })();
  }, [activeCell, activeSheetId, wb, getCellId, addDependentArrows]);

  /**
   * Remove all trace arrows.
   */
  const removeAllArrows = useCallback(() => {
    clearAllTraceArrows();
  }, [clearAllTraceArrows]);

  /**
   * Remove only precedent arrows.
   */
  const removePrecedentArrows = useCallback(() => {
    removePrecedentArrowsAction();
  }, [removePrecedentArrowsAction]);

  /**
   * Remove only dependent arrows.
   */
  const removeDependentArrows = useCallback(() => {
    removeDependentArrowsAction();
  }, [removeDependentArrowsAction]);

  return {
    tracePrecedents,
    traceDependents,
    removeAllArrows,
    removePrecedentArrows,
    removeDependentArrows,
    hasArrows,
  };
}
