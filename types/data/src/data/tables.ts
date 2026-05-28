/**
 * Table Contracts
 *
 * Type definitions for spreadsheet tables with structured references.
 * Tables provide named ranges with automatic formatting, filtering,
 * total rows, and structured reference support in formulas.
 *
 * Tables now use Cell Identity Model for CRDT-safe positioning.
 * - rangeIdentity replaces range (CellRange) with CellIdRange
 * - Position resolution happens at render time via resolveTableRange()
 *
 */

import type { CellIdRange } from '@mog/types-core/cell-identity';
import type { CellFormat, CellRange, SheetId } from '@mog/types-core/core';

// ============================================================================
// Table Style Configuration
// ============================================================================

/**
 * Table style presets matching Excel's table style gallery.
 * Light styles (1-28), Medium styles (1-28), Dark styles (1-11).
 */
export type TableStylePreset =
  | 'none'
  // Light styles
  | 'light1'
  | 'light2'
  | 'light3'
  | 'light4'
  | 'light5'
  | 'light6'
  | 'light7'
  | 'light8'
  | 'light9'
  | 'light10'
  | 'light11'
  | 'light12'
  | 'light13'
  | 'light14'
  | 'light15'
  | 'light16'
  | 'light17'
  | 'light18'
  | 'light19'
  | 'light20'
  | 'light21'
  | 'light22'
  | 'light23'
  | 'light24'
  | 'light25'
  | 'light26'
  | 'light27'
  | 'light28'
  // Medium styles
  | 'medium1'
  | 'medium2'
  | 'medium3'
  | 'medium4'
  | 'medium5'
  | 'medium6'
  | 'medium7'
  | 'medium8'
  | 'medium9'
  | 'medium10'
  | 'medium11'
  | 'medium12'
  | 'medium13'
  | 'medium14'
  | 'medium15'
  | 'medium16'
  | 'medium17'
  | 'medium18'
  | 'medium19'
  | 'medium20'
  | 'medium21'
  | 'medium22'
  | 'medium23'
  | 'medium24'
  | 'medium25'
  | 'medium26'
  | 'medium27'
  | 'medium28'
  // Dark styles
  | 'dark1'
  | 'dark2'
  | 'dark3'
  | 'dark4'
  | 'dark5'
  | 'dark6'
  | 'dark7'
  | 'dark8'
  | 'dark9'
  | 'dark10'
  | 'dark11';

/**
 * Custom table style definition (user-defined).
 * Allows fine-grained control over table appearance.
 */
export interface TableCustomStyle {
  /** Header row background color */
  headerRowFill?: string;
  /** Header row font formatting */
  headerRowFont?: CellFormat;
  /** Data row background color */
  dataRowFill?: string;
  /** Alternating data row background (for banded rows) */
  dataRowAltFill?: string;
  /** Total row background color */
  totalRowFill?: string;
  /** Total row font formatting */
  totalRowFont?: CellFormat;
  /** First column highlight background */
  firstColumnFill?: string;
  /** Last column highlight background */
  lastColumnFill?: string;
}

/**
 * Complete table style configuration.
 * Either uses a preset or custom style definition.
 */
export interface TableStyle {
  /** Preset style name (mutually exclusive with custom) */
  preset?: TableStylePreset;
  /** Custom style definition (mutually exclusive with preset) */
  custom?: TableCustomStyle;
  /** Show alternating row colors */
  showBandedRows?: boolean;
  /** Show alternating column colors */
  showBandedColumns?: boolean;
  /** Highlight first column with special formatting */
  showFirstColumnHighlight?: boolean;
  /** Highlight last column with special formatting */
  showLastColumnHighlight?: boolean;
}

// ============================================================================
// Table Column Configuration
// ============================================================================

/**
 * Total row function types.
 * Maps to Excel's total row dropdown options.
 */
export type TotalFunction =
  | 'none'
  | 'sum'
  | 'count'
  | 'average'
  | 'min'
  | 'max'
  | 'stdDev'
  | 'var'
  | 'countNums'
  | 'custom';

/**
 * Column definition within a table.
 * Each column has a stable ID and configurable total row behavior.
 */
export interface TableColumn {
  /** Unique column ID (stable across renames) */
  id: string;
  /** Display name shown in header row */
  name: string;
  /** Column index within table (0-indexed) */
  index: number;
  /** Total row formula (e.g., "=SUBTOTAL(109,[Sales])") */
  totalFormula?: string;
  /** Total row function type for UI display */
  totalFunction?: TotalFunction;
  /** Column-level data validation schema ID (optional) */
  validationSchemaId?: string;
  /**
   * Calculated column formula.
   * When set, this formula automatically fills the entire column.
   * New rows automatically get this formula.
   * Uses structured references with @ shorthand (e.g., "=[@Price]*[@Quantity]").
   */
  calculatedFormula?: string;
}

// ============================================================================
// Table Configuration
// ============================================================================

/**
 * Complete table configuration stored in Yjs.
 * This is the source of truth for table metadata.
 *
 * Tables use CellIdRange for CRDT-safe range tracking.
 * The rangeIdentity field stores CellId corners, and position-based
 * range is resolved at render time via resolveTableRange().
 */
export interface TableConfig {
  /** Unique table identifier */
  id: string;
  /** Table name used in structured references (e.g., "Table1") */
  name: string;
  /** Sheet containing the table */
  sheetId: SheetId;

  /**
   * CellId-based range (CRDT-safe).
   * Automatically expands when rows/cols inserted inside table.
   * Resolution to positions happens at render time.
   */
  rangeIdentity?: CellIdRange;

  /**
   * @deprecated Use rangeIdentity instead.
   * Legacy position-based range - kept for migration only.
   * Table range (includes header and total rows if present)
   */
  range: CellRange;

  /** Whether table has a header row (default: true) */
  hasHeaderRow: boolean;
  /** Whether table has a total row (default: false) */
  hasTotalRow: boolean;
  /** Column definitions in order */
  columns: TableColumn[];
  /** Style configuration */
  style: TableStyle;
  /** Auto-expand when data added adjacent to table (default: true) */
  autoExpand: boolean;
  /** Auto-create/fill calculated columns when formulas are entered in data columns (default: true) */
  autoCalculatedColumns: boolean;
  /** Show filter dropdowns in header row (default: true) */
  showFilterButtons: boolean;
  /** Created timestamp (Unix ms) */
  createdAt?: number;
  /** Last modified timestamp (Unix ms) */
  updatedAt?: number;
}

// ============================================================================
// Structured References
// ============================================================================

/**
 * Special item specifiers in structured references.
 * Used in formulas like Table1[[#Headers],[Sales]]
 */
export type StructuredReferenceSpecifier =
  | 'all' // Entire table including headers and totals
  | 'data' // Data rows only (excludes headers and totals)
  | 'headers' // Header row only
  | 'totals' // Total row only
  | 'thisRow'; // Current row (for formulas within table)

/**
 * Parsed structured reference from a formula.
 * Represents references like Table1[[#Headers],[Sales]:[Revenue]]
 */
export interface StructuredReference {
  /** Table name as it appears in the formula */
  tableName: string;
  /** Special item specifiers (can be multiple) */
  specifiers: StructuredReferenceSpecifier[];
  /** Column references (names or ranges like [Start]:[End]) */
  columns: string[];
  /** Whether this is a reference to the entire table (no column specifier) */
  isWholeTable: boolean;
}

// ============================================================================
// Table Manager Interface
// ============================================================================

/**
 * Options for creating a new table.
 */
export interface CreateTableOptions {
  /** Table name (auto-generated if not provided) */
  name?: string;
  /** Whether first row contains headers (default: true) */
  hasHeaderRow?: boolean;
  /** Initial style configuration */
  style?: TableStyle;
  /** Auto-expand behavior (default: true) */
  autoExpand?: boolean;
  /** Auto-calculated-column behavior (default: true) */
  autoCalculatedColumns?: boolean;
  /** Show filter buttons (default: true) */
  showFilterButtons?: boolean;
}

/**
 * Result of resolving a structured reference to cell coordinates.
 */
export interface ResolvedStructuredReference {
  /** The resolved cell range */
  range: CellRange;
  /** Table ID this reference belongs to */
  tableId: string;
  /** Whether the reference is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
}

/**
 * Table manager interface for CRUD operations on tables.
 * Implemented in engine, integrated via coordinator.
 */
export interface ITableManager {
  // === CRUD Operations ===

  /**
   * Create a new table from a cell range.
   * @param sheetId Sheet to create the table in
   * @param range Cell range for the table
   * @param options Optional configuration
   * @returns The created table configuration
   */
  createTable(sheetId: string, range: CellRange, options?: CreateTableOptions): TableConfig;

  /**
   * Get table by ID.
   * @param tableId Table identifier
   * @returns Table configuration or undefined if not found
   */
  getTable(tableId: string): TableConfig | undefined;

  /**
   * Get table by name.
   * @param tableName Table name (case-insensitive)
   * @returns Table configuration or undefined if not found
   */
  getTableByName(tableName: string): TableConfig | undefined;

  /**
   * Get all tables in a sheet.
   * @param sheetId Sheet identifier
   * @returns Array of table configurations
   */
  getTablesInSheet(sheetId: string): TableConfig[];

  /**
   * Get all tables in the workbook.
   * @returns Array of all table configurations
   */
  getAllTables(): TableConfig[];

  /**
   * Update table configuration.
   * @param tableId Table identifier
   * @param updates Partial configuration to merge
   */
  updateTable(tableId: string, updates: Partial<TableConfig>): void;

  /**
   * Delete a table (removes table formatting but keeps cell data).
   * @param tableId Table identifier
   */
  deleteTable(tableId: string): void;

  // === Table Operations ===

  /**
   * Convert table back to a regular range (removes table, keeps data).
   * @param tableId Table identifier
   */
  convertToRange(tableId: string): void;

  /**
   * Resize table to a new range.
   * @param tableId Table identifier
   * @param newRange New table range
   */
  resizeTable(tableId: string, newRange: CellRange): void;

  /**
   * Enable or disable the total row.
   * @param tableId Table identifier
   * @param enabled Whether to show total row
   */
  setTotalRow(tableId: string, enabled: boolean): void;

  /**
   * Set total row function for a column.
   * @param tableId Table identifier
   * @param columnIndex Column index within table
   * @param fn Total function type
   */
  setColumnTotalFunction(tableId: string, columnIndex: number, fn: TotalFunction): void;

  /**
   * Rename a table.
   * @param tableId Table identifier
   * @param newName New table name
   */
  renameTable(tableId: string, newName: string): void;

  /**
   * Rename a column in a table.
   * @param tableId Table identifier
   * @param columnIndex Column index within table
   * @param newName New column name
   */
  renameColumn(tableId: string, columnIndex: number, newName: string): void;

  // === Query Methods ===

  /**
   * Check if a cell is inside any table.
   * @param sheetId Sheet identifier
   * @param row Row index
   * @param col Column index
   * @returns True if cell is inside a table
   */
  isInTable(sheetId: string, row: number, col: number): boolean;

  /**
   * Get the table containing a specific cell.
   * @param sheetId Sheet identifier
   * @param row Row index
   * @param col Column index
   * @returns Table configuration or undefined if cell is not in a table
   */
  getTableAtCell(sheetId: string, row: number, col: number): TableConfig | undefined;

  /**
   * Get the data range of a table (excludes header and total rows).
   * @param tableId Table identifier
   * @returns Data-only range
   */
  getDataRange(tableId: string): CellRange;

  /**
   * Get the header row range of a table.
   * @param tableId Table identifier
   * @returns Header row range or undefined if no header row
   */
  getHeaderRange(tableId: string): CellRange | undefined;

  /**
   * Get the total row range of a table.
   * @param tableId Table identifier
   * @returns Total row range or undefined if no total row
   */
  getTotalRange(tableId: string): CellRange | undefined;

  // === Structured Reference Support ===

  /**
   * Parse a structured reference string.
   * @param ref Structured reference string (e.g., "Table1[Sales]")
   * @returns Parsed reference or null if invalid syntax
   */
  parseStructuredReference(ref: string): StructuredReference | null;

  /**
   * Resolve a structured reference to a cell range.
   * @param ref Parsed structured reference
   * @param currentRow Current row for [#This Row] resolution (optional)
   * @returns Resolved range with validity status
   */
  resolveStructuredReference(
    ref: StructuredReference,
    currentRow?: number,
  ): ResolvedStructuredReference;

  /**
   * Generate a structured reference string for a range within a table.
   * @param tableId Table identifier
   * @param range Range within the table
   * @returns Structured reference string or null if range not in table
   */
  generateStructuredReference(tableId: string, range: CellRange): string | null;

  // === Validation ===

  /**
   * Check if a table name is valid and available.
   * @param name Proposed table name
   * @param excludeTableId Table ID to exclude from uniqueness check (for renames)
   * @returns True if name is valid and available
   */
  isValidTableName(name: string, excludeTableId?: string): boolean;

  /**
   * Generate a unique table name.
   * @returns Unique name like "Table1", "Table2", etc.
   */
  generateTableName(): string;
}
