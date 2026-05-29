/**
 * usePdfExport Hook
 *
 * PDF export via SpreadsheetPdfExporter (Rust PDF pipeline).
 * Uses PdfCanvas + TauriFontBridge to render pages through the IPC bridge
 * to the Rust pdf-core backend.
 *
 * All data access goes through the unified Workbook/Worksheet API
 * Row heights and column widths are pre-fetched via batch methods before constructing
 * the PdfDataProvider, giving genuinely sync lookups with no `as unknown` casts.
 *
 * Data flow:
 * Workbook API → PdfDataProvider adapter → SpreadsheetPdfExporter
 * → PdfCanvas → TauriFontBridge → Rust pdf-core
 */

import { useCallback, useState } from 'react';

import {
  createPdfExporter,
  type CellDataInput,
  type PageSetup,
  type PdfDataProvider,
  type PdfExportResult,
  type PrintOptions,
} from '@mog/print-export';

import type { Workbook } from '@mog-sdk/contracts/api';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';

import { useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface PdfExportState {
  /** Whether a PDF export is currently in progress */
  isExporting: boolean;

  /** Export progress (0-100) */
  progress: number;

  /** Error message if export failed */
  error: string | null;

  /** Terminal status message for assistive tech and export UI */
  message: string | null;

  /** Result from last export */
  lastResult: PdfExportResult | null;
}

export interface UsePdfExportOptions {
  /** Default print options (reserved for future page setup integration) */
  defaultPrintOptions?: Partial<PrintOptions>;

  /** Default page setup (reserved for future page setup integration) */
  defaultPageSetup?: PageSetup;

  /** Default file name for export */
  defaultFileName?: string;

  /** Callback when export starts */
  onExportStart?: () => void;

  /** Callback when export completes */
  onExportComplete?: (result: PdfExportResult) => void;

  /** Callback when export fails */
  onExportError?: (error: string) => void;

  /** Callback for progress updates */
  onProgress?: (progress: number) => void;
}

export interface UsePdfExportReturn {
  /** Current export state */
  state: PdfExportState;

  /** Export to PDF via the Rust pipeline */
  exportPdf: (filename?: string, sheetIds?: string[]) => Promise<boolean>;

  /** Export current selection only */
  exportSelection: (filename?: string) => Promise<boolean>;

  /** Reset error state */
  clearError: () => void;
}

// =============================================================================
// Data Provider Adapter
// =============================================================================

/**
 * Create a PdfDataProvider adapter that bridges the unified Workbook API
 * to the SpreadsheetPdfExporter's data interface.
 *
 * Core methods (cells, dimensions, merges, visibility) are fully implemented.
 * Floating objects (charts, drawings, images), CF, and sparklines return
 * stubs — they'll be wired up as those kernel APIs are exposed to the
 * export pipeline.
 *
 * Row heights and column widths are provided via a pre-fetched DimensionCache
 * for genuinely sync lookups (PdfDataProvider requires sync for these).
 */
interface DimensionCache {
  rowHeights: Map<number, number>;
  colWidths: Map<number, number>;
}

function createPdfDataProvider(
  wb: Workbook,
  dimensionCache: Map<string, DimensionCache>,
): PdfDataProvider {
  // Pre-compute hidden rows/cols as Sets for O(1) lookup
  const hiddenRowSets = new Map<string, Set<number>>();
  const hiddenColSets = new Map<string, Set<number>>();

  async function getHiddenRowSet(sheetId: SheetId): Promise<Set<number>> {
    let set = hiddenRowSets.get(sheetId);
    if (!set) {
      const ws = wb.getSheetById(sheetId);
      set = (await ws.layout.getHiddenRowsBitmap()) ?? new Set<number>();
      hiddenRowSets.set(sheetId, set);
    }
    return set;
  }

  async function getHiddenColSet(sheetId: SheetId): Promise<Set<number>> {
    let set = hiddenColSets.get(sheetId);
    if (!set) {
      const ws = wb.getSheetById(sheetId);
      set = (await ws.layout.getHiddenColumnsBitmap()) ?? new Set<number>();
      hiddenColSets.set(sheetId, set);
    }
    return set;
  }

  return {
    async getSheetIds(): Promise<string[]> {
      const names = wb.sheetNames;
      return Promise.all(names.map(async (name) => (await wb.getSheet(name)).getSheetId()));
    },

    async getSheetName(sheetId: SheetId): Promise<string> {
      return (await wb.getSheetById(sheetId).getName()) ?? 'Sheet';
    },

    async getCellData(
      sheetId: SheetId,
      row: number,
      col: number,
    ): Promise<CellDataInput | undefined> {
      const ws = wb.getSheetById(sheetId);
      const cellData = await ws.getCell(row, col);
      if (!cellData) return undefined;

      const value = cellData.value;

      return {
        displayValue: value == null ? '' : String(value),
        valueType: detectValueType(value),
        format: {},
        hyperlink: cellData.hyperlink != null,
        comment: cellData.comment != null,
      };
    },

    getRowHeight(sheetId: SheetId, row: number): number {
      return dimensionCache.get(sheetId)?.rowHeights.get(row) ?? 21;
    },

    getColumnWidth(sheetId: SheetId, col: number): number {
      return dimensionCache.get(sheetId)?.colWidths.get(col) ?? 100;
    },

    async getUsedRange(sheetId: SheetId) {
      const usedRange = await wb.getSheetById(sheetId).getUsedRange();
      if (!usedRange) return undefined;
      // ws.getUsedRange() returns a structured `CellRange | null` with
      // 0-based fields — pass them through.
      return {
        startRow: usedRange.startRow,
        startCol: usedRange.startCol,
        endRow: usedRange.endRow,
        endCol: usedRange.endCol,
      };
    },

    async getMergedRegions(sheetId: SheetId) {
      const ws = wb.getSheetById(sheetId);
      return (await ws.structure.getMergedRegions()).map((r) => ({
        startRow: r.startRow,
        startCol: r.startCol,
        endRow: r.endRow,
        endCol: r.endCol,
      }));
    },

    async isRowHidden(sheetId: SheetId, row: number): Promise<boolean> {
      return (await getHiddenRowSet(sheetId)).has(row);
    },

    async isColHidden(sheetId: SheetId, col: number): Promise<boolean> {
      return (await getHiddenColSet(sheetId)).has(col);
    },

    // Floating objects — stub until kernel chart/drawing/image APIs are exposed
    getCharts() {
      return [];
    },
    getDrawings() {
      return [];
    },
    getImages() {
      return [];
    },

    // CF & sparklines — stub until CF engine and sparkline data are exposed
    getCFResult() {
      return undefined;
    },
    getSparklineData() {
      return undefined;
    },

    // Per-sheet page setup (falls back to exporter defaults)
    getPageSetup() {
      return undefined;
    },
  };
}

/**
 * Detect the value type for alignment heuristics in the PDF renderer.
 */
function detectValueType(value: unknown): CellDataInput['valueType'] {
  if (value == null) return 'empty';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') {
    if (value.startsWith('#')) return 'error';
    return 'string';
  }
  return 'string';
}

// =============================================================================
// Hook Implementation
// =============================================================================

const initialState: PdfExportState = {
  isExporting: false,
  progress: 0,
  error: null,
  message: null,
  lastResult: null,
};

type DownloadablePdfResult = PdfExportResult & {
  blob?: Blob;
  dataUrl?: string;
  bytes?: Uint8Array | ArrayBuffer | number[];
};

function copyViewToArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function getPdfBlob(result: PdfExportResult): Blob | null {
  const downloadable = result as DownloadablePdfResult;
  if (downloadable.blob instanceof Blob) {
    return downloadable.blob;
  }
  if (downloadable.bytes) {
    if (downloadable.bytes instanceof ArrayBuffer) {
      return new Blob([downloadable.bytes], { type: 'application/pdf' });
    }
    if (ArrayBuffer.isView(downloadable.bytes)) {
      return new Blob([copyViewToArrayBuffer(downloadable.bytes)], { type: 'application/pdf' });
    }
    return new Blob([new Uint8Array(downloadable.bytes).buffer], { type: 'application/pdf' });
  }
  return null;
}

function downloadPdf(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;

  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

async function getPdfExportSheetName(wb: Workbook, exportSheetIds: string[]): Promise<string> {
  const firstSheetId = exportSheetIds[0];
  if (!firstSheetId) return 'Sheet';

  try {
    const ws = wb.getSheetById(toSheetId(firstSheetId));
    return (await ws.getName()) || ws.name || 'Sheet';
  } catch {
    return 'Sheet';
  }
}

export function usePdfExport(
  activeSheetId: SheetId,
  _selection?: { startRow: number; startCol: number; endRow: number; endCol: number },
  options: UsePdfExportOptions = {},
): UsePdfExportReturn {
  const { onExportStart, onExportComplete, onExportError, onProgress } = options;
  const wb = useWorkbook();

  const [state, setState] = useState<PdfExportState>(initialState);

  const exportPdf = useCallback(
    async (
      filename = options.defaultFileName ?? 'workbook.pdf',
      sheetIds?: string[],
    ): Promise<boolean> => {
      setState({ ...initialState, isExporting: true });
      onExportStart?.();

      try {
        // Pre-fetch row heights and column widths for sync provider lookups.
        // ws.getUsedRange() returns a structured `CellRange | null` —
        // 0-based fields go straight into the batch APIs.
        const exportSheetIds = sheetIds ?? [activeSheetId];
        const dimCache = new Map<string, DimensionCache>();
        for (const sid of exportSheetIds) {
          const ws = wb.getSheetById(toSheetId(sid));
          const usedRange = await ws.getUsedRange();
          if (usedRange) {
            const [rowHeights, colWidths] = await Promise.all([
              ws.layout.getRowHeightsBatch(usedRange.startRow, usedRange.endRow),
              ws.layout.getColWidthsBatch(usedRange.startCol, usedRange.endCol),
            ]);
            dimCache.set(sid, {
              rowHeights: new Map(rowHeights),
              colWidths: new Map(colWidths),
            });
          }
        }

        const dataProvider = createPdfDataProvider(wb, dimCache);
        const exporter = createPdfExporter(dataProvider);

        const result = await exporter.export({
          sheetIds: sheetIds ?? [activeSheetId],
          onProgress: (current, total) => {
            const percent = total > 0 ? Math.round((current / total) * 100) : 0;
            setState((prev) => ({ ...prev, progress: percent }));
            onProgress?.(percent);
          },
        });

        if (result.pageCount === 0) {
          const sheetName = await getPdfExportSheetName(wb, exportSheetIds);
          const errorMsg = `PDF export unavailable: "${sheetName}" has no printable content.`;
          setState({
            isExporting: false,
            progress: 0,
            error: errorMsg,
            message: errorMsg,
            lastResult: result,
          });
          onExportError?.(errorMsg);
          return false;
        }

        const pdfBlob = getPdfBlob(result);
        const dataUrl = (result as DownloadablePdfResult).dataUrl;
        if (pdfBlob) {
          downloadPdf(pdfBlob, filename);
        } else if (dataUrl && typeof document !== 'undefined') {
          const anchor = document.createElement('a');
          anchor.href = dataUrl;
          anchor.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
          anchor.style.display = 'none';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        } else {
          const errorMsg = 'PDF export is unavailable in this environment';
          setState((prev) => ({
            ...prev,
            isExporting: false,
            error: errorMsg,
            message: errorMsg,
            lastResult: result,
          }));
          onExportError?.(errorMsg);
          return false;
        }

        setState((prev) => ({
          ...prev,
          isExporting: false,
          progress: 100,
          message: `PDF export downloaded ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}.`,
          lastResult: result,
        }));

        onExportComplete?.(result);
        return true;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'PDF export failed';
        setState((prev) => ({ ...prev, isExporting: false, error: errorMsg, message: errorMsg }));
        onExportError?.(errorMsg);
        return false;
      }
    },
    [
      wb,
      activeSheetId,
      options.defaultFileName,
      onExportStart,
      onExportComplete,
      onExportError,
      onProgress,
    ],
  );

  const exportSelection = useCallback(
    async (filename?: string): Promise<boolean> => {
      // Selection-based export: restrict to active sheet.
      // Print area from selection will be supported when PdfExportOptions
      // gains printArea support.
      return exportPdf(filename, [activeSheetId]);
    },
    [activeSheetId, exportPdf],
  );

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null, message: null }));
  }, []);

  return {
    state,
    exportPdf,
    exportSelection,
    clearError,
  };
}
