/**
 * Paste Store Adapter
 *
 * Adapts Worksheet/Workbook API to PasteStoreOperations interface required by clipboard paste executor.
 * This isolates the clipboard paste logic from direct store dependencies.
 *
 * All reads use ws.viewport (no Yjs).
 * - getCellData → ws.viewport.getCellData() (sync, viewport-scoped)
 * - getSheetName → pre-fetched (async at creation, sync at use)
 * - getMergesInRange → ws.viewport.getMerges() (sync, viewport-scoped)
 * - isRowHidden → pre-fetched (async at creation, sync at use)
 * - relocateCells → remains on mutations layer (write operation)
 *
 */

import type { Workbook, Worksheet } from '@mog-sdk/contracts/api';
import type { CFRuleInput } from '@mog-sdk/contracts/api';
import {
  sheetId as toSheetId,
  type CellFormat,
  type CellRange,
  type SheetId,
} from '@mog-sdk/contracts/core';
import { displayStringOrNull } from '@mog-sdk/contracts/core';
import type { PasteStoreOperations } from '../../domain/clipboard';

// =============================================================================
// Mutation Callbacks Interface
// =============================================================================

/**
 * Mutation functions injected from the coordinator layer.
 * systems/ must NOT import from coordinator/mutations/ directly.
 */
export interface PasteMutations {
  setCellValues: (
    sheetId: SheetId,
    updates: Array<{ row: number; col: number; value: string | number | boolean | null }>,
    origin?: 'user' | 'import' | 'api',
  ) => void;
  setFormat: (sheetId: SheetId, row: number, col: number, format: Partial<CellFormat>) => void;
  /**
   * Batch set formats for multiple cells that share the same format.
   * Groups by identical format to minimize IPC calls via setCellFormatForRanges.
   */
  setFormatBatch?: (
    sheetId: SheetId,
    updates: Array<{ row: number; col: number; format: Partial<CellFormat> }>,
  ) => void;
  mergeRange: (sheetId: SheetId, range: CellRange) => unknown;
  unmergeRange: (sheetId: SheetId, range: CellRange) => number;
  /**
   * Relocate cells (move operation preserving CellIds).
   * Injected from coordinator layer; no longer calls Cells.relocateCells directly.
   */
  relocateCells?: (
    sourceSheetId: SheetId,
    sourceRange: CellRange,
    targetSheetId: SheetId,
    targetCell: { row: number; col: number },
    options?: { clearTarget?: boolean },
  ) => { success: boolean; movedCellIds: string[]; error?: string };
}

/**
 * Build paste store operations adapter.
 *
 * Uses ws.viewport for reads instead of Yjs.
 * getCellData uses ws.viewport (sync); getSheetName and isRowHidden use
 * pre-fetched data (async at creation, sync at use).
 *
 * @param ws - Worksheet providing viewport reader
 * @param mutations - Mutation callbacks injected from coordinator layer
 * @param prefetched - Pre-fetched data (sheet names, hidden rows)
 * @returns PasteStoreOperations adapter instance
 */
export function buildPasteStoreOperations(
  ws: Worksheet,
  mutations: PasteMutations,
  prefetched?: PrefetchedPasteData,
): PasteStoreOperations {
  return {
    setCellValues: (sheetId, updates) => mutations.setCellValues(sheetId, updates),
    setCellFormat: (sheetId, row, col, format) => mutations.setFormat(sheetId, row, col, format),
    setCellFormatBatch: mutations.setFormatBatch
      ? (sheetId, updates) => mutations.setFormatBatch!(sheetId, updates)
      : undefined,
    getCellData: (_sheetId, row, col) => {
      // Use ws.viewport for sync cell reads
      const cell = ws.viewport.getCellData(row, col);
      if (!cell) return undefined;
      // ViewportCell has `displayText` (formatted string) and `editText`
      const valueStr = displayStringOrNull(cell.displayText) ?? undefined;
      return { raw: cell.editText ?? valueStr, computed: valueStr };
    },
    getSheetName: (sheetId) => {
      // Use pre-fetched sheet name
      const name = prefetched?.sheetNames?.get(sheetId);
      return name ?? sheetId;
    },
    mergeRange: (sheetId, startRow, startCol, endRow, endCol) => {
      // fire-and-forget, assume success
      mutations.mergeRange(sheetId, { startRow, startCol, endRow, endCol } as CellRange);
      return true;
    },
    unmergeRange: (sheetId, startRow, startCol, endRow, endCol) => {
      mutations.unmergeRange(sheetId, { startRow, startCol, endRow, endCol } as CellRange);
    },
    getMergesInRange: (_sheetId, range) => {
      // Use ws.viewport.getMerges() for sync reads (viewport-scoped)
      const allMerges = ws.viewport.getMerges();
      return allMerges
        .filter(
          (m) =>
            m.start_row <= range.endRow &&
            m.end_row >= range.startRow &&
            m.start_col <= range.endCol &&
            m.end_col >= range.startCol,
        )
        .map((m) => ({
          startRow: m.start_row,
          startCol: m.start_col,
          endRow: m.end_row,
          endCol: m.end_col,
        }));
    },
    relocateCells: (sourceSheetId, sourceRange, targetSheetId, targetRow, targetCol) => {
      // Delegate to injected mutation callback
      if (mutations.relocateCells) {
        const result = mutations.relocateCells(
          sourceSheetId,
          sourceRange,
          targetSheetId,
          { row: targetRow, col: targetCol },
          { clearTarget: true },
        );
        return {
          success: result.success,
          movedCount: result.movedCellIds.length,
          error: result.error,
        };
      }
      return { success: false, movedCount: 0, error: 'relocateCells not available' };
    },
    copyRange: async (
      _sourceSheetId,
      sourceRange,
      targetSheetId,
      targetRow,
      targetCol,
      copyType,
      skipBlanks,
      transpose,
    ) => {
      const internal = (
        ws as unknown as {
          _internal?: {
            copyRangeToSheet: (
              sourceRange: CellRange,
              targetSheetId: SheetId,
              targetRow: number,
              targetCol: number,
              copyType: 'all' | 'values' | 'formulas' | 'formats',
              skipBlanks: boolean,
              transpose: boolean,
            ) => Promise<void>;
          };
        }
      )._internal;
      if (!internal) {
        throw new Error('copyRange not available: worksheet lacks _internal API');
      }
      await internal.copyRangeToSheet(
        sourceRange,
        targetSheetId,
        targetRow,
        targetCol,
        copyType,
        skipBlanks,
        transpose,
      );
    },
    addComment: async (sheetId, row, col, content, author, options) => {
      if (sheetId !== ws.getSheetId()) {
        throw new Error('addComment target sheet does not match adapter worksheet');
      }
      const text = content.map((segment) => segment.text ?? '').join('');
      if (!text.trim()) return;

      if (options?.commentType === 'note') {
        await ws.comments.addNote(row, col, { text, author });
        return;
      }

      const comment = await ws.comments.add(row, col, { text, author });
      if (options?.resolved && comment.threadId) {
        await ws.comments.resolveThread(comment.threadId, true);
      }
    },
    createConditionalFormat: async (sheetId, ranges, rules) => {
      if (sheetId !== ws.getSheetId()) {
        throw new Error('createConditionalFormat target sheet does not match adapter worksheet');
      }
      const format = await ws.conditionalFormats.add(ranges, rules as CFRuleInput[]);
      return format.id;
    },
    // Hidden/Filtered Row Handling
    // Use pre-fetched hidden rows
    isRowHidden: (sheetId, row) => {
      const hiddenSet = prefetched?.hiddenRows?.get(sheetId);
      if (!hiddenSet) return false;
      return hiddenSet.has(row);
    },
  };
}

// =============================================================================
// Pre-fetched Data for Paste Operations
// =============================================================================

/**
 * Pre-fetched data for sync access during paste.
 * Created via prefetchPasteData() before buildPasteStoreOperations().
 */
export interface PrefetchedPasteData {
  /** Map of sheetId → sheet name */
  sheetNames: Map<string, string>;
  /** Map of sheetId → Set of hidden row indices */
  hiddenRows: Map<string, Set<number>>;
}

/**
 * Pre-fetch data needed by paste operations from Worksheet API.
 * Call this before buildPasteStoreOperations() to avoid async in sync callbacks.
 *
 * @param workbook - Workbook for unified API access
 * @param sheetIds - Sheet IDs to pre-fetch data for
 * @param maxRow - Maximum row index to check for hidden state (default: 1000)
 */
export async function prefetchPasteData(
  workbook: Workbook,
  sheetIds: string[],
  maxRow = 1000,
): Promise<PrefetchedPasteData> {
  const sheetNames = new Map<string, string>();
  const hiddenRows = new Map<string, Set<number>>();

  await Promise.all(
    sheetIds.map(async (sheetId) => {
      const ws = workbook.getSheetById(toSheetId(sheetId));

      const name = await ws.getName();
      sheetNames.set(sheetId, name ?? sheetId);

      const usedRange = await ws.getUsedRange();
      const boundsMaxRow = usedRange?.endRow ?? 0;
      const effectiveMaxRow = Math.min(boundsMaxRow, maxRow);
      const hiddenSet = new Set<number>();

      const rowPromises: Promise<boolean>[] = [];
      for (let row = 0; row <= effectiveMaxRow; row++) {
        rowPromises.push(ws.layout.isRowHidden(row));
      }
      const results = await Promise.all(rowPromises);
      for (let row = 0; row <= effectiveMaxRow; row++) {
        if (results[row]) hiddenSet.add(row);
      }

      hiddenRows.set(sheetId, hiddenSet);
    }),
  );

  return { sheetNames, hiddenRows };
}
