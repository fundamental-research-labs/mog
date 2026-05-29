/**
 * Clipboard Hook
 *
 * Complete clipboard operations hook that wraps the XState clipboard machine
 * and provides convenient methods for copy/cut/paste operations.
 *
 * This is the SINGLE clipboard hook - all clipboard operations go through here.
 * The hook handles:
 * - XState machine state and events
 * - Building clipboard data from current selection
 * - Writing to system clipboard (for cross-app paste)
 * - Convenience methods (copySelection, cutSelection, pasteToSelection)
 *
 * All domain module reads go through the unified Worksheet API with proper async
 * pre-fetching. Browser clipboard events use navigator.clipboard.write() (modern async
 * API) instead of event.clipboardData.setData() (legacy sync API). Zero `as any` casts.
 *
 * ARCHITECTURE: Uses selectors from contracts for reactive reads and commands for writes.
 * @see docs/renderer/README.md - Clipboard Machine
 */

import { useSelector } from '@xstate/react';
import { useCallback, useEffect, useMemo, type RefObject } from 'react';

import {
  buildClipboardData,
  buildSparseClipboardData,
  getClipboardCellDisplayValue,
  hasFullShapeIntent,
  unifiedCopy,
  unifiedCut,
  unifiedPaste,
  writeToSystemClipboard,
  type ClipboardStoreReader,
  type SparseClipboardCellEntry,
  type UnifiedCopyCutDeps,
} from '../../domain/clipboard';
import {
  resolveDefaultPasteOptions,
  shouldNoopExternalFormatsPaste,
} from '../../domain/clipboard/paste-defaults';
import { readPasteDefaultsPreference } from '../../infra/state/paste-defaults-store';

import {
  EXTERNAL_SOURCE_SHEET_ID,
  type ClipboardData,
  type ExternalPastePayload,
  type PasteSpecialOptions,
} from '@mog-sdk/contracts/actors';
import type { Comment } from '@mog-sdk/contracts/api';
import { clipboardSelectors } from '../../selectors';
import type { ClipboardState } from '@mog-sdk/contracts/actors';
import { cellId } from '@mog-sdk/contracts/cell-identity';
import type { CellRange, CellRawValue, CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { ClipboardSnapshot } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { ensureFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';
import { blobToDataUrl } from '../../utils/blob-to-data-url';
import { withHandlerErrors } from '../../devtools/handler-error-boundary';
import { useActiveSheetId, useReadOnly, useWorkbook } from '../../infra/context';
import { rangeToHTML, rangeToTSV } from '../../infra/utils/clipboard-utils';
import { waitForPendingClipboardPaste } from '../../systems/grid-editing/coordination/pending-clipboard-paste';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// SELECTOR STATE SLICE
// =============================================================================

/**
 * State slice for clipboard selector - extracts only the fields needed for rendering.
 * This prevents re-renders when unrelated clipboard state changes.
 */
interface ClipboardStateSlice {
  // For getClipboardSnapshot()
  hasCopyAvailable: boolean;
  hasCut: boolean;
  cutSource: CellRange[] | null;
  copySource: CellRange[] | null;
  isPasting: boolean;
  /** Source sheet ID for sheet-scoped marching ants */
  sourceSheetId: string | null;
  // Additional fields used directly in hook return
  isPastePreview: boolean;
  marchingAntsPhase: number;
  errorMessage: string | null;
  pastePreviewTarget: CellCoord | null;
}

function normalizeClipboardSignature(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
}

function isOurClipboardData(
  clipboardState: ClipboardState,
  clipboardData: ClipboardData | null,
  systemText: string,
): boolean {
  const internalSignature = clipboardData?.textSignature
    ? normalizeClipboardSignature(clipboardData.textSignature)
    : '';
  const systemSignature = normalizeClipboardSignature(systemText);
  const hasFreshInternalClipboard =
    Boolean(clipboardData?.textSignature) &&
    clipboardData?.sourceSheetId !== EXTERNAL_SOURCE_SHEET_ID &&
    clipboardState.context.isStale !== true;

  return (
    (internalSignature === systemSignature && systemSignature !== '') || hasFreshInternalClipboard
  );
}

async function sendClipboardPasteCommand(command: () => void): Promise<void> {
  command();
  await waitForPendingClipboardPaste();
}

// =============================================================================
// EQUALITY FUNCTION
// =============================================================================

/**
 * Compare two CellRange arrays for equality.
 */
function rangesEqual(a: CellRange[] | null, b: CellRange[] | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  return a.every(
    (range, i) =>
      range.startRow === b[i].startRow &&
      range.startCol === b[i].startCol &&
      range.endRow === b[i].endRow &&
      range.endCol === b[i].endCol,
  );
}

/**
 * Compare two CellCoord values for equality.
 */
function coordEqual(a: CellCoord | null, b: CellCoord | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.row === b.row && a.col === b.col;
}

/**
 * Custom equality function for clipboard state comparison.
 * Only returns true (preventing re-render) if all tracked fields are identical.
 */
function clipboardStateEqual(a: ClipboardStateSlice, b: ClipboardStateSlice): boolean {
  return (
    a.hasCopyAvailable === b.hasCopyAvailable &&
    a.hasCut === b.hasCut &&
    a.isPasting === b.isPasting &&
    a.isPastePreview === b.isPastePreview &&
    a.marchingAntsPhase === b.marchingAntsPhase &&
    a.errorMessage === b.errorMessage &&
    a.sourceSheetId === b.sourceSheetId &&
    rangesEqual(a.cutSource, b.cutSource) &&
    rangesEqual(a.copySource, b.copySource) &&
    coordEqual(a.pastePreviewTarget, b.pastePreviewTarget)
  );
}

function toCellRawValue(value: CellValue | null | undefined): CellRawValue {
  if (value == null) return null;
  return typeof value === 'object' ? null : value;
}

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseClipboardReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Whether clipboard has copy data */
  hasCopy: boolean;

  /** Whether clipboard has cut data (shows marching ants) */
  hasCut: boolean;

  /** Whether clipboard has data (either copy or cut) */
  hasClipboard: boolean;

  /** Whether clipboard is empty */
  isEmpty: boolean;

  /** Whether currently pasting */
  isPasting: boolean;

  /** Whether showing paste preview */
  isShowingPreview: boolean;

  /** Source ranges for cut operation (for marching ants rendering) */
  cutSource: CellRange[] | null;

  /** Current marching ants animation phase (0-7) */
  marchingAntsPhase: number;

  /** Error message from failed paste */
  errorMessage: string | null;

  /** Paste preview target cell */
  pastePreviewTarget: CellCoord | null;

  /** Full snapshot for advanced usage */
  snapshot: ClipboardSnapshot;

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE METHODS (use current selection)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Copy the current selection to clipboard (async: pre-fetches data, writes to system clipboard) */
  copySelection: () => Promise<void>;

  /** Cut the current selection to clipboard (async: pre-fetches data, writes to system clipboard) */
  cutSelection: () => Promise<void>;

  /**
   * Paste clipboard data at the current active cell.
   * Returns a Promise because it reads the system clipboard to detect external copies.
   */
  pasteToSelection: () => Promise<void>;

  /**
   * Paste values only at the current active cell.
   * Returns a Promise because it reads the system clipboard to detect external copies.
   */
  pasteValues: () => Promise<void>;

  /**
   * Paste formulas only at the current active cell.
   * Returns a Promise because it reads the system clipboard to detect external copies.
   */
  pasteFormulas: () => Promise<void>;

  /**
   * Paste formats only at the current active cell.
   * Returns a Promise because it reads the system clipboard to detect external copies.
   */
  pasteFormats: () => Promise<void>;

  // ═══════════════════════════════════════════════════════════════════════════
  // LOW-LEVEL ACTIONS (explicit ranges/data)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Copy the given ranges with explicit data */
  copy: (ranges: CellRange[], data: ClipboardData) => void;

  /** Cut the given ranges with explicit data */
  cut: (ranges: CellRange[], data: ClipboardData) => void;

  /** Clear clipboard */
  clear: () => void;

  /** Paste at explicit target cell */
  paste: (targetCell: CellCoord) => void;

  /** Paste special with options at explicit target cell */
  pasteSpecial: (targetCell: CellCoord, options: PasteSpecialOptions) => void;

  /** Paste from external source (text/html from other apps) */
  pasteExternal: (payload: ExternalPastePayload) => void;

  /** Show paste preview at target */
  showPastePreview: (targetCell: CellCoord) => void;

  /** Hide paste preview */
  hidePastePreview: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Tick the marching ants animation (call in requestAnimationFrame) */
  tickMarchingAnts: () => void;
}

// =============================================================================
// HELPER: Pre-fetch Clipboard Data via Worksheet API
// =============================================================================

/**
 * Pre-fetch all data needed for clipboard operations via the ONE API.
 * Returns sync lookup factories that read from pre-fetched maps.
 *
 * This is the architecturally correct pattern (same as actions/handlers/clipboard.ts):
 * 1. Batch-fetch data asynchronously via Worksheet API
 * 2. Build sync lookup maps
 * 3. Return sync callbacks — zero `as any` casts
 *
 */
async function prefetchClipboardData(
  wb: ReturnType<typeof useWorkbook>,
  activeSheetId: SheetId,
  ranges: readonly CellRange[],
) {
  const ws = wb.getSheetById(activeSheetId);

  if (hasFullShapeIntent(ranges)) {
    return prefetchSparseClipboardData(wb, activeSheetId, ranges);
  }

  // Compute bounding box across all ranges
  let minRow = Infinity,
    maxRow = -Infinity,
    minCol = Infinity,
    maxCol = -Infinity;
  for (const range of ranges) {
    minRow = Math.min(minRow, range.startRow);
    maxRow = Math.max(maxRow, range.endRow);
    minCol = Math.min(minCol, range.startCol);
    maxCol = Math.max(maxCol, range.endCol);
  }

  const numRows = maxRow - minRow + 1;
  const numCols = maxCol - minCol + 1;

  // Batch-fetch ALL needed data in parallel via ONE API
  const [
    cellData2D,
    allMerges,
    hiddenRowEntries,
    hiddenColEntries,
    formatEntries,
    rangeSchemas,
    conditionalFormats,
    commentEntries,
  ] = await Promise.all([
    ws.getRange(minRow, minCol, maxRow, maxCol),
    ws.structure.getMergedRegions(),
    // Hidden rows
    Promise.all(
      Array.from({ length: numRows }, (_, i) =>
        ws.layout.isRowHidden(minRow + i).then((h) => [minRow + i, h] as [number, boolean]),
      ),
    ),
    // Hidden cols
    Promise.all(
      Array.from({ length: numCols }, (_, i) =>
        ws.layout.isColumnHidden(minCol + i).then((h) => [minCol + i, h] as [number, boolean]),
      ),
    ),
    // Formats — batch fetch per cell
    Promise.all(
      Array.from({ length: numRows * numCols }, (_, idx) => {
        const r = minRow + Math.floor(idx / numCols);
        const c = minCol + (idx % numCols);
        return ws.formats.get(r, c).then((f) => [`${r},${c}`, f] as [string, any]);
      }),
    ),
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

  // Build sync lookup maps
  const cellLookup = new Map<string, any>();
  const displayLookup = new Map<string, string>();
  for (let r = 0; r < cellData2D.length; r++) {
    for (let c = 0; c < (cellData2D[r]?.length ?? 0); c++) {
      const cell = cellData2D[r][c];
      const key = `${minRow + r},${minCol + c}`;
      cellLookup.set(key, cell);
      displayLookup.set(key, cell?.formatted ?? (cell?.value != null ? String(cell.value) : ''));
    }
  }

  const formatLookup = new Map<string, any>(formatEntries);
  const hiddenRowSet = new Set(hiddenRowEntries.filter(([, h]) => h).map(([r]) => r));
  const hiddenColSet = new Set(hiddenColEntries.filter(([, h]) => h).map(([c]) => c));
  const commentsByPosition = new Map<string, Comment[]>(commentEntries);

  // Build merge origin lookup for export options
  const mergeLookup = new Map<
    string,
    { startRow: number; startCol: number; rowSpan: number; colSpan: number }
  >();
  for (const merge of allMerges) {
    mergeLookup.set(`${merge.startRow},${merge.startCol}`, {
      startRow: merge.startRow,
      startCol: merge.startCol,
      rowSpan: merge.endRow - merge.startRow + 1,
      colSpan: merge.endCol - merge.startCol + 1,
    });
  }

  // Return sync factories — all callbacks read from pre-fetched maps
  const storeReader: ClipboardStoreReader = {
    getCellData: (_sid, row, col) => cellLookup.get(`${row},${col}`) ?? undefined,
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
    isRowHidden: (_sid, row) => hiddenRowSet.has(row),
    isColHidden: (_sid, col) => hiddenColSet.has(col),
    getRangeSchemas: (_sid) => rangeSchemas,
    getConditionalFormats: (_sid) => conditionalFormats,
    getCommentsForCellAt: (_sid, row, col) => commentsByPosition.get(`${row},${col}`) ?? [],
  };

  const exportOptions = {
    isRowHidden: (_sid: string, row: number) => hiddenRowSet.has(row),
    isColHidden: (_sid: string, col: number) => hiddenColSet.has(col),
    getMergeInfo: (_sid: string, row: number, col: number) => mergeLookup.get(`${row},${col}`),
  };

  const getDisplayValue = (_sid: string, row: number, col: number) =>
    displayLookup.get(`${row},${col}`) ?? '';

  const getFormat = (_sid: string, _row: number, _col: number) =>
    formatLookup.get(`${_row},${_col}`) ?? undefined;

  const buildData = (clipRanges: CellRange[]) =>
    buildClipboardData(clipRanges, activeSheetId, storeReader);
  const generateTSV = (clipRanges: CellRange[]) => {
    const range = clipRanges[0] ?? ranges[0];
    return range ? rangeToTSV(activeSheetId, range, getDisplayValue, exportOptions) : '';
  };
  const generateHTML = (clipRanges: CellRange[]) => {
    const range = clipRanges[0] ?? ranges[0];
    return range
      ? rangeToHTML(activeSheetId, range, getDisplayValue, getFormat, undefined, exportOptions)
      : '';
  };

  return {
    storeReader,
    exportOptions,
    getDisplayValue,
    getFormat,
    buildData,
    generateTSV,
    generateHTML,
  };
}

async function prefetchSparseClipboardData(
  wb: ReturnType<typeof useWorkbook>,
  activeSheetId: SheetId,
  ranges: readonly CellRange[],
) {
  const ws = wb.getSheetById(activeSheetId);
  const mutableRanges = [...ranges] as CellRange[];
  const allComments = await ws.comments.list().catch((): Comment[] => []);
  const commentPositions = await ws._internal
    .batchGetCellPositions(allComments.map((comment) => comment.cellRef))
    .catch(() => new Map<string, { row: number; col: number }>());
  const commentsByPosition = new Map<string, Comment[]>();
  for (const comment of allComments) {
    const position = commentPositions.get(comment.cellRef);
    if (!position || !isCellInAnyRange(position.row, position.col, mutableRanges)) continue;
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
      mutableRanges.map((range) =>
        ws.getRangeWithIdentity(range.startRow, range.startCol, range.endRow, range.endCol),
      ),
    )
  ).flat();

  const entriesByPosition = new Map<string, SparseClipboardCellEntry>();
  for (const cell of identifiedCells) {
    entriesByPosition.set(`${cell.row},${cell.col}`, {
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
    if (!isCellInAnyRange(position.row, position.col, mutableRanges)) continue;
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

  const buildData = (clipRanges: CellRange[]) =>
    buildSparseClipboardData(clipRanges, activeSheetId, sparseEntries, storeReader);
  const generateTSV = (clipRanges: CellRange[]) => sparseClipboardDataToTSV(buildData(clipRanges));
  const generateHTML = (clipRanges: CellRange[]) =>
    sparseClipboardDataToHTML(buildData(clipRanges));

  return {
    storeReader,
    exportOptions: {},
    getDisplayValue: () => '',
    getFormat: () => undefined,
    buildData,
    generateTSV,
    generateHTML,
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

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for clipboard operations.
 *
 * Provides both convenience methods (copySelection, cutSelection, pasteToSelection)
 * and low-level methods (copy, cut, paste) for advanced use cases.
 *
 * @example
 * ```tsx
 * function ClipboardButtons() {
 * const { copySelection, cutSelection, pasteToSelection, hasClipboard } = useClipboard;
 *
 * return (
 * <>
 * <button onClick={copySelection}>Copy</button>
 * <button onClick={cutSelection}>Cut</button>
 * <button onClick={pasteToSelection} disabled={!hasClipboard}>Paste</button>
 * </>
 * );
 * }
 * ```
 */
export function useClipboard(): UseClipboardReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.clipboard;
  // Performance: NO selection subscriptions here - clipboard callbacks read on-demand
  // via coordinator.grid.getSelectionSnapshot() when invoked. This prevents re-renders
  // during high-frequency selection changes (60Hz during drag).
  // @see Architecture Section 15: Remove high-frequency subscriptions from low-frequency UI
  // @see Architecture Section 18: Handlers use point-in-time reads, not reactive subscriptions
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const readOnly = useReadOnly();

  // Get pre-created commands from the grid system (stable references)
  const commands = coordinator.grid.access.commands.clipboard;

  // Subscribe to ONLY the fields we need with custom equality
  // This prevents re-renders when unrelated clipboard state changes
  // (e.g., internal state transitions that don't affect rendered output)
  const stateSlice = useSelector(
    actor,
    (state): ClipboardStateSlice => ({
      hasCopyAvailable: clipboardSelectors.hasCopyAvailable(state as ClipboardState),
      hasCut: clipboardSelectors.hasCut(state as ClipboardState),
      cutSource: clipboardSelectors.cutSource(state as ClipboardState),
      copySource: clipboardSelectors.copySource(state as ClipboardState),
      isPasting: clipboardSelectors.isPasting(state as ClipboardState),
      sourceSheetId: clipboardSelectors.sourceSheetId(state as ClipboardState),
      isPastePreview: clipboardSelectors.isPastePreview(state as ClipboardState),
      marchingAntsPhase: clipboardSelectors.marchingAntsPhase(state as ClipboardState),
      errorMessage: clipboardSelectors.errorMessage(state as ClipboardState),
      pastePreviewTarget: clipboardSelectors.pastePreviewTarget(state as ClipboardState),
    }),
    clipboardStateEqual,
  );

  // Derive snapshot from the state slice (no longer needs full state)
  const snapshot: ClipboardSnapshot = useMemo(
    () => ({
      hasCopy: stateSlice.hasCopyAvailable,
      hasCut: stateSlice.hasCut,
      cutSource: stateSlice.cutSource,
      copySource: stateSlice.copySource,
      isPasting: stateSlice.isPasting,
      sourceSheetId: stateSlice.sourceSheetId,
    }),
    [stateSlice],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // LOW-LEVEL ACTIONS (use commands instead of actor.send)
  // ═══════════════════════════════════════════════════════════════════════════

  const copy = useMemo(
    () => (ranges: CellRange[], data: ClipboardData) => {
      commands.copy(ranges, data);
    },
    [commands],
  );

  const cut = useMemo(
    () => (ranges: CellRange[], data: ClipboardData) => {
      commands.cut(ranges, data);
    },
    [commands],
  );

  const clear = useMemo(
    () => () => {
      commands.clear();
    },
    [commands],
  );

  const paste = useMemo(
    () => (targetCell: CellCoord) => {
      commands.paste(targetCell);
    },
    [commands],
  );

  const pasteSpecial = useMemo(
    () => (targetCell: CellCoord, options: PasteSpecialOptions) => {
      commands.pasteSpecial(targetCell, options);
    },
    [commands],
  );

  const pasteExternal = useMemo(
    () => (payload: ExternalPastePayload) => {
      commands.externalPaste(payload);
    },
    [commands],
  );

  const showPastePreview = useMemo(
    () => (targetCell: CellCoord) => {
      commands.showPastePreview(targetCell);
    },
    [commands],
  );

  const hidePastePreview = useMemo(
    () => () => {
      commands.hidePastePreview();
    },
    [commands],
  );

  const tickMarchingAnts = useMemo(
    () => () => {
      commands.tickMarchingAnts();
    },
    [commands],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE METHODS (use commands instead of actor.send)
  // ═══════════════════════════════════════════════════════════════════════════

  const copySelection = useCallback(async () => {
    // / O-A: surface fire-and-forget rejections in __dt.recentErrors
    // tagged 'handler:COPY' instead of dying silent at the React boundary.
    return withHandlerErrors('COPY', async () => {
      // On-demand read: Get selection state only when the copy action is invoked
      const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
      const ranges = selectionSnapshot.ranges;
      if (!ranges || ranges.length === 0) return;

      const mutableRanges = [...ranges] as CellRange[];
      // Pre-fetch all data via ONE API — proper async, zero casts
      const prefetched = await prefetchClipboardData(wb, activeSheetId, ranges);

      const deps: UnifiedCopyCutDeps = {
        commands,
        buildData: prefetched.buildData,
        generateTSV: prefetched.generateTSV,
        generateHTML: prefetched.generateHTML,
      };

      await unifiedCopy(mutableRanges, deps);
    });
  }, [coordinator, activeSheetId, wb, commands]);

  const cutSelection = useCallback(async () => {
    if (readOnly) return; // Read-only mode: block cut
    // / O-A: surface fire-and-forget rejections in __dt.recentErrors
    // tagged 'handler:CUT'.
    return withHandlerErrors('CUT', async () => {
      // On-demand read: Get selection state only when the cut action is invoked
      const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
      const ranges = selectionSnapshot.ranges;
      if (!ranges || ranges.length === 0) return;

      const mutableRanges = [...ranges] as CellRange[];
      // Pre-fetch all data via ONE API — proper async, zero casts
      const prefetched = await prefetchClipboardData(wb, activeSheetId, ranges);

      const deps: UnifiedCopyCutDeps = {
        commands,
        buildData: prefetched.buildData,
        generateTSV: prefetched.generateTSV,
        generateHTML: prefetched.generateHTML,
      };

      await unifiedCut(mutableRanges, deps);
    });
  }, [coordinator, activeSheetId, wb, commands, readOnly]);

  // Paste callbacks use unified paste logic that reads the system clipboard
  // to detect external copies. This ensures consistent behavior across all paste methods.

  const pasteToSelection = useCallback(async (): Promise<void> => {
    if (readOnly) return; // Read-only mode: block paste
    // / O-A: surface fire-and-forget rejections (e.g. compute bridge
    // throws inside `unifiedPaste`) in __dt.recentErrors as 'handler:PASTE'.
    return withHandlerErrors('PASTE', async () => {
      const activeCell = coordinator.grid.getSelectionSnapshot().activeCell;
      await unifiedPaste(activeCell, {
        getClipboardSnapshot: () => actor.getSnapshot() as ClipboardState,
        commands,
        waitForPasteCommit: waitForPendingClipboardPaste,
        pasteImage: async (blob, anchorCell) => {
          const ws = wb.getSheetById(activeSheetId);
          const dataUrl = await blobToDataUrl(blob);
          await ws.pictures.add({
            src: dataUrl,
            anchorCell: { row: anchorCell.row, col: anchorCell.col },
          });
        },
      });
    });
  }, [coordinator, actor, commands, readOnly, wb, activeSheetId]);

  const pasteValues = useCallback(async (): Promise<void> => {
    if (readOnly) return; // Read-only mode: block paste
    return withHandlerErrors('PASTE_VALUES', async () => {
      const activeCell = coordinator.grid.getSelectionSnapshot().activeCell;
      await unifiedPaste(
        activeCell,
        {
          getClipboardSnapshot: () => actor.getSnapshot() as ClipboardState,
          commands,
          waitForPasteCommit: waitForPendingClipboardPaste,
        },
        { values: true },
      );
    });
  }, [coordinator, actor, commands, readOnly]);

  const pasteFormulas = useCallback(async (): Promise<void> => {
    if (readOnly) return; // Read-only mode: block paste
    return withHandlerErrors('PASTE_FORMULAS', async () => {
      const activeCell = coordinator.grid.getSelectionSnapshot().activeCell;
      await unifiedPaste(
        activeCell,
        {
          getClipboardSnapshot: () => actor.getSnapshot() as ClipboardState,
          commands,
          waitForPasteCommit: waitForPendingClipboardPaste,
        },
        { formulas: true },
      );
    });
  }, [coordinator, actor, commands, readOnly]);

  const pasteFormats = useCallback(async (): Promise<void> => {
    if (readOnly) return; // Read-only mode: block paste
    return withHandlerErrors('PASTE_FORMATTING', async () => {
      const activeCell = coordinator.grid.getSelectionSnapshot().activeCell;
      await unifiedPaste(
        activeCell,
        {
          getClipboardSnapshot: () => actor.getSnapshot() as ClipboardState,
          commands,
          waitForPasteCommit: waitForPendingClipboardPaste,
        },
        { formats: true },
      );
    });
  }, [coordinator, actor, commands, readOnly]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE (using stateSlice instead of full state)
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // State - using stateSlice (already extracted via granular selector)
      hasCopy: snapshot.hasCopy,
      hasCut: snapshot.hasCut,
      hasClipboard: snapshot.hasCopy || snapshot.hasCut,
      isEmpty: !snapshot.hasCopy && !snapshot.hasCut,
      isPasting: snapshot.isPasting,
      isShowingPreview: stateSlice.isPastePreview,
      cutSource: snapshot.cutSource,
      marchingAntsPhase: stateSlice.marchingAntsPhase,
      errorMessage: stateSlice.errorMessage,
      pastePreviewTarget: stateSlice.pastePreviewTarget,
      snapshot,

      // Convenience methods
      copySelection,
      cutSelection,
      pasteToSelection,
      pasteValues,
      pasteFormulas,
      pasteFormats,

      // Low-level actions
      copy,
      cut,
      clear,
      paste,
      pasteSpecial,
      pasteExternal,
      showPastePreview,
      hidePastePreview,

      // Animation actions
      tickMarchingAnts,
    }),
    [
      snapshot,
      stateSlice,
      copySelection,
      cutSelection,
      pasteToSelection,
      pasteValues,
      pasteFormulas,
      pasteFormats,
      copy,
      cut,
      clear,
      paste,
      pasteSpecial,
      pasteExternal,
      showPastePreview,
      hidePastePreview,
      tickMarchingAnts,
    ],
  );
}

// =============================================================================
// CLIPBOARD EVENTS HOOK - Browser Event Handling
// =============================================================================

/**
 * Options for useClipboardEvents hook.
 */
export interface UseClipboardEventsOptions {
  /** Whether clipboard event handling is enabled */
  enabled?: boolean;
  /** Ref to the container element that receives clipboard events */
  containerRef: RefObject<HTMLElement | null>;
  /** Callback after successful paste */
  onPaste?: (cellCount: number) => void;
  /** Callback after successful copy */
  onCopy?: () => void;
  /** Callback after successful cut */
  onCut?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Return type for useClipboardEvents hook.
 */
export interface UseClipboardEventsReturn {
  /** Whether the hook is actively listening for events */
  isActive: boolean;
  /** Programmatically paste from system clipboard */
  pasteFromSystemClipboard: () => Promise<number>;
}

/**
 * Hook for handling native browser clipboard events (copy, cut, paste).
 *
 * This hook complements useClipboard by handling clipboard events from the browser
 * (right-click menu, Edit menu) rather than just programmatic operations.
 *
 * All operations flow through the XState clipboard machine via useClipboard.
 *
 * @example
 * ```tsx
 * function Grid() {
 * const containerRef = useRef<HTMLDivElement>(null);
 * useClipboardEvents({ containerRef });
 *
 * return <div ref={containerRef} tabIndex={0}>...</div>;
 * }
 * ```
 */
export function useClipboardEvents(options: UseClipboardEventsOptions): UseClipboardEventsReturn {
  const { enabled = true, containerRef, onPaste, onCopy, onCut, onError } = options;

  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.clipboard;
  // Performance: NO selection subscriptions here - event handlers read on-demand
  // via coordinator.grid.getSelectionSnapshot() when invoked. This prevents re-renders
  // during high-frequency selection changes (60Hz during drag).
  // @see Architecture Section 15: Remove high-frequency subscriptions from low-frequency UI
  // @see Architecture Section 18: Handlers use point-in-time reads, not reactive subscriptions
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const readOnly = useReadOnly();

  // Get pre-created commands from the grid system (stable references)
  const commands = coordinator.grid.access.commands.clipboard;

  // ═══════════════════════════════════════════════════════════════════════════
  // COPY HANDLER (use commands instead of actor.send)
  // ═══════════════════════════════════════════════════════════════════════════

  const handleCopy = useCallback(
    async (event: ClipboardEvent) => {
      // Don't intercept if focused element is an input/textarea
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) {
        let selectedText = '';
        if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
          const start = activeEl.selectionStart ?? 0;
          const end = activeEl.selectionEnd ?? 0;
          selectedText = activeEl.value.substring(start, end);
        } else {
          selectedText = window.getSelection()?.toString() ?? '';
        }
        if (selectedText) {
          commands.editModeCopy(selectedText);
        }
        return;
      }

      event.preventDefault();

      // / O-A: handler-side errors flow into __dt.recentErrors as
      // 'handler:COPY' even though the local try/catch then swallows them
      // through `onError` — a `recentErrors` entry pinpoints the originating
      // file:line in the failure record.
      try {
        // On-demand read: Get selection state only when the copy event fires
        const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
        const ranges = selectionSnapshot.ranges;
        if (!ranges || ranges.length === 0) return;

        const mutableRanges = [...ranges] as CellRange[];
        // Pre-fetch all data via ONE API — proper async, zero casts
        const prefetched = await prefetchClipboardData(wb, activeSheetId, ranges);

        // Build clipboard data from pre-fetched lookups (sync)
        const data = prefetched.buildData(mutableRanges);

        // Generate clipboard formats from pre-fetched lookups (sync)
        const tsv = prefetched.generateTSV(mutableRanges);
        const html = prefetched.generateHTML(mutableRanges);

        // Store text signature for external clipboard detection
        data.textSignature = tsv;

        // Write to system clipboard via modern async API
        await writeToSystemClipboard({ tsv, html });

        // Update XState clipboard machine using commands
        commands.copy(mutableRanges, data);
        onCopy?.();
      } catch (err) {
        // Push to devtools error buffer first so failure records have
        // a `recentErrors` entry, then fall through to the existing
        // `onError` callback path so UX behaviour is unchanged.
        (
          window as { __dt?: { captureError?: (s: string, e: unknown) => void } }
        ).__dt?.captureError?.('handler:COPY', err);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [coordinator, activeSheetId, wb, commands, onCopy, onError],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CUT HANDLER (use commands instead of actor.send)
  // ═══════════════════════════════════════════════════════════════════════════

  const handleCut = useCallback(
    async (event: ClipboardEvent) => {
      // Read-only mode: block cut
      if (readOnly) {
        event.preventDefault();
        return;
      }
      // Don't intercept if focused element is an input/textarea
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) {
        let selectedText = '';
        if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
          const start = activeEl.selectionStart ?? 0;
          const end = activeEl.selectionEnd ?? 0;
          selectedText = activeEl.value.substring(start, end);
        } else {
          selectedText = window.getSelection()?.toString() ?? '';
        }
        if (selectedText) {
          commands.editModeCopy(selectedText);
        }
        return;
      }

      event.preventDefault();

      try {
        // On-demand read: Get selection state only when the cut event fires
        const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
        const ranges = selectionSnapshot.ranges;
        if (!ranges || ranges.length === 0) return;

        const mutableRanges = [...ranges] as CellRange[];
        // Pre-fetch all data via ONE API — proper async, zero casts
        const prefetched = await prefetchClipboardData(wb, activeSheetId, ranges);

        // Build clipboard data from pre-fetched lookups (sync)
        const data = prefetched.buildData(mutableRanges);

        // Generate clipboard formats from pre-fetched lookups (sync)
        const tsv = prefetched.generateTSV(mutableRanges);
        const html = prefetched.generateHTML(mutableRanges);

        // Store text signature for external clipboard detection
        data.textSignature = tsv;

        // Write to system clipboard via modern async API
        await writeToSystemClipboard({ tsv, html });

        // Update XState clipboard machine using commands
        commands.cut(mutableRanges, data);
        onCut?.();
      } catch (err) {
        (
          window as { __dt?: { captureError?: (s: string, e: unknown) => void } }
        ).__dt?.captureError?.('handler:CUT', err);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [coordinator, activeSheetId, wb, commands, onCut, onError, readOnly],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PASTE HANDLER (use commands and selectors instead of actor.send/context)
  // ═══════════════════════════════════════════════════════════════════════════

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      // Read-only mode: block paste
      if (readOnly) {
        event.preventDefault();
        return;
      }
      // Don't intercept if focused element is an input/textarea
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) return;

      event.preventDefault();

      try {
        // On-demand read: Get activeCell only when the paste event fires
        const activeCell = coordinator.grid.getSelectionSnapshot().activeCell;

        // Get system clipboard text for signature comparison
        const systemText = event.clipboardData?.getData('text/plain') ?? '';

        // Actor Access Layer: Point-in-time read (similar to action handler pattern)
        // This is inside an event handler callback, not a reactive subscription.
        // The read happens once when the paste event fires, then the handler exits.
        const clipboardState = actor.getSnapshot();
        const clipboardData = clipboardSelectors.data(clipboardState);

        // Compare system clipboard with our text signature to detect external copies
        // - If they match: user is pasting our copy → use rich internal data (formulas, formats)
        // - If they differ: user copied from another app → parse external clipboard
        const isOurClipboard = isOurClipboardData(clipboardState, clipboardData, systemText);

        if (clipboardData && isOurClipboard) {
          // System clipboard matches what we wrote - use rich internal data
          const resolved = resolveDefaultPasteOptions(readPasteDefaultsPreference(), {
            sourceKind: clipboardSelectors.isCut(clipboardState) ? 'internal-cut' : 'internal-copy',
            hasInternalRichData: true,
          });
          if (resolved.appliesDefault) {
            await sendClipboardPasteCommand(() =>
              commands.pasteSpecial(activeCell, resolved.options),
            );
          } else {
            await sendClipboardPasteCommand(() => commands.paste(activeCell));
          }
          // Count cells from internal clipboard
          if (clipboardData.sourceRanges && clipboardData.sourceRanges.length > 0) {
            const range = clipboardData.sourceRanges[0];
            const count = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
            onPaste?.(count);
          }
          return;
        }

        // System clipboard differs from our signature - user copied from external app
        // Use the text we already retrieved for signature comparison
        let text = systemText;
        const html = event.clipboardData?.getData('text/html');

        // If no text from event, try navigator.clipboard
        if (!text) {
          try {
            text = await navigator.clipboard.readText();
          } catch {
            // Clipboard access denied - nothing to paste
          }
        }

        // Hand external clipboard payloads to the clipboard machine exactly
        // once. The machine owns parsing/normalization before paste execution.
        if (text || html) {
          const resolved = resolveDefaultPasteOptions(readPasteDefaultsPreference(), {
            sourceKind: html ? 'external-html' : 'external-text',
            hasExternalHtml: Boolean(html),
            hasExternalText: Boolean(text),
          });
          const resolvedOptions = resolved.appliesDefault ? resolved.options : undefined;
          if (shouldNoopExternalFormatsPaste(resolvedOptions, html || undefined)) return;
          await sendClipboardPasteCommand(() =>
            commands.externalPaste({
              text,
              targetCell: activeCell,
              html: html || undefined,
              options: resolvedOptions,
            }),
          );
          onPaste?.(1);
          return;
        }

        // Image-only paste: clipboardData has image files but no cell text/HTML.
        // Routing priority matches unifiedPaste (text/HTML wins when both present).
        if (!text && !html) {
          const files = event.clipboardData?.files;
          if (files && files.length > 0) {
            const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'));
            if (imageFile) {
              const ws = wb.getSheetById(activeSheetId);
              const dataUrl = await blobToDataUrl(imageFile);
              await ws.pictures.add({
                src: dataUrl,
                anchorCell: { row: activeCell.row, col: activeCell.col },
              });
              onPaste?.(1);
              return;
            }
          }
        }
      } catch (err) {
        (
          window as { __dt?: { captureError?: (s: string, e: unknown) => void } }
        ).__dt?.captureError?.('handler:PASTE', err);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [coordinator, actor, commands, onPaste, onError, readOnly, wb, activeSheetId],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PROGRAMMATIC PASTE (for keyboard shortcuts) - use commands and selectors
  // ═══════════════════════════════════════════════════════════════════════════

  const pasteFromSystemClipboard = useCallback(async (): Promise<number> => {
    if (readOnly) return 0; // Read-only mode: block paste
    // On-demand read: Get activeCell only when pasteFromSystemClipboard is called
    const activeCell = coordinator.grid.getSelectionSnapshot().activeCell;

    // Read system clipboard text for signature comparison
    let systemText = '';
    try {
      systemText = await navigator.clipboard.readText();
    } catch {
      // Clipboard access denied - will fall through to return 0
    }

    // Actor Access Layer: Point-in-time read (similar to action handler pattern)
    // This is inside a callback function, not a reactive subscription.
    // The read happens once when pasteFromSystemClipboard is called, then exits.
    const clipboardState = actor.getSnapshot();
    const clipboardData = clipboardSelectors.data(clipboardState);

    // Compare system clipboard with our text signature to detect external copies
    const isOurClipboard = isOurClipboardData(clipboardState, clipboardData, systemText);

    if (clipboardData && isOurClipboard) {
      // System clipboard matches what we wrote - use rich internal data
      const resolved = resolveDefaultPasteOptions(readPasteDefaultsPreference(), {
        sourceKind: clipboardSelectors.isCut(clipboardState) ? 'internal-cut' : 'internal-copy',
        hasInternalRichData: true,
      });
      if (resolved.appliesDefault) {
        await sendClipboardPasteCommand(() => commands.pasteSpecial(activeCell, resolved.options));
      } else {
        await sendClipboardPasteCommand(() => commands.paste(activeCell));
      }
      if (clipboardData.sourceRanges && clipboardData.sourceRanges.length > 0) {
        const range = clipboardData.sourceRanges[0];
        return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
      }
      return 0;
    }

    // System clipboard differs - user copied from external app
    const text = systemText;

    if (text) {
      const resolved = resolveDefaultPasteOptions(readPasteDefaultsPreference(), {
        sourceKind: 'external-text',
        hasExternalText: true,
      });
      const resolvedOptions = resolved.appliesDefault ? resolved.options : undefined;
      if (shouldNoopExternalFormatsPaste(resolvedOptions)) return 0;
      await sendClipboardPasteCommand(() =>
        commands.externalPaste({ text, targetCell: activeCell, options: resolvedOptions }),
      );
      return 1;
    }

    return 0;
  }, [coordinator, actor, commands, readOnly]);

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT LISTENER SETUP
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    // Wrappers for async handlers to satisfy EventListener type
    const copyHandler = (e: Event) => {
      void handleCopy(e as ClipboardEvent);
    };
    const cutHandler = (e: Event) => {
      void handleCut(e as ClipboardEvent);
    };
    const pasteHandler = (e: Event) => {
      void handlePaste(e as ClipboardEvent);
    };

    // Add clipboard event listeners
    container.addEventListener('copy', copyHandler);
    container.addEventListener('cut', cutHandler);
    container.addEventListener('paste', pasteHandler);

    return () => {
      container.removeEventListener('copy', copyHandler);
      container.removeEventListener('cut', cutHandler);
      container.removeEventListener('paste', pasteHandler);
    };
  }, [enabled, containerRef, handleCopy, handleCut, handlePaste]);

  return {
    isActive: enabled,
    pasteFromSystemClipboard,
  };
}
