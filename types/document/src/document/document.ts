/**
 * Document Lifecycle Types
 *
 * Types for the DocumentFactory API that manages document creation and lifecycle.
 * This enables clean separation between the spreadsheet engine and host applications.
 *
 * Architecture:
 * - DocumentFactory creates DocumentHandles (stateless, doesn't track open docs)
 * - DocumentHandle bundles document identity + ready state
 * - Host app owns document metadata (name, owner, permissions)
 * - Engine owns document content (cells, formulas, charts)
 *
 * Note: The actual YjsDocument and SpreadsheetStore types are internal to the engine.
 * This file defines the PUBLIC contract types that consuming apps use.
 *
 */

import type {
  ImportDiagnosticDetails,
  ImportDiagnosticDto,
  ImportDiagnosticLocation,
  ImportDiagnosticRecoverability,
  ImportDiagnosticSeverity,
} from '@mog/types-data/data/diagnostics';

// =============================================================================
// DocumentSource — Where document data comes from
// =============================================================================

/**
 * Describes where a document's data comes from.
 *
 * The pipeline preserves this context through every layer so each
 * platform bridge can dispatch optimally:
 * - Desktop (Tauri): 'path' → native Rust I/O (one IPC call)
 * - Web: 'bytes' → WASM parsing
 * - Recovery: 'bytes' → autosave data from IndexedDB/Rust
 */
export type DocumentSource =
  | { readonly type: 'path'; readonly path: string }
  | { readonly type: 'bytes'; readonly data: Uint8Array };

// =============================================================================
// Provider Configuration
// =============================================================================

/**
 * IndexedDB provider configuration for offline-first persistence.
 */
export interface IndexedDBProviderConfig {
  type: 'indexeddb';
}

/**
 * WebSocket provider configuration for real-time collaboration.
 */
export interface WebSocketProviderConfig {
  type: 'websocket';
  /** WebSocket server URL (e.g., 'wss://collab.example.com') */
  url: string;
  /** Optional URL parameters (e.g., auth tokens) */
  params?: Record<string, string>;
}

/**
 * Provider configuration union type.
 * Extensible for future providers (WebRTC, custom, etc.)
 */
export type ProviderConfig = IndexedDBProviderConfig | WebSocketProviderConfig;

// =============================================================================
// CreateOptions
// =============================================================================

/**
 * Options for creating a new document.
 */
export interface CreateDocumentOptions {
  /**
   * Custom document ID.
   * If not provided, a UUID v7 is generated automatically.
   * Use this when you need a deterministic ID (e.g., from database).
   */
  documentId?: string;

  /**
   * @deprecated Unused — the lifecycle system selects providers based on
   * `environment` (browser -> IndexedDB, headless -> none). This field is
   * retained for type compatibility but rejected at runtime by
   * `DocumentFactory.create` when called from production facades.
   *
   * @internal Only accepted in internal/test paths.
   */
  providers?: ProviderConfig[];

  /**
   * Skip creating the default "Sheet1" on document creation.
   * Default: false (creates default sheet)
   *
   * Use this when importing from external sources (e.g., XLSX) that will
   * create their own sheets. This prevents an empty "Sheet1" from remaining
   * after import.
   *
   * @internal Used by DocumentFactory.createFromXlsx()
   */
  skipDefaultSheet?: boolean;

  /**
   * Pre-built WorkbookSnapshot to initialize the engine from (for collaboration).
   * When provided, the engine is created with this snapshot instead of an empty one.
   * This ensures the engine shares the same CellIds as the source/authoritative engine.
   *
   * @internal Collaboration-only. Rejected at runtime when `environment`
   * is `'browser'` — production browser facades must not bypass the
   * provider lifecycle.
   */
  initialSnapshot?: Record<string, unknown>;

  /**
   * Raw Yrs document state bytes for engine initialization (for collaboration).
   * When provided, the engine is created from these bytes via `createEngineFromYrsState`
   * instead of the normal `createEngine` path. This ensures the engine shares the
   * same CellIds and history as the authoritative source.
   * Takes precedence over `initialSnapshot` if both are provided.
   *
   * @internal Collaboration-only. Rejected at runtime when `environment`
   * is `'browser'` — production browser facades must not bypass the
   * provider lifecycle.
   */
  yrsState?: Uint8Array;

  /**
   * Mark this document as internal / non-user-visible.
   *
   * When `true`, the orchestrator (`RustDocument`) will NOT call
   * `touchDoc(docId)` on Provider attach, so the document never appears
   * in the Meta API's `recentDocs` or `lastActiveDocId`. This is the
   * Internal scaffold document escape hatch (e.g.,
   * the `os-fallback-doc` the shell historically opens at boot for
   * non-document AppKernelAPI consumers).
   *
   * Default: `false`. End-user document creation paths must leave this
   * unset; only the shell's internal-app machinery (internal app machinery sets it.
   *
   */
  internal?: boolean;

  /**
   * Skip local persistence for this document lifecycle. Browser legacy paths
   * avoid IndexedDB/Web Locks and do not replay locally persisted state.
   *
   * Use when the host owns persistence or the document is intentionally
   * ephemeral.
   */
  skipLocalPersistence?: boolean;
}

// =============================================================================
// ImportOptions (extends CreateOptions for XLSX import)
// =============================================================================

/**
 * Options for importing an XLSX file into a new document.
 * Extends CreateDocumentOptions with import-specific settings.
 */
export interface DocumentImportOptions extends CreateDocumentOptions {
  /**
   * Maximum number of cells to import.
   * Default: 1,000,000
   * Files exceeding this limit will fail the pre-flight check.
   */
  maxCells?: number;

  /**
   * Import values only, skip formulas.
   * Default: false
   */
  valuesOnly?: boolean;

  /**
   * Skip cell formatting (faster import).
   * Default: false
   */
  skipFormatting?: boolean;

  /**
   * AbortSignal for cancellation support.
   * Use with AbortController to cancel long-running imports.
   */
  signal?: AbortSignal;

  /**
   * Progress callback for UI feedback.
   * Called periodically during import with progress information.
   */
  onProgress?: (progress: ImportProgressInfo) => void;
}

/**
 * Options for importing a CSV file into a new document.
 *
 * Field names mirror the Rust `csv_parser::CsvImportOptions` struct exactly
 * so the generated bridge wire types pass through unchanged. Defaults are
 * applied at the boundary (`DocumentFactory.createFromCsv` /
 * `csv-parser` crate) — every field here is optional from the caller's
 * perspective.
 */
export interface CsvImportOptions {
  /**
   * Single-character column delimiter (e.g. `","`, `"\t"`, `";"`).
   * If undefined, the parser auto-detects from the first 8 KB.
   * Validated to one character at the Rust boundary.
   */
  delimiter?: string;

  /**
   * Source encoding name (e.g. `"utf-8"`, `"utf-16le"`, `"windows-1252"`).
   * If undefined, the parser auto-detects via BOM sniffing first, then
   * `chardetng` heuristics if no BOM is present and the bytes don't
   * validate as UTF-8.
   */
  encoding?: string;

  /**
   * Whether the first row should be promoted to a header row.
   * If undefined, no row is promoted (treated as data).
   */
  hasHeaderRow?: boolean;

  /**
   * Whether to evaluate cells starting with `=`, `+`, `-`, `@` as formulas.
   * Defaults to `false` as a CSV-injection guard — leading `=` becomes a
   * literal text cell unless this is explicitly enabled.
   */
  evaluateFormulas?: boolean;

  /**
   * Name to assign to the single sheet created from the CSV.
   * If undefined, the caller default is used (typically `"Sheet1"` or the
   * source filename stem).
   */
  sheetName?: string;

  /**
   * Maximum rows to import. Defaults to the Excel row limit (1,048,576).
   * Excess rows are dropped and surfaced as a `TruncatedRows` warning.
   */
  maxRows?: number;

  /**
   * Maximum columns to import. Defaults to the Excel column limit (16,384).
   * Excess columns are dropped and surfaced as a `TruncatedCols` warning.
   */
  maxCols?: number;

  /**
   * BCP-47 locale tag (e.g. `"en-US"`, `"de-DE"`).
   * Reserved hook for locale-aware number / date inference; unused this
   * round (parser uses en-US semantics regardless).
   */
  locale?: string;
}

/**
 * Progress information during XLSX import.
 */
export interface ImportProgressInfo {
  /** Current phase of import */
  phase: 'parsing' | 'processing' | 'complete';

  /** Name of the sheet currently being processed */
  currentSheet?: string;

  /** Number of sheets processed so far */
  sheetsProcessed: number;

  /** Total number of sheets to process */
  totalSheets: number;

  /** Number of cells processed so far */
  cellsProcessed: number;

  /** Total number of cells to process */
  totalCells: number;

  /** Percentage complete (0-100) */
  percentage: number;
}

// =============================================================================
// ImportResult
// =============================================================================

/**
 * Result of an XLSX import operation.
 * Note: The handle is not included here - it's part of the engine's return type.
 */
export interface DocumentImportResult {
  /** Whether the import succeeded */
  success: boolean;

  /** Number of cells imported (may be undefined when not available from hydration path) */
  cellCount?: number;

  /** Sheet IDs created during import */
  sheetIds: string[];

  /** Error that occurred (if success is false) */
  error?: Error;

  /** Warnings generated during import (e.g., unsupported features) */
  warnings: DocumentImportWarning[];

  /** Import metrics for performance monitoring */
  metrics?: {
    /** Time spent parsing the XLSX file (ms) */
    parseTimeMs: number;
    /** Time spent processing cells (ms) */
    processTimeMs: number;
    /** Total import time (ms) */
    totalTimeMs: number;
  };
}

/**
 * Warning generated during import.
 */
export interface DocumentImportWarning {
  /** Stable diagnostic identity when the warning originates from an import diagnostic. */
  id?: string;

  /** Type of warning */
  type: 'cell_limit' | 'format_loss' | 'formula_error' | 'import_error' | 'unsupported_feature';

  /** Human-readable warning message */
  message: string;

  /** Diagnostic severity, when available from the importer. */
  severity?: ImportDiagnosticSeverity;

  /** Whether the imported feature was preserved, repaired, dropped, etc. */
  recoverability?: ImportDiagnosticRecoverability | string;

  /** Imported feature family that produced this warning. */
  feature?: string;

  /** Deterministic primary reason for the warning, when the importer provides details. */
  reason?: string;

  /** Structured diagnostic details. */
  details?: ImportDiagnosticDetails;

  /** Full canonical diagnostic DTO that produced this warning. */
  diagnostic?: ImportDiagnosticDto;

  /** Location where the warning occurred */
  location?: ImportDiagnosticLocation;
}
