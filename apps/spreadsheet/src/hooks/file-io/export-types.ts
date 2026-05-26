/**
 * Export Types
 *
 * Type definitions for the XLSX export pipeline.
 * Fully migrated to the unified API — no domain module types.
 *
 * TODO: When Tauri native export is implemented, these types may be
 * replaced or extended to match the Tauri export pipeline's requirements.
 */

/**
 * Options for XLSX export operations.
 */
export interface ExportOptions {
  /** Sheets to include (empty = all) */
  sheetIds?: string[];
  /** Whether to include formulas */
  includeFormulas?: boolean;
  /** Whether to include formatting */
  includeFormatting?: boolean;
}

/**
 * Progress information during export.
 */
export interface ExportProgress {
  /** Export phase */
  phase: 'preparing' | 'exporting-sheets' | 'writing-file' | 'complete';
  /** Progress percentage (0-100) */
  percentage: number;
  /** Current sheet being processed */
  currentSheet?: string;
}

/**
 * Result of an export operation.
 */
export interface ExportResult {
  success: boolean;
  error?: string;
  blob?: Blob;
  stats: {
    sheetsExported: number;
    cellsExported: number;
    formulasExported: number;
    exportTimeMs: number;
  };
}
