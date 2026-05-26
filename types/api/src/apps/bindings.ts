/**
 * App Data Binding Types
 *
 * Apps bind to tables, they don't own tables. This enables:
 * - Fresh start: App creates new tables on a dedicated sheet
 * - Existing data: App binds to user's existing tables with column mappings
 *
 */

import type { AppColumnId, AppTableId, AppTableInfo } from './types';

// =============================================================================
// Core Binding Types
// =============================================================================

/**
 * Persisted app instance - represents one "installation" of an app with its data bindings.
 * One app type can have multiple instances (e.g., "Sales CRM" and "Recruiting CRM").
 *
 * Stored in WorkbookSettings.appInstances and persisted with the document.
 */
export interface AppInstance {
  /** Unique instance ID */
  instanceId: string;

  /** App type from manifest */
  appId: string;

  /** User-given name for this instance */
  name: string;

  /** Table bindings - maps app's logical tables to actual tables */
  bindings: Record<string, TableBinding>;

  /** Whether setup is complete */
  setupComplete: boolean;

  /** Created timestamp (Unix ms) */
  createdAt: number;
}

/**
 * Binding from an app's logical table to an actual table in the workbook.
 */
export interface TableBinding {
  /** The actual table ID in the workbook (null = needs setup) */
  tableId: AppTableId | null;

  /** Column mappings: app's logical column name -> actual column */
  columnMappings: Record<string, ColumnMapping>;

  /** Whether this table was created by the app (vs bound to existing) */
  isManaged: boolean;
}

/**
 * Mapping from an app's logical column to an actual column.
 */
export interface ColumnMapping {
  /** Target column ID */
  columnId: AppColumnId;

  /** Target column name (for display) */
  columnName: string;
}

// =============================================================================
// Resolved Binding Types (Runtime)
// =============================================================================

/**
 * Resolved bindings passed to app components at runtime.
 * All table IDs are guaranteed to exist.
 */
export interface ResolvedBindings {
  /** Map of logical table name -> resolved table info */
  tables: Record<string, ResolvedTableBinding>;
}

/**
 * A fully resolved table binding with table info loaded.
 */
export interface ResolvedTableBinding {
  /** Table ID */
  tableId: AppTableId;

  /** Table info */
  table: AppTableInfo;

  /** Map of logical column name -> actual column ID */
  columns: Record<string, AppColumnId>;

  /** Whether this was auto-created (managed) */
  isManaged: boolean;
}
