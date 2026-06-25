/**
 * Clipboard Action Handlers
 *
 * Pure handler functions for clipboard-related actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps) => ActionResult
 * - They access actor state through deps.accessors (reads) and deps.commands (writes)
 * - They do NOT store references to deps
 *
 * This file handles:
 * - Copy (Ctrl+C)
 * - Cut (Ctrl+X)
 * - Paste (Ctrl+V)
 * - Paste Special (Ctrl+Shift+V)
 *
 * PASTE IMPLEMENTATION:
 * The PASTE handler uses unifiedPaste() which reads the system clipboard to detect
 * external copies. This is necessary because keyboard shortcuts intercept before
 * browser events, preventing native paste events from firing.
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { Comment, FilterSummaryInfo } from '@mog-sdk/contracts/api';
import type { ClipboardData } from '@mog-sdk/contracts/actors';
import { cellId } from '@mog-sdk/contracts/cell-identity';
import type {
  CellFormat,
  CellRange,
  CellRawValue,
  CellValue,
  SheetId,
} from '@mog-sdk/contracts/core';
import { ensureFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';
// Cell/merge reads and row/col visibility migrated to Worksheet API.
import {
  normalCopyRangeExportOptions,
  rangeToHTML,
  rangeToTSV,
} from '../../infra/utils/clipboard-utils';

import {
  buildClipboardData,
  buildSparseClipboardData,
  getClipboardCellDisplayValue,
  hasFullShapeIntent,
  writeToSystemClipboard,
  type ClipboardStoreReader,
  type SparseClipboardCellEntry,
} from '../../domain/clipboard';

import { getUIStore, handled } from './handler-utils';
import { trackPendingClipboardCapture } from '../../systems/grid-editing/coordination/pending-clipboard-capture';

export {
  CANCEL_PASTE_OVERWRITE,
  CANCEL_PASTE_SIZE_MISMATCH,
  CLEAR_CLIPBOARD,
  CONFIRM_PASTE_OVERWRITE,
  CONFIRM_PASTE_SIZE_MISMATCH,
  HIDE_PASTE_OPTIONS,
  PASTE,
  PASTE_AS_LINKED_PICTURE,
  PASTE_AS_PICTURE,
  PASTE_FORMATTING,
  PASTE_FORMULAS,
  PASTE_LINK,
  PASTE_TRANSPOSE,
  PASTE_VALUES,
  PASTE_WITH_OPTIONS,
  SHOW_PASTE_OPTIONS,
  SHOW_PASTE_SIZE_MISMATCH_DIALOG,
} from './clipboard-paste';

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Helper: Return a deferred result (let browser handle it).
 */
function deferred(): ActionResult {
  return { handled: false, reason: 'disabled' };
}

/**
 * Check if currently editing a cell.
 * When editing, clipboard operations should use native browser behavior
 * for text selection (not intercept cell-level copy/cut/paste).
 *
 * Returns true if the editor is in any editing state.
 */
function isEditing(deps: ActionDependencies): boolean {
  // Check for any editing state (editing, formulaEditing, imeComposing)
  return deps.accessors.editor.isEditing() || deps.accessors.editor.isImeComposing();
}

function toCellRawValue(value: CellValue | null | undefined): CellRawValue {
  if (value == null) return null;
  return typeof value === 'object' ? null : value;
}

// =============================================================================
// Clipboard Data Building Helpers (for unified copy/cut)
// =============================================================================

/**
 * Create clipboard data builder dependencies from action dependencies.
 * Used by COPY and CUT handlers to call unifiedCopy/unifiedCut.
 *
 * Pre-fetches data via Worksheet API (ws.getRange, ws.getMergedRegions,
 * ws.layout.isRowHidden, ws.layout.isColumnHidden) so that buildClipboardData and rangeToTSV/rangeToHTML
 * can consume it synchronously via lookup maps.
 */
async function createCopyCutDeps(deps: ActionDependencies, sheetId: SheetId, ranges: CellRange[]) {
  // Worksheet API for cell/merge reads and visibility checks
  const ws = deps.workbook.getSheetById(sheetId);

  if (hasFullShapeIntent(ranges)) {
    return createSparseFullShapeCopyCutDeps(deps, sheetId, ranges);
  }

  const usedRange = await ws.getUsedRange().catch(() => null);
  const captureRanges = ranges.map((range) => boundClipboardCaptureRange(range, usedRange));

  // Compute the bounding box across all ranges for batch queries
  let minRow = Infinity,
    maxRow = -Infinity,
    minCol = Infinity,
    maxCol = -Infinity;
  for (const range of captureRanges) {
    minRow = Math.min(minRow, range.startRow);
    maxRow = Math.max(maxRow, range.endRow);
    minCol = Math.min(minCol, range.startCol);
    maxCol = Math.max(maxCol, range.endCol);
  }

  // Batch-fetch cell data, merges, hidden row/col info, cell formats, validation,
  // and conditional formats in parallel.
  const numRows = maxRow - minRow + 1;
  const numCols = maxCol - minCol + 1;

  // Fetch format entries separately so a failure doesn't block the core clipboard data
  let formatEntries: Array<[string, unknown]> = [];
  const formatPromise = Promise.all(
    Array.from({ length: numRows * numCols }, (_, idx) => {
      const r = minRow + Math.floor(idx / numCols);
      const c = minCol + (idx % numCols);
      return ws.formats.get(r, c).then((f) => [`${r},${c}`, f] as [string, unknown]);
    }),
  ).catch(() => [] as Array<[string, unknown]>);

  const [
    rangeData2D,
    allMerges,
    hiddenRowsMap,
    hiddenColsMap,
    filterHiddenRows,
    fetchedFormats,
    rangeSchemas,
    conditionalFormats,
    commentEntries,
    filterSummaries,
  ] = await Promise.all([
    ws.getRange(minRow, minCol, maxRow, maxCol),
    ws.structure.getMergedRegions(),
    // Batch-check hidden rows via Worksheet API
    Promise.all(
      Array.from({ length: numRows }, (_, i) =>
        ws.layout.isRowHidden(minRow + i).then((h) => [minRow + i, h] as [number, boolean]),
      ),
    ).then((entries) => new Map(entries)),
    // Batch-check hidden cols via Worksheet API
    Promise.all(
      Array.from({ length: numCols }, (_, i) =>
        ws.layout.isColumnHidden(minCol + i).then((h) => [minCol + i, h] as [number, boolean]),
      ),
    ).then((entries) => new Map(entries)),
    ws.layout.getFilterHiddenRowsBitmap().catch(() => new Set<number>()),
    formatPromise,
    // Validation: full RangeSchema list, used by clipboard capture to
    // carry validation rules along with copied cells.
    ws._internal.getRangeSchemas().catch(() => []),
    ws.conditionalFormats.list().catch(() => []),
    Promise.all(
      Array.from({ length: numRows * numCols }, (_, idx) => {
        const r = minRow + Math.floor(idx / numCols);
        const c = minCol + (idx % numCols);
        return ws.comments
          .getForCell(r, c)
          .then((comments) => [`${r},${c}`, comments] as [string, Comment[]])
          .catch(() => [`${r},${c}`, []] as [string, Comment[]]);
      }),
    ),
    ws.filters.listSummaries({ scope: 'available' }).catch((): FilterSummaryInfo[] => []),
  ]);
  formatEntries = fetchedFormats;
  const commentsByPosition = new Map<string, Comment[]>(commentEntries);
  const copyIntersectsActiveFilter =
    filterHiddenRows.size > 0 && rangesIntersectAnyFilter(captureRanges, filterSummaries);

  // Build lookup maps for sync access from 2D CellData[][] array.
  // ws.getRange() returns {value, format, formatted} but buildClipboardCellData
  // expects StoreCellData shape with {raw, computed, formula}. Map accordingly.
  const formatLookup = new Map<string, unknown>(formatEntries);
  const cellDataLookup = new Map<string, any>();
  const displayLookup = new Map<string, string>();
  for (let r = 0; r < rangeData2D.length; r++) {
    for (let c = 0; c < rangeData2D[r].length; c++) {
      const cell = rangeData2D[r][c];
      const key = `${minRow + r},${minCol + c}`;
      const legacyCell = cell as
        | (typeof cell & {
            raw?: unknown;
            computed?: unknown;
          })
        | undefined;
      if (cell) {
        // Map ws.getRange() shape → StoreCellData-compatible shape
        cellDataLookup.set(key, {
          raw: cell.value ?? legacyCell?.raw,
          computed: cell.formatted ?? legacyCell?.computed ?? cell.value,
          formula: cell.formula,
          hyperlink: cell.hyperlink,
        });
      }
      displayLookup.set(
        key,
        cell?.formatted ??
          (legacyCell?.computed != null ? String(legacyCell.computed) : undefined) ??
          (legacyCell?.raw != null ? String(legacyCell.raw) : undefined) ??
          (cell?.value != null ? String(cell.value) : ''),
      );
    }
  }

  // Build merge lookup for getMergeInfo (MergedRegion already uses camelCase fields)
  const mergeLookup = new Map<string, (typeof allMerges)[0]>();
  for (const merge of allMerges) {
    // Only the origin cell gets merge info
    const key = `${merge.startRow},${merge.startCol}`;
    mergeLookup.set(key, merge);
  }

  // Create store reader for buildClipboardData using pre-fetched data
  const storeReader: ClipboardStoreReader = {
    getCellData: (_sid, row, col) => cellDataLookup.get(`${row},${col}`) ?? undefined,
    getCellFormat: (_sid, row, col) => formatLookup.get(`${row},${col}`) ?? undefined,
    getMergedRegions: (_sid) =>
      allMerges.map((m) => ({
        startRow: m.startRow,
        startCol: m.startCol,
        endRow: m.endRow,
        endCol: m.endCol,
        rowSpan: m.endRow - m.startRow + 1,
        colSpan: m.endCol - m.startCol + 1,
      })),
    isRowHidden: (_sid, row) => hiddenRowsMap.get(row) ?? false,
    isColHidden: (_sid, col) => hiddenColsMap.get(col) ?? false,
    getRangeSchemas: (_sid) => rangeSchemas,
    getConditionalFormats: (_sid) => conditionalFormats,
    getCommentsForCellAt: (_sid, row, col) => commentsByPosition.get(`${row},${col}`) ?? [],
  };

  const systemClipboardExportOptions = normalCopyRangeExportOptions(
    (_sid: string, row: number, col: number) => {
      const merge = mergeLookup.get(`${row},${col}`);
      if (!merge) return undefined;
      return {
        startRow: merge.startRow,
        startCol: merge.startCol,
        rowSpan: merge.endRow - merge.startRow + 1,
        colSpan: merge.endCol - merge.startCol + 1,
      };
    },
  );
  if (copyIntersectsActiveFilter) {
    systemClipboardExportOptions.isRowHidden = (_sid, row) => filterHiddenRows.has(row);
  }

  const filteredCopyStoreReader: ClipboardStoreReader = copyIntersectsActiveFilter
    ? {
        ...storeReader,
        isRowHidden: (_sid, row) => filterHiddenRows.has(row),
        isColHidden: undefined,
      }
    : storeReader;

  return {
    commands: deps.commands.clipboard,
    buildData: (clipRanges: CellRange[]): ClipboardData => {
      const data = buildClipboardData(
        captureRanges,
        sheetId,
        filteredCopyStoreReader,
        copyIntersectsActiveFilter ? { skipHidden: true } : undefined,
      );
      data.sourceRanges = clipRanges;
      return data;
    },
    generateTSV: (clipRanges: CellRange[]): string => {
      const range = captureRanges[0] ?? clipRanges[0];
      return rangeToTSV(
        sheetId,
        range,
        (_sid, row, col) => displayLookup.get(`${row},${col}`) ?? '',
        systemClipboardExportOptions,
      );
    },
    generateHTML: (clipRanges: CellRange[]): string => {
      const range = captureRanges[0] ?? clipRanges[0];
      return rangeToHTML(
        sheetId,
        range,
        (_sid, row, col) => displayLookup.get(`${row},${col}`) ?? '',
        (_sid, row, col) => formatLookup.get(`${row},${col}`) as CellFormat | undefined,
        undefined, // getHyperlink - not used here
        systemClipboardExportOptions,
      );
    },
  };
}

function rangesIntersectAnyFilter(ranges: CellRange[], filters: FilterSummaryInfo[]): boolean {
  return ranges.some((range) => filters.some((filter) => rangesIntersect(range, filter.range)));
}

function rangesIntersect(left: CellRange, right: FilterSummaryInfo['range']): boolean {
  return (
    left.startRow <= right.endRow &&
    left.endRow >= right.startRow &&
    left.startCol <= right.endCol &&
    left.endCol >= right.startCol
  );
}

async function createSparseFullShapeCopyCutDeps(
  deps: ActionDependencies,
  sheetId: SheetId,
  ranges: CellRange[],
) {
  const ws = deps.workbook.getSheetById(sheetId);
  const allComments = await ws.comments.list().catch((): Comment[] => []);
  const commentPositions = await ws._internal
    .batchGetCellPositions(allComments.map((comment) => comment.cellRef))
    .catch(() => new Map<string, { row: number; col: number }>());

  const commentsByPosition = new Map<string, Comment[]>();
  for (const comment of allComments) {
    const position = commentPositions.get(comment.cellRef);
    if (!position || !isCellInAnyRange(position.row, position.col, ranges)) continue;
    const key = `${position.row},${position.col}`;
    const existing = commentsByPosition.get(key);
    if (existing) {
      existing.push(comment);
    } else {
      commentsByPosition.set(key, [comment]);
    }
  }

  const identifiedCells = (
    await Promise.all(
      ranges.map((range) =>
        ws.getRangeWithIdentity(range.startRow, range.startCol, range.endRow, range.endCol),
      ),
    )
  ).flat();

  const entriesByPosition = new Map<string, SparseClipboardCellEntry>();
  for (const cell of identifiedCells) {
    const key = `${cell.row},${cell.col}`;
    entriesByPosition.set(key, {
      row: cell.row,
      col: cell.col,
      cellData: {
        id: cellId(cell.cellId),
        row: cell.row,
        col: cell.col,
        raw: toCellRawValue(cell.value),
        computed: cell.value ?? undefined,
        formula: cell.formulaText ? ensureFormulaA1(cell.formulaText) : undefined,
      },
    });
  }

  for (const position of commentPositions.values()) {
    if (!isCellInAnyRange(position.row, position.col, ranges)) continue;
    const key = `${position.row},${position.col}`;
    if (!entriesByPosition.has(key)) {
      entriesByPosition.set(key, {
        row: position.row,
        col: position.col,
      });
    }
  }

  const sparseEntries = Array.from(entriesByPosition.values());
  const formatEntries = await Promise.all(
    sparseEntries.map((entry) =>
      ws.formats
        .get(entry.row, entry.col)
        .then((format) => [`${entry.row},${entry.col}`, format] as [string, unknown])
        .catch(() => [`${entry.row},${entry.col}`, undefined] as [string, unknown]),
    ),
  );
  const formatLookup = new Map<string, unknown>(formatEntries);
  for (const entry of sparseEntries) {
    entry.format = formatLookup.get(
      `${entry.row},${entry.col}`,
    ) as SparseClipboardCellEntry['format'];
  }

  const [allMerges, rangeSchemas, conditionalFormats] = await Promise.all([
    ws.structure.getMergedRegions(),
    ws._internal.getRangeSchemas().catch(() => []),
    ws.conditionalFormats.list().catch(() => []),
  ]);

  const storeReader: ClipboardStoreReader = {
    getCellData: (_sid, row, col) => entriesByPosition.get(`${row},${col}`)?.cellData ?? undefined,
    getCellFormat: (_sid, row, col) =>
      (formatLookup.get(`${row},${col}`) as SparseClipboardCellEntry['format']) ?? undefined,
    getMergedRegions: (_sid) =>
      allMerges.map((m) => ({
        startRow: m.startRow,
        startCol: m.startCol,
        endRow: m.endRow,
        endCol: m.endCol,
        rowSpan: m.endRow - m.startRow + 1,
        colSpan: m.endCol - m.startCol + 1,
      })),
    getRangeSchemas: (_sid) => rangeSchemas,
    getConditionalFormats: (_sid) => conditionalFormats,
    getCommentsForCellAt: (_sid, row, col) => commentsByPosition.get(`${row},${col}`) ?? [],
  };

  return {
    commands: deps.commands.clipboard,
    buildData: (clipRanges: CellRange[]): ClipboardData =>
      buildSparseClipboardData(clipRanges, sheetId, sparseEntries, storeReader),
    generateTSV: (clipRanges: CellRange[]): string => {
      const data = buildSparseClipboardData(clipRanges, sheetId, sparseEntries, storeReader);
      return sparseClipboardDataToTSV(data);
    },
    generateHTML: (clipRanges: CellRange[]): string => {
      const data = buildSparseClipboardData(clipRanges, sheetId, sparseEntries, storeReader);
      return sparseClipboardDataToHTML(data);
    },
  };
}

function isCellInAnyRange(row: number, col: number, ranges: CellRange[]): boolean {
  return ranges.some(
    (range) =>
      row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol,
  );
}

function sparseClipboardDataToTSV(data: ClipboardData): string {
  const entries = Object.entries(data.cells).sort((a, b) => {
    const [aRow, aCol] = a[0].split(',').map(Number);
    const [bRow, bCol] = b[0].split(',').map(Number);
    return aRow - bRow || aCol - bCol;
  });
  if (entries.length === 0) return ' ';

  return entries.map(([, cell]) => getClipboardCellDisplayValue(cell)).join('\n');
}

function sparseClipboardDataToHTML(data: ClipboardData): string {
  const tsv = sparseClipboardDataToTSV(data);
  const rows = tsv.split('\n').map((value) => `<tr><td>${escapeHTML(value)}</td></tr>`);
  return `<table>${rows.join('')}</table>`;
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function boundClipboardCaptureRange(
  range: CellRange,
  usedRange: CellRange | null,
  commentPositions: Map<string, { row: number; col: number }> = new Map(),
): CellRange {
  const hasFullColumnIntent = range.isFullColumn === true;
  const hasFullRowIntent = range.isFullRow === true;
  if (!hasFullColumnIntent && !hasFullRowIntent) {
    return range;
  }

  let maxRelevantRow = usedRange ? Math.min(range.endRow, usedRange.endRow) : range.startRow;
  let maxRelevantCol = usedRange ? Math.min(range.endCol, usedRange.endCol) : range.startCol;

  for (const position of commentPositions.values()) {
    if (
      position.row >= range.startRow &&
      position.row <= range.endRow &&
      position.col >= range.startCol &&
      position.col <= range.endCol
    ) {
      maxRelevantRow = Math.max(maxRelevantRow, position.row);
      maxRelevantCol = Math.max(maxRelevantCol, position.col);
    }
  }

  return {
    ...range,
    endRow: hasFullColumnIntent ? maxRelevantRow : range.endRow,
    endCol: hasFullRowIntent ? maxRelevantCol : range.endCol,
  };
}

// =============================================================================
// Selection Size Guard
// =============================================================================

const MAX_CLIPBOARD_CELLS = 100_000;
let clipboardSettlementSequence = 0;

function totalCells(ranges: CellRange[]): number {
  let total = 0;
  for (const r of ranges) {
    total += (r.endRow - r.startRow + 1) * (r.endCol - r.startCol + 1);
  }
  return total;
}

// =============================================================================
// Clipboard Handlers
// =============================================================================

/**
 * Copy selected cells to clipboard (Ctrl+C).
 *
 * Uses ClipboardItem with promise-based Blobs to reserve the clipboard
 * slot synchronously (within user activation), then resolves the data
 * after async bridge calls complete. This avoids the user activation
 * expiry that breaks navigator.clipboard.write() after multiple awaits.
 *
 * When editing a cell, defer to native browser clipboard
 * to allow copying text selection within the editor.
 *
 * Announces "Copied to clipboard" for screen reader accessibility.
 *
 */
export const COPY: ActionHandler = (deps) => {
  // In edit mode, let native browser handle text selection copy.
  // CRITICAL: This must return synchronously so getHandledSync() sees
  // { handled: false } immediately and does NOT call preventDefault().
  if (isEditing(deps)) {
    return deferred();
  }

  // Get selection ranges synchronously via accessors
  const ranges = deps.accessors.selection.getRanges();
  if (!ranges || ranges.length === 0) {
    return handled();
  }

  // Convert readonly array to mutable for compatibility
  const mutableRanges = [...ranges] as CellRange[];
  const sheetId = deps.getActiveSheetId();

  // Guard: Prevent browser hang when copying very large selections (e.g. entire column = 1M+ rows).
  if (totalCells(mutableRanges) > MAX_CLIPBOARD_CELLS && !hasFullShapeIntent(mutableRanges)) {
    getUIStore(deps).getState().announce('Selection too large to copy', 'assertive');
    return handled();
  }

  // Bug #20 fix: ClipboardItem with promise-based Blobs.
  //
  // navigator.clipboard.write() requires transient user activation (from the
  // original keydown). Multiple awaits between keydown and clipboard write
  // cause user activation to expire, silently failing the write.
  //
  // The fix: create a deferred promise, call writeToSystemClipboard() NOW
  // (synchronous, within user activation), then resolve the promise LATER
  // after async bridge work completes. ClipboardItem accepts promise-based
  // Blob values — the browser reserves the clipboard slot immediately.
  let resolveData!: (value: { tsv: string; html: string }) => void;
  let rejectData!: (err: unknown) => void;
  const dataPromise = new Promise<{ tsv: string; html: string }>((res, rej) => {
    resolveData = res;
    rejectData = rej;
  });
  const settlementId = ++clipboardSettlementSequence;

  // SYNCHRONOUS: Reserve clipboard slot within user activation window.
  const clipboardWritePromise = writeToSystemClipboard(dataPromise);

  // ASYNC: Bridge work runs in background via .then/.catch chain.
  // Handler returns handled() synchronously below.
  const capturePromise = createCopyCutDeps(deps, sheetId, mutableRanges)
    .then((copyCutDeps) => {
      const data = copyCutDeps.buildData(mutableRanges);
      const tsv = copyCutDeps.generateTSV(mutableRanges);
      const html = copyCutDeps.generateHTML(mutableRanges);

      // Store text signature for external clipboard detection
      data.textSignature = tsv;

      // Resolve the deferred promise — clipboard now receives the data.
      resolveData({ tsv, html });

      // Update XState clipboard machine with rich data BEFORE awaiting the
      // system clipboard write. The internal state must be set even if the
      // system clipboard write fails (e.g., headless browsers, Playwright).
      copyCutDeps.commands.copy(mutableRanges, data);

      // Await the clipboard write — best-effort, failure is non-fatal.
      void clipboardWritePromise
        .then(() => {
          emitClipboardSettlement('copy', settlementId, tsv, true);
        })
        .catch((clipErr) => {
          console.warn('System clipboard write failed (copy):', clipErr);
          emitClipboardSettlement('copy', settlementId, tsv, false, clipErr);
        });

      // Accessibility announcement for copy operation
      getUIStore(deps).getState().announce('Copied to clipboard', 'polite');
    })
    .catch((err) => {
      // Reject the data promise so ClipboardItem doesn't hang forever.
      rejectData(err);
      console.error('Copy failed:', err);
    });
  trackPendingClipboardCapture(capturePromise);

  return handled();
};

/**
 * Cut selected cells to clipboard (Ctrl+X).
 *
 * Uses ClipboardItem with promise-based Blobs to reserve the clipboard
 * slot synchronously (within user activation), then resolves the data
 * after async bridge calls complete. Same pattern as COPY handler.
 *
 * When editing a cell, defer to native browser clipboard
 * to allow cutting text selection within the editor.
 *
 * Announces "Cut to clipboard" for screen reader accessibility.
 *
 */
export const CUT: ActionHandler = (deps) => {
  // In edit mode, let native browser handle text selection cut.
  // CRITICAL: This must return synchronously so getHandledSync() sees
  // { handled: false } immediately and does NOT call preventDefault().
  if (isEditing(deps)) {
    return deferred();
  }

  // Get selection ranges synchronously via accessors
  const ranges = deps.accessors.selection.getRanges();
  if (!ranges || ranges.length === 0) {
    return handled();
  }

  // Convert readonly array to mutable for compatibility
  const mutableRanges = [...ranges] as CellRange[];
  const sheetId = deps.getActiveSheetId();

  // Guard: Prevent browser hang when cutting very large selections.
  if (totalCells(mutableRanges) > MAX_CLIPBOARD_CELLS && !hasFullShapeIntent(mutableRanges)) {
    getUIStore(deps).getState().announce('Selection too large to cut', 'assertive');
    return handled();
  }

  // Bug #20 fix: Same ClipboardItem promise pattern as COPY.
  // See COPY handler for full explanation of the user activation timing issue.
  let resolveData!: (value: { tsv: string; html: string }) => void;
  let rejectData!: (err: unknown) => void;
  const dataPromise = new Promise<{ tsv: string; html: string }>((res, rej) => {
    resolveData = res;
    rejectData = rej;
  });
  const settlementId = ++clipboardSettlementSequence;

  // SYNCHRONOUS: Reserve clipboard slot within user activation window.
  const clipboardWritePromise = writeToSystemClipboard(dataPromise);

  // ASYNC: Bridge work runs in background via .then/.catch chain.
  // Handler returns handled() synchronously below.
  const capturePromise = createCopyCutDeps(deps, sheetId, mutableRanges)
    .then((copyCutDeps) => {
      const data = copyCutDeps.buildData(mutableRanges);
      const tsv = copyCutDeps.generateTSV(mutableRanges);
      const html = copyCutDeps.generateHTML(mutableRanges);

      // Store text signature for external clipboard detection
      data.textSignature = tsv;

      // Resolve the deferred promise — clipboard now receives the data.
      resolveData({ tsv, html });

      // Update XState clipboard machine with rich data BEFORE awaiting the
      // system clipboard write. The internal state must be set even if the
      // system clipboard write fails (e.g., headless browsers, Playwright).
      copyCutDeps.commands.cut(mutableRanges, data);

      // Await the clipboard write — best-effort, failure is non-fatal.
      void clipboardWritePromise
        .then(() => {
          emitClipboardSettlement('cut', settlementId, tsv, true);
        })
        .catch((clipErr) => {
          console.warn('System clipboard write failed (cut):', clipErr);
          emitClipboardSettlement('cut', settlementId, tsv, false, clipErr);
        });

      // Accessibility announcement for cut operation
      getUIStore(deps).getState().announce('Cut to clipboard', 'polite');
    })
    .catch((err) => {
      rejectData(err);
      console.error('Cut failed:', err);
    });
  trackPendingClipboardCapture(capturePromise);

  return handled();
};

function emitClipboardSettlement(
  operation: 'copy' | 'cut',
  sequence: number,
  tsv: string,
  systemClipboardWritten: boolean,
  error?: unknown,
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('mog:clipboard-settled', {
      detail: {
        operation,
        sequence,
        tsv,
        systemClipboardWritten,
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
      },
    }),
  );
}
