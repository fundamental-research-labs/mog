/**
 * Table Driver Runtime Functions
 *
 * Error factories and batch helpers for table drivers.
 * Types/interfaces remain in @mog-sdk/contracts/storage/table-driver.
 */

import type {
  DriverError,
  ITableDriver,
  Query,
  RecordData,
  RowId,
  TableId,
} from '@mog-sdk/contracts/storage';

// =============================================================================
// Error Factories
// =============================================================================

/**
 * Create a connection lost error.
 */
export function connectionLostError(reconnectingIn?: number): DriverError {
  return { type: 'connection_lost', reconnectingIn };
}

/**
 * Create a query failed error.
 */
export function queryFailedError(query: Query | string, message: string): DriverError {
  return { type: 'query_failed', query, message };
}

/**
 * Create a permission denied error.
 */
export function permissionDeniedError(tableId: TableId, operation: string): DriverError {
  return { type: 'permission_denied', tableId, operation };
}

/**
 * Create a rate limited error.
 */
export function rateLimitedError(retryAfter?: number): DriverError {
  return { type: 'rate_limited', retryAfter };
}

/**
 * Create an unknown error.
 */
export function unknownDriverError(message: string): DriverError {
  return { type: 'unknown', message };
}

// =============================================================================
// Batch Helpers
// =============================================================================

/**
 * Helper to execute batch operations with fallback to sequential.
 */
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

/**
 * Helper to execute batch updates with fallback to sequential.
 */
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

/**
 * Helper to execute batch deletes with fallback to sequential.
 */
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
