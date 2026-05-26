/**
 * Diagnostics Core Types - Unified framework for validating and tracing cell properties
 *
 * This file defines the core types for the Unified Diagnostics Framework, enabling:
 * - Property resolution tracing (source → stored → computed)
 * - Multi-domain validation (style, formula, value, etc.)
 * - Mismatch detection between XLSX and stored state
 * - Document diffing for import/export validation
 *
 */

// =============================================================================
// Cell Coordinates
// =============================================================================

/**
 * Cell coordinates (0-indexed row/col, shared across all domains).
 * This is the minimal representation for identifying a cell within a sheet.
 */
export interface CellCoord {
  /** Sheet identifier */
  sheetId: string;
  /** 0-indexed row number */
  row: number;
  /** 0-indexed column number */
  col: number;
}

/**
 * Extended cell reference with display metadata.
 * Includes human-readable references and stable cell identity when available.
 */
export interface CellRef extends CellCoord {
  /** Sheet name (for display) */
  sheetName: string;
  /** A1 notation (1-indexed, e.g., "C17") */
  ref: string;
  /** Stable cell identity if materialized (null if transient) */
  cellId: string | null;
}

// =============================================================================
// Diagnostic Issues
// =============================================================================

/**
 * Severity level for diagnostic issues.
 * - error: Critical mismatch requiring attention
 * - warning: Non-critical difference or potential issue
 * - info: Informational note about property resolution
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * Domain name for categorizing diagnostics.
 * Each domain validates a specific aspect of cell properties.
 */
export type DiagnosticDomainName =
  | 'style' // Visual formatting (colors, fonts, alignment)
  | 'formula' // Formula syntax and dependencies
  | 'value' // Cell values and types
  | 'validation' // Data validation rules
  | 'conditionalFormat' // Conditional formatting rules
  | 'namedRange' // Named range definitions
  | 'table' // Table structure and formatting
  | 'pivot' // Pivot table configuration
  | 'floating-object'; // Floating objects (shapes, equations, text-effects, etc.)

/**
 * Diagnostic issue describing a problem or observation.
 * Generic structure applicable to all domains.
 */
export interface DiagnosticIssue {
  /** Severity level (error/warning/info) */
  severity: DiagnosticSeverity;
  /** Domain that detected this issue */
  domain: DiagnosticDomainName;
  /** Specific property name (if applicable, e.g., 'backgroundColor') */
  property?: string;
  /** Machine-readable issue code (e.g., 'XLSX_STORED_MISMATCH') */
  code: string;
  /** Human-readable description */
  message: string;
  /** Source value (from XLSX or external source) */
  sourceValue?: unknown;
  /** Stored value (in Yjs) */
  storedValue?: unknown;
  /** Computed value (effective/resolved value) */
  computedValue?: unknown;
}

// =============================================================================
// Property Resolution
// =============================================================================

/**
 * Source of a resolved property value.
 * Indicates where the property came from in the resolution cascade.
 */
export type ResolutionSource =
  | 'cell' // Cell-level format (highest priority)
  | 'row' // Row-level format
  | 'col' // Column-level format
  | 'table' // Table style
  | 'conditionalFormat' // Conditional formatting rule
  | 'default' // System default
  | 'computed'; // Computed/calculated value

/**
 * Trace of how a property value was resolved.
 * Documents the resolution cascade from various sources.
 */
export interface PropertyResolution<T = unknown> {
  /** Property name (e.g., 'backgroundColor') */
  property: string;
  /** Resolved value */
  value: T;
  /** Where this value came from */
  source: ResolutionSource;
  /** ID of the source entity (cellId, rowId, tableId, etc.) */
  sourceId?: string;
  /** Priority level (higher = wins in cascade) */
  priority?: number;
}

// =============================================================================
// Diagnostic Trace
// =============================================================================

/**
 * Complete diagnostic trace for a cell property.
 * Generic type parameterized by domain-specific source/stored/computed types.
 *
 * @template TSource - Source data type (e.g., XLSX raw data)
 * @template TStored - Stored data type (e.g., Yjs cell/row/col format)
 * @template TComputed - Computed data type (e.g., effective resolved format)
 */
export interface DiagnosticTrace<TSource, TStored, TComputed> {
  /** Cell being traced */
  cell: CellRef;
  /** Source data (XLSX, external) - null if not available */
  source: TSource | null;
  /** Stored data (Yjs) - null if not stored */
  stored: TStored | null;
  /** Computed/effective data (always present) */
  computed: TComputed;
  /** Resolution trace for each property */
  resolution: PropertyResolution[];
  /** Detected issues for this cell */
  issues: DiagnosticIssue[];
  /** Timestamp when trace was captured (ISO 8601) */
  tracedAt: string;
}

// =============================================================================
// Validation Results
// =============================================================================

/**
 * Aggregate validation result across all cells and domains.
 * Provides summary statistics and categorized issues.
 */
export interface ValidationResult {
  /** Overall validation status */
  valid: boolean;
  /** Issue count by severity */
  issueCount: { error: number; warning: number; info: number };
  /** All issues (flat list) */
  issues: DiagnosticIssue[];
  /** Issues grouped by cell (cell key -> issues) */
  byCell: Map<string, DiagnosticIssue[]>;
  /** Issues grouped by domain */
  byDomain: Map<DiagnosticDomainName, DiagnosticIssue[]>;
}

// =============================================================================
// Document Diff
// =============================================================================

/**
 * Entry describing a difference between source and stored values.
 * Used for import/export validation and reconciliation.
 */
export interface DiffEntry {
  /** Cell with difference */
  cell: CellRef;
  /** Domain where difference was detected */
  domain: DiagnosticDomainName;
  /** Property name */
  property: string;
  /** Value from source (XLSX, external) */
  sourceValue: unknown;
  /** Value in storage (Yjs) */
  storedValue: unknown;
}

/**
 * Document diff result categorizing all differences.
 * Distinguishes between modifications, missing data, and added data.
 */
export interface DocumentDiff {
  /** Properties that differ between source and stored */
  modified: DiffEntry[];
  /** Properties in source but missing in stored */
  missing: DiffEntry[];
  /** Properties in stored but not in source */
  added: DiffEntry[];
}

// =============================================================================
// Diagnostic Domain Interface
// =============================================================================

/**
 * Interface for implementing domain-specific diagnostics.
 * Each domain (style, formula, value, etc.) implements this interface.
 *
 * @template TSource - Source data type for this domain
 * @template TStored - Stored data type for this domain
 * @template TComputed - Computed data type for this domain
 */
export interface DiagnosticDomain<TSource, TStored, TComputed> {
  /** Domain identifier */
  readonly name: DiagnosticDomainName;

  /**
   * Capture source data for a cell (e.g., XLSX raw data).
   * Returns null if source data is not available.
   *
   * @param ctx - Domain-specific context (XLSX workbook, external source, etc.)
   * @returns Source data or null
   */
  captureSource(ctx: unknown): TSource | null;

  /**
   * Get stored data for a cell from Yjs.
   * Returns null if no data is stored.
   *
   * @param ctx - Domain-specific context (Yjs doc, sheet state, etc.)
   * @param cell - Cell coordinates
   * @returns Stored data or null
   */
  getStored(ctx: unknown, cell: CellCoord): TStored | null | Promise<TStored | null>;

  /**
   * Get computed/effective data for a cell.
   * This is the resolved value after applying all cascades.
   * Always returns a value (uses defaults if necessary).
   *
   * @param ctx - Domain-specific context
   * @param cell - Cell coordinates
   * @returns Computed data
   */
  getComputed(ctx: unknown, cell: CellCoord): TComputed | Promise<TComputed>;

  /**
   * Resolve properties by tracing the resolution cascade.
   * Documents where each property value came from.
   *
   * @param source - Source data
   * @param stored - Stored data
   * @param computed - Computed data
   * @returns Property resolution trace
   */
  resolveProperties(
    source: TSource | null,
    stored: TStored | null,
    computed: TComputed,
  ): PropertyResolution[];

  /**
   * Detect issues by comparing source, stored, and computed values.
   * Returns list of diagnostic issues for this cell.
   *
   * @param trace - Complete diagnostic trace
   * @returns Detected issues
   */
  detectIssues(trace: DiagnosticTrace<TSource, TStored, TComputed>): DiagnosticIssue[];
}
