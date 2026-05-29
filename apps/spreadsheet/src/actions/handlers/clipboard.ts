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
import type { Comment } from '@mog-sdk/contracts/api';
import type { ClipboardData } from '@mog-sdk/contracts/actors';
import { cellId } from '@mog-sdk/contracts/cell-identity';
import type { CellRange, CellRawValue, CellValue, SheetId } from '@mog-sdk/contracts/core';
import { ensureFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';
// Cell/merge reads and row/col visibility migrated to Worksheet API.
import { rangeToHTML, rangeToTSV } from '../../infra/utils/clipboard-utils';

import {
  buildClipboardData,
  buildSparseClipboardData,
  getClipboardCellDisplayValue,
  hasFullShapeIntent,
  unifiedPaste,
  writeToSystemClipboard,
  type ClipboardStoreReader,
  type SparseClipboardCellEntry,
} from '../../domain/clipboard';
import { blobToDataUrl } from '../../utils/blob-to-data-url';

import { pasteChartFromClipboard } from './chart-clipboard';
import { getUIStore, handled } from './handler-utils';
import { waitForPendingClipboardPaste } from '../../systems/grid-editing/coordination/pending-clipboard-paste';

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
    fetchedFormats,
    rangeSchemas,
    conditionalFormats,
    commentEntries,
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
  ]);
  formatEntries = fetchedFormats;
  const commentsByPosition = new Map<string, Comment[]>(commentEntries);

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
      if (cell) {
        const legacyCell = cell as typeof cell & {
          raw?: unknown;
          computed?: unknown;
        };
        // Map ws.getRange() shape → StoreCellData-compatible shape
        cellDataLookup.set(key, {
          raw: cell.value ?? legacyCell.raw,
          computed: cell.formatted ?? legacyCell.computed ?? cell.value,
          formula: cell.formula,
          hyperlink: cell.hyperlink,
        });
      }
      displayLookup.set(key, cell?.value != null ? String(cell.value) : '');
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

  // Export options using pre-fetched data
  const exportOptions = {
    isRowHidden: (_sid: string, row: number) => hiddenRowsMap.get(row) ?? false,
    isColHidden: (_sid: string, col: number) => hiddenColsMap.get(col) ?? false,
    getMergeInfo: (_sid: string, row: number, col: number) => {
      const merge = mergeLookup.get(`${row},${col}`);
      if (!merge) return undefined;
      return {
        startRow: merge.startRow,
        startCol: merge.startCol,
        rowSpan: merge.endRow - merge.startRow + 1,
        colSpan: merge.endCol - merge.startCol + 1,
      };
    },
  };

  return {
    commands: deps.commands.clipboard,
    buildData: (clipRanges: CellRange[]): ClipboardData => {
      const data = buildClipboardData(captureRanges, sheetId, storeReader);
      data.sourceRanges = clipRanges;
      return data;
    },
    generateTSV: (clipRanges: CellRange[]): string => {
      const range = captureRanges[0] ?? clipRanges[0];
      return rangeToTSV(
        sheetId,
        range,
        (_sid, row, col) => displayLookup.get(`${row},${col}`) ?? '',
        exportOptions,
      );
    },
    generateHTML: (clipRanges: CellRange[]): string => {
      const range = captureRanges[0] ?? clipRanges[0];
      return rangeToHTML(
        sheetId,
        range,
        (_sid, row, col) => displayLookup.get(`${row},${col}`) ?? '',
        (_sid, _row, _col) => undefined, // Format embedded in display
        undefined, // getHyperlink - not used here
        exportOptions,
      );
    },
  };
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
  createCopyCutDeps(deps, sheetId, mutableRanges)
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
  createCopyCutDeps(deps, sheetId, mutableRanges)
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

/**
 * Paste from clipboard (Ctrl+V).
 *
 * This uses unifiedPaste() which:
 * 1. Reads the system clipboard (async)
 * 2. Compares with our internal clipboard signature
 * 3. Routes to internal paste (formulas preserved) or external paste (text parsed)
 *
 * Why unifiedPaste()?
 * The keyboard shortcut intercepts Cmd+V before the browser fires native paste events.
 * This prevents useClipboardEvents.handlePaste() from running. Without unifiedPaste(),
 * we can't detect external clipboard content or properly route paste operations.
 *
 * When editing a cell, defer to native browser clipboard
 * to allow pasting text at cursor within the editor.
 *
 * Announces "Pasted" for screen reader accessibility.
 *
 */
export const PASTE: AsyncActionHandler = (deps) => runPaste(deps);

const runPaste: AsyncActionHandler = async (deps) => {
  // In edit mode, let native browser handle text paste at cursor
  if (isEditing(deps)) {
    return deferred();
  }

  // If a chart was previously copied/cut, delegate to chart paste instead of
  // cell paste. The chart clipboard is stored in UIStore independently of the
  // XState clipboard machine (which only tracks cell ranges).
  const uiStore = getUIStore(deps);
  if (uiStore.getState().hasChartInClipboard()) {
    return pasteChartFromClipboard(deps);
  }

  // Get active cell synchronously via accessors
  const activeCell = deps.accessors.selection.getActiveCell();

  // Await async operation - unifiedPaste reads system clipboard
  // and routes to appropriate paste method (internal or external)
  await unifiedPaste(activeCell, {
    getClipboardSnapshot: () => deps.accessors.clipboard.getSnapshot(),
    commands: deps.commands.clipboard,
    waitForPasteCommit: waitForPendingClipboardPaste,
    pasteImage: async (blob, anchorCell) => {
      const sheetId = deps.getActiveSheetId();
      const ws = deps.workbook.getSheetById(sheetId);
      const dataUrl = await blobToDataUrl(blob);
      await ws.pictures.add({
        src: dataUrl,
        anchorCell: { row: anchorCell.row, col: anchorCell.col },
      });
    },
  });

  // Accessibility announcement for paste operation
  uiStore.getState().announce('Pasted', 'polite');

  return handled();
};

/**
 * Clear clipboard state (ESC key in grid mode).
 *
 * G1/G2: Clears the clipboard, stopping the marching ants animation
 * and removing any pending copy/cut operation. This is the Excel-standard
 * behavior when pressing ESC while in grid mode with active clipboard.
 *
 * Item 1.2 (01-MOUSE-INPUT.md): ESC during column/row resize should cancel
 * and revert to original dimensions. Check resize state first before
 * clearing clipboard.
 *
 * Excel Parity 2.6: ESC also exits F8 (Extend Selection) and Shift+F8
 * (Add to Selection) modes.
 *
 */
export const CLEAR_CLIPBOARD: ActionHandler = (deps) => {
  // Check if we're resizing a column/row header
  // If so, cancel the resize instead of clearing clipboard
  if (deps.accessors.selection.isResizingHeader()) {
    deps.commands.selection.cancelResize();
    return handled();
  }

  // Check if draw border mode is active
  // If so, deactivate draw border mode instead of clearing clipboard
  // Uses Actor Access Layer: deps.accessors.drawBorder and deps.commands.drawBorder
  const drawBorderAccessor = deps.accessors.drawBorder;
  const drawBorderCommands = deps.commands.drawBorder;
  if (drawBorderAccessor && drawBorderCommands) {
    const isDrawBorderActive = drawBorderAccessor.isActive();

    if (isDrawBorderActive) {
      drawBorderCommands.cancel();
      return handled();
    }
  }

  // Excel Parity 2.6: Exit F8/Shift+F8 selection modes on ESC.
  // routed through the selection actor; the UIStore
  // mode slice fields were retired.
  deps.commands.selection.exitAllModes();

  // Otherwise, clear the clipboard as normal
  deps.commands.clipboard.clear();
  return handled();
};

// =============================================================================
// Paste Options Button Handlers (G3: Paste Options Button)
// =============================================================================

/**
 * Show paste options button after a paste operation.
 *
 * G3: Excel parity - Shows a floating button at the bottom-right corner
 * of the pasted range with quick access to paste options.
 *
 * @param deps - Action dependencies
 * @param payload - { range: CellRange, sheetId: SheetId }
 */
export const SHOW_PASTE_OPTIONS: ActionHandler = (deps, payload) => {
  if (!payload?.range || !payload?.sheetId) {
    return { handled: false, reason: 'disabled' };
  }
  getUIStore(deps).getState().showPasteOptionsButton(payload.range, payload.sheetId);
  return handled();
};

/**
 * Hide paste options button.
 *
 * G3: Called when user navigates away, starts editing, or presses Escape.
 */
export const HIDE_PASTE_OPTIONS: ActionHandler = (deps) => {
  getUIStore(deps).getState().hidePasteOptionsButton();
  return handled();
};

/**
 * Paste with specific option from the paste options dropdown.
 *
 * G3: Applies a specific paste option (values only, formulas, formatting, etc.)
 * to the previously pasted range.
 *
 * NOTE: This handler uses direct actor access because PASTE_WITH_OPTION is a custom
 * event that re-applies paste with different options to a specific range. This is
 * different from the standard triggerPaste() which triggers a new paste operation.
 * TODO: Add triggerPasteWithOptions(option, range, sheetId) to ClipboardCommands
 * when the PASTE_WITH_OPTION event is fully implemented in the clipboard machine.
 *
 * @param deps - Action dependencies
 * @param payload - { option: PasteOption }
 */
export const PASTE_WITH_OPTIONS: ActionHandler = (deps, payload) => {
  if (!payload?.option) {
    return { handled: false, reason: 'disabled' };
  }

  // Get the paste range from UIStore
  const uiStore = getUIStore(deps);
  const { range, sheetId } = uiStore.getState().pasteOptions;

  if (!range || !sheetId) {
    return { handled: false, reason: 'disabled' };
  }

  // Re-apply paste with different options to the specified range
  deps.commands.clipboard.pasteWithOption(payload.option, range, sheetId);

  // Hide the paste options button after applying
  uiStore.getState().hidePasteOptionsButton();

  return handled();
};

// =============================================================================
// Context Menu Paste Options (Context Menus - Item 4.3)
// =============================================================================

/**
 * Paste values only (no formulas).
 *
 * Context Menus - Item 4.3 (Paste Options Submenu)
 *
 * Uses unifiedPaste() with { values: true } to paste only cell values,
 * converting formulas to their calculated results.
 *
 */
export const PASTE_VALUES: AsyncActionHandler = async (deps) => {
  // In edit mode, let native browser handle text paste
  if (isEditing(deps)) {
    return deferred();
  }

  const activeCell = deps.accessors.selection.getActiveCell();

  await unifiedPaste(
    activeCell,
    {
      getClipboardSnapshot: () => deps.accessors.clipboard.getSnapshot(),
      commands: deps.commands.clipboard,
      waitForPasteCommit: waitForPendingClipboardPaste,
    },
    { values: true },
  );

  getUIStore(deps).getState().announce('Pasted values', 'polite');
  return handled();
};

/**
 * Paste formulas only.
 *
 * Context Menus - Item 4.3 (Paste Options Submenu)
 *
 * Uses unifiedPaste() with { formulas: true } to paste only formulas,
 * excluding formatting and other cell properties.
 *
 */
export const PASTE_FORMULAS: AsyncActionHandler = async (deps) => {
  // In edit mode, let native browser handle text paste
  if (isEditing(deps)) {
    return deferred();
  }

  const activeCell = deps.accessors.selection.getActiveCell();

  await unifiedPaste(
    activeCell,
    {
      getClipboardSnapshot: () => deps.accessors.clipboard.getSnapshot(),
      commands: deps.commands.clipboard,
      waitForPasteCommit: waitForPendingClipboardPaste,
    },
    { formulas: true },
  );

  getUIStore(deps).getState().announce('Pasted formulas', 'polite');
  return handled();
};

/**
 * Paste formatting only (no values or formulas).
 *
 * Context Menus - Item 4.3 (Paste Options Submenu)
 *
 * Uses unifiedPaste() with { formats: true } to paste only cell formatting
 * (number formats, fonts, colors, borders, etc.).
 *
 */
export const PASTE_FORMATTING: AsyncActionHandler = async (deps) => {
  // In edit mode, let native browser handle text paste
  if (isEditing(deps)) {
    return deferred();
  }

  const activeCell = deps.accessors.selection.getActiveCell();

  await unifiedPaste(
    activeCell,
    {
      getClipboardSnapshot: () => deps.accessors.clipboard.getSnapshot(),
      commands: deps.commands.clipboard,
      waitForPasteCommit: waitForPendingClipboardPaste,
    },
    { formats: true },
  );

  getUIStore(deps).getState().announce('Pasted formatting', 'polite');
  return handled();
};

/**
 * Paste with transpose (swap rows and columns).
 *
 * Context Menus - Item 4.3 (Paste Options Submenu)
 *
 * Uses unifiedPaste() with { transpose: true } to paste with rows and columns swapped.
 *
 */
export const PASTE_TRANSPOSE: AsyncActionHandler = async (deps) => {
  // In edit mode, let native browser handle text paste
  if (isEditing(deps)) {
    return deferred();
  }

  const activeCell = deps.accessors.selection.getActiveCell();

  await unifiedPaste(
    activeCell,
    {
      getClipboardSnapshot: () => deps.accessors.clipboard.getSnapshot(),
      commands: deps.commands.clipboard,
      waitForPasteCommit: waitForPendingClipboardPaste,
    },
    { transpose: true },
  );

  getUIStore(deps).getState().announce('Pasted with transpose', 'polite');
  return handled();
};

// =============================================================================
// Paste Link/Picture Options
// =============================================================================

/**
 * Paste Link - creates formula reference to copied range.
 *
 * Paste option
 * Excel: Creates a formula that references the copied cells (e.g., =Sheet1!A1)
 *
 * Uses unifiedPaste() with { pasteLink: true } to create formula references
 * to the source cells instead of copying their values.
 *
 */
export const PASTE_LINK: AsyncActionHandler = async (deps) => {
  // In edit mode, let native browser handle text paste
  if (isEditing(deps)) {
    return deferred();
  }

  const activeCell = deps.accessors.selection.getActiveCell();

  await unifiedPaste(
    activeCell,
    {
      getClipboardSnapshot: () => deps.accessors.clipboard.getSnapshot(),
      commands: deps.commands.clipboard,
      waitForPasteCommit: waitForPendingClipboardPaste,
    },
    { pasteLink: true },
  );

  getUIStore(deps).getState().announce('Pasted as link', 'polite');
  return handled();
};

/**
 * Paste as Picture - pastes clipboard content as a static image.
 *
 * Paste option
 * Excel: Creates a static image of the copied cells
 *
 * TODO: This operation creates a floating picture object, not a cell paste.
 * It requires different handling than unifiedPaste() because:
 * 1. It needs to render cells to an image (canvas/SVG snapshot)
 * 2. It creates a floating object (image) instead of pasting cell data
 * 3. The PasteSpecialOptions interface doesn't support picture options
 *
 * For now, this uses triggerPaste() which is broken for keyboard shortcuts.
 * When implementing properly, this should:
 * - Render the clipboard range to a canvas/SVG
 * - Create a floating image object at the active cell position
 * - Use deps.commands.objects or a new picture insertion API
 */
export const PASTE_AS_PICTURE: ActionHandler = (deps) => {
  // In edit mode, defer to browser
  if (isEditing(deps)) {
    return deferred();
  }

  // TODO: Implement proper picture paste using floating objects API
  // For now, this is a no-op since triggerPaste('picture') doesn't work properly
  // and PasteSpecialOptions doesn't support picture mode.
  // deps.commands.clipboard.triggerPaste('picture');

  getUIStore(deps).getState().announce('Paste as picture not yet implemented', 'polite');
  return handled();
};

/**
 * Paste as Linked Picture - pastes as an image that updates with source.
 *
 * Paste option
 * Excel: Creates a linked picture that updates when source cells change
 *
 * TODO: This operation creates a linked picture that dynamically updates
 * when the source cells change. It requires:
 * 1. Render source cells to an image
 * 2. Create a linked floating object that re-renders on source cell changes
 * 3. Track the dependency between the picture and source range
 *
 * For now, this uses triggerPaste() which is broken for keyboard shortcuts.
 * When implementing properly, this should:
 * - Store the source range reference in the picture object
 * - Subscribe to source cell changes for re-rendering
 * - Use deps.commands.objects or a new linked picture API
 */
export const PASTE_AS_LINKED_PICTURE: ActionHandler = (deps) => {
  // In edit mode, defer to browser
  if (isEditing(deps)) {
    return deferred();
  }

  // TODO: Implement proper linked picture paste using floating objects API
  // For now, this is a no-op since triggerPaste('linkedPicture') doesn't work properly
  // and PasteSpecialOptions doesn't support linked picture mode.
  // deps.commands.clipboard.triggerPaste('linkedPicture');

  getUIStore(deps).getState().announce('Paste as linked picture not yet implemented', 'polite');
  return handled();
};

// =============================================================================
// Paste Size Mismatch Dialog Handlers
// =============================================================================

/**
 * Show the paste size mismatch warning dialog.
 *
 * Called when paste data size doesn't match target selection size.
 * Stores the pending paste data so it can be executed if user confirms.
 *
 * @param deps - Action dependencies
 * @param payload - { sourceSize, targetSize, pendingData }
 */
export const SHOW_PASTE_SIZE_MISMATCH_DIALOG: ActionHandler = (deps, payload) => {
  if (!payload?.sourceSize || !payload?.targetSize || !payload?.pendingData) {
    return { handled: false, reason: 'disabled' };
  }

  getUIStore(deps)
    .getState()
    .openPasteMismatchDialog(payload.sourceSize, payload.targetSize, payload.pendingData);

  return handled();
};

/**
 * Confirm paste despite size mismatch.
 *
 * User clicked OK on the mismatch dialog.
 * Executes the pending paste operation and closes the dialog.
 */
export const CONFIRM_PASTE_SIZE_MISMATCH: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);
  const { pendingPasteData } = uiStore.getState().pasteMismatchDialog;

  if (!pendingPasteData) {
    // No pending paste data, just close the dialog
    uiStore.getState().closePasteMismatchDialog();
    return handled();
  }

  // Close the dialog first
  uiStore.getState().closePasteMismatchDialog();

  // Execute the paste via clipboard commands
  // The clipboard machine will handle the actual paste operation
  deps.commands.clipboard.paste(pendingPasteData.targetCell, true /* skipSizeCheck */);

  return handled();
};

/**
 * Cancel paste due to size mismatch.
 *
 * User clicked Cancel on the mismatch dialog.
 * Closes the dialog without executing the paste.
 */
export const CANCEL_PASTE_SIZE_MISMATCH: ActionHandler = (deps) => {
  getUIStore(deps).getState().closePasteMismatchDialog();
  return handled();
};

// =============================================================================
// Cut-Paste Overwrite Confirmation Handlers (Excel/Sheets parity)
// =============================================================================

/**
 * Confirm cut-paste overwrite.
 *
 * User clicked OK / pressed Enter on the cut-paste overwrite confirm dialog.
 * Closes the dialog and re-fires the paste with skipOverwriteCheck=true so
 * the integration proceeds straight to mutation.
 */
export const CONFIRM_PASTE_OVERWRITE: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);
  const { pendingData } = uiStore.getState().pasteOverwriteConfirmDialog;

  // Close the dialog first so the paste integration sees a clean UI state.
  uiStore.getState().closePasteOverwriteConfirmDialog();

  if (!pendingData) {
    return handled();
  }

  // Re-trigger the paste, skipping the overwrite check this time. The
  // clipboard machine is in `hasCut` (because the original paste path sent
  // PASTE_ERROR while isCut), so the PASTE event transitions back to
  // `pasting` and the integration proceeds with mutations.
  deps.commands.clipboard.paste(
    pendingData.targetCell,
    /* skipSizeCheck */ true,
    /* skipOverwriteCheck */ true,
  );

  return handled();
};

/**
 * Cancel cut-paste overwrite.
 *
 * User clicked Cancel / pressed Escape on the cut-paste overwrite confirm
 * dialog. Closes the dialog and clears the clipboard (Excel parity: cancelling
 * the overwrite cancels the cut entirely — marching-ants disappear, source
 * remains intact, destination remains intact).
 */
export const CANCEL_PASTE_OVERWRITE: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closePasteOverwriteConfirmDialog();
  // Clear the clipboard (cuts marching ants, drops cut data).
  deps.commands.clipboard.clear();
  return handled();
};
