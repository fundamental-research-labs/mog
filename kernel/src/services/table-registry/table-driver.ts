/**
 * Table Driver Interface
 *
 * The core interface for table data storage drivers.
 * Extracted from @mog-sdk/contracts/storage.
 */

import type { TableDriverCapabilities } from './capabilities';
import type { ConnectionStatus, DriverType, RowId, TableId } from './connection';
import type { Query } from './query';

// =============================================================================
// Record Types
// =============================================================================

export type RecordData = Record<string, unknown>;

export interface TableRecord {
  _rowId: RowId;
  [key: string]: unknown;
}

// =============================================================================
// Schema Types
// =============================================================================

export interface TableSchema {
  columns: ColumnSchema[];
  primaryKey?: string;
}

export interface ColumnSchema {
  name: string;
  type: ColumnType;
  nullable: boolean;
  defaultValue?: unknown;
}

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
// Change Types
// =============================================================================

export type TableChange =
  | { type: 'insert'; rowId: RowId; data: RecordData }
  | { type: 'update'; rowId: RowId; data: Partial<RecordData>; previous?: Partial<RecordData> }
  | { type: 'delete'; rowId: RowId };

// =============================================================================
// Error Types
// =============================================================================

export type DriverError =
  | { type: 'connection_lost'; reconnectingIn?: number }
  | { type: 'query_failed'; query: Query | string; message: string }
  | { type: 'permission_denied'; tableId: TableId; operation: string }
  | { type: 'rate_limited'; retryAfter?: number }
  | { type: 'unknown'; message: string };

export function connectionLostError(reconnectingIn?: number): DriverError {
  return { type: 'connection_lost', reconnectingIn };
}

export function queryFailedError(query: Query | string, message: string): DriverError {
  return { type: 'query_failed', query, message };
}

export function permissionDeniedError(tableId: TableId, operation: string): DriverError {
  return { type: 'permission_denied', tableId, operation };
}

export function rateLimitedError(retryAfter?: number): DriverError {
  return { type: 'rate_limited', retryAfter };
}

export function unknownDriverError(message: string): DriverError {
  return { type: 'unknown', message };
}

// =============================================================================
// Utility Types
// =============================================================================

export type Unsubscribe = () => void;
export type PingResult = { latencyMs: number } | { error: string };

// =============================================================================
// ITableDriver Interface
// =============================================================================

export interface ITableDriver {
  readonly id: string;
  readonly type: DriverType;
  readonly status: ConnectionStatus;
  readonly lastSync: number | null;
  readonly capabilities: TableDriverCapabilities;

  getSchema(tableId: TableId): Promise<TableSchema>;
  getRecords(tableId: TableId, query?: Query): Promise<TableRecord[]>;
  createRecord(tableId: TableId, data: RecordData): Promise<RowId>;
  updateRecord(tableId: TableId, rowId: RowId, data: Partial<RecordData>): Promise<void>;
  deleteRecord(tableId: TableId, rowId: RowId): Promise<void>;

  executeNative?(query: string, params?: unknown[]): Promise<TableRecord[]>;
  subscribe?(tableId: TableId, cb: (changes: TableChange[]) => void): Unsubscribe;
  createRecords?(tableId: TableId, data: RecordData[]): Promise<RowId[]>;
  updateRecords?(
    tableId: TableId,
    updates: Array<{ rowId: RowId; data: Partial<RecordData> }>,
  ): Promise<void>;
  deleteRecords?(tableId: TableId, rowIds: RowId[]): Promise<void>;
  streamRecords?(tableId: TableId, query?: Query): AsyncIterable<TableRecord>;
  refresh?(tableId: TableId): Promise<void>;
  onStatusChange?(cb: (status: ConnectionStatus) => void): Unsubscribe;
  onError?(cb: (error: DriverError) => void): Unsubscribe;
  ping?(): Promise<PingResult>;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// =============================================================================
// Utility Functions
// =============================================================================

export async function batchCreate(
  driver: ITableDriver,
  tableId: TableId,
  data: RecordData[],
): Promise<RowId[]> {
  if (driver.createRecords) {
    return driver.createRecords(tableId, data);
  }
  const ids: RowId[] = [];
  for (const record of data) {
    ids.push(await driver.createRecord(tableId, record));
  }
  return ids;
}

export async function batchUpdate(
  driver: ITableDriver,
  tableId: TableId,
  updates: Array<{ rowId: RowId; data: Partial<RecordData> }>,
): Promise<void> {
  if (driver.updateRecords) {
    return driver.updateRecords(tableId, updates);
  }
  for (const { rowId, data } of updates) {
    await driver.updateRecord(tableId, rowId, data);
  }
}

export async function batchDelete(
  driver: ITableDriver,
  tableId: TableId,
  rowIds: RowId[],
): Promise<void> {
  if (driver.deleteRecords) {
    return driver.deleteRecords(tableId, rowIds);
  }
  for (const rowId of rowIds) {
    await driver.deleteRecord(tableId, rowId);
  }
}
