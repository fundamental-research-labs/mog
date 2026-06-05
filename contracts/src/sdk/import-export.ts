/**
 * Import, export, and serialization contracts.
 *
 * Canonical versioned types for document sources, sinks, and results.
 */

import type {
  ImportDiagnosticDetails,
  ImportDiagnosticDto,
  ImportDiagnosticLocation,
  ImportDiagnosticRecoverability,
  ImportDiagnosticSeverity,
} from '@mog/types-data/data/diagnostics';

// ---------------------------------------------------------------------------
// Document source (input)
// ---------------------------------------------------------------------------

export type MogDocumentSource =
  | { readonly type: 'blank' }
  | { readonly type: 'bytes'; readonly data: Uint8Array; readonly format?: MogFileFormat }
  | { readonly type: 'path'; readonly path: string; readonly format?: MogFileFormat }
  | { readonly type: 'snapshot'; readonly snapshot: MogSnapshot }
  | { readonly type: 'updateLog'; readonly updates: MogUpdateLog };

export type MogFileFormat = 'xlsx' | 'csv' | 'ooxml';

// ---------------------------------------------------------------------------
// Snapshot and update log (Mog-native serialization)
// ---------------------------------------------------------------------------

export interface MogSnapshot {
  readonly version: number;
  readonly documentId: string;
  readonly data: Uint8Array;
  readonly metadata?: Record<string, unknown>;
}

export interface MogUpdateLog {
  readonly version: number;
  readonly documentId: string;
  readonly baseSnapshot?: MogSnapshot;
  readonly updates: readonly Uint8Array[];
}

// ---------------------------------------------------------------------------
// Import options
// ---------------------------------------------------------------------------

export interface MogImportOptions {
  readonly maxCells?: number;
  readonly valuesOnly?: boolean;
  readonly skipFormatting?: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: MogImportProgress) => void;
  readonly csv?: MogCsvImportOptions;
}

export interface MogCsvImportOptions {
  readonly delimiter?: string;
  readonly encoding?: string;
  readonly hasHeaderRow?: boolean;
  readonly evaluateFormulas?: boolean;
  readonly sheetName?: string;
  readonly maxRows?: number;
  readonly maxCols?: number;
}

export interface MogImportProgress {
  readonly phase: 'parsing' | 'processing' | 'complete';
  readonly currentSheet?: string;
  readonly sheetsProcessed: number;
  readonly totalSheets: number;
  readonly cellsProcessed: number;
  readonly totalCells: number;
  readonly percentage: number;
}

// ---------------------------------------------------------------------------
// Import result
// ---------------------------------------------------------------------------

export interface MogImportResult {
  readonly success: boolean;
  readonly sheetIds: readonly string[];
  readonly cellCount?: number;
  readonly warnings: readonly MogImportWarning[];
  readonly metrics?: MogImportMetrics;
  readonly error?: MogImportError;
}

export interface MogImportWarning {
  readonly id?: string;
  readonly type: MogImportWarningType;
  readonly message: string;
  readonly severity?: ImportDiagnosticSeverity;
  readonly recoverability?: ImportDiagnosticRecoverability | string;
  readonly feature?: string;
  readonly reason?: string;
  readonly details?: ImportDiagnosticDetails;
  readonly diagnostic?: ImportDiagnosticDto;
  readonly location?: ImportDiagnosticLocation;
}

export type MogImportWarningType =
  | 'cell_limit'
  | 'format_loss'
  | 'formula_error'
  | 'import_error'
  | 'unsupported_feature';

export interface MogImportMetrics {
  readonly parseTimeMs: number;
  readonly processTimeMs: number;
  readonly totalTimeMs: number;
}

export interface MogImportError {
  readonly code: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Export options
// ---------------------------------------------------------------------------

export interface MogExportOptions {
  readonly format?: MogFileFormat;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: MogExportProgress) => void;
}

export interface MogExportProgress {
  readonly phase: string;
  readonly percentage: number;
}

// ---------------------------------------------------------------------------
// Export result
// ---------------------------------------------------------------------------

export interface MogExportResult {
  readonly success: boolean;
  readonly data?: Uint8Array;
  readonly warnings: readonly MogExportWarning[];
  readonly error?: MogExportError;
}

export interface MogExportWarning {
  readonly type: string;
  readonly message: string;
}

export interface MogExportError {
  readonly code: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Save semantics
// ---------------------------------------------------------------------------

export type MogSaveMode = 'workbookSave' | 'documentCheckpoint' | 'exportOnly' | 'noSave';

export type MogCloseBehavior = 'save' | 'skipSave';
