/**
 * App Kernel API - Interface Definition
 *
 * This is THE contract between apps and the kernel. Apps import this interface
 * and receive an implementation from the Shell host.
 *
 * The API is organized into sub-APIs for different domains:
 * - tables: Table CRUD operations
 * - columns: Column CRUD operations
 * - records: Record CRUD operations
 * - relations: Relation traversal
 * - events: Subscribe to data changes
 *
 */

import type {
  AppCellValue,
  AppColumnId,
  AppColumnInfo,
  AppColumnSchema,
  AppQueryOptions,
  AppRecord,
  AppTableId,
  AppTableInfo,
  AppTableSchema,
  RecordId,
  Unsubscribe,
} from './types';

import type { IUndoService } from '../services';
import type { AppInstance, TableBinding } from './bindings';

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event payload for record changes.
 */
export interface RecordChangeEvent {
  type: 'created' | 'updated' | 'deleted';
  tableId: AppTableId;
  recordId: RecordId;
  /** For 'updated', the fields that changed */
  changedFields?: (AppColumnId | string)[];
  /** For 'created' and 'updated', the new record */
  record?: AppRecord;
}

/**
 * Event payload for table schema changes.
 */
export interface TableSchemaChangeEvent {
  type: 'columnAdded' | 'columnRemoved' | 'columnRenamed' | 'columnTypeChanged' | 'tableRenamed';
  tableId: AppTableId;
  columnId?: AppColumnId;
  oldName?: string;
  newName?: string;
}

/**
 * Handler for record change events.
 */
export type RecordChangeHandler = (event: RecordChangeEvent) => void;

/**
 * Handler for table schema change events.
 */
export type TableSchemaChangeHandler = (event: TableSchemaChangeEvent) => void;

// =============================================================================
// Tables API
// =============================================================================

/**
 * API for table operations.
 */
export interface IAppTablesAPI {
  /**
   * Get a table by ID.
   * @param tableId - Table identifier
   * @returns Table info or null if not found
   */
  get(tableId: AppTableId): Promise<AppTableInfo | null>;

  /**
   * Find a table by name.
   * @param name - Table name
   * @returns Table info or null if not found
   */
  findByName(name: string): Promise<AppTableInfo | null>;

  /**
   * List all tables.
   * @returns Array of table info
   */
  list(): Promise<AppTableInfo[]>;

  /**
   * Create a new table.
   * @param schema - Table schema
   * @param options - Creation options
   * @returns Created table info
   */
  create(
    schema: AppTableSchema,
    options?: {
      /** Sheet to create table in (creates new sheet if not specified) */
      sheetId?: string;
      /** Starting cell (A1 notation, defaults to A1) */
      startCell?: string;
    },
  ): Promise<AppTableInfo>;

  /**
   * Rename a table.
   * @param tableId - Table identifier
   * @param newName - New table name
   */
  rename(tableId: AppTableId, newName: string): Promise<void>;

  /**
   * Delete a table.
   * Note: This removes the table definition, not the underlying data.
   * @param tableId - Table identifier
   */
  delete(tableId: AppTableId): Promise<void>;
}

// =============================================================================
// Columns API
// =============================================================================

/**
 * API for column operations.
 */
export interface IAppColumnsAPI {
  /**
   * Get column info by ID.
   * @param tableId - Table identifier
   * @param columnId - Column identifier
   * @returns Column info or null if not found
   */
  get(tableId: AppTableId, columnId: AppColumnId): Promise<AppColumnInfo | null>;

  /**
   * Find a column by name.
   * @param tableId - Table identifier
   * @param name - Column name
   * @returns Column info or null if not found
   */
  findByName(tableId: AppTableId, name: string): Promise<AppColumnInfo | null>;

  /**
   * List all columns in a table.
   * @param tableId - Table identifier
   * @returns Array of column info
   */
  list(tableId: AppTableId): Promise<AppColumnInfo[]>;

  /**
   * Add a new column to a table.
   * @param tableId - Table identifier
   * @param schema - Column schema
   * @param options - Creation options
   * @returns Created column info
   */
  create(
    tableId: AppTableId,
    schema: AppColumnSchema,
    options?: {
      /** Insert at specific position (0-indexed, defaults to end) */
      index?: number;
    },
  ): Promise<AppColumnInfo>;

  /**
   * Update a column's schema.
   * @param tableId - Table identifier
   * @param columnId - Column identifier
   * @param updates - Partial schema updates
   */
  update(
    tableId: AppTableId,
    columnId: AppColumnId,
    updates: Partial<AppColumnSchema>,
  ): Promise<void>;

  /**
   * Rename a column.
   * @param tableId - Table identifier
   * @param columnId - Column identifier
   * @param newName - New column name
   */
  rename(tableId: AppTableId, columnId: AppColumnId, newName: string): Promise<void>;

  /**
   * Delete a column.
   * @param tableId - Table identifier
   * @param columnId - Column identifier
   */
  delete(tableId: AppTableId, columnId: AppColumnId): Promise<void>;
}

// =============================================================================
// Records API
// =============================================================================

/**
 * API for record (row) operations.
 */
export interface IAppRecordsAPI {
  /**
   * Get a single record by ID.
   * @param tableId - Table identifier
   * @param recordId - Record identifier
   * @returns Record or null if not found
   */
  get(tableId: AppTableId, recordId: RecordId): Promise<AppRecord | null>;

  /**
   * List records with optional filtering, sorting, and pagination.
   * @param tableId - Table identifier
   * @param options - Query options
   * @returns Array of records
   */
  list(tableId: AppTableId, options?: AppQueryOptions): Promise<AppRecord[]>;

  /**
   * Create a new record.
   * @param tableId - Table identifier
   * @param values - Field values (by column name or ID)
   * @returns Created record
   */
  create(tableId: AppTableId, values: Record<string, AppCellValue>): Promise<AppRecord>;

  /**
   * Update a record.
   * @param tableId - Table identifier
   * @param recordId - Record identifier
   * @param values - Field values to update (by column name or ID)
   * @returns Updated record
   */
  update(
    tableId: AppTableId,
    recordId: RecordId,
    values: Record<string, AppCellValue>,
  ): Promise<AppRecord>;

  /**
   * Delete a record.
   * LOAD-BEARING: This MUST actually remove the row from the table.
   * @param tableId - Table identifier
   * @param recordId - Record identifier
   */
  delete(tableId: AppTableId, recordId: RecordId): Promise<void>;

  /**
   * Batch create multiple records.
   * More efficient than calling create() in a loop.
   * @param tableId - Table identifier
   * @param records - Array of field value objects
   * @returns Array of created records
   */
  createBatch(tableId: AppTableId, records: Record<string, AppCellValue>[]): Promise<AppRecord[]>;

  /**
   * Batch update multiple records.
   * @param tableId - Table identifier
   * @param updates - Array of { id, values } objects
   * @returns Array of updated records
   */
  updateBatch(
    tableId: AppTableId,
    updates: Array<{ id: RecordId; values: Record<string, AppCellValue> }>,
  ): Promise<AppRecord[]>;

  /**
   * Batch delete multiple records.
   * @param tableId - Table identifier
   * @param recordIds - Array of record IDs to delete
   */
  deleteBatch(tableId: AppTableId, recordIds: RecordId[]): Promise<void>;
}

// =============================================================================
// Relations API
// =============================================================================

/**
 * Relation link between records.
 */
export interface RelationLink {
  /** Source table ID */
  sourceTableId: AppTableId;
  /** Source record ID */
  sourceRecordId: RecordId;
  /** Relation column ID in source table */
  relationColumnId: AppColumnId;
  /** Target table ID */
  targetTableId: AppTableId;
  /** Target record ID */
  targetRecordId: RecordId;
}

/**
 * API for relation traversal.
 */
export interface IAppRelationsAPI {
  /**
   * Get related records through a relation column.
   * @param tableId - Source table ID
   * @param recordId - Source record ID
   * @param relationColumnId - Relation column ID
   * @returns Array of related records
   */
  getRelated(
    tableId: AppTableId,
    recordId: RecordId,
    relationColumnId: AppColumnId,
  ): Promise<AppRecord[]>;

  /**
   * Get all records that link TO this record (reverse lookup).
   * @param tableId - Target table ID
   * @param recordId - Target record ID
   * @param options - Optional filter by source table/column
   * @returns Array of records that reference this record
   */
  getBacklinks(
    tableId: AppTableId,
    recordId: RecordId,
    options?: {
      sourceTableId?: AppTableId;
      sourceColumnId?: AppColumnId;
    },
  ): Promise<AppRecord[]>;

  /**
   * Link two records via a relation column.
   * @param sourceTableId - Source table ID
   * @param sourceRecordId - Source record ID
   * @param relationColumnId - Relation column ID in source table
   * @param targetRecordId - Target record ID to link to
   */
  link(
    sourceTableId: AppTableId,
    sourceRecordId: RecordId,
    relationColumnId: AppColumnId,
    targetRecordId: RecordId,
  ): Promise<void>;

  /**
   * Unlink two records.
   * @param sourceTableId - Source table ID
   * @param sourceRecordId - Source record ID
   * @param relationColumnId - Relation column ID
   * @param targetRecordId - Target record ID to unlink
   */
  unlink(
    sourceTableId: AppTableId,
    sourceRecordId: RecordId,
    relationColumnId: AppColumnId,
    targetRecordId: RecordId,
  ): Promise<void>;
}

// =============================================================================
// Events API
// =============================================================================

/**
 * API for subscribing to data changes.
 */
export interface IAppEventsAPI {
  /**
   * Subscribe to record changes in a table.
   * @param tableId - Table to watch
   * @param handler - Change handler
   * @returns Unsubscribe function
   */
  onRecordChange(tableId: AppTableId, handler: RecordChangeHandler): Unsubscribe;

  /**
   * Subscribe to table schema changes.
   * @param tableId - Table to watch
   * @param handler - Change handler
   * @returns Unsubscribe function
   */
  onSchemaChange(tableId: AppTableId, handler: TableSchemaChangeHandler): Unsubscribe;

  /**
   * Subscribe to changes on a specific record.
   * @param tableId - Table ID
   * @param recordId - Record ID
   * @param handler - Change handler
   * @returns Unsubscribe function
   */
  onRecordFieldChange(
    tableId: AppTableId,
    recordId: RecordId,
    handler: (fieldId: AppColumnId, value: AppCellValue) => void,
  ): Unsubscribe;
}

// =============================================================================
// Clipboard API
// =============================================================================

/**
 * Clipboard payload for cross-app copy/paste.
 * Simplified version for apps - the kernel manages the full payload internally.
 */
export interface AppClipboardPayload {
  /**
   * Cell values as 2D array (for spreadsheet paste).
   * Each inner array is a row of values.
   */
  cells: AppCellValue[][];

  /**
   * Plain text representation (TSV format).
   * Used for pasting into external apps.
   */
  text: string;

  /**
   * Table context for smart paste (optional).
   */
  tableContext?: {
    /** Source table ID */
    sourceTableId: AppTableId;
    /** Record IDs being copied */
    recordIds: RecordId[];
    /** Column names in order */
    columnNames: string[];
  };
}

/**
 * Clipboard state snapshot for apps.
 */
export interface AppClipboardSnapshot {
  /** Whether clipboard has data */
  hasData: boolean;
  /** Current operation (copy/cut/null) */
  operation: 'copy' | 'cut' | null;
}

// =============================================================================
// Bindings API
// =============================================================================

/**
 * API for managing app data bindings.
 * Apps bind to tables rather than owning them directly.
 *
 */
export interface IAppBindingsAPI {
  /**
   * Get all instances for an app type.
   * @param appId - App identifier from manifest
   * @returns Array of app instances
   */
  getInstances(appId: string): AppInstance[];

  /**
   * Get a specific instance.
   * @param instanceId - Instance identifier
   * @returns App instance or null if not found
   */
  getInstance(instanceId: string): AppInstance | null;

  /**
   * Create a new app instance.
   * @param appId - App identifier from manifest
   * @param name - User-given name for this instance
   * @returns Created app instance
   */
  createInstance(appId: string, name: string): AppInstance;

  /**
   * Update instance bindings.
   * @param instanceId - Instance identifier
   * @param bindings - New bindings to set
   */
  updateBindings(instanceId: string, bindings: Record<string, TableBinding>): void;

  /**
   * Mark instance setup as complete.
   * @param instanceId - Instance identifier
   */
  completeSetup(instanceId: string): void;

  /**
   * Delete an instance.
   * @param instanceId - Instance identifier
   */
  deleteInstance(instanceId: string): void;
}

// =============================================================================
// Clipboard API
// =============================================================================

/**
 * API for clipboard operations.
 * Apps can copy records to clipboard for cross-app paste.
 */
export interface IAppClipboardAPI {
  /**
   * Copy data to clipboard.
   * @param payload - Data to copy
   */
  copy(payload: AppClipboardPayload): void;

  /**
   * Cut data to clipboard (single-use).
   * @param payload - Data to cut
   */
  cut(payload: AppClipboardPayload): void;

  /**
   * Get current clipboard state.
   */
  getSnapshot(): AppClipboardSnapshot;

  /**
   * Get the current clipboard payload data.
   * Returns null if clipboard is empty.
   */
  getPayload(): AppClipboardPayload | null;

  /**
   * Clear clipboard.
   */
  clear(): void;

  /**
   * Subscribe to clipboard state changes.
   * @param handler - Called when clipboard state changes
   */
  subscribe(handler: (snapshot: AppClipboardSnapshot) => void): Unsubscribe;
}

// =============================================================================
// Main API Interface
// =============================================================================

/**
 * The App Kernel API.
 *
 * This is the main interface that apps use to interact with the spreadsheet kernel.
 * Apps receive an implementation of this interface from the Shell host.
 *
 * Design:
 * - Organized into logical sub-APIs (tables, columns, records, etc.)
 * - Uses opaque ID types (apps don't see internal CellId/RowId/ColId)
 * - Provides dual access patterns (by name and by ID)
 *
 * Example usage:
 * ```typescript
 * // Get a table by name
 * const deals = api.tables.findByName('Deals');
 *
 * // Query records with filtering and sorting
 * const openDeals = api.records.list(deals.id, {
 *   filter: { conditions: [{ field: 'Status', operator: 'equals', value: 'Open' }] },
 *   sort: [{ field: 'Value', direction: 'desc' }]
 * });
 *
 * // Create a new record
 * const newDeal = api.records.create(deals.id, {
 *   'Name': 'Acme Corp Deal',
 *   'Value': 50000,
 *   'Status': 'Open'
 * });
 *
 * // Subscribe to changes
 * const unsubscribe = api.events.onRecordChange(deals.id, (event) => {
 *   console.log('Record changed:', event.recordId, event.type);
 * });
 * ```
 */
export interface IAppKernelAPI {
  /** Table operations */
  readonly tables: IAppTablesAPI;

  /** Column operations */
  readonly columns: IAppColumnsAPI;

  /** Record operations */
  readonly records: IAppRecordsAPI;

  /** Relation traversal */
  readonly relations: IAppRelationsAPI;

  /** Event subscriptions */
  readonly events: IAppEventsAPI;

  /** Clipboard operations (cross-app copy/paste) */
  readonly clipboard?: IAppClipboardAPI;

  /**
   * App data bindings management.
   * Optional for backward compatibility - may be undefined if bindings not yet implemented.
   */
  readonly bindings?: IAppBindingsAPI;

  /**
   * Undo/redo service for reverting changes.
   * May be undefined if undo service is not available.
   */
  readonly undo?: IUndoService;

  /**
   * Execute multiple operations as a single undo step.
   * NOT transactional: if an operation throws, prior writes remain committed.
   * @param fn - Function containing operations to group
   * @param description - Description for undo history
   */
  undoGroup<T>(fn: () => Promise<T> | T, description?: string): Promise<T>;
}

// =============================================================================
// App Context Types
// =============================================================================

/**
 * App metadata provided to the kernel.
 */
export interface AppManifest {
  /** Unique app identifier */
  id: string;

  /** Display name */
  name: string;

  /** App version */
  version: string;

  /** Icon (emoji or icon identifier) */
  icon?: string;

  /** Description */
  description?: string;

  /** Author */
  author?: string;

  /** Tables this app manages (for ensureAppTables) */
  managedTables?: AppTableSchema[];

  /**
   * Views contributed by this app.
   * These views appear in view tabs for applicable tables.
   * @see contracts/src/apps/views.ts
   */
  views?: import('./views').ViewContribution[];
}

/**
 * Context provided to an app when it starts.
 */
export interface AppContext {
  /** App's manifest */
  manifest: AppManifest;

  /** The App Kernel API */
  api: IAppKernelAPI;

  /**
   * Ensure app's managed tables exist.
   * Creates tables from manifest.managedTables if they don't exist.
   * Returns existing tables if they already exist (idempotent).
   * @returns Map of table name to table ID
   */
  ensureAppTables(): Map<string, AppTableId>;
}
