/**
 * Table Driver Interface
 *
 * The core interface for table data storage drivers.
 * Implementations can be local (Yjs) or external (Postgres, REST, etc.)
 *
 */

import type { TableDriverCapabilities } from './capabilities';
import type { ConnectionStatus, DriverType, RowId, TableId } from './connection';
import type { Query } from './query';

// =============================================================================
// Record Types
// =============================================================================

/**
 * Raw record data (without system fields).
 */
export type RecordData = Record<string, unknown>;

/**
 * A record with its row ID.
 */
export interface TableRecord {
  /** The unique row identifier */
  _rowId: RowId;
  /** Record data fields */
  [key: string]: unknown;
}

// =============================================================================
// Schema Types
// =============================================================================

/**
 * Schema for a table.
 */
export interface TableSchema {
  /** Column definitions */
  columns: ColumnSchema[];
  /** Primary key column name (optional) */
  primaryKey?: string;
}

/**
 * Schema for a column.
 */
export interface ColumnSchema {
  /** Column name */
  name: string;
  /** Column data type */
  type: ColumnType;
  /** Whether the column can contain null values */
  nullable: boolean;
  /** Default value for the column (optional) */
  defaultValue?: unknown;
}

/**
 * Supported column data types.
 * These map to common types across SQL, REST, and local storage.
 */
export type ColumnType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'json'
  | 'array'
  | 'unknown';

// =============================================================================
// Change Types (for subscriptions)
// =============================================================================

/**
 * A change to a table record.
 * Used for real-time subscriptions.
 */
export type TableChange =
  | { type: 'insert'; rowId: RowId; data: RecordData }
  | { type: 'update'; rowId: RowId; data: Partial<RecordData>; previous?: Partial<RecordData> }
  | { type: 'delete'; rowId: RowId };

// =============================================================================
// Error Types
// =============================================================================

/**
 * Errors that can occur during driver operations.
 */
export type DriverError =
  | { type: 'connection_lost'; reconnectingIn?: number }
  | { type: 'query_failed'; query: Query | string; message: string }
  | { type: 'permission_denied'; tableId: TableId; operation: string }
  | { type: 'rate_limited'; retryAfter?: number }
  | { type: 'unknown'; message: string };

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Function to unsubscribe from a subscription.
 */
export type Unsubscribe = () => void;

/**
 * Ping result for connection health checks.
 */
export type PingResult = { latencyMs: number } | { error: string };

// =============================================================================
// ITableDriver Interface
// =============================================================================

/**
 * Interface for table data storage drivers.
 * Implementations can be local (Yjs) or external (Postgres, REST, etc.)
 */
export interface ITableDriver {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  /** Unique identifier for this driver instance */
  readonly id: string;

  /** The driver type */
  readonly type: DriverType;

  // ---------------------------------------------------------------------------
  // Connection Status
  // ---------------------------------------------------------------------------

  /** Current connection status */
  readonly status: ConnectionStatus;

  /** Timestamp of last successful sync (null if never synced) */
  readonly lastSync: number | null;

  // ---------------------------------------------------------------------------
  // Capabilities
  // ---------------------------------------------------------------------------

  /** What this driver can do */
  readonly capabilities: TableDriverCapabilities;

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  /**
   * Get the schema for a table.
   *
   * @param tableId - The table to get schema for
   * @returns The table schema
   */
  getSchema(tableId: TableId): Promise<TableSchema>;

  // ---------------------------------------------------------------------------
  // CRUD Operations (uses portable Query contract)
  // ---------------------------------------------------------------------------

  /**
   * Get records from a table.
   *
   * @param tableId - The table to query
   * @param query - Optional query to filter/sort/limit results
   * @returns Array of records
   */
  getRecords(tableId: TableId, query?: Query): Promise<TableRecord[]>;

  /**
   * Create a new record.
   *
   * @param tableId - The table to create in
   * @param data - The record data
   * @returns The ID of the created record
   */
  createRecord(tableId: TableId, data: RecordData): Promise<RowId>;

  /**
   * Update an existing record.
   *
   * @param tableId - The table containing the record
   * @param rowId - The record to update
   * @param data - The fields to update
   */
  updateRecord(tableId: TableId, rowId: RowId, data: Partial<RecordData>): Promise<void>;

  /**
   * Delete a record.
   *
   * @param tableId - The table containing the record
   * @param rowId - The record to delete
   */
  deleteRecord(tableId: TableId, rowId: RowId): Promise<void>;

  // ---------------------------------------------------------------------------
  // Native Query (escape hatch)
  // ---------------------------------------------------------------------------

  /**
   * Execute a native query.
   * For complex queries that the portable Query contract can't express.
   *
   * - Postgres: raw SQL
   * - REST: raw URL
   * - GraphQL: raw query string
   *
   * @param query - The native query string
   * @param params - Query parameters (for SQL prepared statements)
   * @returns Array of records
   */
  executeNative?(query: string, params?: unknown[]): Promise<TableRecord[]>;

  // ---------------------------------------------------------------------------
  // Real-time Subscriptions (optional)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to changes on a table.
   *
   * @param tableId - The table to watch
   * @param cb - Callback for changes
   * @returns Function to unsubscribe
   */
  subscribe?(tableId: TableId, cb: (changes: TableChange[]) => void): Unsubscribe;

  // ---------------------------------------------------------------------------
  // Batch Operations (optional - falls back to sequential if not implemented)
  // ---------------------------------------------------------------------------

  /**
   * Create multiple records at once.
   * More efficient than calling createRecord() in a loop.
   *
   * @param tableId - The table to create in
   * @param data - Array of record data
   * @returns Array of created record IDs
   */
  createRecords?(tableId: TableId, data: RecordData[]): Promise<RowId[]>;

  /**
   * Update multiple records at once.
   *
   * @param tableId - The table containing the records
   * @param updates - Array of updates (rowId + data)
   */
  updateRecords?(
    tableId: TableId,
    updates: Array<{ rowId: RowId; data: Partial<RecordData> }>,
  ): Promise<void>;

  /**
   * Delete multiple records at once.
   *
   * @param tableId - The table containing the records
   * @param rowIds - Array of record IDs to delete
   */
  deleteRecords?(tableId: TableId, rowIds: RowId[]): Promise<void>;

  // ---------------------------------------------------------------------------
  // Streaming (optional - for large results)
  // ---------------------------------------------------------------------------

  /**
   * Stream records from a table.
   * For large result sets (100K+ rows) where loading all at once isn't practical.
   *
   * @param tableId - The table to query
   * @param query - Optional query to filter/sort results
   * @returns Async iterable of records
   */
  streamRecords?(tableId: TableId, query?: Query): AsyncIterable<TableRecord>;

  // ---------------------------------------------------------------------------
  // Manual Refresh (for external sources)
  // ---------------------------------------------------------------------------

  /**
   * Manually refresh data from the external source.
   * No-op for local drivers.
   *
   * @param tableId - The table to refresh
   */
  refresh?(tableId: TableId): Promise<void>;

  // ---------------------------------------------------------------------------
  // Connection Health & Errors
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to connection status changes.
   *
   * @param cb - Callback for status changes
   * @returns Function to unsubscribe
   */
  onStatusChange?(cb: (status: ConnectionStatus) => void): Unsubscribe;

  /**
   * Subscribe to driver errors.
   *
   * @param cb - Callback for errors
   * @returns Function to unsubscribe
   */
  onError?(cb: (error: DriverError) => void): Unsubscribe;

  /**
   * Check connection health.
   *
   * @returns Latency in ms if connected, or error message
   */
  ping?(): Promise<PingResult>;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Establish connection to the data source.
   * For local drivers, this may be a no-op.
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the data source.
   * Clean up resources, close connections.
   */
  disconnect(): Promise<void>;
}

// =============================================================================
// Utility Functions
// =============================================================================
