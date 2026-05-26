/**
 * App Kernel API - Type Definitions
 *
 * These types define the stable API surface for apps. Apps see only these types,
 * never internal kernel types like CellId, RowId, ColId.
 *
 * Design principles:
 * 1. Opaque IDs - RecordId, AppTableId, AppColumnId are branded strings
 * 2. Dual access - AppRecord provides values by name AND by column ID
 * 3. Stability - Internal kernel changes don't break apps
 *
 */

// =============================================================================
// Branded ID Types (Opaque to Apps)
// =============================================================================

/**
 * Opaque record identifier.
 * Maps internally to RowId but apps don't need to know this.
 */
export type RecordId = string & { readonly __brand: 'RecordId' };

/**
 * Opaque table identifier.
 * Maps internally to table ID string but apps don't need to know this.
 */
export type AppTableId = string & { readonly __brand: 'AppTableId' };

/**
 * Opaque column identifier.
 * Maps internally to ColId but apps don't need to know this.
 */
export type AppColumnId = string & { readonly __brand: 'AppColumnId' };

// =============================================================================
// Cell Value Types
// =============================================================================

/**
 * Primitive cell value types that apps can work with.
 */
export type AppCellValuePrimitive = string | number | boolean | null;

/**
 * Cell error representation for apps.
 */
export interface AppCellError {
  type: 'error';
  value: string; // Error code like '#REF!', '#VALUE!', etc.
  message?: string;
}

/**
 * Cell value type for apps.
 * Includes primitives and errors.
 */
export type AppCellValue = AppCellValuePrimitive | AppCellError;

// =============================================================================
// Record Types
// =============================================================================

/**
 * A record (row) in a table as seen by apps.
 *
 * LOAD-BEARING DECISION: Provides BOTH access patterns:
 * - `values` - Keyed by column NAME (convenient for app-managed tables)
 * - `valuesByColumnId` - Keyed by column ID (stable across renames)
 *
 * Apps choose based on their needs:
 * - App-managed tables use names (app controls schema, won't rename)
 * - User-created tables use IDs (user might rename columns)
 */
export interface AppRecord {
  /** Opaque record ID (maps to internal RowId) */
  id: RecordId;

  /** Table this record belongs to */
  tableId: AppTableId;

  /**
   * Values keyed by column NAME (convenience access).
   * Use this for app-managed tables where you control the schema.
   * Example: record.values["Status"]
   */
  values: Record<string, AppCellValue>;

  /**
   * Values keyed by column ID (stable access).
   * Use this for user-created tables where columns might be renamed.
   * Example: record.valuesByColumnId[STATUS_COL_ID]
   */
  valuesByColumnId: Record<AppColumnId, AppCellValue>;

  /** Timestamp when record was created (Unix ms) */
  createdAt?: number;

  /** Timestamp when record was last modified (Unix ms) */
  modifiedAt?: number;
}

// =============================================================================
// Column Types
// =============================================================================

/**
 * Column type kinds supported by the system.
 */
export type AppColumnTypeKind =
  // Primitives
  | 'text'
  | 'number'
  | 'date'
  | 'checkbox'
  | 'formula'
  // Rich types
  | 'select'
  | 'multiselect'
  | 'person'
  | 'file'
  | 'url'
  | 'email'
  | 'phone'
  | 'rating'
  | 'progress'
  // Computed (auto-populated)
  | 'createdTime'
  | 'modifiedTime'
  | 'createdBy'
  | 'modifiedBy'
  | 'autoNumber'
  // Relational
  | 'relation'
  | 'lookup'
  | 'rollup';

/**
 * Select option for select/multiselect columns.
 */
export interface AppSelectOption {
  id: string;
  name: string;
  color?: string;
}

/**
 * Column type configuration.
 */
export interface AppColumnType {
  kind: AppColumnTypeKind;

  // For select/multiselect
  options?: AppSelectOption[];

  // For number
  format?: string; // Number format code
  min?: number;
  max?: number;

  // For date
  includeTime?: boolean;

  // For rating
  maxRating?: number;

  // For formula
  formula?: string;

  // For relation
  targetTableId?: AppTableId;
  allowMultiple?: boolean; // For multi-select relations

  // For lookup/rollup
  relationColumnId?: AppColumnId;
  sourceColumnId?: AppColumnId;
  aggregation?:
    | 'sum'
    | 'avg'
    | 'min'
    | 'max'
    | 'count'
    | 'countAll'
    | 'countValues'
    | 'countUnique';
}

/**
 * Column information as seen by apps.
 */
export interface AppColumnInfo {
  /** Opaque column ID */
  id: AppColumnId;

  /** Column display name */
  name: string;

  /** Column type and configuration */
  type: AppColumnType;

  /** Whether the column is required (non-null) */
  required: boolean;

  /** Whether values must be unique */
  unique: boolean;

  /** Default value for new records */
  defaultValue?: AppCellValue;

  /** Column position (0-indexed) */
  index: number;
}

/**
 * Column schema for creating/updating columns.
 */
export interface AppColumnSchema {
  /** Column display name */
  name: string;

  /** Column type and configuration */
  type: AppColumnType;

  /** Whether the column is required (non-null) */
  required?: boolean;

  /** Whether values must be unique */
  unique?: boolean;

  /** Default value for new records */
  defaultValue?: AppCellValue;
}

// =============================================================================
// Table Types
// =============================================================================

/**
 * Table information as seen by apps.
 */
export interface AppTableInfo {
  /** Opaque table ID */
  id: AppTableId;

  /** Table display name */
  name: string;

  /** Columns in the table */
  columns: AppColumnInfo[];

  /** Number of records (rows) in the table */
  recordCount: number;

  /** ID of the sheet containing this table (opaque to apps) */
  sheetId: string;
}

/**
 * Table schema for creating tables.
 */
export interface AppTableSchema {
  /** Table display name */
  name: string;

  /** Column schemas */
  columns: AppColumnSchema[];
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Filter operator for queries.
 */
export type AppFilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'isAnyOf'
  | 'isNoneOf';

/**
 * Filter condition for a single field.
 */
export interface AppFilterCondition {
  /** Column to filter on (by ID or name) */
  field: AppColumnId | string;

  /** Filter operator */
  operator: AppFilterOperator;

  /** Value(s) to compare against */
  value?: AppCellValue | AppCellValue[];
}

/**
 * Combined filter expression (AND logic).
 */
export interface AppFilter {
  conditions: AppFilterCondition[];
}

/**
 * Sort direction.
 */
export type AppSortDirection = 'asc' | 'desc';

/**
 * Sort configuration for a single field.
 */
export interface AppSortConfig {
  /** Column to sort by (by ID or name) */
  field: AppColumnId | string;

  /** Sort direction */
  direction: AppSortDirection;
}

/**
 * Query options for listing records.
 */
export interface AppQueryOptions {
  /** Filter conditions */
  filter?: AppFilter;

  /** Sort configuration (applied in order) */
  sort?: AppSortConfig[];

  /** Maximum number of records to return */
  limit?: number;

  /** Number of records to skip (for pagination) */
  offset?: number;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Unsubscribe function returned by event subscriptions.
 */
export type Unsubscribe = () => void;
