/**
 * QUERY Formula Contracts
 *
 * Type definitions for the QUERY formula that executes database queries.
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { CellValue, SheetId } from '@mog/types-core/core';

// =============================================================================
// Connection Types
// =============================================================================

/**
 * A reference to a named database connection.
 *
 * In formulas, connections are referenced via the CONN("name") function:
 *   =QUERY(CONN("analytics_events"), "SELECT * FROM events")
 *
 * The connection name refers to a pre-configured connection in the
 * connection manager, which holds the actual connection details
 * (type, host, port, database, credentials).
 */
export interface ConnectionRef {
  /** The connection name (as passed to CONN()) */
  name: string;
}

/**
 * Supported database types for QUERY formulas.
 */
export type QueryDatabaseType = 'clickhouse' | 'postgres' | 'mysql' | 'bigquery' | 'duckdb';

// =============================================================================
// Query Parameter Types
// =============================================================================

/**
 * A parameter in a QUERY formula.
 * Parameters can be:
 * - Cell references (resolved at execution time)
 * - Literal values (string, number, boolean, null)
 */
export type QueryParameter =
  | { type: 'cellRef'; cellId: CellId }
  | { type: 'literal'; value: CellValue };

/**
 * Resolved parameter values ready for query execution.
 */
export type ResolvedQueryParameter = CellValue;

// =============================================================================
// Query Execution Types
// =============================================================================

/**
 * Status of a query execution.
 */
export type QueryStatus = 'idle' | 'executing' | 'success' | 'error';

/**
 * Result of executing a QUERY formula.
 *
 * NOTE: This is the formula-level result type (with status lifecycle).
 * For the database proxy response type (with success: boolean), see
 * QueryResult in kernel/services/query-executor/types.ts.
 */
export interface QueryFormulaResult {
  status: QueryStatus;
  data?: CellValue[][];
  columnNames?: string[];
  columnTypes?: string[];
  rowCount?: number;
  executionTimeMs?: number;
  error?: string;
  executedAt?: number;
}

// =============================================================================
// Query Cache Types
// =============================================================================

export interface QueryCacheKey {
  cellId: CellId;
  sql: string;
  paramValues: string;
}

export interface QueryFormulaCacheEntry {
  key: QueryCacheKey;
  result: QueryFormulaResult;
  cachedAt: number;
  ttlMs: number;
}

// =============================================================================
// Query Refresh Policy Types
// =============================================================================

export type QueryRefreshPolicy =
  | { type: 'manual' }
  | { type: 'onParamChange' }
  | { type: 'interval'; intervalMs: number };

// =============================================================================
// Query Spill Types
// =============================================================================

export interface QuerySpillInfo {
  anchorCellId: CellId;
  sheetId: SheetId;
  rows: number;
  cols: number;
  hasHeaders: boolean;
}

// =============================================================================
// Query Formula Specification
// =============================================================================

export interface QueryFormulaSpec {
  connectionName: string;
  sql: string;
  parameters: QueryParameter[];
  refreshPolicy: QueryRefreshPolicy;
  includeHeaders: boolean;
}

// =============================================================================
// Query Error Types
// =============================================================================

/**
 * Error types for QUERY formula execution.
 *
 * NOTE: This is the formula-level error type (includes spill_blocked, parameter_error).
 * For the database proxy error type (includes network_error, invalid_sql), see
 * QueryErrorType in kernel/services/query-executor/types.ts.
 */
export type QueryFormulaErrorType =
  | 'connection_not_found'
  | 'connection_error'
  | 'sql_syntax_error'
  | 'execution_error'
  | 'timeout'
  | 'result_too_large'
  | 'parameter_error'
  | 'spill_blocked';

export interface QueryFormulaError {
  type: QueryFormulaErrorType;
  message: string;
  details?: Record<string, unknown>;
}

// =============================================================================
// Query Configuration Types
// =============================================================================

export interface QueryExecutionConfig {
  timeoutMs: number;
  maxRows: number;
  includeHeaders: boolean;
}

// =============================================================================
// Calculator-Kernel Query Types (Database Connection Markers)
// =============================================================================

/**
 * Connection handle returned by CONN("name") formula.
 * This is a marker type that the calculator returns to indicate a connection reference.
 * The kernel resolves this to actual connection details.
 */
export interface ConnectionHandle {
  __connection__: string;
}

/**
 * Query request marker returned by QUERY() when result is not cached.
 * This is returned by the calculator to signal the kernel to execute the query.
 * The kernel intercepts this marker and replaces it with the actual query result.
 */
export interface QueryRequest {
  __queryRequest__: true;
  connection: string;
  sql: string;
  params: CellValue[];
}

/**
 * Query error wrapper for query execution failures.
 * Returned by the kernel when a query fails to execute.
 */
export interface QueryErrorMarker {
  __queryError__: true;
  message: string;
  code?: string;
}
