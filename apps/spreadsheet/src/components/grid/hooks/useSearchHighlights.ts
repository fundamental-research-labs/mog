/**
 * Search Highlights Hook
 *
 * Provides search highlights for Find & Replace functionality.
 * Resolves CellId-based search results to row/col positions for canvas rendering.
 *
 * ARCHITECTURE (Cell Identity):
 * - Find-replace machine stores results with CellIds (stable identity)
 * - This hook resolves CellId → position at render time via GridIndex
 * - Canvas layer receives row/col (doesn't know about CellId)
 *
 * Find & Replace
 */

import type { SearchHighlight } from '@mog-sdk/contracts/search';
import type { SheetId } from '@mog-sdk/contracts/core';
import { useCallback } from 'react';
import { useWorkbook } from '../../../infra/context';

interface UseSearchHighlightsOptions {
  coordinator: any; // SheetCoordinator type
  activeSheetId: SheetId;
}

/**
 * Hook to create a function that returns current search highlights.
 *
 * The returned function resolves CellId-based search results to positions
 * using GridIndex.createCellPositionLookup(), which handles row/column
 * insertions/deletions gracefully.
 */
export function useSearchHighlights(
  options: UseSearchHighlightsOptions,
): () => Promise<SearchHighlight[]> {
  const { coordinator, activeSheetId } = options;
  const wb = useWorkbook();

  return useCallback(async (): Promise<SearchHighlight[]> => {
    // Get find-replace actor from coordinator
    const findReplaceActor = coordinator.grid.access.actors.findReplace;
    const state = findReplaceActor.getSnapshot();

    // Don't show highlights if dialog is closed
    if (state.matches('closed')) {
      return [];
    }

    const { results, currentIndex } = state.context;
    if (results.length === 0) {
      return [];
    }

    // Collect all CellIds that need resolution for the active sheet
    const cellIds: string[] = [];
    const resultIndices: number[] = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].sheetId === activeSheetId) {
        cellIds.push(results[i].cellId);
        resultIndices.push(i);
      }
    }

    if (cellIds.length === 0) return [];

    // Batch-resolve CellIds to positions via Worksheet API
    const ws = wb.getSheetById(activeSheetId);
    const positions = await ws._internal.batchGetCellPositions(cellIds);

    const highlights: SearchHighlight[] = [];
    for (let j = 0; j < cellIds.length; j++) {
      const position = positions.get(cellIds[j]);
      if (!position) {
        // Cell was deleted - skip
        continue;
      }

      highlights.push({
        row: position.row,
        col: position.col,
        isCurrent: resultIndices[j] === currentIndex,
      });
    }

    return highlights;
  }, [coordinator, wb, activeSheetId]);
}
