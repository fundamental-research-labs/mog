/**
 * useExport Hook
 *
 * Provides XLSX export functionality for the spreadsheet application.
 *
 * Fully migrated to the unified Workbook/Worksheet API
 *
 * TODO: This hook is a stub awaiting Tauri native export implementation.
 * The export functions (exportAndDownload, exportToBlob) are not yet functional.
 * When implemented, they should use the Workbook API for data access:
 * - wb.getWorkbookSnapshot for full workbook serialization
 * - Or ws.getRange, ws.charts.list, ws.tables.list, ws.getPrintSettings
 * for granular data extraction
 */

import { useCallback, useState } from 'react';

import type { ExportOptions, ExportProgress, ExportResult } from './export-types';

// =============================================================================
// Types
// =============================================================================

export interface ExportState {
  /** Whether an export is currently in progress */
  isExporting: boolean;

  /** Current export progress (0-100) */
  progress: number;

  /** Current phase of export */
  phase: ExportProgress['phase'] | null;

  /** Current sheet being processed */
  currentSheet: string | null;

  /** Error message if export failed */
  error: string | null;

  /** Statistics from last successful export */
  lastExportStats: ExportResult['stats'] | null;
}

export interface UseExportOptions {
  /** Default filename for downloads (without .xlsx extension) */
  defaultFilename?: string;

  /** Callback when export starts */
  onExportStart?: () => void;

  /** Callback when export completes */
  onExportComplete?: (result: ExportResult) => void;

  /** Callback when export fails */
  onExportError?: (error: string) => void;
}

export interface UseExportReturn {
  /** Current export state */
  state: ExportState;

  /** Export to XLSX and download */
  exportAndDownload: (filename?: string, options?: ExportOptions) => Promise<boolean>;

  /** Export to XLSX and return the blob (for custom handling) */
  exportToBlob: (options?: ExportOptions) => Promise<ExportResult>;

  /** Reset error state */
  clearError: () => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

const initialState: ExportState = {
  isExporting: false,
  progress: 0,
  phase: null,
  currentSheet: null,
  error: null,
  lastExportStats: null,
};

export function useExport(options: UseExportOptions = {}): UseExportReturn {
  const { onExportStart, onExportError } = options;

  const [state, setState] = useState<ExportState>(initialState);

  // TODO(tauri-migration): Reimplement with Tauri native export
  const exportToBlob = useCallback(
    async (_exportOptions: ExportOptions = {}): Promise<ExportResult> => {
      setState({
        ...initialState,
        isExporting: true,
      });

      onExportStart?.();

      const errorMsg = 'Export to blob not yet implemented with Tauri native exports';
      setState((prev) => ({
        ...prev,
        isExporting: false,
        error: errorMsg,
      }));
      onExportError?.(errorMsg);

      return {
        success: false,
        error: errorMsg,
        stats: {
          sheetsExported: 0,
          cellsExported: 0,
          formulasExported: 0,
          exportTimeMs: 0,
        },
      };
    },
    [onExportStart, onExportError],
  );

  // TODO(tauri-migration): Reimplement with Tauri native export
  const exportAndDownload = useCallback(
    async (_filename?: string, _exportOptions: ExportOptions = {}): Promise<boolean> => {
      setState({
        ...initialState,
        isExporting: true,
      });

      onExportStart?.();

      const errorMsg = 'Export and download not yet implemented with Tauri native exports';
      setState((prev) => ({
        ...prev,
        isExporting: false,
        error: errorMsg,
      }));
      onExportError?.(errorMsg);
      return false;
    },
    [onExportStart, onExportError],
  );

  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      error: null,
    }));
  }, []);

  return {
    state,
    exportAndDownload,
    exportToBlob,
    clearError,
  };
}
