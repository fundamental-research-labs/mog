import type { ClipboardData } from '@mog-sdk/contracts/actors';
import type { Comment } from '@mog-sdk/contracts/api';
import { cellId } from '@mog-sdk/contracts/cell-identity';
import type { CellRange, CellRawValue, CellValue, SheetId } from '@mog-sdk/contracts/core';
import { ensureFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';

import {
  buildClipboardData,
  buildSparseClipboardData,
  getClipboardCellDisplayValue,
  hasFullShapeIntent,
  type ClipboardStoreReader,
  type SparseClipboardCellEntry,
} from '../../domain/clipboard';
import type { useWorkbook } from '../../infra/context';
import {
  normalCopyRangeExportOptions,
  rangeToHTML,
  rangeToTSV,
} from '../../infra/utils/clipboard-utils';

function toCellRawValue(value: CellValue | null | undefined): CellRawValue {
  if (value == null) return null;
  return typeof value === 'object' ? null : value;
}

/**
 * Pre-fetch all data needed for clipboard operations via the ONE API.
 * Returns sync lookup factories that read from pre-fetched maps.
 */
export async function prefetchClipboardData(
  wb: ReturnType<typeof useWorkbook>,
  activeSheetId: SheetId,
  ranges: readonly CellRange[],
) {
  const ws = wb.getSheetById(activeSheetId);

  if (hasFullShapeIntent(ranges)) {
    return prefetchSparseClipboardData(wb, activeSheetId, ranges);
  }

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
    Promise.all(
      Array.from({ length: numRows }, (_, i) =>
        ws.layout.isRowHidden(minRow + i).then((h) => [minRow + i, h] as [number, boolean]),
      ),
    ),
    Promise.all(
      Array.from({ length: numCols }, (_, i) =>
        ws.layout.isColumnHidden(minCol + i).then((h) => [minCol + i, h] as [number, boolean]),
      ),
    ),
    Promise.all(
      Array.from({ length: numRows * numCols }, (_, idx) => {
        const r = minRow + Math.floor(idx / numCols);
        const c = minCol + (idx % numCols);
        return ws.formats.get(r, c).then((f) => [`${r},${c}`, f] as [string, any]);
      }),
    ),
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

  const systemClipboardExportOptions = normalCopyRangeExportOptions((_sid, row, col) =>
    mergeLookup.get(`${row},${col}`),
  );
  const getDisplayValue = (_sid: string, row: number, col: number) =>
    displayLookup.get(`${row},${col}`) ?? '';
  const getFormat = (_sid: string, _row: number, _col: number) =>
    formatLookup.get(`${_row},${_col}`) ?? undefined;

  const buildData = (clipRanges: CellRange[]) =>
    buildClipboardData(clipRanges, activeSheetId, storeReader);
  const generateTSV = (clipRanges: CellRange[]) => {
    const range = clipRanges[0] ?? ranges[0];
    return range
      ? rangeToTSV(activeSheetId, range, getDisplayValue, systemClipboardExportOptions)
      : '';
  };
  const generateHTML = (clipRanges: CellRange[]) => {
    const range = clipRanges[0] ?? ranges[0];
    return range
      ? rangeToHTML(
          activeSheetId,
          range,
          getDisplayValue,
          getFormat,
          undefined,
          systemClipboardExportOptions,
        )
      : '';
  };

  return {
    storeReader,
    exportOptions: systemClipboardExportOptions,
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
